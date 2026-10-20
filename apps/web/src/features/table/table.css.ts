// Record table metrics (layout.md §4, components.md §9, C1 README §2.4–2.6, motion.md "Table"): header 40, rows 36
// (35 + 1 px border), cell padding 8 12 0, 1 px right/bottom `stroke.primary`, Body.Standard; record column sticky
// with a frozen shadow once scrolled; footer 36 + 1 px top border; overlays fade 140 ms ease-in-out.
import { alpha, scales, text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, keyframes, style } from '@vanilla-extract/css';

const c = vars.color;
const overlayEase = `${scales.duration.comfortable}ms ease-in-out`;
const selectedBg = `color-mix(in srgb, ${c.surface.accent} 7%, ${c.surface.primary})`;
const hoverBg = `color-mix(in srgb, ${c.content.primary} 2.5%, ${c.surface.primary})`;

export const root = style({
  position: 'relative',
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: c.surface.primary,
});

export const scroller = style({
  position: 'relative',
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  outline: 'none',
  overscrollBehavior: 'contain',
  color: c.content.primary,
  ...text.body.standard,
});

export const canvas = style({ position: 'relative' });

// ---- header ---------------------------------------------------------------------------------------------------

export const headerRow = style({
  position: 'sticky',
  top: 0,
  zIndex: 4,
  height: 40,
  backgroundColor: c.surface.primary,
});

const cellBase = style({
  position: 'absolute',
  top: 0,
  boxSizing: 'border-box',
  borderRight: `1px solid ${c.stroke.primary}`,
  borderBottom: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
});

export const headerCell = style([
  cellBase,
  {
    height: 40,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '0 12px',
    cursor: 'pointer',
    userSelect: 'none',
    transition: `background-color ${overlayEase}`,
    selectors: {
      '&:hover, &[data-open]': { backgroundColor: c.surface.primaryHover },
      '&[data-dragging]': { opacity: 0.4 },
    },
  },
]);

export const headerIcon = style({ flex: 'none', color: c.content.secondary });

export const headerLabel = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: c.content.primary,
});

export const headerTrailing = style({ flex: 'none', display: 'flex', color: c.content.tertiary });

export const recordHeaderCell = style([
  cellBase,
  {
    position: 'sticky',
    left: 0,
    zIndex: 2,
    height: 40,
    display: 'flex',
    alignItems: 'center',
    gap: 13,
    padding: '0 4px 0 17px',
  },
]);

export const headerAdd = style({
  flex: 'none',
  width: 24,
  height: 24,
  display: 'grid',
  placeItems: 'center',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: c.content.tertiary,
  cursor: 'pointer',
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHover, color: c.content.secondary } },
});

/** The header area after the last column (evidence C1/05, 26): a ghost "+ Add column" button, 8 px in. */
export const addColumnCell = style([
  cellBase,
  {
    height: 40,
    borderRight: 'none',
    display: 'flex',
    alignItems: 'center',
    padding: '0 8px',
  },
]);

export const addColumnButton = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 8px 0 6px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: c.content.secondary,
  font: 'inherit',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  outline: 'none',
  transition: `background-color ${overlayEase}`,
  selectors: {
    '&[data-hovered], &[data-pressed], &[aria-expanded="true"], &[data-focus-visible]': {
      backgroundColor: c.interactive.ghostHover,
      color: c.content.primary,
    },
  },
});

/** Column resize hit zone: 3 px either side of the divider; the indicator is 3 px `surface.accent`. */
export const resizeHandle = style({
  position: 'absolute',
  top: 0,
  right: -4,
  width: 7,
  height: '100%',
  zIndex: scales.zIndex.local.tableResizeHandle,
  cursor: 'col-resize',
  touchAction: 'none',
  selectors: {
    '&::after': {
      content: '""',
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 2,
      width: 3,
      backgroundColor: c.surface.accent,
      opacity: 0,
      transition: 'opacity 100ms ease 100ms',
    },
    '&:hover::after, &[data-active]::after': { opacity: 1 },
  },
});

/** Full-height guide while resizing / the 2 px drop line while reordering. */
export const guideLine = style({
  position: 'absolute',
  top: 0,
  width: 2,
  backgroundColor: c.surface.accent,
  zIndex: 6,
  pointerEvents: 'none',
});

export const dragGhost = style([
  headerCell,
  {
    position: 'relative',
    opacity: 0.85,
    boxShadow: vars.elevation.e2,
    border: `1px solid ${c.stroke.primary}`,
    borderRadius: 4,
    cursor: 'grabbing',
  },
]);

// ---- body ------------------------------------------------------------------------------------------------------

export const body = style({ position: 'relative' });

export const row = style({ position: 'absolute', left: 0, top: 0, height: 36 });

