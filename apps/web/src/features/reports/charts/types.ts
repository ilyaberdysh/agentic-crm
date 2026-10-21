// The seam between the report pages (dashboard cells, editor canvas, viewer) and the chart library (BACKLOG 9.07;
//). The pages build a `ChartContext` from the report and the schema (labels, attribute types, value
// formats) and hand it with the server's `DatasetOutput`; the library turns both into a chart model and draws it
// with visx. Nothing in features/reports/charts reads the schema or calls the API.
import type {
  AttributeType,
  DatasetOutput,
  ReportSettings,
  ReportType,
  VisualisationType,
} from '@agentic-crm/contracts';

/** How one number is written (formatting follows the metric attribute, chart-types "Number formatting"). */
export type ValueFormat =
  /** Counts: integers ("12"). */
  | { kind: 'count' }
  /** A number or rating attribute: `decimals` null = as stored; grouping false = "no groups". */
  | { kind: 'number'; decimals: number | null; grouping: boolean }
  /** Currency: tooltips and tables "€470,000.00" (`decimals` 2) or "€470,000" (0); axes compact ("€500k"). */
  | { kind: 'currency'; currency: string; decimals: 0 | 2; display: 'symbol' | 'narrowSymbol' | 'code' | 'name' }
  /** Milliseconds: "3hr 25m 7s" in tooltips and tables, "1hr … 6hr" on axes. */
  | { kind: 'duration' };

export interface ChartReport {
  reportType: ReportType;
  visualisationType: VisualisationType;
  settings: ReportSettings;
}

/** What a chart needs to know that the dataset does not carry. */
export interface ChartContext {
  report: ChartReport;
  /** Plural noun of the data source ("Projects"): funnel tooltips ("Projects" / count). */
  sourcePlural: string;
  metric: {
    format: ValueFormat;
    /** Y-axis title and the calculated-values column: "Budget › Sum", "Count", "Average time in status". */
    axisTitle: string;
    /** Tooltip row label: "Budget (Sum)", "Count", "Average time in status". */
    tooltipLabel: string;
    /** Single metric caption: "Single Metric - Sum" (the blue square is drawn by the chart) … */
    singleCaption: string;
    /** … and the sub-caption: "Records" for counts, else the attribute title. */
    singleSubCaption: string;
  };
  /** The x-axis grouping: axis title ("Phase", "Primary location › Country", "Time", "Date changed"). null = none. */
  primary: {
    title: string;
    /** Leaf attribute type of the grouping (null for time axes of historical / stage-changed reports). */
    type: AttributeType | null;
    /** Group keys are time buckets ('YYYY-MM-DD') — format them as "Oct", "Dec 2025", "Week commencing …". */
    isTime: boolean;
  } | null;
  /** Segment / series attribute ("Priority"); null = no segments. */
  secondary: { title: string; type: AttributeType | null } | null;
  /** Funnel / stage reports: the status attribute's title ("Phase"). */
  statusTitle: string | null;
  /** The viewer's today (local date), week start (0 = Sunday) and IANA zone — time buckets, "Period incomplete". */
  env: { today: string; weekStart: number; timeZone: string };
}

/** A click on a bar, segment, slice or point (Insight drill-down): the keys of the row's `group` and `segment`. */
export interface DrillTarget {
  group: string | null;
  segment: string | null;
}

export interface ReportChartProps {
  ctx: ChartContext;
  data: DatasetOutput;
  /** `cell` = dashboard card (smaller type, no axis titles unless there is room); `canvas` = editor / viewer. */
  size?: 'cell' | 'canvas';
  /** Key of the element highlighted from outside (hover in the calculated-values table); see `ChartHighlight`. */
  highlightKey?: string | null;
  onHighlight?: (key: string | null) => void;
  /** Present for Insight reports: bars, segments, slices and points are clickable. */
  onDrill?: (target: DrillTarget) => void;
}
