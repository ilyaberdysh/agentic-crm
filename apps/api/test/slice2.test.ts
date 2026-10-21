// Slice 2 server procedures over HTTP: search.records / search.members, snapshots.query with time zones, history
// ("was") and path filters, snapshots.aggregate kinds, saved filters keeping dynamic values, and limit errors in
// the public API envelope (BACKLOG §2: 2.06–2.08, B.8, C.4 #7).
import { randomUUID } from 'node:crypto';
import type { inferRouterOutputs } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppRouter } from '../src/trpc/router';
import {
  type Harness,
  signUp,
  startHarness,
  type TestUser,
  type TrpcOptions,
  trpcCall,
  trpcError,
} from './support/harness';

type Out = inferRouterOutputs<AppRouter>;

let h: Harness;
let admin: TestUser;
let member: TestUser;
const slug = `s2-${Date.now().toString(36)}`;
let workspaceId: string;
let projects: string;
const attr: Record<string, string> = {};
const stage: Record<string, string> = {};
const company: Record<string, string> = {};

const call = <T>(user: TestUser, path: string, input?: unknown, opts: TrpcOptions = {}) =>
  trpcCall<T>(h, path, input, { user, slug, ...opts });
const hop = (attributeDefinitionId: string, entityDefinitionId = projects) => ({
  entityDefinitionId,
  attributeDefinitionId,
});

beforeAll(async () => {
  h = await startHarness();
  admin = await signUp(h, 'Ada Admin');
  member = await signUp(h, 'Max Member');
  const created = await call<Out['workspaces']['create']>(admin, 'workspaces.create', { name: 'S2 Co', slug });
  workspaceId = created.workspace.id;
  const { invites } = await call<Out['invites']['create']>(admin, 'invites.create', {
    invites: [{ emailAddress: member.email }],
  });
  await call(member, 'invites.accept', { inviteId: invites[0]?.id }, { slug: undefined });

  for (const [key, name, domain] of [
    ['acme', 'Acme', 'acme.com'],
    ['holdings', 'Acme Holdings', 'acmeholdings.com'],
    ['globex', 'Globex', 'globex.io'],
  ] as const) {
    company[key] = randomUUID();
    await call(admin, 'records.put', {
      entityDefinitionId: 'companies',
      entityInstanceId: company[key],
      values: { name: [{ value: name }], domains: [{ value: domain }] },
    });
  }

  projects = (
    await call<Out['schema']['objects']['create']>(admin, 'schema.objects.create', {
      id: randomUUID(),
      apiSlug: 'projects',
      singularNoun: 'Project',
      pluralNoun: 'Projects',
    })
  ).object.id;
  const create = async (title: string, type: string, extra: Record<string, unknown> = {}) => {
    const res = await call<Out['schema']['attributes']['create']>(admin, 'schema.attributes.create', {
      id: randomUUID(),
      entityDefinitionId: projects,
      title,
      type,
      ...extra,
    });
    attr[res.attribute.apiSlug] = res.attribute.id;
  };
  await create('Name', 'text');
  await create('Phase', 'pipeline', {
    stages: [
      { title: 'Lead', lifecyclePhase: 'ACTIVE' },
      { title: 'Doing', lifecyclePhase: 'ACTIVE' },
      { title: 'Won', lifecyclePhase: 'WON' },
    ],
  });
  await create('Budget', 'currency', { currencyConfiguration: { defaultCurrencyCode: 'EUR' } });
  await create('Done', 'checkbox');
  await create('Due', 'date');
  await create('Client', 'entity-reference', {
    entityReferenceConfiguration: { allowedEntityDefinitionIds: [await companiesId()] },
  });
  const stages = await call<Out['schema']['statuses']['list']>(admin, 'schema.statuses.list', {
    entityDefinitionId: projects,
    attributeDefinitionId: attr.phase,
  });
  for (const s of stages) stage[s.title] = s.id;
});
afterAll(async () => {
  await h?.close();
});

async function companiesId() {
  return (await call<Out['schema']['objects']['get']>(admin, 'schema.objects.get', { entityDefinitionId: 'companies' }))
    .id;
}

async function project(name: string, values: Record<string, unknown[]>) {
  const id = randomUUID();
  await call(admin, 'records.put', {
    entityDefinitionId: projects,
    entityInstanceId: id,
    values: { name: [{ value: name }], ...values },
  });
  return id;
}