export const cell = style([
  cellBase,
  {
    height: 36,
    padding: 0,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    transition: `background-color ${overlayEase}`,
    selectors: {
      [`${row}:hover &`]: { backgroundColor: hoverBg },
      [`${row}[data-selected] &`]: { backgroundColor: selectedBg },
      '&[data-align="end"]': { textAlign: 'right' },
    },
  },
]);

export const cellContent = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

/** Table-drawn content (skeletons, errors) gets the cell padding the registry's frames otherwise provide. */
export const cellPad = style({ boxSizing: 'border-box', height: '100%', padding: '8px 12px 0', overflow: 'hidden' });

export const fillerCell = style([cell, { borderRight: 'none', padding: 0 }]);

export const recordCell = style([
  cell,
  {
    position: 'sticky',
    left: 0,
    zIndex: 2,
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    padding: '0 8px 0 17px',
    transition: `background-color ${overlayEase}, box-shadow 200ms ease`,
    selectors: {
      [`${row}:hover &`]: { backgroundColor: hoverBg },
      [`${row}[data-selected] &`]: { backgroundColor: selectedBg },
      '[data-scrolled-x] &': { boxShadow: '6px 0 16px -4px rgba(0, 0, 0, 0.12)', clipPath: 'inset(0 -32px 0 0)' },
    },
  },
]);

globalStyle(`[data-scrolled-x] ${recordHeaderCell}`, {
  boxShadow: '6px 0 16px -4px rgba(0, 0, 0, 0.12)',
  clipPath: 'inset(0 -32px 0 0)',
});

export const recordTitle = style({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  color: c.content.primary,
  textDecoration: 'none',
  overflow: 'hidden',
});

export const recordTitleText = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

export const recordActions = style({
  display: 'none',
  flex: 'none',
  gap: 2,
  selectors: { [`${row}:hover &`]: { display: 'flex' } },
});

export const recordAction = style({
  width: 20,
  height: 20,
  display: 'grid',
  placeItems: 'center',
  border: 'none',
  borderRadius: 6,
  background: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  color: c.content.secondary,
  cursor: 'pointer',
  padding: 0,
  selectors: { '&:hover': { color: c.content.primary, backgroundColor: c.surface.primaryHover } },
});

/** Row checkbox: 16 × 16, radius 6? (layout §4: radius 6, 1 px `stroke.secondaryTransparent`). */
export const checkbox = style({
  flex: 'none',
  width: 16,
  height: 16,
  padding: 0,
  margin: 0,
  display: 'grid',
  placeItems: 'center',
  boxSizing: 'border-box',
  border: 'none',
  borderRadius: 5,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondaryTransparent}`,
  color: c.content.onAccent,
  cursor: 'pointer',
  transition: 'background-color 200ms ease-in-out, box-shadow 200ms ease-in-out',
  selectors: {
    '&:hover': { boxShadow: `inset 0 0 0 1px ${c.stroke.tertiary}` },
    '&[aria-checked="true"], &[aria-checked="mixed"]': { backgroundColor: c.surface.accent, boxShadow: 'none' },
    '&:disabled': { opacity: 0.4, cursor: 'default' },
  },
});

export const skeleton = style({ verticalAlign: 'middle', marginTop: 4, display: 'block' });

export const cellError = style({ display: 'flex', alignItems: 'center', gap: 4, color: c.content.critical });

// ---- active cell, editor, presence ----------------------------------------------------------------------------------

export const activeBox = style({
  position: 'absolute',
  left: 0,
  top: 0,
  zIndex: 3,
  boxSizing: 'border-box',
  minHeight: 36,
  padding: 0,
  borderRadius: 4,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.accent}`,
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
  selectors: {
    '&[data-align="end"]': { textAlign: 'right' },
    '&[data-range]': { backgroundColor: alpha(c.surface.accent, 6), boxShadow: 'none', borderRadius: 0 },
  },
});

export const activeContent = style({ pointerEvents: 'auto' });

