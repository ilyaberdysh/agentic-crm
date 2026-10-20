import type { InvalidationMessage } from '@agentic-crm/realtime';
import { describe, expect, it } from 'vitest';
import { invalidationFilters } from './invalidation';

const msg = (
  resource: InvalidationMessage['resource'],
  resourceId: string | null,
  scope: Record<string, unknown> = {},
): InvalidationMessage => ({ type: 'invalidate', seq: '1', workspaceId: 'w', resource, resourceId, scope });

const keysOf = (m: InvalidationMessage) => invalidationFilters(m).map((f) => f.queryKey);

describe('slice 10 Ask AI invalidations', () => {
  it('thread and turn changes refresh the thread detail, the thread list and turn reads', () => {
    for (const resource of ['ai-thread', 'ai-thread-list', 'ai-turn', 'ai-turn-list'] as const) {
      expect(keysOf(msg(resource, 't1', { threadId: 't1' }))).toEqual([
        ['ws', 'w', 'ai-thread'],
        ['ws', 'w', 'ai-thread-list'],
        ['ws', 'w', 'ai-turn'],
      ]);
    }
  });

  it('prompts, settings, credits and summaries refresh only their own prefixes', () => {
    expect(keysOf(msg('ai-prompt', 'p1'))).toEqual([
      ['ws', 'w', 'ai-prompt'],
      ['ws', 'w', 'ai-prompt-list'],
    ]);
    expect(keysOf(msg('ai-settings', null, { memberId: 'm' }))).toEqual([['ws', 'w', 'ai-settings']]);
    expect(keysOf(msg('credit-usage', null))).toEqual([['ws', 'w', 'credit-usage']]);
    expect(keysOf(msg('record-ai-summary', 'def', { entityInstanceIds: ['r'] }))).toEqual([
      ['ws', 'w', 'record-ai-summary'],
    ]);
  });
});
