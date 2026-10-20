// Glyph of a report by its visualisation (chips of the index rows, thumbnails of the favourite cards, Settings rows).
import type { VisualisationType } from '@agentic-crm/contracts';
import type { IconGlyph } from '@agentic-crm/ui';
import {
  BarIcon,
  FunnelAreaIcon,
  FunnelMetricIcon,
  FunnelStepsIcon,
  LineIcon,
  MapIcon,
  PieIcon,
  SingleMetricIcon,
} from '../icons';

const GLYPHS: Record<VisualisationType, IconGlyph> = {
  bar: BarIcon,
  line: LineIcon,
  pie: PieIcon,
  map: MapIcon,
  single_metric: SingleMetricIcon,
  funnel: FunnelAreaIcon,
  metric: FunnelMetricIcon,
  steps: FunnelStepsIcon,
};

export const reportGlyph = (visualisation: VisualisationType | null | undefined): IconGlyph =>
  (visualisation ? GLYPHS[visualisation] : undefined) ?? BarIcon;
