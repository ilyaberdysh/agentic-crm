// Styles of the chart library; colours are theme tokens so both themes follow.
import { alpha, insetRing, scales, text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style } from '@vanilla-extract/css';

const c = vars.color;

// ---- frame -------------------------------------------------------------------------------------------------------------

export const root = style({
  position: 'relative',
  boxSizing: 'border-box',
  width: '100%',
  height: '100%',
  minHeight: 0,
  overflow: 'hidden',
  color: c.content.secondary,
  userSelect: 'none',
  ...text.text12.standard,
});

export const svgLayer = style({ position: 'absolute', left: 0, top: 0, overflow: 'visible' });

export const clickable = style({ cursor: 'pointer' });

// ---- axes ----------------------------------------------------------------------------------------------------------------

const axisText = style({
  position: 'absolute',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
  color: c.content.secondary,
  ...text.text12.standard,
});

export const yTick = style([axisText, { textAlign: 'right', transform: 'translateY(-50%)' }]);

export const xTick = style([
  axisText,
  { textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', transition: 'opacity 120ms ease' },
]);

/** Rotated −45° with its end at the band centre. */
export const xTickRotated = style([
  axisText,
  { transformOrigin: '100% 0', transform: 'translateX(-100%) rotate(-45deg)' },
]);

export const axisTitle = style([
  axisText,
  { display: 'flex', alignItems: 'center', gap: 4, ...text.body.standard, color: c.content.secondary },
]);

export const yAxisTitle = style([axisTitle, { transform: 'translate(-50%, -50%) rotate(-90deg)' }]);
export const xAxisTitle = style([axisTitle, { transform: 'translateX(-50%)' }]);

export const titleChevron = style({ flex: 'none', width: 8, height: 8, opacity: 0.8 });

export const gridLine = style({
  stroke: c.stroke.secondary,
  strokeWidth: 1,
  strokeDasharray: '3 3',
  shapeRendering: 'crispEdges',
});
export const baseline = style({ fill: c.stroke.primary });

// ---- marks --------------------------------------------------------------------------------------------------------------

export const mark = style({ transition: 'opacity 120ms ease' });
export const dimmed = style({ opacity: 0.3 });
export const surfaceStroke = style({ stroke: c.surface.primary, paintOrder: 'stroke' });

// Previous-period bars: a muted blue-cyan fill (#A4D1E6 over white) with a dashed cyan outline (#53B6E6), sampled from
// evidence H/editor-insight-bar-time-compare.png (the cyan at ≈ 40 %, the outline at full strength).
export const comparisonBar = style({
  fill: alpha(c.utilities.content.cyan, 40),
  stroke: c.utilities.content.cyan,
  strokeWidth: 1.25,
  strokeDasharray: '5 3',
});

export const targetLine = style({
  stroke: c.utilities.content.cyan,
  strokeWidth: 2,
  strokeDasharray: '0 7',
  strokeLinecap: 'round',
  fill: 'none',
});

export const linePath = style({ fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' });
// A line point: r = 3 in the series colour inside a 2 px surface ring (the dot reads 4 px across) with a faint shadow (evidence H/editor-insight-line-segmented-target.png).
export const pointRing = style({
  stroke: c.surface.primary,
  filter: 'drop-shadow(0 1px 1.25px rgba(16, 17, 18, 0.28))',
});

// ---- legend --------------------------------------------------------------------------------------------------------------

export const legend = style({
  position: 'absolute',
  display: 'flex',
  flexWrap: 'nowrap',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 16,
  height: 16,
  whiteSpace: 'nowrap',
  color: c.content.secondary,
  ...text.text12.standard,
});

export const legendItem = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 16,
  cursor: 'default',
  transition: 'opacity 120ms ease',
});

export const legendSwatch = style({ flex: 'none', width: 12, height: 12, borderRadius: 3 });
/** Line charts: a short dash instead of a square. */
export const legendDash = style({ flex: 'none', width: 12, height: 2, borderRadius: 1 });
export const legendComparisonSwatch = style({
  flex: 'none',
  width: 12,
  height: 12,
  borderRadius: 3,
  backgroundColor: alpha(c.utilities.content.cyan, 22),
  boxShadow: `inset 0 0 0 1px ${c.utilities.content.cyan}`,
});
/** The "+N more" swatch: four small squares in the colours of the hidden series. */
export const legendMulti = style({
  flex: 'none',
  width: 12,
  height: 12,
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gridTemplateRows: '1fr 1fr',
  gap: 2,
});
export const legendMultiCell = style({ borderRadius: 2 });

export const legendMore = style({
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 16,
});

export const legendOverflow = style({
  position: 'absolute',
  top: 22,
  right: 0,
  zIndex: 2,
  display: 'none',
  flexDirection: 'column',
  gap: 6,
  padding: 8,
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: vars.elevation.e2,
  whiteSpace: 'nowrap',
});
globalStyle(`${legendMore}:hover > ${legendOverflow}`, { display: 'flex' });

// ---- tooltip -------------------------------------------------------------------------------------------------------------

export const tooltip = style({
  position: 'fixed',
  left: 0,
  top: 0,
  // Above dialogs: the editor is an overlay and its chart tooltips must not hide behind it.
  zIndex: scales.zIndex.popoverTooltipDialog,
  boxSizing: 'border-box',
  minWidth: 318,
  maxWidth: 420,
  padding: '8px 12px 8px 8px',
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: vars.elevation.e2,
  color: c.content.primary,
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
  ...text.body.standard,
});

export const tooltipHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 24,
  padding: '0 0 6px 12px',
  color: c.content.primary,
});