describe('search', () => {
  it('search.records ranks hits for pickers; search.members finds members', async () => {
    const { hits } = await call<Out['search']['records']>(member, 'search.records', {
      query: 'acme',
      entityDefinitionIds: ['companies'],
    });
    expect(hits.map((x) => x.entityInstanceId)).toEqual([company.acme, company.holdings]);
    expect(hits[0]).toMatchObject({ title: 'Acme', subtitle: 'acme.com', score: expect.any(Number) });
    const empty = await call<Out['search']['records']>(member, 'search.records', { query: '', limit: 1 });
    expect(empty.hits).toHaveLength(1);
    const members = await call<Out['search']['members']>(member, 'search.members', { query: 'max' });
    expect(members.hits).toEqual([expect.objectContaining({ firstName: 'Max', lastName: 'Member' })]);
    const bad = await trpcError(call(member, 'search.records', { query: 'x', limit: 1000 }));
    expect(bad.status).toBe(400);
  });
});

describe('filters, sorts and calculations', () => {
  it('queries with history, path and relative-date filters in a time zone', async () => {
    const won = await project('Moved to Won', { phase: [{ value: { pipelineStageId: stage.Lead } }] });
    await call(admin, 'records.patch', {
      entityDefinitionId: projects,
      entityInstanceId: won,
      values: { phase: [{ value: { pipelineStageId: stage.Won } }] },
    });
    const lead = await project('Still a lead', {
      phase: [{ value: { pipelineStageId: stage.Lead } }],
      client: [{ value: { entityInstanceId: company.globex } }],
      due: [{ value: new Date().toISOString().slice(0, 10) }],
    });
    const q = (filter: unknown, extra: Record<string, unknown> = {}) =>
      call<Out['snapshots']['query']>(member, 'snapshots.query', { entityDefinitionId: projects, filter, ...extra });
    const wasLead = await q({
      path: [hop(attr.phase as string)],
      mode: 'must',
      history: true,
      constraints: [{ field: 'pipeline_stage_id', operator: 'eq', value: stage.Lead }],
    });
    expect(wasLead.ids.sort()).toEqual([won, lead].sort());
    const isLead = await q({
      path: [hop(attr.phase as string)],
      mode: 'must',
      constraints: [{ field: 'pipeline_stage_id', operator: 'eq', value: stage.Lead }],
    });
    expect(isLead.ids).toEqual([lead]);
    const viaClient = await q({
      path: [hop(attr.client as string), hop((await companyAttr('name')) as string, await companiesId())],
      mode: 'must',
      constraints: [{ field: 'value', operator: 'contains', value: 'glob' }],
    });
    expect(viaClient.ids).toEqual([lead]);
    // "Due is today" in the viewer's zone (the record's date is today in UTC; Kiritimati is UTC+14).
    const today = {
      path: [hop(attr.due as string)],
      mode: 'must',
      constraints: [{ field: 'value', operator: 'eq', value: 'P0D', valueType: 'dynamic' }],
    };
    expect((await q(today, { timeZone: 'UTC' })).ids).toEqual([lead]);
    const kiritimatiToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Kiritimati' }).format(new Date());
    expect((await q(today, { timeZone: 'Pacific/Kiritimati' })).ids).toEqual(
      kiritimatiToday === new Date().toISOString().slice(0, 10) ? [lead] : [],
    );
    const badZone = await trpcError(q(today, { timeZone: 'Nowhere/Land' }));
    expect(badZone.body).toMatchObject({ statusCode: 400, additional_information: { code: 'VALIDATION_ERROR' } });
    const badFilter = await trpcError(
      q({ path: [hop(attr.name as string)], mode: 'must', history: true, constraints: [] }),
    );
    expect(badFilter.body).toMatchObject({ statusCode: 400, additional_information: { code: 'UNSUPPORTED_FILTER' } });
  });

  it('saves filters with dynamic values unresolved and sorts as a full array', async () => {
    const view = await call<Out['views']['create']>(member, 'views.create', {
      id: randomUUID(),
      entityDefinitionId: projects,
      title: 'Recent wins',
    });
    const filter = {
      and: [
        {
          path: [hop(attr.phase as string)],
          mode: 'must',
          history: true,
          constraints: [
            { field: 'pipeline_stage_id', operator: 'eq', value: stage.Won, valueType: 'static' },
            { field: 'active_from', operator: 'gt', value: '-P7D', valueType: 'dynamic' },
          ],
        },
      ],
    };
    const saved = await call<Out['views']['setFilter']>(member, 'views.setFilter', { viewId: view.view.id, filter });
    expect(saved.view.filter).toEqual(filter);
    const sorts = await call<Out['views']['setSorts']>(member, 'views.setSorts', {
      viewId: view.view.id,
      sorts: [
        {
          path: [hop(attr.client as string), hop((await companyAttr('name')) as string, await companiesId())],
          direction: 'asc',
        },
        { path: [hop(attr.budget as string)], direction: 'desc' },
      ],
    });
    expect(sorts.view.sorts).toHaveLength(2);
    const snap = await call<Out['snapshots']['query']>(member, 'snapshots.query', {
      entityDefinitionId: projects,
      viewId: view.view.id,
    });
    expect(snap.total).toBe(1);
  });

  it('snapshots.aggregate answers every calculation kind with the new shape', async () => {
    await project('Budgeted', { budget: [{ value: { currencyValue: 1500 } }], done: [{ value: true }] });
    await project('Small', { budget: [{ value: { currencyValue: 500 } }], done: [{ value: false }] });
    const snap = await call<Out['snapshots']['query']>(member, 'snapshots.query', { entityDefinitionId: projects });
    const agg = (aggregation: string, attribute: string) =>
      call<Out['snapshots']['aggregate']>(member, 'snapshots.aggregate', {
        snapshotId: snap.snapshotId,
        path: [hop(attr[attribute] as string)],
        aggregation,
      });
    const sum = await agg('sum', 'budget');
    expect(sum).toMatchObject({
      aggregation: 'sum',
      value: 2000,
      valueText: null,
      currencyCode: 'EUR',
      total: snap.total,
    });
    expect((await agg('percent_not_empty', 'budget')).value).toBe(Math.round((2 / snap.total) * 10_000) / 100);
    expect((await agg('count_checked', 'done')).value).toBe(1);
    expect((await agg('count_unchecked', 'done')).value).toBe(snap.total - 1);
    expect((await agg('latest', 'due')).valueText).toBe(new Date().toISOString().slice(0, 10));
    expect((await agg('filled', 'budget')).value).toBe(2); // slice-1 name
    const wrong = await trpcError(agg('sum', 'name'));
    expect(wrong.body).toMatchObject({ statusCode: 400, additional_information: { code: 'VALIDATION_ERROR' } });
  });
});

