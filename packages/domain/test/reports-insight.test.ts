// Slice 9 dataset engine — Insight pivots (H api §4.1, builder §3): every metric over current values, group by and
// segment by every groupable kind (status, select, multi-select, record reference through a path, actor, number,
// rating, checkbox, text, dates and timestamps bucketed by every resolution in the viewer's zone with the week start),
// null group, selected values, empty groups, ranges and comparisons, labels and the plan.
import { type AttributeType, contributingDataFilter, type Path } from '@agentic-crm/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { createRecord } from './collab-fixtures.ts';
import { byKey, createDeal, type DealsFixture, dataset, dealsFixture } from './reports-fixtures.ts';
import { domain, expectCode } from './support/harness.ts';

let f: DealsFixture;
let acme: string;
let globex: string;

beforeAll(async () => {
  f = await dealsFixture();
  acme = await createRecord(f, 'companies', { name: [{ value: 'Acme' }] });
  globex = await createRecord(f, 'companies', { name: [{ value: 'Globex' }] });
  const { stages: s, options: o } = f;
  // 6 deals: amounts 100, 200, 300, 400, 500 and one without an amount.
  await createDeal(f, {
    name: 'Ärger GmbH',
    stage: s.lead,
    amount: 100,
    priority: o.high,
    tags: [o.alpha, o.beta],
    close: '2026-01-15',
    signed: '2026-03-31T22:30:00Z', // 1 April 01:30 in Moscow
    owner: f.memberId,
    rating: 3,
    score: 10,
    active: true,
    company: acme,
  });
  await createDeal(f, {
    name: 'ärger gmbh',
    stage: s.lead,
    amount: 200,
    priority: o.low,
    tags: [o.alpha],
    close: '2026-01-31',
    signed: '2026-02-10T10:00:00Z',
    rating: 0,
    score: 10,
    company: acme,
  });
  await createDeal(f, {
    name: 'Initech',
    stage: s.qualified,
    amount: 300,
    priority: o.high,
    close: '2026-02-01',
    signed: '2026-04-05T12:00:00Z',
    rating: 5,
    score: 20,
    active: false,
    company: globex,
  });
  await createDeal(f, { name: 'Umbrella', stage: s.won, amount: 400, close: '2026-04-12', score: 30 });
  await createDeal(f, { name: 'Hooli', stage: s.won, amount: 500, priority: o.low, tags: [o.beta] });
  await createDeal(f, { name: 'Pied Piper' });
});

describe('insight metrics', () => {
  it('counts records and aggregates a currency attribute without grouping (single metric)', async () => {
    const count = await dataset(f, { type: 'pivot' });
    expect(count.type).toBe('pivot');
    expect(count.rows).toEqual([{ group: null, segment: null, value: 6, count: 6 }]);
    expect(count.meta.totalRecords).toBe(6);
    const agg = async (aggregation: 'sum' | 'mean' | 'min' | 'max' | 'median' | 'count') =>
      (await dataset(f, { type: 'pivot', metric: { type: 'attribute', path: f.path('amount'), aggregation } })).rows[0]
        ?.value;
    expect(await agg('sum')).toBe(1500);
    expect(await agg('mean')).toBe(300);
    expect(await agg('min')).toBe(100);
    expect(await agg('max')).toBe(500);
    expect(await agg('median')).toBe(300);
    expect(await agg('count')).toBe(5);
  });

  it('treats a 0 rating as no value', async () => {
    const r = await dataset(f, {
      type: 'pivot',
      metric: { type: 'attribute', path: f.path('rating'), aggregation: 'mean' },
    });
    expect(r.rows[0]?.value).toBe(4);
    const c = await dataset(f, {
      type: 'pivot',
      metric: { type: 'attribute', path: f.path('rating'), aggregation: 'count' },
    });
    expect(c.rows[0]?.value).toBe(2);
  });

  it('rejects numeric aggregations of non-numeric attributes', async () => {
    await expectCode(
      dataset(f, { type: 'pivot', metric: { type: 'attribute', path: f.path('priority'), aggregation: 'sum' } }),
      'VALIDATION_ERROR',
    );
  });
});

