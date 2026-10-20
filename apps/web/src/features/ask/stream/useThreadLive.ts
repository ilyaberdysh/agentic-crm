import { type AiStreamEvent, type AiTurn, aiThreadRoom } from '@agentic-crm/contracts';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { getRealtimeClient, useConnectionState } from '../../../data/realtime/connection';
import type { WorkspaceRef } from '../../../data/trpc';
import { mergeTurns } from '../thread/tree';
import { liveStore, type ThreadLive } from './live';

const EMPTY: ThreadLive = { turns: new Map(), states: new Map(), optimistic: [] };

/** Live snapshots and optimistic turns of a thread; re-renders on every stream event. */
export function useThreadLiveState(threadId: string | null): ThreadLive {
  const version = useSyncExternalStore(liveStore.subscribe, liveStore.getVersion, liveStore.getVersion);
  return useMemo(() => (threadId ? liveStore.forThread(threadId) : EMPTY), [threadId, version]);
}

/**
 * Everything a thread view needs, in one hook: joins the thread's room (other tabs of the same member stream the answer
 * as ephemeral messages, I4b), resumes the stream of an executing turn found after a reload, reconciles optimistic
 * turns with the persisted ones, and returns the persisted turns with live snapshots folded in.
 */
export function useThreadTurns(ws: WorkspaceRef, threadId: string | null, persisted: readonly AiTurn[] | undefined) {
  const live = useThreadLiveState(threadId);
  const { status } = useConnectionState();
  const client = getRealtimeClient();

  useEffect(() => {
    if (!client || !threadId) return;
    const room = client.joinRoom(aiThreadRoom(ws.id, threadId));
    const off = room.onEphemeral(({ payload }) => {
      if (payload.kind === 'ai-stream' && payload.event) liveStore.apply(payload.event as AiStreamEvent, ws);
    });
    return () => {
      off();
      room.leave();
    };
    // `status` re-joins the room after a reconnect.
  }, [client, status, ws.id, ws.slug, threadId]);

  // Optimistic turns the persisted thread contains are no longer optimistic.
  useEffect(() => {
    if (!threadId || !persisted) return;
    liveStore.reconcile(threadId, new Set(persisted.map((t) => t.id)));
  }, [threadId, persisted]);

  // An executing turn nobody streams in this tab (reload, another tab started it): open its stream.
  useEffect(() => {
    if (!threadId || !persisted) return;
    for (const turn of persisted) {
      if (turn.role !== 'assistant' || turn.status !== 'executing' || turn.pendingApprovals.length > 0) continue;
      if (liveStore.canResume(turn.id)) liveStore.startStream(ws, threadId, turn.id);
    }
  }, [ws, threadId, persisted]);

  return useMemo(
    () =>
      persisted ? mergeTurns(persisted, live.turns, live.optimistic) : mergeTurns([], live.turns, live.optimistic),
    [persisted, live],
  );
}