describe('limits', () => {
  it('answers OVER_USAGE_LIMIT in the public API envelope', async () => {
    await h.db.query(
      `UPDATE workspaces SET settings = jsonb_set(settings, '{capabilities}', '{"quotas":{"views_per_object_hard":1}}')
       WHERE id = $1`,
      [workspaceId],
    );
    try {
      const views = await call<Out['views']['list']>(admin, 'views.list', { entityDefinitionId: 'companies' });
      expect(views.length).toBeGreaterThanOrEqual(1);
      const err = await trpcError(
        call(admin, 'views.create', { id: randomUUID(), entityDefinitionId: 'companies', title: 'One more' }),
      );
      expect(err.body).toMatchObject({
        statusCode: 409,
        error: 'Conflict',
        status_code: 409,
        additional_information: { code: 'OVER_USAGE_LIMIT', quota: 'views_per_object_hard', limit: 1 },
      });
      const caps = await call<Out['capabilities']['get']>(admin, 'capabilities.get');
      expect(caps.quotas.views_per_object_hard).toBe(1);
      expect(caps.quotas.attributes_per_object_hard).toBe(500);
    } finally {
      await h.db.query(`UPDATE workspaces SET settings = settings - 'capabilities' WHERE id = $1`, [workspaceId]);
    }
  });
});

async function companyAttr(apiSlug: string) {
  const attrs = await call<Out['schema']['attributes']['list']>(admin, 'schema.attributes.list', {
    entityDefinitionId: 'companies',
  });
  return attrs.find((a) => a.apiSlug === apiSlug)?.id;
}
