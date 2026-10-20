// One report's chart area (cells, editor canvas, viewer): the loading skeleton, "Input needed" / "Not available" /
// error states (chart-types §5) or the chart itself, built from the dataset, the schema and the viewer's environment.
import type { DatasetOutput } from '@agentic-crm/contracts';
import { Skeleton } from '@agentic-crm/ui';
import { useMemo } from 'react';
import { errorEnvelopeOf, httpStatusOf } from '../../data/trpc';
import type { SchemaIndex } from '../views/schemaIndex';
import { buildChartContext, chartEnv } from './chartContext';
import type { DrillTarget } from './charts';
import { ChartMessage, type ChartReport, ReportChart } from './charts';
import { viewerEnv } from './data';
import type { DataSource } from './dataSources';

export interface DatasetState {
  data: DatasetOutput | undefined;
  isPending: boolean;
  error: unknown;
  /** Why the report cannot run yet (`incompleteReason`), else null. */
  incomplete: string | null;
}

/** Messages of the "Input needed" states (chart-types §5). */
export function incompleteMessage(reason: string): string {
  if (reason === 'Choose a status attribute') return 'Select a status attribute';
  if (reason === 'Select stages') return 'Select at least 2 statuses';
  return reason;
}

export function ChartSkeleton() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'flex-end',
        gap: 16,
        padding: '24px 32px 32px',
      }}
    >
      {[0.5, 0.8, 0.35, 0.65, 0.45, 0.7].map((h, i) => (
        <Skeleton key={i} width="100%" height={`${h * 100}%`} />
      ))}
    </div>
  );
}

export interface ReportChartViewProps {
  report: ChartReport;
  schema: SchemaIndex | null;
  source: DataSource | undefined;
  state: DatasetState;
  size: 'cell' | 'canvas';
  highlightKey?: string | null;
  onHighlight?: (key: string | null) => void;
  onDrill?: (target: DrillTarget) => void;
}

export function ReportChartView({
  report,
  schema,
  source,
  state,
  size,
  highlightKey,
  onHighlight,
  onDrill,
}: ReportChartViewProps) {
  const env = useMemo(() => chartEnv(viewerEnv()), []);
  const ctx = useMemo(
    () => (schema ? buildChartContext({ report, schema, sourcePlural: source?.name ?? 'Records', env }) : null),
    [report, schema, source?.name, env],
  );
  if (state.incomplete) {
    return <ChartMessage title="Input needed to display chart" subtitle={incompleteMessage(state.incomplete)} />;
  }
  if (state.error && !state.data) {
    const status = httpStatusOf(state.error);
    if (status === 404 || status === 403) {
      return (
        <ChartMessage
          title="Not available"
          subtitle="A data source used by this report is not available. You may not have access to it or it may have been deleted."
        />
      );
    }
    return <ChartMessage title="Unable to load report" subtitle={errorEnvelopeOf(state.error).message} />;
  }
  if (!state.data || !ctx) return <ChartSkeleton />;
  return (
    <ReportChart
      ctx={ctx}
      data={state.data}
      size={size}
      highlightKey={highlightKey}
      onHighlight={onHighlight}
      onDrill={onDrill}
    />
  );
}
