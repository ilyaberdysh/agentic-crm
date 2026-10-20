// Dashboard page:
// title row 49 px, grid of 12 columns with 458 px rows, 14 px container margin and 6 px cell padding.
import { insetRing, text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const page = style({ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' });

export const headerStart = style({ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 });
export const headerActions = style({ display: 'flex', alignItems: 'center', gap: 8 });
export const headerGroup = style({ display: 'flex', alignItems: 'center', gap: 4 });
export const headerDivider = style({ width: 1, height: 16, backgroundColor: c.stroke.secondary });

export const titleRow = style({
  flex: 'none',
  boxSizing: 'border-box',
  height: 49,
  padding: '0 12px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  borderBottom: `1px solid ${c.stroke.primary}`,
});
export const titleGroup = style({ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: 1 });

export const notice = style({
  flex: 'none',
  padding: '8px 20px',
  ...text.body.small,
  color: c.content.secondary,
  backgroundColor: c.surface.secondary,
  borderBottom: `1px solid ${c.stroke.primary}`,
});

export const scroll = style({ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' });

export const grid = style({
  boxSizing: 'border-box',
  padding: 14,
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
});

export const row = style({
  position: 'relative',
  display: 'grid',
  gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
  height: 470,
  selectors: { '&[data-single]': { gridTemplateColumns: 'minmax(0, 1fr)' } },
});

export const slot = style({
  position: 'relative',
  boxSizing: 'border-box',
  padding: 6,
  minWidth: 0,
  height: 470,
});

export const card = style({
  position: 'relative',
  boxSizing: 'border-box',
  height: 458,
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  border: `1px solid ${c.stroke.primary}`,
  overflow: 'hidden',
  selectors: { '&[data-dragging]': { visibility: 'hidden' } },
});

export const dragPlaceholder = style({
  position: 'absolute',
  inset: 6,
  borderRadius: 12,
  backgroundColor: c.surface.tertiary,
});

export const cardHeader = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 40,
  padding: '0 8px 0 12px',
  minWidth: 0,
  touchAction: 'none',
});

export const cardTitleLink = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  flex: 1,
  height: 24,
  color: c.content.primary,
  textDecoration: 'none',
  cursor: 'pointer',
  selectors: { '&[data-readonly]': { cursor: 'default' } },
});

export const cardTitle = style({
  ...text.body.strong,
  color: c.content.primary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
});

export const cardActions = style({ display: 'flex', alignItems: 'center', gap: 4, flex: 'none' });

export const cardInfo = style({ flex: 'none', display: 'inline-flex', color: c.content.tertiary });

export const cardBody = style({ flex: 1, minHeight: 0, position: 'relative', padding: '0 12px 12px' });

export const cardSkeleton = style({
  position: 'absolute',
  inset: '8px 12px 12px',
  display: 'flex',
  alignItems: 'flex-end',
  gap: 12,
});

// ---- drag and drop indicators --------------------------------------------------------------------------------------

export const dropBar = style({
  position: 'absolute',
  top: 21,
  bottom: 21,
  width: 3,
  borderRadius: 2,
  backgroundColor: c.surface.accent,
  pointerEvents: 'none',
  zIndex: 3,
});
export const dropBarBefore = style({ left: 2 });
export const dropBarAfter = style({ right: 2 });

export const rowGap = style({
  position: 'absolute',
  left: 0,
  right: 0,
  height: 28,
  zIndex: 2,
  pointerEvents: 'none',
});
export const rowGapLine = style({
  position: 'absolute',
  left: 14,
  right: 14,
  top: 12,
  height: 3,
  borderRadius: 2,
  backgroundColor: c.surface.accent,
});

export const dragChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  maxWidth: 280,
  height: 28,
  padding: '0 10px',
  borderRadius: 8,
  backgroundColor: c.surface.primary,
  boxShadow: `${insetRing(c.stroke.primaryTransparent)}, ${vars.elevation.e2}`,
  ...text.body.strong,
  color: c.content.primary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

// ---- resize handle -------------------------------------------------------------------------------------------------

export const resizeHandle = style({
  position: 'absolute',
  top: 6,
  bottom: 6,
  left: -5,
  width: 10,
  cursor: 'col-resize',
  zIndex: 4,
  touchAction: 'none',
  selectors: {
    '&::after': {
      content: '""',
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 3,
      width: 4,
      borderRadius: 8,
      backgroundColor: 'transparent',
      transition: 'background-color 100ms ease',
    },
    '&:hover::after, &[data-active]::after': { backgroundColor: c.surface.accent },
  },
});

// ---- add report tile / empty ---------------------------------------------------------------------------------------

export const addTile = style({
  boxSizing: 'border-box',
  margin: '0 6px',
  width: 'calc(100% - 12px)',
  height: 48,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 12,
  border: `1px dashed ${c.stroke.secondaryTransparent}`,
  backgroundColor: 'transparent',
  color: c.content.secondary,
  cursor: 'pointer',
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHover },
    '&[data-focus-visible]': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});

export const emptyWrap = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

export const notFound = style({
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  textAlign: 'center',
  ...text.body.standard,
  color: c.content.secondary,
});

/** The non-interactive footer item of a menu ("Created by …"): full opacity, auto height. */
export const menuFooterItem = style({
  height: 'auto',
  minHeight: 0,
  opacity: 1,
  cursor: 'default',
  padding: '4px 8px',
  selectors: { '&[data-disabled]': { opacity: 1 } },
});

export const menuFooter = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  ...text.text12.standard,
  color: c.content.tertiary,
});
