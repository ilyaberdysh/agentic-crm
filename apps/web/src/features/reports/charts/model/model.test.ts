import { beforeAll, describe, expect, it } from 'vitest';
import { setFormatSettings } from '../../../attributes/format/locale';
import * as fx from '../dev/fixtures';
import type { CartesianModel } from './cartesian';
import type { FunnelMetricModel, FunnelModel } from './funnel';
import { cellHighlightKey, groupHighlightKey, matchesHighlight, parseHighlightKey, seriesHighlightKey } from './keys';
import type { PieModel } from './pie';
import { OTHER_KEY } from './pie';
import { buildChart } from './plan';
import type { SingleMetricModel } from './single';
import { calculatedTable, csvOf } from './table';
import {
  bucketFullLabel,
  bucketLabel,
  bucketRangeLabel,
  insightTimeWindow,
  isPeriodIncomplete,
  spansYears,
} from './time';

beforeAll(() => setFormatSettings({ locale: 'en-US', timeZone: 'Europe/Moscow', weekStartsOn: 1 }));

const cartesian = (f: fx.Fixture): CartesianModel => {
  const plan = buildChart(f.ctx, f.data);
  if (plan.type !== 'cartesian') throw new Error(`expected a cartesian model for ${f.id}, got ${JSON.stringify(plan)}`);
  return plan;
};

describe('time buckets', () => {
  it('labels months, adds the year when the range spans years', () => {
    expect(bucketLabel('2026-10-01', 'month', false)).toBe('Oct');
    expect(bucketLabel('2025-12-01', 'month', true)).toBe('Dec 2025');
    expect(bucketLabel('2026-10-05', 'week', false)).toBe('5 Oct');
    expect(bucketLabel('2026-10-01', 'quarter', false)).toBe('Q4');
    expect(bucketLabel('2026-01-01', 'year', false)).toBe('2026');
    expect(spansYears(['2025-12-01', '2026-01-01'])).toBe(true);
    expect(spansYears(['2026-01-01', '2026-02-01'])).toBe(false);
  });

  it('gives tooltips full captions', () => {
    expect(bucketFullLabel('2026-09-01', 'month')).toBe('Sep 2026');
    expect(bucketFullLabel('2026-10-05', 'week')).toBe('Week commencing 5 Oct 2026');
    expect(bucketFullLabel('2026-10-05', 'day')).toBe('5 Oct 2026');
    expect(bucketFullLabel('2026-10-01', 'quarter')).toBe('Q4 2026');
  });

  it('writes range captions with years only across a year boundary', () => {
    expect(bucketRangeLabel(['2025-10-01', '2026-04-01'], 'month')).toBe('Oct 2025 - Apr 2026');
    expect(bucketRangeLabel(['2026-04-01', '2026-10-01'], 'month')).toBe('Apr - Oct');
  });

  it('flags the running bucket', () => {
    const env = { today: '2026-10-14', weekStart: 1 };
    expect(isPeriodIncomplete('2026-10-01', 'month', env)).toBe(true);
    expect(isPeriodIncomplete('2026-09-01', 'month', env)).toBe(false);
    expect(isPeriodIncomplete('2026-10-12', 'week', env)).toBe(true);
  });

  it('applies an Insight window and aligns the previous period by position', () => {
    const env = { today: '2026-10-14', weekStart: 1 };
    const w = insightTimeWindow(
      {
        duration: { type: 'relative', value: '-P0Y6M0DT0H0M0S' },
        resolution: 'month',
        comparison: { type: 'previous_period' },
      },
      ['2026-01-01'],
      env,
    );
    expect(w.buckets).toEqual([
      '2026-04-01',
      '2026-05-01',
      '2026-06-01',
      '2026-07-01',
      '2026-08-01',
      '2026-09-01',
      '2026-10-01',
    ]);
    expect(w.comparisonBuckets).toEqual([
      '2025-10-01',
      '2025-11-01',
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
    ]);
    expect(w.open).toBe(false);
  });

  it('keeps every fetched bucket for "All"', () => {
    const env = { today: '2026-10-14', weekStart: 1 };
    const w = insightTimeWindow(
      { duration: null, resolution: 'month', comparison: null },
      ['2026-01-01', '2026-02-01'],
      env,
    );
    expect(w).toEqual({ buckets: ['2026-01-01', '2026-02-01'], comparisonBuckets: null, open: true });
  });

  it('applies period to date ("Month to date")', () => {
    const env = { today: '2026-10-14', weekStart: 1 };
    const w = insightTimeWindow(
      {
        duration: { type: 'x_to_date', value: 'month' },
        resolution: 'week',
        comparison: { type: 'offset', value: '-P0Y1M0DT0H0M0S' },
      },
      [],
      env,
    );
    expect(w.buckets).toEqual(['2026-09-28', '2026-10-05', '2026-10-12']);
    expect(w.comparisonBuckets).toEqual(['2026-08-31', '2026-09-07', '2026-09-14']);
  });
});

