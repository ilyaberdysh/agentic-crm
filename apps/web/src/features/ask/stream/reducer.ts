// Client state of one streaming assistant turn (slice10-ask-server "Streaming protocol"): applies the events of the
// SSE stream (`turn` / `part` / `done`) and the same events arriving as ephemeral room messages in other tabs.
//   turn  the whole turn: replaces the state when its seq is not older than the last applied turn event;
//   part  one part's cumulative snapshot: replaces the part at `partIndex` of step `stepId` when its seq is newer than
//         the last applied one for that part and newer than the turn snapshot it extends (out-of-order and duplicate
//         events are dropped); a part whose step has not arrived yet waits for the next `turn` event;
//   done  the stream ended (completed | failed | canceled | awaiting-approval).
// Pure: the store and the transport live in live.ts and sse.ts.
import type { AiAssistantPart, AiStreamEvent, AiTurn } from '@agentic-crm/contracts';

export type DoneStatus = 'completed' | 'failed' | 'canceled' | 'awaiting-approval';

export interface LiveTurn {
  turn: AiTurn;
  /** seq of the last applied `turn` event (0 for a snapshot seeded from the stored turn). */
  turnSeq: number;
  /** Last applied seq per `${stepId}:${partIndex}`. */
  partSeq: Record<string, number>;
  /** Parts that arrived before their step: applied by the next `turn` event that contains the step. */
  orphans: Record<string, { stepId: string; partIndex: number; seq: number; part: AiAssistantPart }>;
  done: DoneStatus | null;
  /** seq of the `done` event (a newer `turn` event reopens the stream: the turn resumed after an approval). */
  doneSeq: number;
}

export function seedLiveTurn(turn: AiTurn): LiveTurn {
  return { turn, turnSeq: 0, partSeq: {}, orphans: {}, done: null, doneSeq: 0 };
}

const partKey = (stepId: string, partIndex: number) => `${stepId}:${partIndex}`;

function withPart(turn: AiTurn, stepId: string, partIndex: number, part: AiAssistantPart): AiTurn | null {
  const at = turn.steps.findIndex((s) => s.id === stepId);
  if (at === -1) return null;
  const step = turn.steps[at];
  if (!step) return null;
  const parts = [...step.parts];
  parts[partIndex] = part;
  const steps = [...turn.steps];
  steps[at] = { ...step, parts };
  return { ...turn, steps };
}

/**
 * Applies one event. `seed` (the stored turn) starts the state when a `part` / `done` event arrives before any `turn`
 * event (a tab that joined the room late). Returns the same object when the event changed nothing.
 */
export function applyStreamEvent(
  state: LiveTurn | undefined,
  event: AiStreamEvent,
  seed?: AiTurn | null,
): LiveTurn | undefined {
  if (event.type === 'turn') {
    if (state && event.seq < state.turnSeq) return state;
    let next: LiveTurn = {
      turn: event.turn,
      turnSeq: event.seq,
      partSeq: state ? { ...state.partSeq } : {},
      orphans: {},
      done: state && event.seq <= state.doneSeq ? state.done : null,
      doneSeq: state?.doneSeq ?? 0,
    };
    // The snapshot is as of `event.seq`: part snapshots at or before it are already contained in it.
    next.partSeq = Object.fromEntries(Object.entries(next.partSeq).filter(([, seq]) => seq > event.seq));
    for (const o of Object.values(state?.orphans ?? {})) {
      if (o.seq <= event.seq) continue;
      const turn = withPart(next.turn, o.stepId, o.partIndex, o.part);
      if (turn) next = { ...next, turn, partSeq: { ...next.partSeq, [partKey(o.stepId, o.partIndex)]: o.seq } };
      else next.orphans[partKey(o.stepId, o.partIndex)] = o;
    }
    return next;
  }

  const base = state ?? (seed ? seedLiveTurn(seed) : undefined);
  if (!base) return state;

  if (event.type === 'part') {
    const key = partKey(event.stepId, event.partIndex);
    if (event.seq <= base.turnSeq) return base;
    if ((base.partSeq[key] ?? 0) >= event.seq) return base;
    const turn = withPart(base.turn, event.stepId, event.partIndex, event.part);
    if (!turn) {
      return {
        ...base,
        orphans: {
          ...base.orphans,
          [key]: { stepId: event.stepId, partIndex: event.partIndex, seq: event.seq, part: event.part },
        },
      };
    }
    const { [key]: _drop, ...orphans } = base.orphans;
    return { ...base, turn, partSeq: { ...base.partSeq, [key]: event.seq }, orphans };
  }

  // done
  if (base.done === event.status && base.doneSeq === event.seq) return base;
  if (event.seq < base.doneSeq) return base;
  return { ...base, done: event.status, doneSeq: event.seq };
}

/** The stream of this state may still deliver events (the turn runs, or waits for an approval that resumes it). */
export function isLive(state: LiveTurn | undefined): boolean {
  return Boolean(state && state.done === null);
}

/** A new stream was opened for the turn (after an approval, deny or reload): it is live again until `done`. */
export function reopened(state: LiveTurn | undefined): LiveTurn | undefined {
  return state && state.done !== null ? { ...state, done: null } : state;
}
