// Chart library of the reports feature (visx): every report type × visualisation, the empty / error states, the
// calculated-values footer and the image / CSV exports. The pages hand it a `ChartContext` and a `DatasetOutput`
// (see ./types.ts); nothing in here reads the schema or calls the API.

export { CalculatedValuesBar, type CalculatedValuesBarProps, downloadCsv } from './CalculatedValuesBar';
export { ChartGlyph, ChartMessage, type ChartMessageProps, stateCopy } from './ChartMessage';
export { downloadChartImage, renderElementToPng } from './downloadImage';
export * from './messages';
export {
  buildCartesianModel,
  type CartesianModel,
  type Category,
  type ChartStateKind,
  type Comparison,
  type Series,
} from './model/cartesian';
export {
  cellHighlightKey,
  groupHighlightKey,
  highlightMatchesKey,
  matchesHighlight,
  parseHighlightKey,
  seriesHighlightKey,
} from './model/keys';
export { buildChart, type ChartPlan } from './model/plan';
export { CHART_LIMITS, chartSettings } from './model/settings';
export {
  type CalculatedTable,
  calculatedTable,
  csvOf,
  type TableCell,
  type TableColumn,
  type TableRow,
} from './model/table';
export { CrashMessage, ReportChart } from './ReportChart';
export type { ChartContext, ChartReport, DrillTarget, ReportChartProps, ValueFormat } from './types';
