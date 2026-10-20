// The live side of a thread: snapshots of turns being streamed (SSE in the tab that sent / resumed them, ephemeral room
// messages in other tabs), optimistic turns of messages just sent, and the SSE connections themselves. A module-level
// store (not React state) so a stream outlives the component that opened it: moving a chat between the side panel and
// the full page keeps the answer streaming. The persisted turn reaches the thread query through invalidations; once a
// stream ended and the thread was refetched, the live snapshot is dropped and the query is the truth again.
import type { AiStreamEvent, AiTurn } from '@agentic-crm/contracts';
import { queryClient } from '../../../data/queryClient';
import { getCurrentWorkspace, type WorkspaceRef } from '../../../data/trpc';
import { askKeys } from '../data';
import { applyStreamEvent, type LiveTurn, reopened } from './reducer';
import { readTurnStream } from './sse';

type Listener = () => void;

export interface StreamFailure {
  status: number;
  code?: string;
  message: string;
}

class LiveStore {
  private turns = new Map<string, LiveTurn>();
  private optimistic = new Map<string, AiTurn[]>();
  private streams = new Map<string, AbortController>();
  private failures = new Map<string, StreamFailure>();
  private attempts = new Map<string, number>();
  private listeners = new Set<Listener>();
  private version = 0;
  private cache = new Map<string, { version: number; value: ThreadLive }>();

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private bump(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Applies a stream event (SSE or room message). */
  apply(event: AiStreamEvent, ws?: WorkspaceRef): void {
    const turnId = event.type === 'turn' ? event.turn.id : event.turnId;
    const prev = this.turns.get(turnId);
    const seed = prev ? null : this.storedTurn(turnId, ws);
    const next = applyStreamEvent(prev, event, seed);
    if (next === prev) return;
    if (next) this.turns.set(turnId, next);
    this.bump();
    // A viewer without a stream of its own (another tab) learns the turn ended from the room: refetch and settle.
    if (event.type === 'done' && !this.streams.has(turnId) && next) {
      const workspace = ws ?? getCurrentWorkspace();
      if (workspace) void this.settle(workspace, next.turn.threadId, turnId);
    }
  }

  private storedTurn(turnId: string, ws?: WorkspaceRef): AiTurn | null {
    const workspace = ws ?? getCurrentWorkspace();
    if (!workspace) return null;
    const details = queryClient.getQueriesData<{ turns: AiTurn[] }>({ queryKey: askKeys.threadAll(workspace.id) });
    for (const [, data] of details) {
      const found = data?.turns.find((t) => t.id === turnId);
      if (found) return found;
    }
    return null;
  }

  hasStream(turnId: string): boolean {
    return this.streams.has(turnId);
  }

  failureOf(turnId: string): StreamFailure | undefined {
    return this.failures.get(turnId);
  }

  /** Opens the SSE stream of an assistant turn (idempotent while one is open). */
  startStream(ws: WorkspaceRef, threadId: string, turnId: string): void {
    if (this.streams.has(turnId)) return;
    const controller = new AbortController();
    this.streams.set(turnId, controller);
    this.failures.delete(turnId);
    const prev = this.turns.get(turnId);
    const reopen = reopened(prev);
    if (reopen && reopen !== prev) this.turns.set(turnId, reopen);
    this.attempts.set(turnId, (this.attempts.get(turnId) ?? 0) + 1);
    this.bump();
    readTurnStream({
      workspaceSlug: ws.slug,
      threadId,
      turnId,
      signal: controller.signal,
      onEvent: (event) => this.apply(event, ws),
    })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const status = (error as { status?: number }).status ?? 0;
        this.failures.set(turnId, {
          status,
          code: (error as { code?: string }).code,
          message: error instanceof Error ? error.message : 'The connection was interrupted',
        });
      })
      .finally(() => {
        this.streams.delete(turnId);
        void this.settle(ws, threadId, turnId);
      });
  }

  stopStream(turnId: string): void {
    this.streams.get(turnId)?.abort();
    this.streams.delete(turnId);
  }

  /** Whether a resumed stream for this turn is still worth trying (a stream that keeps failing is not retried). */
  canResume(turnId: string): boolean {
    return !this.streams.has(turnId) && (this.attempts.get(turnId) ?? 0) < 3 && !this.failures.has(turnId);
  }

  /** After a stream ended: refetch the persisted thread, then let it take over from the live snapshot. */
  private async settle(ws: WorkspaceRef, threadId: string, turnId: string): Promise<void> {
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: askKeys.thread(ws.id, threadId) }),
        queryClient.invalidateQueries({ queryKey: askKeys.threadsAll(ws.id) }),
      ]);
    } finally {
      const state = this.turns.get(turnId);
      if (state && (state.done !== null || !this.streams.has(turnId))) {
        this.turns.delete(turnId);
        this.bump();
      }
    }
  }

  // ---- optimistic turns --------------------------------------------------------------------------------------------------

  addOptimistic(threadId: string, turns: AiTurn[]): void {
    this.optimistic.set(threadId, [...(this.optimistic.get(threadId) ?? []), ...turns]);
    this.bump();
  }

  /** Drops the optimistic turns the persisted thread now contains (or all of them with `all`). */
  reconcile(threadId: string, persistedIds: ReadonlySet<string>, all = false): void {
    const list = this.optimistic.get(threadId);
    if (!list) return;
    const keep = all ? [] : list.filter((t) => !persistedIds.has(t.id));
    if (keep.length === list.length) return;
    if (keep.length === 0) this.optimistic.delete(threadId);
    else this.optimistic.set(threadId, keep);
    this.bump();
  }

  /** The send failed: the optimistic turns go away. */
  discardOptimistic(threadId: string, ids: readonly string[]): void {
    const list = this.optimistic.get(threadId);
    if (!list) return;
    const keep = list.filter((t) => !ids.includes(t.id));
    if (keep.length === 0) this.optimistic.delete(threadId);
    else this.optimistic.set(threadId, keep);
    this.bump();
  }

  // ---- reads ---------------------------------------------------------------------------------------------------------------

  /** Live snapshots and optimistic turns of a thread (memoised per store version). */
  forThread(threadId: string): ThreadLive {
    const hit = this.cache.get(threadId);
    if (hit && hit.version === this.version) return hit.value;
    const live = new Map<string, AiTurn>();
    for (const [id, state] of this.turns) if (state.turn.threadId === threadId) live.set(id, state.turn);
    const states = new Map<string, LiveTurn>();
    for (const [id, state] of this.turns) if (state.turn.threadId === threadId) states.set(id, state);
    const value: ThreadLive = { turns: live, states, optimistic: this.optimistic.get(threadId) ?? [] };
    this.cache.set(threadId, { version: this.version, value });
    return value;
  }

  /** Test hook. */
  reset(): void {
    for (const c of this.streams.values()) c.abort();
    this.turns.clear();
    this.optimistic.clear();
    this.streams.clear();
    this.failures.clear();
    this.attempts.clear();
    this.cache.clear();
    this.bump();
  }
}

export interface ThreadLive {
  turns: ReadonlyMap<string, AiTurn>;
  states: ReadonlyMap<string, LiveTurn>;
  optimistic: readonly AiTurn[];
}

export const liveStore = new LiveStore();
