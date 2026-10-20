import type { InvalidationMessage } from '@agentic-crm/realtime';
import { describe, expect, it } from 'vitest';
import { invalidationFilters } from './invalidation';

const msg = (resource: InvalidationMessage['resource'], resourceId: string | null): InvalidationMessage => ({
  type: 'invalidate',
  seq: '1',
  workspaceId: 'w',
  resource,
  resourceId,
  scope: {},
});

const keysOf = (m: InvalidationMessage) => invalidationFilters(m).map((f) => f.queryKey);

describe('slice 5 invalidations', () => {
  it('a notification refreshes the inbox list and the unread count, not the whole workspace', () => {
    expect(keysOf(msg('notification', 'g1'))).toEqual([['ws', 'w', 'notification']]);
    expect(keysOf(msg('notification', null))).toEqual([['ws', 'w', 'notification']]);
  });

  it('notification preferences are their own resource', () => {
    expect(keysOf(msg('notification-preferences', null))).toEqual([['ws', 'w', 'notification-preferences']]);
  });
});
