import type { AiTurn } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import { defaultLeaf, linearize, mergeTurns, replyTarget } from './tree';

function t(
  id: string,
  parent: string | null,
  role: 'user' | 'assistant',
  createdAt: string,
  extra: Partial<AiTurn> = {},
) {
  return {
    id,
    threadId: 'th',
    parentTurnId: parent,
    role,
    parts: [],
    status: 'completed',
    model: null,
    modelMode: null,
    refinement: null,
    steps: [],
    pendingApprovals: [],
    creditCost: null,
    contextTokens: null,
    failureReason: null,
    feedback: null,
    createdByMemberId: 'm',
    createdAt,
    completedAt: null,
    canceledAt: null,
    failedAt: null,
    ...extra,
  } as AiTurn;
}

const u1 = t('u1', null, 'user', '2026-10-10T10:00:00Z');
const a1 = t('a1', 'u1', 'assistant', '2026-10-10T10:00:00Z');
const u2 = t('u2', 'a1', 'user', '2026-10-10T10:05:00Z');
const a2 = t('a2', 'u2', 'assistant', '2026-10-10T10:05:00Z');
// "Try again" on the first answer: a sibling of a1 created later than a2's branch.
const a1b = t('a1b', 'u1', 'assistant', '2026-10-10T10:10:00Z');

describe('thread tree', () => {
  it('walks from the default leaf to the root', () => {
    expect(linearize([u1, a1, u2, a2]).map((x) => x.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(linearize([a2, u1, u2, a1]).map((x) => x.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('prefers the deeper turn when creation times tie', () => {
    expect(defaultLeaf([u1, a1])?.id).toBe('a1');
  });

  it('follows the newest branch after "try again" and can focus another leaf', () => {
    const all = [u1, a1, u2, a2, a1b];
    expect(linearize(all).map((x) => x.id)).toEqual(['u1', 'a1b']);
    expect(linearize(all, 'a2').map((x) => x.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('survives a missing parent and an empty thread', () => {
    expect(linearize([a2]).map((x) => x.id)).toEqual(['a2']);
    expect(linearize([])).toEqual([]);
  });

  it('merges live snapshots and optimistic turns without duplicates', () => {
    const live = new Map([['a1', { ...a1, status: 'executing' } as AiTurn]]);
    const merged = mergeTurns([u1, a1], live, [u1, t('u9', 'a1', 'user', '2026-10-10T11:00:00Z')]);
    expect(merged.map((x) => `${x.id}:${x.status}`)).toEqual(['u1:completed', 'a1:executing', 'u9:completed']);
  });

  it('replies go under the last assistant turn', () => {
    expect(replyTarget([u1, a1, u2])?.id).toBe('a1');
    expect(replyTarget([u1])).toBeNull();
  });
});
