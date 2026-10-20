// Builds the ChartContext of a report (charts/types.ts): labels, attribute types and value formats come from the
// schema; the chart library never reads it (builder §3, chart-types §2 "Number formatting").
import type {
  AttributeDefinition,
  AttributeType,
  FunnelSettings,
  HistoricalSettings,
  InsightSettings,
  Path,
  ReportAggregation,
  ReportMetric,
  StageChangedSettings,
  TimeInStageSettings,
} from '@agentic-crm/contracts';
import { currencyCodeOf, currencyOptions, numberOptions } from '../attributes/format/formatValue';
import type { SchemaIndex } from '../views/schemaIndex';
import type { ChartContext, ChartReport, ValueFormat } from './charts';
import type { DatasetEnv } from './data';
import { AGGREGATION_LABELS, isTimeGrouping } from './reportModel';

/** Local date ('YYYY-MM-DD') of `now` in an IANA zone. */
export function localDateIn(timeZone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function chartEnv(env: DatasetEnv, now = new Date()): ChartContext['env'] {
  return { today: localDateIn(env.timeZone, now), weekStart: env.weekStart, timeZone: env.timeZone };
}

function metricFormat(attr: AttributeDefinition | undefined, aggregation: ReportAggregation): ValueFormat {
  if (!attr || aggregation === 'count') return { kind: 'count' };
  if (attr.type === 'currency') {
    const o = currencyOptions(attr);
    return {
      kind: 'currency',
      currency: currencyCodeOf(attr, null),
      decimals: o.decimals === 'no-decimals' ? 0 : 2,
      display: o.display ?? 'symbol',
    };
  }
  const o = numberOptions(attr);
  const averaged = aggregation === 'mean' || aggregation === 'median';
  return { kind: 'number', decimals: o.decimals ?? (averaged ? 2 : null), grouping: o.grouping !== 'no-groups' };
}

interface MetricParts {
  format: ValueFormat;
  axisTitle: string;
  tooltipLabel: string;
  singleCaption: string;
  singleSubCaption: string;
}

function metricParts(schema: SchemaIndex | null, metric: ReportMetric | null): MetricParts {
  if (!metric || metric.attributePath === null) {
    return {
      format: { kind: 'count' },
      axisTitle: 'Count',
      tooltipLabel: 'Count',
      singleCaption: 'Single Metric - Count',
      singleSubCaption: 'Records',
    };
  }
  const attr = schema?.leaf(metric.attributePath);
  const agg = AGGREGATION_LABELS[metric.aggregation];
  const title = schema?.pathLabel(metric.attributePath, metric.field) ?? attr?.title ?? 'Metric';
  return {
    format: metricFormat(attr, metric.aggregation),
    axisTitle: `${title} › ${agg}`,
    tooltipLabel: `${attr?.title ?? title} (${agg})`,
    singleCaption: `Single Metric - ${agg}`,
    singleSubCaption: attr?.title ?? title,
  };
}

function groupingParts(
  schema: SchemaIndex | null,
  path: Path,
  field: string | null,
): { title: string; type: AttributeType | null; isTime: boolean } {
  const attr = schema?.leaf(path);
  return {
    title: schema?.pathLabel(path, field, 'filter') ?? attr?.title ?? 'Group',
    type: attr?.type ?? null,
    isTime: isTimeGrouping(attr, field),
  };
}

const DURATION: ValueFormat = { kind: 'duration' };

export interface ChartContextInput {
  report: ChartReport;
  schema: SchemaIndex | null;
  sourcePlural: string;
  env: ChartContext['env'];
}

export function buildChartContext({ report, schema, sourcePlural, env }: ChartContextInput): ChartContext {
  const base = { report, sourcePlural, env };
  switch (report.reportType) {
    case 'insights': {
      const s = report.settings as InsightSettings;
      const m = metricParts(schema, s.primaryMetric);
      return {
        ...base,
        metric: m,
        primary: s.primaryGrouping
          ? groupingParts(schema, s.primaryGrouping.attributePath, s.primaryGrouping.field)
          : null,
        secondary:
          s.primaryGrouping && s.secondaryGrouping
            ? groupingParts(schema, s.secondaryGrouping.attributePath, s.secondaryGrouping.field)
            : null,
        statusTitle: null,
      };
    }
    case 'historical': {
      const s = report.settings as HistoricalSettings;
      return {
        ...base,
        metric: metricParts(schema, s.primaryMetric),
        primary: { title: 'Time', type: null, isTime: true },
        secondary: s.primaryGrouping
          ? (({ title, type }) => ({ title, type }))(
              groupingParts(schema, s.primaryGrouping.attributePath, s.primaryGrouping.field),
            )
          : null,
        statusTitle: null,
      };
    }
    case 'stage-changed': {
      const s = report.settings as StageChangedSettings;
      const status = s.statusAttributePath ? (schema?.leaf(s.statusAttributePath)?.title ?? 'Stage') : null;
      return {
        ...base,
        metric: metricParts(schema, s.primaryMetric),
        primary: { title: 'Date changed', type: null, isTime: true },
        secondary: status ? { title: status, type: 'pipeline' } : null,
        statusTitle: status,
      };
    }
    case 'time-in-stage': {
      const s = report.settings as TimeInStageSettings;
      const status = s.statusAttributePath ? (schema?.leaf(s.statusAttributePath)?.title ?? 'Stage') : 'Stage';
      const agg = AGGREGATION_LABELS[s.aggregation];
      const grouping = s.primaryGrouping
        ? groupingParts(schema, s.primaryGrouping.attributePath, s.primaryGrouping.field)
        : null;
      return {
        ...base,
        metric: {
          format: DURATION,
          axisTitle: `${agg} time in status`,
          tooltipLabel: `${agg} time in status`,
          singleCaption: `${agg} time in status`,
          singleSubCaption: status,
        },
        primary: {
          title: status,
          type: s.statusAttributePath ? (schema?.leaf(s.statusAttributePath)?.type ?? 'pipeline') : 'pipeline',
          isTime: false,
        },
        secondary: grouping ? { title: grouping.title, type: grouping.type } : null,
        statusTitle: status,
      };
    }
    case 'funnel': {
      const s = report.settings as FunnelSettings;
      const status = s.funnelAttributePath ? (schema?.leaf(s.funnelAttributePath)?.title ?? 'Stage') : 'Stage';
      const m = metricParts(schema, s.metric);
      return {
        ...base,
        metric: m,
        primary: { title: status, type: 'pipeline', isTime: false },
        secondary: null,
        statusTitle: status,
      };
    }
  }
}