describe('bar chart model', () => {
  it('lists stages in stage order, coloured by stage colour, with the Budget axis title', () => {
    const m = cartesian(fx.barGrouped);
    expect(m.categories.map((c) => c.label)).toEqual(['Discovery', 'Build', 'Review', 'Done']);
    expect(m.categories.map((c) => c.color)).toEqual(['lime', 'blue', 'pink', 'grey']);
    expect(m.colorByCategory).toBe(true);
    expect(m.legend).toEqual([]);
    expect(m.yTitle).toBe('Budget › Sum');
    expect(m.xTitle).toBe('Phase');
    expect(m.cells.map((r) => r[0]?.value)).toEqual([200_000, 470_000, 43_000, 21_000]);
    expect(m.range).toEqual([0, 470_000]);
  });

  it('sorts by amount and honours default_desc', () => {
    const byValue = cartesian(fx.barTarget);
    expect(byValue.categories.map((c) => c.label)).toEqual(['Build', 'Discovery', 'Review', 'Done']);
    expect(byValue.range).toEqual([0, 470_000]);
    expect(byValue.target).toBe(300_000);
    const desc = cartesian({
      ...fx.barGrouped,
      ctx: fx.chartContext('insights', 'bar', { settings: { sortPreference: 'default_desc' } }),
    });
    expect(desc.categories.map((c) => c.label)).toEqual(['Done', 'Review', 'Build', 'Discovery']);
    const asc = cartesian({
      ...fx.barGrouped,
      ctx: fx.chartContext('insights', 'bar', { settings: { sortPreference: 'value_asc' } }),
    });
    expect(asc.categories.map((c) => c.label)).toEqual(['Done', 'Review', 'Discovery', 'Build']);
  });

  it('extends the y range to include a target above the data', () => {
    const m = cartesian({
      ...fx.barGrouped,
      ctx: fx.chartContext('insights', 'bar', { settings: { targetValue: 900_000 } }),
    });
    expect(m.range[1]).toBe(900_000);
  });

  it('hides zero categories when "Show zeros" is off', () => {
    const data = fx.pivot(
      'insight',
      [
        { group: fx.STAGES.discovery, segment: null, value: 5, count: 1 },
        { group: fx.STAGES.build, segment: null, value: 0, count: 0 },
      ],
      { groups: { primary: fx.stageInfos, secondary: null } },
    );
    const on = cartesian({ ...fx.barGrouped, data });
    expect(on.categories).toHaveLength(2);
    const off = cartesian({
      ...fx.barGrouped,
      data,
      ctx: fx.chartContext('insights', 'bar', { settings: { zerosVisible: false } }),
    });
    expect(off.categories.map((c) => c.label)).toEqual(['Discovery']);
  });

  it('stacks segments in option order and lists the legend by total value (Critical, High, Medium, Low)', () => {
    const m = cartesian(fx.barSegmented);
    expect(m.stacked).toBe(true);
    expect(m.segmented).toBe(true);
    expect(m.series.map((s) => s.label)).toEqual(['Low', 'Medium', 'High', 'Critical']);
    expect(m.legend.map((s) => s.label)).toEqual(['Critical', 'High', 'Medium', 'Low']);
    // Same-colour options take base / Subtle / Bold in turn.
    expect(m.series.map((s) => s.color)).toEqual(['grey', 'greySubtle', 'greyBold', 'grey']);
    expect(m.totals).toEqual([200_000, 470_000, 43_000, 21_000]);
    expect(m.cells[0]?.map((c) => c.value)).toEqual([15_000, 45_000, 80_000, 60_000]);
    expect(m.cells[1]?.[0]?.value).toBeNull();
    expect(m.range).toEqual([0, 470_000]);
    expect(m.colorByCategory).toBe(false);
    expect(m.segmentTitle).toBe('Priority');
  });

  it('draws side-by-side bars when "Stack bars" is off (range = largest single cell)', () => {
    const m = cartesian(fx.barSegmentedGrouped);
    expect(m.stacked).toBe(false);
    expect(m.range).toEqual([0, 250_000]);
  });

  it('colours a checkbox grouping and labels the empty bucket', () => {
    const m = cartesian(fx.barCheckbox);
    expect(m.categories.map((c) => c.label)).toEqual(['No', 'Yes', 'No Strategic']);
    expect(m.categories.map((c) => c.color)).toEqual(['nullGrey', 'accent', 'nullGrey']);
  });

  it('keeps many categories (rotated labels are a view concern) and cycles the categorical palette', () => {
    const m = cartesian(fx.barManyCategories);
    expect(m.categories).toHaveLength(18);
    expect(m.categories[0]?.label).toBe('United States');
    expect(m.categories[0]?.color).toBe('blue');
    expect(m.categories[1]?.color).toBe('cyan');
  });

  it('lists date buckets chronologically with a grey "No Start date" bucket last', () => {
    const m = cartesian(fx.barDate);
    expect(m.isTime).toBe(true);
    expect(m.categories[0]?.label).toBe('Dec 2025');
    expect(m.categories.at(-1)?.label).toBe('No Start date');
    expect(m.categories.at(-1)?.color).toBe('nullGrey');
    expect(m.categories.slice(0, -1).every((c) => c.color === 'blue')).toBe(true);
    expect(m.categories.map((c) => c.key).slice(0, 3)).toEqual(['2025-12-01', '2026-01-01', '2026-02-01']);
    // The empty February bucket has a label and no value.
    expect(m.cells[2]?.[0]?.value).toBeNull();
    expect(m.categories.find((c) => c.key === '2026-10-01')?.incomplete).toBe(true);
    expect(m.xTitle).toBe('Start date');
  });

  it('aligns the previous period to the 6M window and calls the x axis "Time"', () => {
    const m = cartesian(fx.barCompare);
    expect(m.categories.map((c) => c.label)).toEqual(['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']);
    expect(m.comparison?.values).toEqual([null, null, 12_000, 9_000, null, 250_000, 70_000]);
    expect(m.comparison?.titles[5]).toBe('Mar 2026');
    expect(m.comparison?.previousRange).toBe('Oct 2025 - Apr 2026');
    expect(m.comparison?.currentRange).toBe('Apr - Oct');
    expect(m.xTitle).toBe('Time');
    expect(m.range[1]).toBe(300_000);
  });

  it('reports a comparison window without data', () => {
    const plan = buildChart(fx.barCompareEmpty.ctx, fx.barCompareEmpty.data);
    expect(plan).toEqual({ type: 'state', state: { kind: 'noComparison' } });
  });

  it('turns an empty dataset into the "no data" state', () => {
    const plan = buildChart(fx.barGrouped.ctx, fx.pivot('insight', [], { groups: { primary: [], secondary: null } }));
    expect(plan).toEqual({ type: 'state', state: { kind: 'empty' } });
  });

  it('refuses too many bars, and a truncated dataset', () => {
    const rows = Array.from({ length: 101 }, (_, i) => ({ group: `g${i}`, segment: null, value: i, count: 1 }));
    const tooMany = buildChart(
      fx.barGrouped.ctx,
      fx.pivot('insight', rows, {
        groups: {
          primary: rows.map((r, order) => ({ key: r.group, label: r.group, color: null, order })),
          secondary: null,
        },
      }),
    );
    expect(tooMany).toEqual({ type: 'state', state: { kind: 'tooMany', nouns: 'bars' } });
    const truncated = buildChart(
      fx.barSegmented.ctx,
      fx.pivot('insight', fx.barSegmented.data.type === 'pivot' ? fx.barSegmented.data.rows : [], {
        truncated: true,
        groups: { primary: fx.stageInfos, secondary: fx.priorityInfos },
      }),
    );
    expect(truncated).toEqual({ type: 'state', state: { kind: 'tooMany', nouns: 'bar segments' } });
  });
});

