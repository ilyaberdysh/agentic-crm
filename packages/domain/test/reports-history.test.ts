// Slice 9 dataset engine over value history (H api §4.1–4.3, builder §7–10). BACKLOG §9 acceptance 2: funnel and
// time-in-stage numbers equal a hand-computed fixture of status history. Also: historical values (as-of each bucket's
// end) by stage, historic and current segments, null segment, every metric; stage changed per month in two zones.
//
// Fixture (stages in order Lead 0, Qualified 1, Proposal 2, Won 3, Lost 4; times UTC midnight unless noted):
//   D1 created 01-10  Lead [01-10, 01-20) Qualified [01-20, 02-15) Proposal [02-15, 02-28T22:00) Won [02-28T22:00, …)
//                     Amount 50 [01-10, 02-01), 100 [02-01, …)                                   priority High
//   D2 created 01-15  Lead [01-15, 02-05) Qualified [02-05, 03-10) Lost [03-10, …)   Amount 200    priority Low
//   D3 created 02-01  Lead [02-01, 02-11) Proposal [02-11, 02-21) Qualified [02-21, …) Amount 300  priority High
//   D4 created 02-20  Lead [02-20, …)                                                 Amount 400
//   D5 created 01-05  Qualified [02-01, 02-03), then no stage                         no amount
//   D6 created 03-20  Won [03-20, …)                                                  Amount 600
//   D7 created 03-25  never had a stage                                               no amount
import { beforeAll, describe, expect, it } from 'vitest';
import {
  byKey,
  createDeal,
  type DealsFixture,
  dataset,
  dealsFixture,
  rebuild,
  setCreatedAt,
  setHistory,
} from './reports-fixtures.ts';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const t = (s: string) => (s.includes('T') ? s : `${s}T00:00:00Z`);
const ms = (s: string) => Date.parse(t(s));

let f: DealsFixture;
let d: Record<'d1' | 'd2' | 'd3' | 'd4' | 'd5' | 'd6' | 'd7', string>;

beforeAll(async () => {
  f = await dealsFixture();
  const { lead, qualified, proposal, won, lost } = f.stages;
  const { high, low } = f.options;
  d = {
    d1: await createDeal(f, { name: 'D1', stage: won, amount: 100, priority: high }),
    d2: await createDeal(f, { name: 'D2', stage: lost, amount: 200, priority: low }),
    d3: await createDeal(f, { name: 'D3', stage: qualified, amount: 300, priority: high }),
    d4: await createDeal(f, { name: 'D4', stage: lead, amount: 400 }),
    d5: await createDeal(f, { name: 'D5' }),
    d6: await createDeal(f, { name: 'D6', stage: won, amount: 600 }),
    d7: await createDeal(f, { name: 'D7' }),
  };
  const created: [string, string][] = [
    [d.d1, '2026-01-10'],
    [d.d2, '2026-01-15'],
    [d.d3, '2026-02-01'],
    [d.d4, '2026-02-20'],
    [d.d5, '2026-01-05'],
    [d.d6, '2026-03-20'],
    [d.d7, '2026-03-25'],
  ];
  for (const [id, at] of created) await setCreatedAt(id, t(at));
  const stage = (ref: string, from: string, until?: string) => ({ ref, from: t(from), until: until ? t(until) : null });
  await setHistory(f, d.d1, 'stage', [
    stage(lead, '2026-01-10', '2026-01-20'),
    stage(qualified, '2026-01-20', '2026-02-15'),
    stage(proposal, '2026-02-15', '2026-02-28T22:00:00Z'),
    stage(won, '2026-02-28T22:00:00Z'),
  ]);
  await setHistory(f, d.d2, 'stage', [
    stage(lead, '2026-01-15', '2026-02-05'),
    stage(qualified, '2026-02-05', '2026-03-10'),
    stage(lost, '2026-03-10'),
  ]);
  await setHistory(f, d.d3, 'stage', [
    stage(lead, '2026-02-01', '2026-02-11'),
    stage(proposal, '2026-02-11', '2026-02-21'),
    stage(qualified, '2026-02-21'),
  ]);
  await setHistory(f, d.d4, 'stage', [stage(lead, '2026-02-20')]);
  await setHistory(f, d.d5, 'stage', [stage(qualified, '2026-02-01', '2026-02-03')]);
  await setHistory(f, d.d6, 'stage', [stage(won, '2026-03-20')]);
  const amount = (num: number, from: string, until?: string) => ({
    num,
    from: t(from),
    until: until ? t(until) : null,
  });
  await setHistory(f, d.d1, 'amount', [amount(50, '2026-01-10', '2026-02-01'), amount(100, '2026-02-01')]);
  await setHistory(f, d.d2, 'amount', [amount(200, '2026-01-15')]);
  await setHistory(f, d.d3, 'amount', [amount(300, '2026-02-01')]);
  await setHistory(f, d.d4, 'amount', [amount(400, '2026-02-20')]);
  await setHistory(f, d.d6, 'amount', [amount(600, '2026-03-20')]);
  // Tags (multi-select): D1 Alpha from creation, Beta from 02-01; D2 Beta [01-15, 03-01).
  const { alpha, beta } = f.options;
  await setHistory(f, d.d1, 'tags', [stage(alpha, '2026-01-10'), stage(beta, '2026-02-01')]);
  await setHistory(f, d.d2, 'tags', [stage(beta, '2026-01-15', '2026-03-01')]);
  await rebuild(f);
});

