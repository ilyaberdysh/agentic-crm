import type { Path, Predicate, ValueInput } from '@agentic-crm/contracts';
import { zebraFromIndices } from '@agentic-crm/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { recordOps } from '../src/records/service.ts';
import { runInWorkspace } from '../src/tx.ts';
import { createWorkspace, database, domain, expectCode, newId, type TestWorkspace } from './support/harness.ts';

interface Item {
  id: string;
  title: string;
  amount: number | null;
  color: number | null; // option index
  tags: number[];
  dueDaysAgo: number;
}

const N = 1205;
let ws: TestWorkspace;
let objectId: string;
const attr: Record<string, string> = {};
let colorIds: string[] = [];
let tagIds: string[] = [];
const items: Item[] = [];

const p = (slug: string): Path => [{ entityDefinitionId: objectId, attributeDefinitionId: attr[slug] as string }];
const leaf = (
  slug: string,
  mode: 'must' | 'must-not',
  constraints: Predicate extends never
    ? never
    : { field: string; operator: string; value?: unknown; valueType?: 'static' | 'dynamic' }[],
) => ({ path: p(slug), mode, constraints }) as Predicate;
const dateDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  ws = await createWorkspace();
  const object = await domain.schema.createObject(ws.ctx, {
    id: newId(),
    apiSlug: 'items',
    singularNoun: 'Item',
    pluralNoun: 'Items',
  });
  objectId = object.id;
  const create = async (title: string, type: string, extra: Record<string, unknown> = {}) => {
    const a = await domain.schema.createAttribute(ws.ctx, {
      id: newId(),
      entityDefinitionId: objectId,
      title,
      type: type as never,
      ...extra,
    });
    attr[a.apiSlug] = a.id;
    return a;
  };
  await create('Title', 'text');
  await create('Amount', 'number');
  await create('Color', 'select', { options: [{ title: 'Red' }, { title: 'Green' }, { title: 'Blue' }] });
  await create('Tags', 'select', {
    isMultiselect: true,
    options: [{ title: 'alpha' }, { title: 'beta' }, { title: 'gamma' }],
  });
  await create('Due', 'date');
  colorIds = (
    await domain.schema.listOptions(ws.ctx, {
      entityDefinitionId: objectId,
      attributeDefinitionId: attr.color as string,
    })
  ).map((o) => o.id);
  tagIds = (
    await domain.schema.listOptions(ws.ctx, {
      entityDefinitionId: objectId,
      attributeDefinitionId: attr.tags as string,
    })
  ).map((o) => o.id);

  // Deterministic data with ties, empties and multi values.
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const words = ['alpha', 'Beta', 'gamma', 'delta', 'Épsilon', 'zeta', 'eta', 'theta'];
  for (let i = 0; i < N; i++) {
    const title = `${words[Math.floor(rnd() * words.length)]} item ${Math.floor(rnd() * 400)}`;
    items.push({
      id: newId(),
      title,
      amount: rnd() < 0.1 ? null : Math.floor(rnd() * 1000),
      color: rnd() < 0.15 ? null : Math.floor(rnd() * 3),
      tags: [0, 1, 2].filter(() => rnd() < 0.3),
      dueDaysAgo: rnd() < 0.5 ? 3 : 30,
    });
  }
  // Bulk insert in batches of 50 records per transaction (each record still goes through the single write path).
  // Short transactions matter: a long one would hold back the cluster-wide snapshot xmin that other suites'
  // change-feed consumers wait on.
  for (let start = 0; start < items.length; start += 50) {
    await insertBatch(items.slice(start, start + 50));
  }
}, 300_000);

async function insertBatch(batch: Item[]): Promise<void> {
  await runInWorkspace(database, ws.ctx, async (tx) => {
    for (const it of batch) {
      const values: Record<string, ValueInput[]> = {
        title: [{ value: it.title }],
        due: [{ value: dateDaysAgo(it.dueDaysAgo) }],
        tags: it.tags.map((t) => ({ value: { selectOptionId: tagIds[t] } })),
      };
      if (it.amount !== null) values.amount = [{ value: it.amount }];
      if (it.color !== null) values.color = [{ value: { selectOptionId: colorIds[it.color] } }];
      await recordOps.create(tx, { entityDefinitionId: objectId, entityInstanceId: it.id, values });
    }
  });
}

const byId = (a: Item, b: Item, dir: 1 | -1) => (a.id < b.id ? -dir : a.id > b.id ? dir : 0);
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