describe('insight groupings', () => {
  it('groups by status with stage labels, colours and order; null group last', async () => {
    const r = await dataset(f, {
      type: 'pivot',
      metric: { type: 'attribute', path: f.path('amount'), aggregation: 'sum' },
      primaryGrouping: { path: f.path('stage') },
    });
    expect(byKey(r.rows)).toEqual({
      [`${f.stages.lead}|∅`]: 300,
      [`${f.stages.qualified}|∅`]: 300,
      [`${f.stages.won}|∅`]: 900,
      '∅|∅': 0,
    });
    expect(r.meta.groups.primary?.map((g) => g.label)).toEqual(['Lead', 'Qualified', 'Won', null]);
    expect(r.meta.groups.primary?.[0]?.color).toEqual(expect.any(String));
    expect(r.meta.plan.map((p) => p.op)).toEqual(['LookUp', 'Join', 'Group', 'Aggregation']);
  });

  it('hides the null group, keeps selected values and lists every option when empty groups are visible', async () => {
    const r = await dataset(f, {
      type: 'pivot',
      primaryGrouping: {
        path: f.path('stage'),
        includeNullGroup: false,
        includeEmptyGroups: true,
        selectedValues: [f.stages.lead, f.stages.won, f.stages.lost],
      },
    });
    expect(byKey(r.rows)).toEqual({ [`${f.stages.lead}|∅`]: 2, [`${f.stages.won}|∅`]: 2, [`${f.stages.lost}|∅`]: 0 });
    expect(r.meta.groups.primary?.map((g) => g.label)).toEqual(['Lead', 'Qualified', 'Proposal', 'Won', 'Lost']);
  });

  it('puts a record in every group of a multi-select and segments by a second attribute', async () => {
    const r = await dataset(f, {
      type: 'pivot',
      primaryGrouping: { path: f.path('tags') },
      secondaryGrouping: { path: f.path('priority') },
    });
    const { alpha, beta, high, low } = f.options;
    expect(byKey(r.rows)).toEqual({
      [`${alpha}|${high}`]: 1,
      [`${alpha}|${low}`]: 1,
      [`${beta}|${high}`]: 1,
      [`${beta}|${low}`]: 1,
      [`∅|${high}`]: 1,
      '∅|∅': 2,
    });
    expect(r.meta.groups.secondary?.map((g) => g.label)).toEqual(['High', 'Low', null]);
  });

  it('groups through a record reference path (company name) with record labels', async () => {
    const path = await f.companyName();
    const r = await dataset(f, {
      type: 'pivot',
      metric: { type: 'attribute', path: f.path('amount'), aggregation: 'sum' },
      primaryGrouping: { path },
    });
    expect(byKey(r.rows)).toEqual({ 'acme|∅': 300, 'globex|∅': 300, '∅|∅': 900 });
    expect(r.meta.groups.primary?.map((g) => g.label)).toEqual(['Acme', 'Globex', null]);
    expect(r.freshness.entityDefinitionIds).toEqual([f.companies, f.deals].sort());
    const byRecord = await dataset(f, { type: 'pivot', primaryGrouping: { path: f.path('company') } });
    expect(byKey(byRecord.rows)).toEqual({ [`${acme}|∅`]: 2, [`${globex}|∅`]: 1, '∅|∅': 3 });
    expect(byRecord.meta.groups.primary?.map((g) => g.label)).toEqual(['Acme', 'Globex', null]);
  });

  it('groups text by its normalised value and labels it with an original spelling', async () => {
    const r = await dataset(f, { type: 'pivot', primaryGrouping: { path: f.path('name'), includeNullGroup: false } });
    expect(r.rows.find((x) => x.group === 'arger gmbh')?.value).toBe(2);
    expect(r.meta.groups.primary?.find((g) => g.key === 'arger gmbh')?.label).toMatch(/^[Ää]rger GmbH$/i);
  });

  it('groups numbers, ratings, checkboxes and actors', async () => {
    const score = await dataset(f, { type: 'pivot', primaryGrouping: { path: f.path('score') } });
    expect(byKey(score.rows)).toEqual({ '10|∅': 2, '20|∅': 1, '30|∅': 1, '∅|∅': 2 });
    expect(score.meta.groups.primary?.map((g) => g.key)).toEqual(['10', '20', '30', null]);
    const rating = await dataset(f, { type: 'pivot', primaryGrouping: { path: f.path('rating') } });
    expect(byKey(rating.rows)).toEqual({ '3|∅': 1, '5|∅': 1, '∅|∅': 4 });
    const active = await dataset(f, { type: 'pivot', primaryGrouping: { path: f.path('active') } });
    expect(byKey(active.rows)).toEqual({ 'true|∅': 1, 'false|∅': 5 });
    const owner = await dataset(f, { type: 'pivot', primaryGrouping: { path: f.path('owner') } });
    expect(byKey(owner.rows)).toEqual({ [`${f.memberId}|∅`]: 1, '∅|∅': 5 });
    expect(owner.meta.groups.primary?.[0]?.label).toBe('Ada Lovelace');
  });

  it('applies the report filter on current values', async () => {
    const r = await dataset(f, {
      type: 'pivot',
      filter: {
        path: f.path('priority'),
        mode: 'must',
        constraints: [{ field: 'select_option_id', operator: 'eq', value: f.options.high }],
      },
      primaryGrouping: { path: f.path('stage') },
    });
    expect(byKey(r.rows)).toEqual({ [`${f.stages.lead}|∅`]: 1, [`${f.stages.qualified}|∅`]: 1 });
    expect(r.meta.totalRecords).toBe(2);
    expect(r.meta.plan.some((p) => p.op === 'FilterSet')).toBe(true);
    expect(r.freshness.attributeDefinitionIds).toEqual([f.attrs.priority, f.attrs.stage].sort());
  });
});