describe('line chart model', () => {
  it('has a single blue series and ignores the sort preference', () => {
    const m = cartesian(fx.lineSingle);
    expect(m.kind).toBe('line');
    expect(m.series).toHaveLength(1);
    expect(m.series[0]?.color).toBe('blue');
    expect(m.colorByCategory).toBe(false);
    expect(m.categories.map((c) => c.label)).toEqual(['Discovery', 'Build', 'Review', 'Done']);
  });

  it('draws one line per segment with a null gap where a segment has no value', () => {
    const m = cartesian(fx.lineSegmentedTarget);
    expect(m.series).toHaveLength(4);
    expect(m.cells[1]?.[0]?.value).toBeNull();
    expect(m.target).toBe(300_000);
    expect(m.range[1]).toBe(300_000);
  });
});

describe('historical, stage changed and time in stage', () => {
  it('uses the server window and colours segments by stage colour', () => {
    const m = cartesian(fx.historicalSegmented);
    expect(m.categories.map((c) => c.label)).toEqual(['Jul', 'Aug', 'Sep', 'Oct']);
    expect(m.series.map((s) => s.color)).toEqual(['lime', 'blue', 'pink', 'grey']);
    expect(m.legend.map((s) => s.label)).toEqual(['Build', 'Discovery', 'Review', 'Done']);
    expect(m.totals).toEqual([0, 0, 0, 734_000]);
    expect(m.categories[3]?.incomplete).toBe(true);
    expect(m.xTitle).toBe('Time');
  });

  it('leaves out the "No {attribute}" segment when no record falls into it', () => {
    // The server answers a null segment with zero rows for every bucket.
    const f = fx.historicalSegmented;
    const zeroNull = (
      f.data as { rows: { group: string | null; segment: string | null; value: number | null; count: number }[] }
    ).rows
      .filter((r) => r.segment !== null)
      .map((r) => ({ group: r.group, segment: null, value: 0, count: 0 }));
    const rows = [...(f.data as { rows: unknown[] }).rows, ...zeroNull];
    const m = cartesian({ ...f, data: { ...f.data, rows } as never });
    expect(m.legend.map((s) => s.label)).toEqual(['Build', 'Discovery', 'Review', 'Done']);
  });

  it('draws a historical line without segment as one blue series', () => {
    const m = cartesian(fx.historicalLine);
    expect(m.series).toHaveLength(1);
    expect(m.cells.map((r) => r[0]?.value)).toEqual([3, 5, 9, 12]);
  });

  it('stacks Stage changed by stage in stage order', () => {
    const m = cartesian(fx.stageChanged);
    expect(m.categories.map((c) => c.label)).toEqual(['Oct']);
    expect(m.series.map((s) => s.label)).toEqual(['Discovery', 'Build', 'Review', 'Done']);
    expect(m.legend.map((s) => s.label)).toEqual(['Discovery', 'Build', 'Review', 'Done']);
    expect(m.totals).toEqual([14]);
    expect(m.xTitle).toBe('Date changed');
  });

  it('draws time in stage per stage colour, without segments', () => {
    const m = cartesian(fx.timeInStage);
    expect(m.categories.map((c) => c.label)).toEqual(['Discovery', 'Build', 'Review', 'Done']);
    expect(m.categories.map((c) => c.color)).toEqual(['lime', 'blue', 'pink', 'grey']);
    expect(m.stacked).toBe(false);
    expect(m.yTitle).toBe('Average time in status');
  });

  it('groups time in stage into side-by-side bars per group value, keeping empty slots', () => {
    const m = cartesian(fx.timeInStageGrouped);
    expect(m.segmented).toBe(true);
    expect(m.stacked).toBe(false);
    // Side-by-side bars are ordered like the legend (by total, ties in option order); colours stay per option.
    expect(m.series.map((s) => s.label)).toEqual(['Low', 'Critical', 'Medium', 'High']);
    expect(m.legend.map((s) => s.label)).toEqual(['Low', 'Critical', 'Medium', 'High']);
    expect(m.series.map((s) => s.color)).toEqual(['grey', 'grey', 'greySubtle', 'greyBold']);
    // Build has no Medium: its slot stays empty.
    expect(m.cells[1]?.map((c) => c.value !== null)).toEqual([true, true, false, true]);
  });
});

