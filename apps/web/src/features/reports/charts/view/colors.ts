// ColorKey → CSS colour (theme variables, so charts follow the theme without re-rendering).
import { vars } from '@agentic-crm/ui/styles';
import type { ChartColorKey, ColorKey } from '../model/palette';

export function colorVar(key: ColorKey): string {
  if (key === 'nullGrey') return vars.color.utilities.surface.grey;
  if (key === 'accent') return vars.color.surface.accent;
  return vars.color.chart[key as ChartColorKey];
}

/**
 * The cyan of the target line and the previous-period bars / line: `utilities.content.cyan` (#0D99BD in light, #40CFF5
 * in dark). The spec names chart.cyanBold, whose dark value (#A9EBFC) is far brighter than the dim teal the dark
 * evidence shows (H/dashboard-grid-4-4-4.png, editor-insight-bar-date-group-ptd-menu.png).
 */
export const TARGET_COLOR = vars.color.utilities.content.cyan;
export const COMPARISON_COLOR = vars.color.utilities.content.cyan;