describe('query snapshots', () => {
  it('orders, counts and pages a 1,205-row snapshot in 1,000-id chunks', async () => {
    const snap = await domain.views.query(ws.ctx, {
      entityDefinitionId: objectId,
      sorts: [{ path: p('amount'), direction: 'desc' }],
    });
    const expected = [...items]
      .sort((a, b) => {
        if (a.amount === b.amount) return byId(a, b, -1);
        if (a.amount === null) return 1;
        if (b.amount === null) return -1;
        return b.amount - a.amount;
      })
      .map((i) => i.id);
    expect(snap.total).toBe(N);
    expect(snap.ids).toHaveLength(1000);
    expect(snap.ids).toEqual(expected.slice(0, 1000));
    const second = await domain.views.chunk(ws.ctx, { snapshotId: snap.snapshotId, start: 1000, size: 1000 });
    expect(second.ids).toEqual(expected.slice(1000));
    const boundary = await domain.views.chunk(ws.ctx, { snapshotId: snap.snapshotId, start: 990, size: 20 });
    expect(boundary.ids).toEqual(expected.slice(990, 1010));
    expect((await domain.views.chunk(ws.ctx, { snapshotId: snap.snapshotId, start: 5000, size: 10 })).ids).toEqual([]);

    // Selections are index intervals over the frozen snapshot.
    const edges = zebraFromIndices([0, 1, 2, 1000, 1001, 1204]);
    const selection = await domain.views.resolveSelection(ws.ctx, { snapshotId: snap.snapshotId, zebraEdges: edges });
    expect(selection.ids).toEqual([
      expected[0],
      expected[1],
      expected[2],
      expected[1000],
      expected[1001],
      expected[1204],
    ]);
    const all = await domain.views.resolveSelection(ws.ctx, { snapshotId: snap.snapshotId, zebraEdges: [0, 99_999] });
    expect(all.ids).toEqual(expected);
    await expectCode(
      domain.views.resolveSelection(ws.ctx, { snapshotId: snap.snapshotId, zebraEdges: [5, 2] }),
      'VALIDATION_ERROR',
      400,
    );

    // The snapshot is frozen: a new record does not appear in it.
    await domain.records.create(ws.ctx, {
      entityDefinitionId: objectId,
      entityInstanceId: newId(),
      values: { amount: [{ value: 5000 }] },
    });
    expect((await domain.views.chunk(ws.ctx, { snapshotId: snap.snapshotId, start: 0, size: 1 })).ids).toEqual([
      expected[0],
    ]);
    await expectCode(domain.views.chunk(ws.ctx, { snapshotId: newId(), start: 0, size: 1 }), 'SNAPSHOT_NOT_FOUND', 404);
  });

  it('filters with the slice-1 operator set', async () => {
    const live = items; // the extra record from the previous test has amount 5000 and nothing else
    const count = async (filter: Predicate) =>
      (await domain.views.query(ws.ctx, { entityDefinitionId: objectId, filter })).total;
    // Guard against vacuous checks: every expected count below (except the '%' literal) is non-zero and partial.
    const nonTrivial = (n: number) => {
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThan(N);
      return n;
    };
    const red = colorIds[0] as string;
    const blue = colorIds[2] as string;

    expect(await count(leaf('color', 'must', [{ field: 'select_option_id', operator: 'eq', value: red }]))).toBe(
      nonTrivial(live.filter((i) => i.color === 0).length),
    );
    expect(await count(leaf('color', 'must-not', [{ field: 'value', operator: 'eq', value: red }]))).toBe(
      nonTrivial(live.filter((i) => i.color !== 0).length) + 1,
    );
    expect(
      await count(leaf('color', 'must', [{ field: 'select_option_id', operator: 'in', value: [red, blue] }])),
    ).toBe(nonTrivial(live.filter((i) => i.color === 0 || i.color === 2).length));
    expect(await count(leaf('amount', 'must-not', []))).toBe(nonTrivial(live.filter((i) => i.amount === null).length));
    expect(await count(leaf('amount', 'must', [{ field: 'value', operator: 'not-empty' }]))).toBe(
      nonTrivial(live.filter((i) => i.amount !== null).length) + 1,
    );
    expect(
      await count({
        and: [
          leaf('amount', 'must', [{ field: 'value', operator: 'gte', value: 100 }]),
          leaf('amount', 'must', [{ field: 'value', operator: 'lt', value: 500 }]),
        ],
      }),
    ).toBe(nonTrivial(live.filter((i) => i.amount !== null && i.amount >= 100 && i.amount < 500).length));
    expect(await count(leaf('title', 'must', [{ field: 'value', operator: 'contains', value: 'EPSILON' }]))).toBe(
      nonTrivial(live.filter((i) => norm(i.title).includes('epsilon')).length),
    );
    expect(await count(leaf('title', 'must', [{ field: 'value', operator: 'starts-with', value: 'beta' }]))).toBe(
      nonTrivial(live.filter((i) => norm(i.title).startsWith('beta')).length),
    );
    expect(await count(leaf('title', 'must', [{ field: 'value', operator: 'contains', value: '%' }]))).toBe(0);
    expect(await count(leaf('tags', 'must', [{ field: 'select_option_id', operator: 'eq', value: tagIds[1] }]))).toBe(
      nonTrivial(live.filter((i) => i.tags.includes(1)).length),
    );
    expect(await count(leaf('tags', 'must-not', []))).toBe(live.filter((i) => i.tags.length === 0).length + 1);
    // Relative date: due within the last 7 days (dynamic ISO duration resolved by the server).
    expect(
      await count(leaf('due', 'must', [{ field: 'value', operator: 'gte', value: '-P7D', valueType: 'dynamic' }])),
    ).toBe(nonTrivial(live.filter((i) => i.dueDaysAgo === 3).length));
    expect(
      await count({
        or: [
          leaf('color', 'must', [{ field: 'select_option_id', operator: 'eq', value: red }]),
          leaf('amount', 'must', [{ field: 'value', operator: 'gt', value: 900 }]),
        ],
      }),
    ).toBe(nonTrivial(live.filter((i) => i.color === 0 || (i.amount ?? -1) > 900).length) + 1);
    await expectCode(
      count(leaf('amount', 'must', [{ field: 'value', operator: 'contains', value: 'x' }])),
      'UNSUPPORTED_FILTER',
      400,
    );
    await expectCode(
      count(leaf('amount', 'must', [{ field: 'nope', operator: 'eq', value: 1 }])),
      'UNSUPPORTED_FILTER',
      400,
    );
  });

  it('sorts by option order and text, and aggregates over the filter', async () => {
    const snap = await domain.views.query(ws.ctx, {
      entityDefinitionId: objectId,
      filter: leaf('color', 'must', []),
      sorts: [
        { path: p('color'), direction: 'asc' },
        { path: p('title'), direction: 'asc' },
      ],
    });
    const withColor = items.filter((i) => i.color !== null);
    expect(snap.total).toBe(withColor.length);
    const expected = [...withColor]
      .sort(
        (a, b) =>
          (a.color as number) - (b.color as number) ||
          (norm(a.title) < norm(b.title) ? -1 : norm(a.title) > norm(b.title) ? 1 : byId(a, b, 1)),
      )
      .map((i) => i.id);
    const all = (
      await domain.views.resolveSelection(ws.ctx, { snapshotId: snap.snapshotId, zebraEdges: [0, snap.total] })
    ).ids;
    expect(all).toEqual(expected);

    const sum = await domain.views.aggregate(ws.ctx, {
      snapshotId: snap.snapshotId,
      path: p('amount'),
      aggregation: 'sum',
    });
    expect(sum.value).toBe(withColor.reduce((s, i) => s + (i.amount ?? 0), 0));
    const filled = await domain.views.aggregate(ws.ctx, {
      snapshotId: snap.snapshotId,
      path: p('amount'),
      aggregation: 'filled',
    });
    expect(filled).toMatchObject({ value: withColor.filter((i) => i.amount !== null).length, total: withColor.length });
    await expectCode(
      domain.views.aggregate(ws.ctx, { snapshotId: snap.snapshotId, path: p('title'), aggregation: 'sum' }),
      'VALIDATION_ERROR',
      400,
    );
  });

  it('queries through saved views and path filters', async () => {
    const view = await domain.views.create(ws.ctx, {
      id: newId(),
      entityDefinitionId: objectId,
      title: 'Expensive blue',
      filter: {
        and: [
          leaf('color', 'must', [{ field: 'select_option_id', operator: 'eq', value: colorIds[2] }]),
          leaf('amount', 'must', [{ field: 'value', operator: 'gte', value: 500 }]),
        ],
      },
      sorts: [{ path: p('amount'), direction: 'asc' }],
      columns: [{ path: p('title') }, { path: p('amount'), tableColumnAggregationType: 'sum' }],
    });
    expect(view.columns).toHaveLength(2);
    const snap = await domain.views.query(ws.ctx, { entityDefinitionId: objectId, viewId: view.id });
    const expected = items.filter((i) => i.color === 2 && (i.amount ?? -1) >= 500);
    expect(snap.total).toBe(expected.length);
    expect(snap.ids[0]).toBe(
      [...expected].sort((a, b) => (a.amount as number) - (b.amount as number) || byId(a, b, 1))[0]?.id,
    );
    // Drafts override the saved filter without saving it.
    const draft = await domain.views.query(ws.ctx, { entityDefinitionId: objectId, viewId: view.id, filter: null });
    expect(draft.total).toBe(N + 1);
    const updated = await domain.views.setSorts(ws.ctx, {
      viewId: view.id,
      sorts: [{ path: p('title'), direction: 'desc' }],
    });
    expect(updated.sorts.map((s) => s.direction)).toEqual(['desc']);
    await expectCode(
      domain.views.setFilter(ws.ctx, {
        viewId: view.id,
        filter: leaf('title', 'must', [{ field: 'value', operator: 'gt', value: 'x' }]),
      }),
      'UNSUPPORTED_FILTER',
      400,
    );

    // Path filter: people whose company name contains "acme" (S1 q2a shape).
    const acme = newId();
    await domain.records.create(ws.ctx, {
      entityDefinitionId: 'companies',
      entityInstanceId: acme,
      values: { name: [{ value: 'ACME Corp' }] },
    });
    const other = newId();
    await domain.records.create(ws.ctx, {
      entityDefinitionId: 'companies',
      entityInstanceId: other,
      values: { name: [{ value: 'Globex' }] },
    });
    const person = newId();
    await domain.records.create(ws.ctx, {
      entityDefinitionId: 'people',
      entityInstanceId: person,
      values: { company: [{ value: { entityInstanceId: acme } }] },
    });
    await domain.records.create(ws.ctx, {
      entityDefinitionId: 'people',
      entityInstanceId: newId(),
      values: { company: [{ value: { entityInstanceId: other } }] },
    });
    const people = await domain.schema.listAttributes(ws.ctx, { entityDefinitionId: 'people' });
    const companies = await domain.schema.listAttributes(ws.ctx, { entityDefinitionId: 'companies' });
    const companyAttr = people.find((a) => a.apiSlug === 'company');
    const nameAttr = companies.find((a) => a.apiSlug === 'name');
    const pathFilter: Predicate = {
      path: [
        {
          entityDefinitionId: companyAttr?.entityDefinitionId as string,
          attributeDefinitionId: companyAttr?.id as string,
        },
        { entityDefinitionId: nameAttr?.entityDefinitionId as string, attributeDefinitionId: nameAttr?.id as string },
      ],
      mode: 'must',
      constraints: [{ field: 'value', operator: 'contains', value: 'acme' }],
    };
    const res = await domain.views.query(ws.ctx, { entityDefinitionId: 'people', filter: pathFilter });
    expect(res.ids).toEqual([person]);
    // Multi-hop the other way: companies whose team has a person (team is multi-valued).
    const teamAttr = companies.find((a) => a.apiSlug === 'team');
    const recordId = people.find((a) => a.apiSlug === 'record_id');
    const reverse = await domain.views.query(ws.ctx, {
      entityDefinitionId: 'companies',
      filter: {
        path: [
          { entityDefinitionId: teamAttr?.entityDefinitionId as string, attributeDefinitionId: teamAttr?.id as string },
          { entityDefinitionId: recordId?.entityDefinitionId as string, attributeDefinitionId: recordId?.id as string },
        ],
        mode: 'must',
        constraints: [{ field: 'value', operator: 'eq', value: person }],
      },
    });
    expect(reverse.ids).toEqual([acme]);
  });

  it('serves default views of the standard objects', async () => {
    const views = await domain.views.list(ws.ctx, { entityDefinitionId: 'companies' });
    const us = views.find((v) => v.title === 'US Companies');
    const de = newId();
    await domain.records.create(ws.ctx, {
      entityDefinitionId: 'companies',
      entityInstanceId: de,
      values: { primary_location: [{ value: { countryCode: 'DE' } }] },
    });
    const usId = newId();
    await domain.records.create(ws.ctx, {
      entityDefinitionId: 'companies',
      entityInstanceId: usId,
      values: { primary_location: [{ value: { locality: 'Austin', countryCode: 'US' } }] },
    });
    const snap = await domain.views.query(ws.ctx, { entityDefinitionId: 'companies', viewId: us?.id as string });
    expect(snap.ids).toEqual([usId]);
    const eu = views.find((v) => v.title === 'UK, French and German Companies');
    expect(
      (await domain.views.query(ws.ctx, { entityDefinitionId: 'companies', viewId: eu?.id as string })).ids,
    ).toEqual([de]);
  });
});