const WINDOW = { resolution: 'month' as const, start: '2026-01-01', end: '2026-03-31' };

describe('funnel (acceptance 2)', () => {
  it('counts records that reached or passed each selected stage, in stage order, with All records first', async () => {
    const { lead, qualified, proposal, won } = f.stages;
    const r = await dataset(f, {
      type: 'funnel',
      statusAttributePath: f.path('stage'),
      // Given out of order: the attribute's stage order wins.
      stageIds: [won, lead, proposal, qualified],
      includeAllRecords: true,
    });
    expect(r.type).toBe('funnel');
    // D2 ended in Lost, which sorts after Won: non-strict progression counts it as having passed Won.
    expect(r.rows.map((x) => [x.stage, x.count])).toEqual([
      [null, 7],
      [lead, 6],
      [qualified, 5],
      [proposal, 4],
      [won, 3],
    ]);
    expect(r.rows.map((x) => x.conversionFromPrevious)).toEqual([null, 6 / 7, 5 / 6, 4 / 5, 3 / 4]);
    expect(r.rows[4]?.conversionFromFirst).toBe(3 / 7);
    expect(r.meta.groups.primary?.map((g) => g.label)).toEqual(['Lead', 'Qualified', 'Proposal', 'Won', null]);
    expect(r.meta.plan.find((p) => p.op === 'Funnel')?.detail).toContain('strict_stage_progression false');
  });

  it('sums a numeric metric per step and reports conversions (funnel metric)', async () => {
    const { lead, qualified, proposal, won } = f.stages;
    const r = await dataset(f, {
      type: 'funnel-metric',
      statusAttributePath: f.path('stage'),
      stageIds: [lead, qualified, proposal, won],
      metric: { type: 'attribute', path: f.path('amount'), aggregation: 'sum' },
    });
    expect(r.rows.map((x) => [x.stage, x.count, x.value])).toEqual([
      [lead, 6, 1600],
      [qualified, 5, 1200],
      [proposal, 4, 1200],
      [won, 3, 900],
    ]);
    expect(r.type === 'funnel-metric' && r.summary).toEqual({
      steps: [
        { from: lead, to: qualified, conversion: 1200 / 1600 },
        { from: qualified, to: proposal, conversion: 1 },
        { from: proposal, to: won, conversion: 900 / 1200 },
      ],
      overallConversion: 900 / 1600,
    });
    const mean = await dataset(f, {
      type: 'funnel',
      statusAttributePath: f.path('stage'),
      stageIds: [lead, won],
      metric: { type: 'attribute', path: f.path('amount'), aggregation: 'mean' },
    });
    expect(mean.rows.map((x) => x.value)).toEqual([1600 / 5, 900 / 3]);
    const median = await dataset(f, {
      type: 'funnel',
      statusAttributePath: f.path('stage'),
      stageIds: [lead, won],
      metric: { type: 'attribute', path: f.path('amount'), aggregation: 'median' },
    });
    expect(median.rows.map((x) => x.value)).toEqual([300, 200]);
  });

  it('applies the filter on current values and rejects stages of another attribute', async () => {
    const { lead, won } = f.stages;
    const r = await dataset(f, {
      type: 'funnel',
      filter: {
        path: f.path('priority'),
        mode: 'must',
        constraints: [{ field: 'select_option_id', operator: 'eq', value: f.options.high }],
      },
      statusAttributePath: f.path('stage'),
      stageIds: [lead, won],
    });
    expect(r.rows.map((x) => x.count)).toEqual([2, 1]);
    await expect(
      dataset(f, { type: 'funnel', statusAttributePath: f.path('stage'), stageIds: [f.options.high] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      dataset(f, { type: 'funnel', statusAttributePath: f.path('amount'), stageIds: [lead] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('time in stage (acceptance 2)', () => {
  it('aggregates the durations of every stay per stage (open stays end now)', async () => {
    const { lead, qualified, proposal, won, lost } = f.stages;
    const mean = await dataset(f, { type: 'time-in-stage', statusAttributePath: f.path('stage') });
    const now = Date.parse(mean.freshness.accurateAt);
    const open = (from: string) => now - ms(from);
    const expected: Record<string, { n: number; mean: number }> = {
      [lead]: { n: 4, mean: (10 * DAY + 21 * DAY + 10 * DAY + open('2026-02-20')) / 4 },
      [qualified]: { n: 4, mean: (26 * DAY + 33 * DAY + open('2026-02-21') + 2 * DAY) / 4 },
      [proposal]: { n: 2, mean: (13 * DAY + 22 * HOUR + 10 * DAY) / 2 },
      [won]: { n: 2, mean: (open('2026-02-28T22:00:00Z') + open('2026-03-20')) / 2 },
      [lost]: { n: 1, mean: open('2026-03-10') },
    };
    expect(mean.rows).toHaveLength(5);
    for (const row of mean.rows) {
      expect(row.group).toBeNull();
      expect(row.count).toBe(expected[row.stage]?.n);
      expect(row.value).toBeCloseTo(expected[row.stage]?.mean as number, -1);
    }
    expect(mean.meta.groups.primary?.map((g) => g.label)).toEqual(['Lead', 'Qualified', 'Proposal', 'Won', 'Lost']);
  });

  it('computes min, max and median over selected stages', async () => {
    const { lead, proposal } = f.stages;
    const run = (aggregation: 'min' | 'max' | 'median') =>
      dataset(f, {
        type: 'time-in-stage',
        statusAttributePath: f.path('stage'),
        selectedStageIds: [lead, proposal],
        aggregation,
      });
    const value = (r: Awaited<ReturnType<typeof run>>, stage: string) =>
      r.type === 'time-in-stage' ? r.rows.find((x) => x.stage === stage)?.value : undefined;
    const min = await run('min');
    expect(min.rows).toHaveLength(2);
    expect(value(min, lead)).toBe(10 * DAY);
    expect(value(min, proposal)).toBe(10 * DAY);
    const max = await run('max');
    expect(value(max, proposal)).toBe(13 * DAY + 22 * HOUR);
    expect(value(max, lead)).toBeCloseTo(Date.parse(max.freshness.accurateAt) - ms('2026-02-20'), -1);
    const median = await run('median');
    expect(value(median, lead)).toBe(15.5 * DAY);
    expect(value(median, proposal)).toBe(11 * DAY + 23 * HOUR);
  });

  it('groups stays by an attribute of the record (left join: records without a value form the null group)', async () => {
    const { lead } = f.stages;
    const r = await dataset(f, {
      type: 'time-in-stage',
      statusAttributePath: f.path('stage'),
      selectedStageIds: [lead],
      primaryGrouping: { path: f.path('priority') },
    });
    const rows = r.type === 'time-in-stage' ? r.rows : [];
    const by = Object.fromEntries(rows.map((x) => [x.group ?? '∅', [x.count, x.value]]));
    expect(by[f.options.high]).toEqual([2, 10 * DAY]);
    expect(by[f.options.low]).toEqual([1, 21 * DAY]);
    expect(by['∅']?.[0]).toBe(1);
    expect(r.meta.groups.secondary?.map((g) => g.label)).toEqual(['High', 'Low', null]);
  });

  it('keeps stays that started inside the range', async () => {
    const r = await dataset(f, {
      type: 'time-in-stage',
      statusAttributePath: f.path('stage'),
      range: { start: '2026-02-01', end: '2026-02-28' },
    });
    const counts = Object.fromEntries((r.type === 'time-in-stage' ? r.rows : []).map((x) => [x.stage, x.count]));
    const { lead, qualified, proposal, won } = f.stages;
    expect(counts).toEqual({ [lead]: 2, [qualified]: 3, [proposal]: 2, [won]: 1 });
  });
});

describe('stage changed', () => {
  it('counts status values by the month they started, per stage, in the viewer zone', async () => {
    const { lead, qualified, proposal, won, lost } = f.stages;
    const utc = await dataset(f, {
      type: 'pivot',
      variant: 'stage-changed',
      statusAttributePath: f.path('stage'),
      timeConfig: WINDOW,
    });
    expect(byKey(utc.rows)).toEqual({
      [`2026-01-01|${lead}`]: 2,
      [`2026-01-01|${qualified}`]: 1,
      [`2026-02-01|${lead}`]: 2,
      [`2026-02-01|${qualified}`]: 3,
      [`2026-02-01|${proposal}`]: 2,
      [`2026-02-01|${won}`]: 1,
      [`2026-03-01|${won}`]: 1,
      [`2026-03-01|${lost}`]: 1,
    });
    expect(utc.meta.buckets).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
    expect(utc.meta.groups.secondary?.map((g) => g.label)).toEqual(['Lead', 'Qualified', 'Proposal', 'Won', 'Lost']);
    const moscow = await dataset(f, {
      type: 'pivot',
      variant: 'stage-changed',
      statusAttributePath: f.path('stage'),
      selectedStageIds: [won],
      timeConfig: WINDOW,
      timeZone: 'Europe/Moscow',
    });
    expect(byKey(moscow.rows)).toEqual({ [`2026-03-01|${won}`]: 2 });
  });

  it('aggregates a metric of the records that changed stage', async () => {
    const { won } = f.stages;
    const r = await dataset(f, {
      type: 'pivot',
      variant: 'stage-changed',
      statusAttributePath: f.path('stage'),
      selectedStageIds: [won],
      metric: { type: 'attribute', path: f.path('amount'), aggregation: 'sum' },
      timeConfig: { ...WINDOW, resolution: 'quarter' },
    });
    expect(byKey(r.rows)).toEqual({ [`2026-01-01|${won}`]: 700 });
  });
});

describe('historical values (as of each bucket end)', () => {
  it('counts records per stage as they were at the end of every month (UTC vs Moscow)', async () => {
    const { lead, qualified, proposal, won, lost } = f.stages;
    const utc = await dataset(f, {
      type: 'pivot',
      variant: 'historical',
      primaryGrouping: { path: f.path('stage') },
      timeConfig: WINDOW,
    });
    const nonZero = (rows: { group: string | null; segment: string | null; value: number | null }[]) =>
      byKey(rows.filter((r) => r.value !== 0));
    expect(nonZero(utc.rows)).toEqual({
      [`2026-01-01|${qualified}`]: 1,
      [`2026-01-01|${lead}`]: 1,
      '2026-01-01|∅': 1,
      [`2026-02-01|${won}`]: 1,
      [`2026-02-01|${qualified}`]: 2,
      [`2026-02-01|${lead}`]: 1,
      '2026-02-01|∅': 1,
      [`2026-03-01|${won}`]: 2,
      [`2026-03-01|${lost}`]: 1,
      [`2026-03-01|${qualified}`]: 1,
      [`2026-03-01|${lead}`]: 1,
      '2026-03-01|∅': 2,
    });
    // Dense series: every segment has a row in every bucket.
    expect(utc.rows.length % 3).toBe(0);
    expect(utc.meta.buckets).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
    const moscow = await dataset(f, {
      type: 'pivot',
      variant: 'historical',
      primaryGrouping: { path: f.path('stage') },
      timeConfig: WINDOW,
      timeZone: 'Europe/Moscow',
    });
    const feb = Object.fromEntries(
      moscow.rows.filter((r) => r.group === '2026-02-01' && r.value !== 0).map((r) => [r.segment ?? '∅', r.value]),
    );
    expect(feb).toEqual({ [proposal]: 1, [qualified]: 2, [lead]: 1, '∅': 1 });
  });

  it('counts all records and aggregates a historic metric (sum, mean, min, max, median)', async () => {
    const run = async (aggregation?: 'sum' | 'mean' | 'min' | 'max' | 'median') =>
      (
        await dataset(f, {
          type: 'pivot',
          variant: 'historical',
          metric: aggregation ? { type: 'attribute', path: f.path('amount'), aggregation } : { type: 'record-count' },
          timeConfig: WINDOW,
        })
      ).rows.map((r) => r.value);
    expect(await run()).toEqual([3, 5, 7]);
    expect(await run('sum')).toEqual([250, 1000, 1600]);
    expect(await run('mean')).toEqual([125, 250, 320]);
    expect(await run('min')).toEqual([50, 100, 100]);
    expect(await run('max')).toEqual([200, 400, 600]);
    expect(await run('median')).toEqual([125, 250, 300]);
  });

  it('sums a historic metric per historic segment, and segments by current values when asked', async () => {
    const { lead, qualified, won, lost } = f.stages;
    const sum = await dataset(f, {
      type: 'pivot',
      variant: 'historical',
      metric: { type: 'attribute', path: f.path('amount'), aggregation: 'sum' },
      primaryGrouping: { path: f.path('stage') },
      timeConfig: WINDOW,
    });
    const mar = Object.fromEntries(
      sum.rows.filter((r) => r.group === '2026-03-01').map((r) => [r.segment ?? '∅', r.value]),
    );
    expect(mar).toMatchObject({ [won]: 700, [lost]: 200, [qualified]: 300, [lead]: 400, '∅': 0 });
    const current = await dataset(f, {
      type: 'pivot',
      variant: 'historical',
      primaryGrouping: { path: f.path('stage'), historic: false },
      timeConfig: WINDOW,
    });
    const jan = Object.fromEntries(
      current.rows.filter((r) => r.group === '2026-01-01' && r.value !== 0).map((r) => [r.segment ?? '∅', r.value]),
    );
    expect(jan).toEqual({ [won]: 1, [lost]: 1, '∅': 1 });
    const noNull = await dataset(f, {
      type: 'pivot',
      variant: 'historical',
      primaryGrouping: { path: f.path('stage'), includeNullGroup: false, selectedValues: [won] },
      timeConfig: WINDOW,
    });
    expect(noNull.rows.map((r) => [r.group, r.segment, r.value])).toEqual([
      ['2026-01-01', won, 0],
      ['2026-02-01', won, 1],
      ['2026-03-01', won, 2],
    ]);
  });

  it('takes extremes per historic segment with a null segment (islands), and segments by a multi-select', async () => {
    const { lead, qualified, won, lost } = f.stages;
    const max = await dataset(f, {
      type: 'pivot',
      variant: 'historical',
      metric: { type: 'attribute', path: f.path('amount'), aggregation: 'max' },
      primaryGrouping: { path: f.path('stage') },
      timeConfig: WINDOW,
    });
    const mar = Object.fromEntries(
      max.rows.filter((r) => r.group === '2026-03-01').map((r) => [r.segment ?? '∅', [r.value, r.count]]),
    );
    expect(mar).toEqual({
      [won]: [600, 2],
      [lost]: [200, 1],
      [qualified]: [300, 1],
      [lead]: [400, 1],
      '∅': [null, 2],
    });
    const tags = await dataset(f, {
      type: 'pivot',
      variant: 'historical',
      primaryGrouping: { path: f.path('tags') },
      timeConfig: WINDOW,
    });
    const { alpha, beta } = f.options;
    expect(byKey(tags.rows)).toEqual({
      [`2026-01-01|${alpha}`]: 1,
      [`2026-02-01|${alpha}`]: 1,
      [`2026-03-01|${alpha}`]: 1,
      [`2026-01-01|${beta}`]: 1,
      [`2026-02-01|${beta}`]: 2,
      [`2026-03-01|${beta}`]: 1,
      '2026-01-01|∅': 1,
      '2026-02-01|∅': 3,
      '2026-03-01|∅': 6,
    });
  });

  it('runs the comparison window and aligns it to the main buckets', async () => {
    const r = await dataset(f, {
      type: 'pivot',
      variant: 'historical',
      timeConfig: {
        resolution: 'month',
        start: '2026-02-01',
        end: '2026-03-31',
        comparison: { start: '2025-12-01', end: '2026-01-31' },
      },
    });
    expect(r.rows.map((x) => [x.group, x.value])).toEqual([
      ['2026-02-01', 5],
      ['2026-03-01', 7],
    ]);
    expect(r.type === 'pivot' && r.comparisonRows?.map((x) => [x.group, x.value])).toEqual([
      ['2026-02-01', 0],
      ['2026-03-01', 3],
    ]);
  });
});
