import type { InvalidationMessage } from '@agentic-crm/realtime';
import { describe, expect, it } from 'vitest';
import { invalidationFilters } from './invalidation';

const msg = (
  resource: InvalidationMessage['resource'],
  resourceId: string | null,
  scope: Record<string, unknown> = {},
): InvalidationMessage => ({ type: 'invalidate', seq: '1', workspaceId: 'w', resource, resourceId, scope });

const keysOf = (m: InvalidationMessage) => invalidationFilters(m).map((f) => f.queryKey);

describe('slice 10 calls invalidations', () => {
  it('a call refreshes its own detail, transcript and speakers, not the whole workspace', () => {
    expect(keysOf(msg('call-recording', 'rec1', { meetingId: 'm1' }))).toEqual([['ws', 'w', 'call-recording', 'rec1']]);
    expect(keysOf(msg('call-recording', null))).toEqual([['ws', 'w', 'call-recording']]);
  });

  it('insights refresh the call that owns them', () => {
    expect(keysOf(msg('call-insight-list', 'rec1', { meetingId: 'm1' }))).toEqual([
      ['ws', 'w', 'call-insight-list', 'rec1'],
    ]);
  });

  it('a template refreshes its detail, the templates index and the insights (isOutdated); the index and member settings their own prefix', () => {
    expect(keysOf(msg('insight-template', 't1'))).toEqual([
      ['ws', 'w', 'insight-template', 't1'],
      ['ws', 'w', 'insight-template-list'],
      ['ws', 'w', 'call-insight-list'],
    ]);
    expect(keysOf(msg('insight-template-list', null))).toEqual([['ws', 'w', 'insight-template-list']]);
    expect(keysOf(msg('member-call-settings', 'm'))).toEqual([['ws', 'w', 'member-call-settings']]);
  });

  it('the Calls list and record Calls tabs refresh on call-recording-list', () => {
    expect(keysOf(msg('call-recording-list', 'm1', { entityInstanceIds: ['r1'] }))).toEqual([
      ['ws', 'w', 'call-recording-list'],
    ]);
  });
});