describe('pie model', () => {
  it('sorts slices by value descending with shares of the total', () => {
    const plan = buildChart(fx.pie.ctx, fx.pie.data) as PieModel;
    expect(plan.type).toBe('pie');
    expect(plan.slices.map((s) => s.label)).toEqual(['Build', 'Discovery', 'Review', 'Done']);
    expect(plan.slices.map((s) => s.color)).toEqual(['blue', 'lime', 'pink', 'grey']);
    expect(plan.total).toBe(734_000);
    expect(plan.slices[0]?.percent).toBeCloseTo(64.03, 1);
    expect(plan.slices.reduce((s, x) => s + x.percent, 0)).toBeCloseTo(100, 6);
  });

  it('merges more than ten categories into "Other"', () => {
    const plan = buildChart(fx.pieOther.ctx, fx.pieOther.data) as PieModel;
    expect(plan.slices).toHaveLength(10);
    const other = plan.slices.at(-1);
    expect(other?.key).toBe(OTHER_KEY);
    expect(other?.label).toBe('Other');
    expect(other?.merged).toBe(4);
    expect(plan.slices.slice(0, 9).map((s) => s.label)[0]).toBe('Acme');
  });

  it('refuses negative values', () => {
    expect(buildChart(fx.pieNegative.ctx, fx.pieNegative.data)).toEqual({ type: 'state', state: { kind: 'negative' } });
  });
});

