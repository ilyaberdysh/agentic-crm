import type { InvalidationMessage } from '@agentic-crm/realtime';
import { describe, expect, it } from 'vitest';
import { invalidationFilters } from './invalidation';

const msg = (
  resource: InvalidationMessage['resource'],
  resourceId: string | null,
  scope: Record<string, unknown> = {},
): InvalidationMessage => ({ type: 'invalidate', seq: '1', workspaceId: 'w', resource, resourceId, scope });

const keysOf = (m: InvalidationMessage) => invalidationFilters(m).map((f) => f.queryKey);

describe('slice 7 invalidations', () => {
  it('personal email resources refresh their own prefix, not the whole workspace', () => {
    for (const resource of [
      'mailbox',
      'mailbox-list',
      'message-draft',
      'message-draft-list',
      'outbox',
      'email-template',
      'email-template-list',
      'mailbox-signature-list',
      'workspace-email-settings',
      'mailbox-blocklist',
    ] as const) {
      expect(keysOf(msg(resource, null))).toEqual([['ws', 'w', resource]]);
    }
  });

  it('synced mail refreshes the thread queries; a grant change also refreshes the grants', () => {
    expect(keysOf(msg('email-thread-list', null, { entityInstanceIds: ['r1'] }))).toEqual([
      ['ws', 'w', 'email-thread-list'],
    ]);
    expect(keysOf(msg('email-grant-list', null))).toEqual([
      ['ws', 'w', 'email-grant-list'],
      ['ws', 'w', 'email-thread-list'],
    ]);
  });

  it('meetings refresh meeting queries and the timelines of their records', () => {
    expect(
      keysOf(msg('meeting-list', 'people', { entityDefinitionId: 'people', entityInstanceIds: ['a', 'b'] })),
    ).toEqual([
      ['ws', 'w', 'meeting'],
      ['ws', 'w', 'meeting-list'],
      ['ws', 'w', 'record-timeline', 'people', 'a'],
      ['ws', 'w', 'record-timeline', 'people', 'b'],
    ]);
    expect(keysOf(msg('meeting', 'm1'))).toEqual([
      ['ws', 'w', 'meeting'],
      ['ws', 'w', 'meeting-list'],
      ['ws', 'w', 'record-timeline'],
    ]);
  });
});
