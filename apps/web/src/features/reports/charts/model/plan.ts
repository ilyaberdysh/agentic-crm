// One entry point from (context, dataset) to the model that is drawn: a chart, or the state that replaces it.
import type { DatasetOutput } from '@agentic-crm/contracts';
import type { ChartContext } from '../types';
import { buildCartesianModel, type CartesianModel, type ChartStateKind } from './cartesian';
import { buildFunnelMetricModel, buildFunnelModel, type FunnelMetricModel, type FunnelModel } from './funnel';
import { buildPieModel, type PieModel } from './pie';
import { buildSingleMetricModel, type SingleMetricModel } from './single';

export type ChartModel = CartesianModel | PieModel | SingleMetricModel | FunnelModel | FunnelMetricModel;
export type ChartPlan = { type: 'state'; state: ChartStateKind } | ChartModel;

const state = (s: ChartStateKind): ChartPlan => ({ type: 'state', state: s });
const isState = (x: ChartModel | ChartStateKind): x is ChartStateKind => 'kind' in x && !('type' in x);

function planOf(x: ChartModel | ChartStateKind): ChartPlan {
  return isState(x) ? state(x) : x;
}

/** Whether the dataset type fits the report's visualisation (a stale dataset can arrive right after a switch). */
export function buildChart(ctx: ChartContext, data: DatasetOutput): ChartPlan {
  const vis = ctx.report.visualisationType;
  switch (data.type) {
    case 'pivot':
      if (data.rows.length === 0 && vis !== 'single_metric') return state({ kind: 'empty' });
      if (vis === 'single_metric') return planOf(buildSingleMetricModel(ctx, data));
      if (vis === 'pie') return planOf(buildPieModel(ctx, data));
      if (vis === 'map') return state({ kind: 'unsupported' });
      return planOf(buildCartesianModel(ctx, data));
    case 'time-in-stage':
      if (data.rows.length === 0) return state({ kind: 'empty' });
      return planOf(buildCartesianModel(ctx, data));
    case 'funnel':
    case 'funnel-metric':
      return planOf(vis === 'metric' ? buildFunnelMetricModel(ctx, data) : buildFunnelModel(ctx, data));
  }
}