describe('single metric model', () => {
  it('formats counts and currency with the metric captions', () => {
    const count = buildChart(fx.singleCount.ctx, fx.singleCount.data) as SingleMetricModel;
    expect(count).toMatchObject({
      type: 'single',
      caption: 'Single Metric - Count',
      value: '12',
      subCaption: 'Records',
    });
    const sum = buildChart(fx.singleCurrency.ctx, fx.singleCurrency.data) as SingleMetricModel;
    expect(sum).toMatchObject({ caption: 'Single Metric - Sum', value: '€734,000.00', subCaption: 'Budget' });
  });
});

describe('funnel models', () => {
  it('computes conversion (12 → 9 → 4 → 2 gives 100 / 75 / 44 / 50 %) and drop-off', () => {
    const m = buildChart(fx.funnel.ctx, fx.funnel.data) as FunnelModel;
    expect(m.type).toBe('funnel');
    expect(m.stages.map((s) => Math.round(s.converted ?? -1))).toEqual([100, 75, 44, 50]);
    expect(m.stages.map((s) => Math.round(s.dropOff ?? -1))).toEqual([0, 25, 56, 50]);
    expect(m.stages.map((s) => s.dropValue)).toEqual([0, 3, 5, 2]);
    expect(m.stages.map((s) => s.height)).toEqual([1, 0.75, 4 / 12, 2 / 12]);
    expect(m.valueLabel).toBe('Projects');
  });

  it('starts with a "Total" column for All records', () => {
    const m = buildChart(fx.funnelAll.ctx, fx.funnelAll.data) as FunnelModel;
    expect(m.stages.map((s) => s.label)).toEqual(['Total', 'Discovery', 'Build', 'Review', 'Done']);
    expect(m.stages.map((s) => Math.round(s.converted ?? -1))).toEqual([100, 100, 75, 44, 50]);
  });

  it('uses the metric for value-based funnels', () => {
    const m = buildChart(fx.funnelMetricSum.ctx, fx.funnelMetricSum.data) as FunnelModel;
    expect(m.type).toBe('steps');
    expect(m.valueLabel).toBe('Budget (Sum)');
    expect(m.stages.map((s) => Math.round(s.converted ?? -1))).toEqual([100, 75, 16, 33]);
  });

  it('writes the funnel metric (17 %) with its path', () => {
    const m = buildChart(fx.funnelMetric.ctx, fx.funnelMetric.data) as FunnelMetricModel;
    expect(m).toMatchObject({ type: 'funnel-metric', caption: 'Funnel Metric - Phase', value: '17 %' });
    expect(m.path).toEqual(['Discovery', 'Build', 'Review', 'Done']);
  });
});

