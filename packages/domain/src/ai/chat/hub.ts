// In-process fan-out of Ask Agentic stream events (slice10-contracts: SSE for the requesting tab, ephemeral room
// messages for other viewers). The turn runner publishes; apps/api subscribes once to forward events into the
// `thread:<ws>:<threadId>` room and per SSE connection to one turn. Nothing here is persisted (I4b): the persisted
// turn reaches clients through the `ai-turn` invalidation when a step or the turn completes.
import type { AiStreamEvent, AiTurn } from '@agentic-crm/contracts';

export interface AiStreamEnvelope {
  workspaceId: string;
  threadId: string;
  turnId: string;
  event: AiStreamEvent;
}

type Listener = (envelope: AiStreamEnvelope) => void;

export class AiTurnHub {
  private seq = Date.now() * 1000;
  private readonly listeners = new Set<Listener>();
  private readonly byTurn = new Map<string, Set<Listener>>();
  /** Latest full snapshot of turns being executed in this process (late SSE subscribers start from it). */
  private readonly live = new Map<string, { workspaceId: string; turn: AiTurn; seq: number }>();

  /** Monotonic event sequence (epoch-µs based so it keeps increasing across restarts). */
  nextSeq(): number {
    this.seq = Math.max(this.seq + 1, Date.now() * 1000);
    return this.seq;
  }

  publish(envelope: AiStreamEnvelope): void {
    const { event } = envelope;
    if (event.type === 'turn') {
      this.live.set(envelope.turnId, { workspaceId: envelope.workspaceId, turn: event.turn, seq: event.seq });
    } else if (event.type === 'part') {
      const live = this.live.get(envelope.turnId);
      const step = live?.turn.steps.find((s) => s.id === event.stepId);
      if (live && step) {
        step.parts[event.partIndex] = event.part;
        live.seq = event.seq;
      }
    } else if (event.type === 'done') {
      this.live.delete(envelope.turnId);
    }
    for (const listener of [...this.listeners, ...(this.byTurn.get(envelope.turnId) ?? [])]) {
      try {
        listener(envelope);
      } catch {
        // A failing subscriber (closed socket) never breaks the runner.
      }
    }
  }

  /** Every event (the API's room forwarder). */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Events of one turn (one SSE connection). */
  subscribeTurn(turnId: string, listener: Listener): () => void {
    let set = this.byTurn.get(turnId);
    if (!set) {
      set = new Set();
      this.byTurn.set(turnId, set);
    }
    set.add(listener);
    return () => {
      const current = this.byTurn.get(turnId);
      current?.delete(listener);
      if (current?.size === 0) this.byTurn.delete(turnId);
    };
  }

  /** The in-flight snapshot of a running turn, if this process runs it. */
  liveTurn(turnId: string, workspaceId: string): { turn: AiTurn; seq: number } | null {
    const live = this.live.get(turnId);
    return live && live.workspaceId === workspaceId ? { turn: structuredClone(live.turn), seq: live.seq } : null;
  }
}
