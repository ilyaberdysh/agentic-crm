import type { AiAssistantPart, AiStep, AiStreamEvent, AiTurn } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import { applyStreamEvent, isLive, type LiveTurn, reopened, seedLiveTurn } from './reducer';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TURN = ID(1);
const STEP1 = ID(11);
const STEP2 = ID(12);

const text = (content: string, status: 'streaming' | 'completed' = 'streaming'): AiAssistantPart => ({
  id: 'p-text',
  type: 'text',
  status,
  content,
});

function step(id: string, index: number, parts: AiAssistantPart[]): AiStep {
  return { id, index, status: 'executing-llm', parts, createdAt: '2026-10-10T10:00:00.000Z', completedAt: null };
}

function turn(steps: AiStep[], status: AiTurn['status'] = 'executing'): AiTurn {
  return {
    id: TURN,
    threadId: ID(2),
    parentTurnId: ID(3),
    role: 'assistant',
    parts: [],
    status,
    model: 'claude-opus-5-5',
    modelMode: 'auto',
    refinement: null,
    steps,
    pendingApprovals: [],
    creditCost: null,
    contextTokens: null,
    failureReason: null,
    feedback: null,
    createdByMemberId: ID(4),
    createdAt: '2026-10-10T10:00:00.000Z',
    completedAt: null,
    canceledAt: null,
    failedAt: null,
  };
}

const turnEvent = (seq: number, t: AiTurn): AiStreamEvent => ({ type: 'turn', seq, turn: t });
const partEvent = (seq: number, stepId: string, partIndex: number, part: AiAssistantPart): AiStreamEvent => ({
  type: 'part',
  seq,
  turnId: TURN,
  stepId,
  partIndex,
  part,
});
const doneEvent = (seq: number, status: 'completed' | 'failed' | 'canceled' | 'awaiting-approval'): AiStreamEvent => ({
  type: 'done',
  seq,
  turnId: TURN,
  status,
});

const answer = (state: LiveTurn | undefined, stepId = STEP1) => {
  const part = state?.turn.steps.find((s) => s.id === stepId)?.parts[0];
  return part?.type === 'text' ? part.content : undefined;
};

describe('stream reducer', () => {
  it('replaces a part with newer cumulative snapshots and drops older or duplicate ones', () => {
    let s = applyStreamEvent(undefined, turnEvent(100, turn([step(STEP1, 0, [text('')])])));
    s = applyStreamEvent(s, partEvent(110, STEP1, 0, text('Hel')));
    s = applyStreamEvent(s, partEvent(130, STEP1, 0, text('Hello wor')));
    expect(answer(s)).toBe('Hello wor');
    // Out of order: 120 < 130.
    s = applyStreamEvent(s, partEvent(120, STEP1, 0, text('Hello')));
    expect(answer(s)).toBe('Hello wor');
    // Duplicate.
    const same = applyStreamEvent(s, partEvent(130, STEP1, 0, text('Hello wor')));
    expect(same).toBe(s);
    s = applyStreamEvent(s, partEvent(140, STEP1, 0, text('Hello world', 'completed')));
    expect(answer(s)).toBe('Hello world');
  });

  it('ignores part snapshots older than the turn snapshot they extend', () => {
    let s = applyStreamEvent(undefined, turnEvent(200, turn([step(STEP1, 0, [text('Hello world')])])));
    s = applyStreamEvent(s, partEvent(150, STEP1, 0, text('Hel')));
    expect(answer(s)).toBe('Hello world');
  });

  it('keeps newer part snapshots when an older turn snapshot arrives late', () => {
    let s = applyStreamEvent(undefined, turnEvent(100, turn([step(STEP1, 0, [text('')])])));
    s = applyStreamEvent(s, partEvent(150, STEP1, 0, text('abc')));
    const late = applyStreamEvent(s, turnEvent(90, turn([step(STEP1, 0, [text('')])])));
    expect(late).toBe(s);
  });

  it('holds a part for a step that has not arrived and applies it with the turn event that adds the step', () => {
    let s = applyStreamEvent(undefined, turnEvent(100, turn([step(STEP1, 0, [text('first', 'completed')])])));
    s = applyStreamEvent(s, partEvent(160, STEP2, 0, text('second')));
    expect(s?.turn.steps).toHaveLength(1);
    s = applyStreamEvent(
      s,
      turnEvent(150, turn([step(STEP1, 0, [text('first', 'completed')]), step(STEP2, 1, [text('')])])),
    );
    expect(answer(s, STEP2)).toBe('second');
  });

  it('seeds from the stored turn when a part arrives before any turn event (late room joiner)', () => {
    const stored = turn([step(STEP1, 0, [text('')])]);
    expect(applyStreamEvent(undefined, partEvent(10, STEP1, 0, text('x')))).toBeUndefined();
    const s = applyStreamEvent(undefined, partEvent(10, STEP1, 0, text('x')), stored);
    expect(answer(s)).toBe('x');
    expect(s?.turnSeq).toBe(0);
  });

  it('tracks done, and a newer turn event after an approval reopens the stream', () => {
    let s = applyStreamEvent(undefined, turnEvent(100, turn([step(STEP1, 0, [text('hi')])])));
    expect(isLive(s)).toBe(true);
    s = applyStreamEvent(s, doneEvent(120, 'awaiting-approval'));
    expect(s?.done).toBe('awaiting-approval');
    expect(isLive(s)).toBe(false);
    // The snapshot a reopened stream starts with is as old as the stored turn (seq 0): still done until it runs.
    s = applyStreamEvent(s, turnEvent(0, turn([step(STEP1, 0, [text('hi')])])));
    expect(s?.done).toBe('awaiting-approval');
    expect(isLive(reopened(s))).toBe(true);
    s = applyStreamEvent(s, turnEvent(300, turn([step(STEP1, 0, [text('hi')])])));
    expect(s?.done).toBeNull();
    s = applyStreamEvent(s, doneEvent(400, 'completed'));
    expect(s?.done).toBe('completed');
  });

  it('starts from a stored snapshot', () => {
    const s = seedLiveTurn(turn([step(STEP1, 0, [text('stored', 'completed')])], 'completed'));
    expect(s.turnSeq).toBe(0);
    expect(answer(s)).toBe('stored');
  });
});