describe('highlight keys', () => {
  it('names groups, series and cells and matches them', () => {
    expect(groupHighlightKey('a')).toBe('g:a');
    expect(groupHighlightKey(null)).toBe('g:\u2205');
    expect(seriesHighlightKey('x')).toBe('s:x');
    expect(cellHighlightKey('a', 'x')).toBe('g:a|s:x');
    const group = parseHighlightKey('g:a');
    expect(matchesHighlight(group, 'a', 'x')).toBe(true);
    expect(matchesHighlight(group, 'b', 'x')).toBe(false);
    const series = parseHighlightKey('s:x');
    expect(matchesHighlight(series, 'a', 'x')).toBe(true);
    expect(matchesHighlight(series, 'a', 'y')).toBe(false);
    expect(matchesHighlight(series, 'a')).toBe(false);
    expect(matchesHighlight(parseHighlightKey('g:a|s:x'), 'a', 'y')).toBe(false);
    expect(matchesHighlight(null, 'a', 'x')).toBe(false);
    expect(parseHighlightKey('nope')).toBeNull();
  });
});

describe('calculated values table and CSV', () => {
  it('lists one row per bar in chart order with formatted values', () => {
    const table = calculatedTable(fx.barTarget.ctx, fx.barTarget.data);
    expect(table?.columns.map((c) => c.title)).toEqual(['Phase', 'Budget › Sum']);
    expect(table?.rows.map((r) => r.cells.map((c) => c.text))).toEqual([
      ['Build', '€470,000.00'],
      ['Discovery', '€200,000.00'],
      ['Review', '€43,000.00'],
      ['Done', '€21,000.00'],
    ]);
    expect(table?.rows[0]?.swatch).toBe('blue');
    expect(table?.rows[0]?.key).toBe(groupHighlightKey(fx.STAGES.build));
  });

  it('lists segments as group / segment / value rows with cell keys', () => {
    const table = calculatedTable(fx.barSegmented.ctx, fx.barSegmented.data);
    expect(table?.columns.map((c) => c.title)).toEqual(['Phase', 'Priority', 'Budget › Sum']);
    expect(table?.rows).toHaveLength(11);
    expect(table?.rows[0]?.key).toBe(cellHighlightKey(fx.STAGES.discovery, fx.PRIORITIES.low));
    expect(table?.rows[1]?.cells.map((c) => c.text)).toEqual(['Discovery', 'Medium', '€45,000.00']);
  });

  it('titles a time column "Month commencing", flags the running bucket and adds the previous period', () => {
    const table = calculatedTable(fx.barCompare.ctx, fx.barCompare.data);
    expect(table?.columns.map((c) => c.title)).toEqual(['Month commencing', 'Budget › Sum', 'Previous period']);
    const oct = table?.rows.at(-1);
    expect(oct?.flag).toBe('Period incomplete');
    expect(oct?.cells.map((c) => c.text)).toEqual(['Oct 2026', '€80,000.00', '€70,000.00']);
  });

  it('lists funnel stages with conversion and drop-off', () => {
    const table = calculatedTable(fx.funnel.ctx, fx.funnel.data);
    expect(table?.columns.map((c) => c.title)).toEqual(['Phase', 'Projects', 'Converted', 'Drop-off']);
    expect(table?.rows[1]?.cells.map((c) => c.text)).toEqual(['Build', '9', '75 %', '25 %']);
  });

  it('lists durations for time in stage', () => {
    const table = calculatedTable(fx.timeInStage.ctx, fx.timeInStage.data);
    expect(table?.columns.map((c) => c.title)).toEqual(['Phase', 'Average time in status']);
    expect(table?.rows[0]?.cells[1]?.text).toBe('5hr 28m 12s');
  });

  it('has no table for a state', () => {
    expect(calculatedTable(fx.pieNegative.ctx, fx.pieNegative.data)).toBeNull();
  });

  it('writes RFC 4180 CSV with machine values', () => {
    const table = calculatedTable(fx.barTarget.ctx, fx.barTarget.data);
    if (!table) throw new Error('no table');
    expect(csvOf(table)).toBe(
      ['Phase,Budget › Sum', 'Build,470000', 'Discovery,200000', 'Review,43000', 'Done,21000'].join('\r\n'),
    );
    expect(
      csvOf({
        columns: [{ key: 'a', title: 'A "x"', align: 'left' }],
        rows: [{ key: 'k', swatch: null, cells: [{ text: 'a,b', raw: 'a,b' }] }],
      }),
    ).toBe('"A ""x"""\r\n"a,b"');
  });
});
