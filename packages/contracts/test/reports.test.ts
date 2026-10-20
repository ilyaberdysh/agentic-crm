// Shared report helpers (contracts/reports.ts): per-type defaults and settings parsing, visualisation normalising,
// time windows and buckets with week starts, report → dataset query compilation, and the dashboard grid packing.
import { describe, expect, it } from 'vitest';
import {
  addDurationToDate,
  bucketStartOf,
  bucketsBetween,
  datasetQueryForReport,
  defaultReportSettings,
  evenRowWidths,
  IncompleteReportError,
  normaliseVisualisation,
  packDashboardRows,
  parseReportSettings,
  resolveReportWindow,
} from '../src/reports.ts';

const D = '01a13b31-b843-73e3-8c84-57b7a78f4fb6';
const A = '01a13b31-b8b6-77e3-984b-c8d8463ba63b';
const S1 = '01a13b31-b8b6-77e3-984b-c8d8463ba63c';
const S2 = '01a13b31-b8b6-77e3-984b-c8d8463ba63d';
const path = [{ entityDefinitionId: D, attributeDefinitionId: A }];
const env = { today: '2026-10-14', weekStart: 1, timeZone: 'Europe/Moscow' };

describe('settings', () => {
  it('starts every type with the builder defaults and merges partial settings', () => {
    expect(defaultReportSettings('time-in-stage')).toMatchObject({ aggregation: 'mean', barSegmentsStacked: false });
    expect(defaultReportSettings('funnel')).toEqual({
      metric: null,
      funnelAttributePath: null,
      funnelSelectedPipelineStageIds: [],
      topOfFunnelVisible: false,
    });
    const s = parseReportSettings('insights', { primaryGrouping: { attributePath: path }, targetValue: 5 });
    expect(s.primaryGrouping).toEqual({
      attributePath: path,
      field: null,
      selectedValues: null,
      nullGroupVisible: true,
      emptyGroupsVisible: false,
      selectedPipelineStageIds: [],
    });
    expect(s.targetValue).toBe(5);
    expect(() => parseReportSettings('insights', { sortPreference: 'random' })).toThrow();
  });

  it('normalises visualisations that the configuration does not allow', () => {
    const insight = defaultReportSettings('insights');
    expect(normaliseVisualisation('insights', insight, 'bar')).toBe('single_metric');
    const grouped = {
      ...insight,
      primaryGrouping: parseReportSettings('insights', { primaryGrouping: { attributePath: path } }).primaryGrouping,
    };
    expect(normaliseVisualisation('insights', grouped, null)).toBe('bar');
    expect(normaliseVisualisation('insights', { ...grouped, secondaryGrouping: grouped.primaryGrouping }, 'pie')).toBe(
      'bar',
    );
    expect(normaliseVisualisation('funnel', defaultReportSettings('funnel'), 'steps')).toBe('steps');
    expect(normaliseVisualisation('time-in-stage', defaultReportSettings('time-in-stage'), 'line')).toBe('bar');
  });
});

describe('time windows and buckets', () => {
  it('computes bucket starts with the week start (Monday vs Sunday)', () => {
    expect(bucketStartOf('2026-10-14', 'week', 1)).toBe('2026-10-12');
    expect(bucketStartOf('2026-10-14', 'week', 0)).toBe('2026-10-11');
    expect(bucketStartOf('2026-10-14', 'quarter', 1)).toBe('2026-10-01');
    expect(bucketsBetween('2026-01-31', '2026-04-02', 'month', 1)).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
    ]);
    expect(addDurationToDate('2026-03-31', '-P0Y1M0DT0H0M0S')).toBe('2026-02-28');
  });

  it('resolves relative and period-to-date ranges and their comparisons', () => {
    expect(resolveReportWindow({ duration: null, resolution: 'month', comparison: null }, env)).toEqual({
      start: null,
      end: null,
      comparison: null,
    });
    expect(
      resolveReportWindow(
        {
          duration: { type: 'relative', value: '-P0Y6M0DT0H0M0S' },
          resolution: 'month',
          comparison: { type: 'previous_period' },
        },
        env,
      ),
    ).toEqual({ start: '2026-04-14', end: '2026-10-14', comparison: { start: '2025-10-14', end: '2026-04-14' } });
    expect(
      resolveReportWindow(
        {
          duration: { type: 'x_to_date', value: 'month' },
          resolution: 'day',
          comparison: { type: 'offset', value: '-P0Y1M0DT0H0M0S' },
        },
        env,
      ),
    ).toEqual({ start: '2026-10-01', end: '2026-10-14', comparison: { start: '2026-09-01', end: '2026-09-14' } });
  });
});