export const tooltipBlock = style({ display: 'flex', alignItems: 'stretch', gap: 8, padding: '2px 0' });
export const tooltipRule = style({ flex: 'none', width: 4, borderRadius: 4, margin: '4px 0' });
export const tooltipBody = style({ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 });
export const tooltipDivider = style({ height: 1, margin: '4px 0', backgroundColor: c.stroke.primary });
export const tooltipBlockDivider = style({ height: 1, margin: '4px 0 4px 12px', backgroundColor: c.stroke.primary });

export const tooltipTitle = style({ minHeight: 26, display: 'flex', alignItems: 'center', color: c.content.primary });
export const tooltipRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: 6,
  minHeight: 26,
});
export const tooltipLabel = style({ color: c.content.secondary });
export const tooltipValue = style({
  display: 'inline-flex',
  alignItems: 'center',
  height: 20,
  padding: '0 6px',
  borderRadius: 6,
  backgroundColor: c.surface.secondaryHover,
  boxShadow: insetRing(c.stroke.secondaryTransparent),
  color: c.content.primary,
  ...text.text12.standard,
});
export const tooltipNote = style({
  minHeight: 20,
  display: 'flex',
  alignItems: 'center',
  color: c.content.tertiary,
  ...text.text12.standard,
});

const badgeBase = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  height: 20,
  padding: '0 6px',
  borderRadius: 6,
  ...text.text12.standard,
});
export const badge = {
  down: style([badgeBase, { backgroundColor: c.surface.critical, color: c.content.onCriticalSubtle }]),
  up: style([badgeBase, { backgroundColor: c.surface.success, color: c.content.onSuccessSubtle }]),
  flat: style([badgeBase, { backgroundColor: c.surface.tint, color: c.content.secondary }]),
};

// ---- single metric -----------------------------------------------------------------------------------------------------

export const single = style({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  textAlign: 'center',
});
export const singleCaption = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  maxWidth: '100%',
  color: c.content.secondary,
  ...text.text12.standard,
});
export const singleSquare = style({
  flex: 'none',
  width: 8,
  height: 8,
  borderRadius: 2,
  backgroundColor: c.chart.blue,
});
export const singleValue = style({
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  margin: '10px 0 9px',
  color: c.content.primary,
  fontSize: 32,
  lineHeight: '36px',
  fontWeight: 600,
  letterSpacing: '-0.02em',
});
export const singleValueCell = style({ fontSize: 28, lineHeight: '32px' });
export const singleSub = style({ color: c.content.secondary, ...text.body.strong });
export const funnelPath = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  maxWidth: '100%',
  color: c.content.secondary,
  fontSize: 14,
  lineHeight: '20px',
  fontWeight: 600,
  letterSpacing: '-0.005em',
});
export const funnelPathItem = style({
  maxWidth: 120,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

// ---- funnel ------------------------------------------------------------------------------------------------------------------

export const funnelCard = style({
  position: 'absolute',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 5,
  minHeight: 56,
  padding: '5px 8px 6px',
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: vars.elevation.e2,
  transform: 'translateX(-50%)',
  pointerEvents: 'none',
  transition: 'opacity 120ms ease',
  ...text.body.standard,
  color: c.content.secondary,
});
export const funnelChip = style({
  display: 'inline-flex',
  whiteSpace: 'nowrap',
  flex: 'none',
  alignItems: 'center',
  height: 20,
  padding: '0 6px',
  borderRadius: 6,
  backgroundColor: c.utilities.surface.blueSubtle,
  color: c.utilities.content.onBlueSubtle,
  ...text.text12.standard,
});
export const funnelCardLabel = style({
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const stepBadge = style([funnelCard, { minHeight: 0, padding: '6px 8px', transform: 'translate(-50%, -50%)' }]);
export const stepLabel = style({
  position: 'absolute',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  color: c.content.primary,
  ...text.body.standard,
});
export const stepLabelIndex = style({ color: c.content.secondary });

// ---- state -------------------------------------------------------------------------------------------------------------------

export const message = style({
  position: 'absolute',
  inset: 0,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  padding: 24,
  textAlign: 'center',
});
export const messageArt = style({ width: 160, height: 160, marginBottom: 36, flex: 'none' });
export const messageTitle = style({
  color: c.content.primary,
  fontSize: 16,
  lineHeight: '20px',
  fontWeight: 600,
  letterSpacing: '-0.01em',
});
export const messageSub = style({ maxWidth: 420, color: c.content.secondary, ...text.body.standard });
export const messageAction = style({ marginTop: 16 });
export const messageCompact = style({ transform: 'scale(0.8)' });