describe('insight time buckets', () => {
  const group = (resolution: 'day' | 'week' | 'month' | 'quarter' | 'year', extra: Record<string, unknown> = {}) => ({
    type: 'pivot' as const,
    primaryGrouping: { path: f.path('close'), includeNullGroup: false },
    timeConfig: { resolution },
    ...extra,
  });

  it('buckets dates by day, month, quarter and year', async () => {
    expect(byKey((await dataset(f, group('day'))).rows)).toEqual({
      '2026-01-15|∅': 1,
      '2026-01-31|∅': 1,
      '2026-02-01|∅': 1,
      '2026-04-12|∅': 1,
    });
    const month = await dataset(f, group('month'));
    expect(byKey(month.rows)).toEqual({ '2026-01-01|∅': 2, '2026-02-01|∅': 1, '2026-04-01|∅': 1 });
    expect(month.meta.buckets).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']);
    expect(month.meta.resolution).toBe('month');
    expect(byKey((await dataset(f, group('quarter'))).rows)).toEqual({ '2026-01-01|∅': 3, '2026-04-01|∅': 1 });
    expect(byKey((await dataset(f, group('year'))).rows)).toEqual({ '2026-01-01|∅': 4 });
  });

  it('starts weeks on the viewer week start (Monday vs Sunday, X-10)', async () => {
    // 2026-02-01 is a Sunday; 2026-01-31 a Saturday.
    const monday = await dataset(f, group('week', { weekStart: 1 }));
    expect(byKey(monday.rows)).toEqual({ '2026-01-12|∅': 1, '2026-01-26|∅': 2, '2026-04-06|∅': 1 });
    const sunday = await dataset(f, group('week', { weekStart: 0 }));
    expect(byKey(sunday.rows)).toEqual({
      '2026-01-11|∅': 1,
      '2026-01-25|∅': 1,
      '2026-02-01|∅': 1,
      '2026-04-12|∅': 1,
    });
    expect(sunday.meta.weekStart).toBe(0);
  });

  it('buckets timestamps in the viewer zone', async () => {
    const utc = await dataset(f, {
      type: 'pivot',
      primaryGrouping: { path: f.path('signed'), includeNullGroup: false },
      timeConfig: { resolution: 'month' },
      timeZone: 'UTC',
    });
    expect(byKey(utc.rows)).toEqual({ '2026-02-01|∅': 1, '2026-03-01|∅': 1, '2026-04-01|∅': 1 });
    const moscow = await dataset(f, {
      type: 'pivot',
      primaryGrouping: { path: f.path('signed'), includeNullGroup: false },
      timeConfig: { resolution: 'month' },
      timeZone: 'Europe/Moscow',
    });
    expect(byKey(moscow.rows)).toEqual({ '2026-02-01|∅': 1, '2026-04-01|∅': 2 });
    expect(moscow.meta.plan.find((p) => p.op === 'AddKey')?.detail).toContain('Europe/Moscow');
    await expectCode(dataset(f, { type: 'pivot', timeZone: 'Mars/Olympus' }), 'VALIDATION_ERROR');
  });

  it('limits to a range, fills empty buckets and compares with a previous window', async () => {
    const r = await dataset(f, {
      type: 'pivot',
      primaryGrouping: { path: f.path('close'), includeNullGroup: false, includeEmptyGroups: true },
      timeConfig: {
        resolution: 'month',
        start: '2026-02-01',
        end: '2026-04-30',
        comparison: { start: '2025-11-01', end: '2026-01-31' },
      },
    });
    expect(byKey(r.rows)).toEqual({ '2026-02-01|∅': 1, '2026-03-01|∅': 0, '2026-04-01|∅': 1 });
    expect(r.meta.buckets).toEqual(['2026-02-01', '2026-03-01', '2026-04-01']);
    expect(r.meta.comparisonBuckets).toEqual(['2025-11-01', '2025-12-01', '2026-01-01']);
    // January (third bucket of the comparison window) aligns with April.
    expect(r.type === 'pivot' && byKey(r.comparisonRows ?? [])).toEqual({ '2026-04-01|∅': 2 });
  });
});