describe('report → dataset query', () => {
  it('"Show zeros" keeps empty options, stages and buckets on the axis of an insight', () => {
    const compile = (zerosVisible: boolean) =>
      datasetQueryForReport(
        {
          entityDefinitionId: D,
          filter: null,
          reportType: 'insights',
          visualisationType: 'bar',
          settings: parseReportSettings('insights', {
            zerosVisible,
            primaryGrouping: { attributePath: path },
            secondaryGrouping: { attributePath: path },
          }),
        },
        env,
      ) as { primaryGrouping: { includeEmptyGroups: boolean }; secondaryGrouping: { includeEmptyGroups: boolean } };
    expect(compile(true).primaryGrouping.includeEmptyGroups).toBe(true);
    expect(compile(false).primaryGrouping.includeEmptyGroups).toBe(false);
    // Segments never fill empty series.
    expect(compile(true).secondaryGrouping.includeEmptyGroups).toBe(false);
  });

  it('compiles every type', () => {
    const insight = datasetQueryForReport(
      {
        entityDefinitionId: D,
        filter: null,
        reportType: 'insights',
        visualisationType: 'bar',
        settings: parseReportSettings('insights', {
          primaryMetric: { attributePath: path, field: 'raw_value', aggregation: 'sum' },
          primaryGrouping: { attributePath: path, selectedPipelineStageIds: [S1] },
        }),
      },
      env,
    );
    expect(insight).toMatchObject({
      type: 'pivot',
      variant: 'insight',
      metric: { type: 'attribute', path, aggregation: 'sum' },
      primaryGrouping: { path, selectedValues: [S1], includeNullGroup: true },
      timeConfig: { resolution: 'month', start: null, end: null },
      timeZone: 'Europe/Moscow',
      weekStart: 1,
    });
    const historical = datasetQueryForReport(
      {
        entityDefinitionId: D,
        filter: null,
        reportType: 'historical',
        visualisationType: 'line',
        settings: parseReportSettings('historical', {
          primaryGrouping: { attributePath: path },
          primaryGroupingIsHistoric: false,
          timeConfig: { duration: { type: 'relative', value: '-P0Y3M0DT0H0M0S' }, resolution: 'week' },
        }),
      },
      env,
    );
    expect(historical).toMatchObject({
      variant: 'historical',
      primaryGrouping: { historic: false },
      timeConfig: { resolution: 'week', start: '2026-07-14', end: '2026-10-14' },
    });
    const funnel = datasetQueryForReport(
      {
        entityDefinitionId: D,
        filter: null,
        reportType: 'funnel',
        visualisationType: 'metric',
        settings: parseReportSettings('funnel', {
          funnelAttributePath: path,
          funnelSelectedPipelineStageIds: [S1, S2],
          topOfFunnelVisible: true,
        }),
      },
      env,
    );
    expect(funnel).toMatchObject({ type: 'funnel-metric', stageIds: [S1, S2], includeAllRecords: true, metric: null });
    expect(() =>
      datasetQueryForReport(
        {
          entityDefinitionId: D,
          filter: null,
          reportType: 'time-in-stage',
          visualisationType: 'bar',
          settings: defaultReportSettings('time-in-stage'),
        },
        env,
      ),
    ).toThrow(IncompleteReportError);
  });
});

describe('dashboard grid', () => {
  it('packs cells into 12-column rows and splits rows evenly', () => {
    expect(
      packDashboardRows([{ width: 12 }, { width: 6 }, { width: 6 }, { width: 5 }]).map((r) =>
        r.map((c) => c.renderWidth),
      ),
    ).toEqual([[12], [6, 6], [12]]);
    expect(evenRowWidths(2)).toEqual([6, 6]);
    expect(evenRowWidths(3)).toEqual([4, 4, 4]);
  });
});
