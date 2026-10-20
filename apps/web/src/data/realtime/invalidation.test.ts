import type { InvalidationMessage } from '@agentic-crm/realtime';
import { QueryClient, type QueryKey } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import { keys } from '../keys';
import { acceptAfterFor, resetAcceptAfter } from '../trpc';
import { applyContinuityLost, applyInvalidation, invalidationFilters, markCovered, resetCovered } from './invalidation';

const WS = 'ws-1';
const OTHER = 'ws-2';
const DEF = 'def-companies';
const ATTR = 'attr-name';

function msg(partial: Partial<InvalidationMessage> & Pick<InvalidationMessage, 'resource'>): InvalidationMessage {
  return { type: 'invalidate', seq: '10', workspaceId: WS, resourceId: null, scope: {}, ...partial };
}

/** A client with one cached (fresh) query per key. */
function seeded(queryKeys: QueryKey[]): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } } });
  for (const key of queryKeys) client.setQueryData(key, { cached: true });
  return client;
}

function invalidated(client: QueryClient): string[] {
  return client
    .getQueryCache()
    .getAll()
    .filter((q) => q.state.isInvalidated)
    .map((q) => JSON.stringify(q.queryKey))
    .sort();
}

const all: QueryKey[] = [
  keys.me(),
  keys.workspaces(),
  keys.workspace(WS),
  keys.members(WS),
  keys.member(WS, 'm1'),
  keys.objects(WS),
  keys.object(WS, DEF),
  keys.object(WS, 'def-people'),
  keys.attributes(WS, DEF),
  keys.attribute(WS, DEF, ATTR),
  keys.options(WS, DEF, 'attr-status'),
  keys.record(WS, DEF, 'r1'),
  keys.record(WS, DEF, 'r2'),
  keys.values(WS, DEF, ATTR, 'r1'),
  keys.values(WS, DEF, ATTR, 'r2'),
  keys.values(WS, DEF, 'attr-domains', 'r1'),
  keys.views(WS, DEF),
  keys.view(WS, 'v1'),
  keys.snapshot(WS, DEF, 'v1'),
  keys.snapshot(WS, 'def-people', 'v2'),
  keys.objects(OTHER),
  keys.values(OTHER, DEF, ATTR, 'r1'),
];

const s = (k: QueryKey) => JSON.stringify(k);

