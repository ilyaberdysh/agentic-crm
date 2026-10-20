// Record page frame: top bar 48 + 1, then the body row — details panel
// (persisted %, 320 px … min(60 %, body − 350 px)), a 10 px resize hit area on the 1 px divider, the tab area
// (flex 1, min 350 px) — and the optional 320 px comments panel at the right.
import { scales, text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const page = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: c.surface.primary,
});

export const row = style({ flex: 1, minHeight: 0, display: 'flex' });

export const body = style({ position: 'relative', flex: 1, minWidth: 0, minHeight: 0, display: 'flex' });

export const details = style({
  position: 'relative',
  flex: 'none',
  boxSizing: 'border-box',
  minWidth: 320,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflowX: 'hidden',
  overflowY: 'auto',
  borderRight: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
});

/** 10 px invisible hit area centred on the panel's 1 px border (cursor col-resize). */
export const resizeHandle = style({
  position: 'absolute',
  top: 0,
  bottom: 0,
  width: 10,
  marginLeft: -5,
  cursor: 'col-resize',
  zIndex: 2,
  touchAction: 'none',
  selectors: {
    '&::after': {
      content: '""',
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 4,
      width: 2,
      backgroundColor: 'transparent',
      transition: `background-color ${scales.duration.comfortable}ms ease`,
    },
    '&:hover::after, &[data-dragging]::after': { backgroundColor: c.stroke.accent },
  },
});

export const tabArea = style({
  position: 'relative',
  flex: '1 1 0',
  minWidth: 350,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: c.surface.primary,
});

export const tabContent = style({
  position: 'relative',
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
});

export const commentsPanel = style({
  flex: 'none',
  boxSizing: 'border-box',
  width: 320,
  height: '100%',
  borderLeft: `1px solid ${c.stroke.primary}`,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  backgroundColor: c.surface.primary,
});

// ---- top bar right side -----------------------------------------------------------------------------------------

export const topActions = style({ display: 'flex', alignItems: 'center', gap: 8 });
export const topGroup = style({ display: 'flex', alignItems: 'center', gap: 4 });
export const topDivider = style({ width: 1, height: 16, backgroundColor: c.stroke.secondary, flex: 'none' });

export const commentsButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 28,
  minWidth: 28,
  boxSizing: 'border-box',
  justifyContent: 'center',
  padding: '0 6px',
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  color: c.content.ghost,
  cursor: 'pointer',
  ...text.body.standard,
  fontWeight: 500,
  transition: `background-color ${scales.duration.breezy}ms ease, color ${scales.duration.breezy}ms ease`,
  selectors: {
    '&:hover, &[data-pressed]': { backgroundColor: c.interactive.ghostHover, color: c.content.primary },
    '&:focus-visible': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});

// ---- overlay top bar (record opened from a view) ------------------------------------------------------------------

export const overlayRoot = style({
  position: 'fixed',
  inset: 0,
  zIndex: 50,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: c.surface.primary,
});

export const overlayBar = style({
  boxSizing: 'border-box',
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 49,
  padding: '10px 12px 11px',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
});

export const overlayLeft = style({ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 });
export const overlayNav = style({ display: 'flex', alignItems: 'center', gap: 4 });

export const overlayPosition = style({
  ...text.text12.standard,
  color: c.content.secondary,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  marginLeft: 6,
});

// ---- Tab bar ---------------------------------------------------------------------

export const tabBar = style({
  position: 'relative',
  flex: 'none',
  boxSizing: 'border-box',
  height: 45,
  padding: '8px 12px 0',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
  display: 'flex',
  alignItems: 'flex-start',
  overflow: 'hidden',
});

export const tabList = style({ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 });

export const tab = style({
  position: 'relative',
  flex: 'none',
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '4px 8px',
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  ...text.body.standard,
  fontWeight: 500,
  color: c.content.secondary,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  textDecoration: 'none',
  transition: `box-shadow ${scales.duration.comfortable}ms ease, color ${scales.duration.comfortable}ms ease, background-color ${scales.duration.comfortable}ms ease`,
  selectors: {
    '&:hover': { color: c.content.primary, boxShadow: `inset 0 0 0 1px ${c.stroke.primary}` },
    '&[data-active]': {
      color: c.content.primary,
      backgroundColor: c.surface.primaryHover,
      boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
    },
    '&[data-active]::after': {
      content: '""',
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: -8,
      height: 1,
      backgroundColor: c.content.primary,
    },
    '&:focus-visible': { outline: 'none', boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
  },
});

export const tabIcon = style({ flex: 'none', color: 'inherit' });

export const tabCount = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 14,
  height: 14,
  padding: '0 3px',
  borderRadius: 4,
  fontSize: 10,
  lineHeight: '14px',
  fontWeight: 500,
  fontVariantNumeric: 'tabular-nums',
  color: c.content.secondary,
  backgroundColor: c.surface.tint,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primaryTransparent}`,
});

export const tabDivider = style({
  flex: 'none',
  width: 1,
  height: 16,
  margin: '0 8px',
  backgroundColor: c.stroke.secondary,
});

/** Off-screen copy of the tabs used to measure their natural widths for the "+N more" overflow. */
export const tabMeasure = style({
  position: 'absolute',
  left: 0,
  top: 0,
  visibility: 'hidden',
  pointerEvents: 'none',
  display: 'flex',
  gap: 4,
});

// ---- tab page header (D: 52 px, padding 12 20) ----------------------------------------------------------

export const tabHeader = style({
  boxSizing: 'border-box',
  height: 52,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '12px 20px',
});

export const tabTitle = style({
  ...text.heading.small,
  fontWeight: 500,
  color: c.content.primary,
  margin: 0,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

export const tabHeaderActions = style({ display: 'flex', alignItems: 'center', gap: 8 });

export const tabEmpty = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  padding: '96px 20px 40px',
});

export const emptyTitle = style({ ...text.body.standard, fontWeight: 600, color: c.content.primary, marginTop: 40 });
export const emptyText = style({ ...text.body.standard, color: c.content.secondary, marginTop: 0 });
export const emptyActions = style({ display: 'flex', gap: 6, marginTop: 16 });

// ---- loading ------------------------------------------------------------------------------------------------

export const skeletonStack = style({ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 });
