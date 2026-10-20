import type { InvalidationMessage } from '@agentic-crm/realtime';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { invalidationFilters } from './invalidation';

const msg = (
  resource: InvalidationMessage['resource'],
  resourceId: string | null,
  scope = {},
): InvalidationMessage => ({
  type: 'invalidate',
  seq: '1',
  workspaceId: 'w',
  resource,
  resourceId,
  scope,
});

const keysOf = (m: InvalidationMessage) => invalidationFilters(m).flatMap((f) => (f.queryKey ? [f.queryKey] : []));

describe('slice 6 invalidations', () => {
  it('teams, rules, tokens and webhooks refresh their own keys (not the whole workspace)', () => {
    expect(keysOf(msg('workspace-team', 't1'))).toEqual([
      ['ws', 'w', 'workspace-team', 't1'],
      ['ws', 'w', 'workspace-team-list'],
    ]);
    expect(keysOf(msg('workspace-team-list', null))).toEqual([['ws', 'w', 'workspace-team-list']]);
    expect(keysOf(msg('requirement-rule-list', 'def', { entityDefinitionId: 'def' }))).toEqual([
      ['ws', 'w', 'requirement-rule-list', 'def'],
    ]);
    expect(keysOf(msg('api-token-list', null))).toEqual([['ws', 'w', 'api-token-list']]);
    expect(keysOf(msg('webhook', 'h1'))).toEqual([
      ['ws', 'w', 'webhook', 'h1'],
      ['ws', 'w', 'webhook-list'],
    ]);
    expect(keysOf(msg('webhook-list', null))).toEqual([['ws', 'w', 'webhook-list']]);
  });

  it('a change of team memberships refreshes resolved policies and permission rows below any definition', async () => {
    const client = new QueryClient();
    const policy = ['ws', 'w', 'entity-definition', 'def1', 'policy'];
    const grants = ['ws', 'w', 'entity-definition', 'def1', 'permissions', 'object'];
    const other = ['ws', 'w', 'entity-definition', 'def1', 'attributes'];
    for (const key of [policy, grants, other]) client.setQueryData(key, 1);
    for (const f of invalidationFilters(msg('entity-definition-list', null))) await client.invalidateQueries(f);
    expect(client.getQueryState(policy)?.isInvalidated).toBe(true);
    expect(client.getQueryState(grants)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBeFalsy();
  });
});