describe('contributing data (drill-down)', () => {
  it('the records behind every group are exactly the snapshot of the report filter AND the group key', async () => {
    const companyName = await f.companyName();
    const cases: { path: Path; type: AttributeType; resolution?: 'month' | 'week'; timeZone?: string }[] = [
      { path: f.path('stage'), type: 'pipeline' },
      { path: f.path('tags'), type: 'select' },
      { path: f.path('score'), type: 'number' },
      { path: f.path('active'), type: 'checkbox' },
      { path: f.path('rating'), type: 'rating' },
      { path: companyName, type: 'text' },
      { path: f.path('close'), type: 'date', resolution: 'week' },
      { path: f.path('signed'), type: 'timestamp', resolution: 'month', timeZone: 'Europe/Moscow' },
    ];
    const filter = {
      path: f.path('name'),
      mode: 'must' as const,
      constraints: [{ field: 'value', operator: 'not-empty' as const }],
    };
    for (const c of cases) {
      const timeZone = c.timeZone ?? 'UTC';
      const r = await dataset(f, {
        type: 'pivot',
        filter,
        primaryGrouping: { path: c.path },
        timeConfig: { resolution: c.resolution ?? 'month' },
        timeZone,
        weekStart: 1,
      });
      for (const row of r.rows) {
        const drill = contributingDataFilter(filter, { path: c.path }, c.type, row.group, {
          resolution: c.resolution ?? 'month',
          timeZone,
          weekStart: 1,
        });
        const snapshot = await domain.views.query(f.ctx, { entityDefinitionId: f.deals, filter: drill, timeZone });
        expect([c.type, row.group, snapshot.total]).toEqual([c.type, row.group, row.count]);
      }
    }
  });
});