export const editorBox = style({
  position: 'absolute',
  left: 0,
  top: 0,
  zIndex: 5,
  boxSizing: 'border-box',
  minHeight: 36,
  maxWidth: 350,
  padding: '7px 12px 8px',
  borderRadius: 4,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.accent}, ${vars.elevation.e1}`,
  ...text.body.standard,
});

/** Cells inside a mouse/shift range: accent tint, outline drawn by `rangeOutline`. */
export const rangeOutline = style({
  position: 'absolute',
  zIndex: 3,
  pointerEvents: 'none',
  boxShadow: `inset 0 0 0 1px ${c.stroke.accent}`,
  backgroundColor: alpha(c.surface.accent, 6),
});

export const peerRing = style({
  position: 'absolute',
  inset: 0,
  zIndex: 3,
  pointerEvents: 'none',
  borderRadius: 2,
});

export const peerTag = style({
  position: 'absolute',
  left: -1,
  top: -15,
  height: 15,
  maxWidth: 160,
  padding: '0 4px',
  borderRadius: '4px 4px 0 0',
  color: '#ffffff',
  fontSize: 11,
  lineHeight: '15px',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

export const peerDraft = style({
  position: 'absolute',
  left: 0,
  top: 0,
  zIndex: 3,
  boxSizing: 'border-box',
  minWidth: '100%',
  height: 36,
  padding: 0,
  backgroundColor: c.surface.primary,
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
});

// ---- footer -----------------------------------------------------------------------------------------------------

export const footerRow = style({
  position: 'sticky',
  bottom: 0,
  zIndex: 4,
  height: 37,
  backgroundColor: c.surface.primary,
});

const footerBase = style([
  cellBase,
  {
    height: 37,
    borderBottom: 'none',
    borderTop: `1px solid ${c.stroke.primary}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    padding: '0 12px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
]);

export const footerCell = style([
  footerBase,
  {
    borderLeft: 'none',
    borderBottom: 'none',
    margin: 0,
    outline: 'none',
    cursor: 'pointer',
    font: 'inherit',
    color: c.content.primary,
    textAlign: 'right',
    transition: `background-color ${overlayEase}`,
    selectors: {
      '&:hover, &[aria-expanded="true"]': { backgroundColor: c.surface.primaryHover },
      '&:disabled': { cursor: 'default', backgroundColor: c.surface.primary },
    },
  },
]);

export const footerRecordCell = style([footerBase, { position: 'sticky', left: 0, zIndex: 2 }]);

export const footerFiller = style([footerBase, { borderRight: 'none' }]);

export const footerPlaceholder = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  color: c.content.tertiary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

export const footerSuffix = style({ color: c.content.tertiary });

export const footerValue = style({ fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis' });

// ---- states -------------------------------------------------------------------------------------------------------

export const stateOverlay = style({
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
});

export const statePanel = style({
  pointerEvents: 'auto',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  maxWidth: 244,
  gap: 0,
});

export const stateIcon = style({
  width: 44,
  height: 44,
  marginBottom: 12,
  display: 'grid',
  placeItems: 'center',
  borderRadius: '50%',
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  color: c.content.accent,
});

export const stateTitle = style({ ...text.heading.medium, color: c.content.primary, margin: 0 });

export const stateText = style({ ...text.body.standard, color: c.content.secondary, margin: '6px 0 0' });

export const stateActions = style({ marginTop: 16 });

export const noColumnsPanel = style({
  position: 'absolute',
  top: 40,
  bottom: 37,
  right: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
});

// ---- bulk bar -------------------------------------------------------------------------------------------------------

const barIn = keyframes({
  from: { opacity: 0, transform: 'translate(-50%, 8px)' },
  to: { opacity: 1, transform: 'translate(-50%, 0)' },
});

export const bulkBar = style({
  position: 'absolute',
  left: '50%',
  bottom: 28,
  transform: 'translateX(-50%)',
  zIndex: 6,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 48,
  boxSizing: 'border-box',
  padding: '6px 6px 6px 12px',
  borderRadius: 14,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}, ${vars.elevation.e2}`,
  animation: `${barIn} ${scales.duration.comfortable}ms ease`,
  whiteSpace: 'nowrap',
});

export const bulkCount = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 4px 0 6px',
  borderRadius: 8,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  color: c.content.secondary,
});

export const bulkBadge = style({
  minWidth: 16,
  height: 16,
  padding: '0 4px',
  boxSizing: 'border-box',
  borderRadius: 8,
  backgroundColor: c.surface.accent,
  color: c.content.onAccent,
  fontSize: 11,
  lineHeight: '16px',
  fontWeight: 600,
  textAlign: 'center',
});

export const bulkClear = style({
  width: 20,
  height: 20,
  display: 'grid',
  placeItems: 'center',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: c.content.tertiary,
  cursor: 'pointer',
  padding: 0,
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHover, color: c.content.primary } },
});

export const bulkDivider = style({ width: 1, height: 20, backgroundColor: c.stroke.primary });

export const bulkActions = style({ display: 'flex', alignItems: 'center', gap: 4 });

export const frozenBanner = style({
  position: 'absolute',
  left: '50%',
  bottom: 86,
  transform: 'translateX(-50%)',
  zIndex: 6,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 6px 6px 12px',
  borderRadius: 10,
  backgroundColor: c.surface.warning,
  boxShadow: `inset 0 0 0 1px ${c.stroke.warning}`,
  color: c.content.onWarningSubtle,
  whiteSpace: 'nowrap',
});