describe('invalidation → query keys', () => {
  beforeEach(() => {
    resetAcceptAfter();
    resetCovered();
  });

  it('attribute values: only the listed records of that attribute', async () => {
    const client = seeded(all);
    await applyInvalidation(
      client,
      msg({
        resource: 'attribute-value-list',
        resourceId: ATTR,
        scope: { entityDefinitionId: DEF, attributeDefinitionId: ATTR, entityInstanceIds: ['r1'] },
      }),
    );
    expect(invalidated(client)).toEqual([s(keys.values(WS, DEF, ATTR, 'r1'))]);
  });

  it('snapshot-selection: every snapshot of the definition, nothing else', async () => {
    const client = seeded(all);
    await applyInvalidation(
      client,
      msg({ resource: 'snapshot-selection', resourceId: DEF, scope: { entityDefinitionId: DEF } }),
    );
    expect(invalidated(client)).toEqual([s(keys.snapshot(WS, DEF, 'v1'))]);
  });

  it('snapshot-selection naming attributes: only snapshot queries that depend on them', async () => {
    const client = seeded(all);
    const sortedByName = ['ws', WS, 'snapshot', DEF, 'by-name'];
    const sortedByDomain = ['ws', WS, 'snapshot', DEF, 'by-domain'];
    client
      .getQueryCache()
      .build(client, { queryKey: sortedByName, meta: { snapshotDeps: [ATTR] } })
      .setData({});
    client
      .getQueryCache()
      .build(client, { queryKey: sortedByDomain, meta: { snapshotDeps: ['attr-domains'] } })
      .setData({});
    await applyInvalidation(
      client,
      msg({
        resource: 'snapshot-selection',
        resourceId: DEF,
        scope: { entityDefinitionId: DEF, attributeDefinitionIds: [ATTR] },
      }),
    );
    // Queries without declared dependencies stay conservative (always refetch).
    expect(invalidated(client)).toEqual([s(sortedByName), s(keys.snapshot(WS, DEF, 'v1'))].sort());
  });

  it('entity-instance: the record and all its value lists', async () => {
    const client = seeded(all);
    await applyInvalidation(
      client,
      msg({ resource: 'entity-instance', resourceId: 'r1', scope: { entityDefinitionId: DEF } }),
    );
    expect(invalidated(client)).toEqual(
      [
        s(keys.record(WS, DEF, 'r1')),
        s(keys.values(WS, DEF, ATTR, 'r1')),
        s(keys.values(WS, DEF, 'attr-domains', 'r1')),
      ].sort(),
    );
  });

  it('entity-definition-list: the object list of that workspace only', async () => {
    const client = seeded(all);
    await applyInvalidation(client, msg({ resource: 'entity-definition-list' }));
    expect(invalidated(client)).toEqual([s(keys.objects(WS))]);
  });

  it('entity-definition: the definition and the list', async () => {
    const client = seeded(all);
    await applyInvalidation(client, msg({ resource: 'entity-definition', resourceId: DEF }));
    expect(invalidated(client)).toEqual([s(keys.object(WS, DEF)), s(keys.objects(WS))].sort());
  });

  it('attribute-definition with and without its owner in scope', async () => {
    const withOwner = seeded(all);
    await applyInvalidation(
      withOwner,
      msg({ resource: 'attribute-definition', resourceId: ATTR, scope: { entityDefinitionId: DEF } }),
    );
    expect(invalidated(withOwner)).toEqual([s(keys.attribute(WS, DEF, ATTR)), s(keys.attributes(WS, DEF))].sort());

    const without = seeded(all);
    await applyInvalidation(without, msg({ resource: 'attribute-definition', resourceId: ATTR }));
    expect(invalidated(without)).toEqual([s(keys.attribute(WS, DEF, ATTR)), s(keys.attributes(WS, DEF))].sort());
  });

  it('select options, views, members and workspace', async () => {
    const options = seeded(all);
    await applyInvalidation(
      options,
      msg({
        resource: 'select-option-list',
        resourceId: 'attr-status',
        scope: { entityDefinitionId: DEF, attributeDefinitionId: 'attr-status' },
      }),
    );
    expect(invalidated(options)).toEqual([s(keys.options(WS, DEF, 'attr-status'))]);

    const views = seeded(all);
    await applyInvalidation(
      views,
      msg({ resource: 'entity-view', resourceId: 'v1', scope: { entityDefinitionId: DEF } }),
    );
    expect(invalidated(views)).toEqual([s(keys.view(WS, 'v1')), s(keys.views(WS, DEF))].sort());

    const members = seeded(all);
    await applyInvalidation(members, msg({ resource: 'workspace-member', resourceId: 'm1' }));
    expect(invalidated(members)).toEqual([s(keys.members(WS)), s(keys.member(WS, 'm1')), s(keys.workspaces())].sort());

    const workspace = seeded(all);
    await applyInvalidation(workspace, msg({ resource: 'workspace', resourceId: WS }));
    expect(invalidated(workspace)).toEqual([s(keys.workspaces()), s(keys.workspace(WS))].sort());
  });

  it('records the seq as the accept-after watermark (monotonic)', async () => {
    const client = seeded(all);
    await applyInvalidation(client, msg({ resource: 'entity-definition-list', seq: '42' }));
    expect(acceptAfterFor(WS)).toBe('42');
    await applyInvalidation(client, msg({ resource: 'entity-definition-list', seq: '9' }));
    expect(acceptAfterFor(WS)).toBe('42');
    await applyInvalidation(client, msg({ resource: 'entity-definition-list', seq: '100' }));
    expect(acceptAfterFor(WS)).toBe('100');
    expect(acceptAfterFor(OTHER)).toBeUndefined();
  });

  it('skips keys already reconciled from our own mutation response (seq ≤ response seq), never snapshots', async () => {
    const valueKey = keys.values(WS, DEF, ATTR, 'r1');
    markCovered(valueKey, '50');
    const echo = msg({
      resource: 'attribute-value-list',
      resourceId: ATTR,
      seq: '50',
      scope: { entityDefinitionId: DEF, attributeDefinitionId: ATTR, entityInstanceIds: ['r1'] },
    });
    const client = seeded(all);
    await applyInvalidation(client, echo);
    await applyInvalidation(
      client,
      msg({ resource: 'snapshot-selection', resourceId: DEF, seq: '50', scope: { entityDefinitionId: DEF } }),
    );
    expect(invalidated(client)).toEqual([s(keys.snapshot(WS, DEF, 'v1'))]);

    // A newer change by someone else is refetched.
    await applyInvalidation(client, { ...echo, seq: '51' });
    expect(invalidated(client)).toContain(s(valueKey));
  });

  it('record page: value changes and child writes refresh the record activity; layouts and files by key', async () => {
    const timeline1 = keys.recordTimeline(WS, DEF, 'r1');
    const counts1 = [...timeline1, 'counts'];
    const timeline2 = keys.recordTimeline(WS, DEF, 'r2');
    const layout = keys.customLayout(WS, DEF);
    const files1 = [...keys.storageEntries(WS, DEF, 'r1'), 'root'];
    const prefs = keys.memberPreferences(WS);
    const extra = [timeline1, counts1, timeline2, layout, files1, prefs];

    let client = seeded([...all, ...extra]);
    await applyInvalidation(
      client,
      msg({
        resource: 'attribute-value-list',
        resourceId: ATTR,
        scope: { entityDefinitionId: DEF, attributeDefinitionId: ATTR, entityInstanceIds: ['r1'] },
      }),
    );
    expect(invalidated(client)).toEqual([s(counts1), s(timeline1), s(keys.values(WS, DEF, ATTR, 'r1'))].sort());

    client = seeded([...all, ...extra]);
    await applyInvalidation(
      client,
      msg({
        resource: 'record-timeline',
        resourceId: DEF,
        scope: { entityDefinitionId: DEF, entityInstanceIds: ['r2'] },
      }),
    );
    expect(invalidated(client)).toEqual([s(timeline2)]);

    client = seeded([...all, ...extra]);
    await applyInvalidation(
      client,
      msg({ resource: 'custom-layout', resourceId: 'l1', scope: { entityDefinitionId: DEF } }),
    );
    expect(invalidated(client)).toEqual([s(layout)]);

    client = seeded([...all, ...extra]);
    await applyInvalidation(
      client,
      msg({
        resource: 'storage-entry-list',
        resourceId: 'r1',
        scope: { entityDefinitionId: DEF, entityInstanceId: 'r1', parentFolderIds: [null] },
      }),
    );
    expect(invalidated(client)).toEqual([s(files1)]);

    client = seeded([...all, ...extra]);
    await applyInvalidation(client, msg({ resource: 'member-preferences', resourceId: 'm1' }));
    expect(invalidated(client)).toEqual([s(prefs)]);
    expect(invalidationFilters(msg({ resource: 'upload-session', resourceId: 'u1' }))).toEqual([]);
  });

  it('document: only that document (collab saves must not refetch the workspace)', async () => {
    const client = seeded([...all, keys.document(WS, 'doc-1'), keys.document(WS, 'doc-2')]);
    await applyInvalidation(client, msg({ resource: 'document', resourceId: 'doc-1', scope: { docType: 'note' } }));
    expect(invalidated(client)).toEqual([s(keys.document(WS, 'doc-1'))]);
  });

  it('unknown resources invalidate the whole workspace', () => {
    const filters = invalidationFilters(msg({ resource: 'something-new' as InvalidationMessage['resource'] }));
    expect(filters).toEqual([{ queryKey: keys.ws(WS) }]);
  });

  it('continuity lost: everything of the workspace (plus the workspace list), or everything', async () => {
    const scoped = seeded(all);
    await applyContinuityLost(scoped, WS);
    const hit = invalidated(scoped);
    expect(hit).toContain(s(keys.values(WS, DEF, ATTR, 'r1')));
    expect(hit).toContain(s(keys.workspaces()));
    expect(hit).not.toContain(s(keys.objects(OTHER)));
    expect(hit).not.toContain(s(keys.me()));

    const global = seeded(all);
    await applyContinuityLost(global, undefined);
    expect(invalidated(global)).toHaveLength(all.length);
  });

  it('active queries refetch on invalidation', async () => {
    const client = new QueryClient();
    let calls = 0;
    const observerKey = keys.objects(WS);
    const { QueryObserver } = await import('@tanstack/react-query');
    const observer = new QueryObserver(client, {
      queryKey: observerKey,
      queryFn: async () => {
        calls += 1;
        return calls;
      },
      staleTime: Number.POSITIVE_INFINITY,
    });
    const unsubscribe = observer.subscribe(() => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(1);
    await applyInvalidation(client, msg({ resource: 'entity-definition-list' }));
    expect(calls).toBe(2);
    unsubscribe();
  });
});
