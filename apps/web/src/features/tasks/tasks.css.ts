// Tasks (b; evidence E/tasks-page.png, task-create-dialog.png, task-edit-dialog.png,
// task-deadline-picker.png, tasks-bulk-select-dark.png): 32 px header and group rows, 52 px task rows with a 16 px round
// checkbox, the 808 px create / edit dialog with chips in its footer, the deadline popover and the bulk toolbar.
import { alpha, scales, text, transitionColors, vars } from '@agentic-crm/ui/styles';
import { style, styleVariants } from '@vanilla-extract/css';

const c = vars.color;
const ease = `${scales.duration.comfortable}ms ease`;

// ---- table ----------------------------------------------------------------------------------------------------------

export const table = style({ display: 'flex', flexDirection: 'column', minWidth: 860 });

export const columns = style({
  boxSizing: 'border-box',
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 243px 242px 285px',
  alignItems: 'center',
  borderBottom: `1px solid ${c.stroke.primary}`,
});

export const columnsCompact = style({ gridTemplateColumns: 'minmax(0, 1fr) 160px 200px 200px' });

export const head = style({ height: 32, ...text.text12.standard, fontSize: 13, color: c.content.secondary });

export const headCell = style({ display: 'flex', alignItems: 'center', gap: 4, padding: '0 16px', minWidth: 0 });

export const groupRow = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  padding: '0 16px',
  backgroundColor: c.surface.secondary,
  borderBottom: `1px solid ${c.stroke.primary}`,
  ...text.text12.standard,
  fontSize: 13,
  color: c.content.secondary,
});

export const row = style({
  position: 'relative',
  height: 52,
  cursor: 'pointer',
  transition: `background-color ${ease}`,
  selectors: {
    '&:hover': { backgroundColor: alpha('#000000', 2) },
    '&[data-selected]': { backgroundColor: c.interactive.selectedSubtle },
  },
});

export const rowCompleted = style({});

export const cell = style({ display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px', minWidth: 0 });

export const fade = style({ opacity: 0.5 });

export const title = style({
  ...text.body.standard,
  color: c.content.primary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
});

export const due = styleVariants({
  overdue: { ...text.body.standard, color: c.content.critical, whiteSpace: 'nowrap' },
  soon: { ...text.body.standard, color: c.content.warning, whiteSpace: 'nowrap' },
  later: { ...text.body.standard, color: c.content.secondary, whiteSpace: 'nowrap' },
});

export const assignee = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 24,
  maxWidth: '100%',
  padding: '0 6px 0 4px',
  borderRadius: 6,
  backgroundColor: c.surface.tint,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primaryTransparent}`,
  ...text.body.standard,
  color: c.content.primary,
  minWidth: 0,
});

export const assigneeName = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

export const rowMenu = style({
  position: 'absolute',
  right: 12,
  top: '50%',
  transform: 'translateY(-50%)',
  opacity: 0,
  transition: `opacity ${ease}`,
  selectors: { [`${row}:hover &, &[aria-expanded="true"], &[data-focus-visible]`]: { opacity: 1 } },
});

// ---- round checkbox (16 px) ---------------------------------------------------------------------------------------

export const check = style({
  boxSizing: 'border-box',
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  padding: 0,
  borderRadius: 999,
  border: `1px solid ${c.stroke.tertiary}`,
  backgroundColor: c.surface.primary,
  color: c.content.onAccent,
  cursor: 'pointer',
  outline: 'none',
  transition: `border-color 200ms ease-in-out, background-color 200ms ease-in-out`,
  selectors: {
    '&:hover': { borderColor: c.content.tertiary },
    '&[aria-checked="true"]': { backgroundColor: c.interactive.primary, borderColor: c.interactive.primary },
    '&:focus-visible': { boxShadow: `0 0 0 2px ${c.stroke.accentMedium}` },
  },
});

// ---- dialog (808 × 148) ---------------------------------------------------------------------------------------------

export const dialogBody = style({ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px 15px' });

export const dialogCheck = style({ marginTop: 2 });

export const footer = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  height: 48,
  padding: '0 8px',
  borderTop: `1px solid ${c.stroke.primary}`,
});

export const footerSpacer = style({ flex: 1 });

export const chip = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  maxWidth: 220,
  padding: '0 8px 0 6px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: c.content.secondary,
  fontFamily: 'inherit',
  cursor: 'pointer',
  outline: 'none',
  whiteSpace: 'nowrap',
  ...text.body.standard,
  transition: transitionColors,
  selectors: {
    '&[data-hovered], &[aria-expanded="true"], &[data-pressed]': {
      backgroundColor: c.interactive.ghostHover,
      color: c.content.primary,
    },
    '&[data-focus-visible]': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
  },
});

export const chipText = style({ overflow: 'hidden', textOverflow: 'ellipsis' });

export const createMore = style({ display: 'inline-flex', alignItems: 'center', gap: 8, marginRight: 8 });

// ---- deadline popover -------------------------------------------------------------------------------------------------

export const deadlinePanel = style({ display: 'flex', flexDirection: 'column', width: 270, outline: 'none' });

export const nlRow = style({ padding: 8 });

export const nlInput = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  padding: '0 4px 0 10px',
  borderRadius: 8,
  boxShadow: `inset 0 0 0 1px ${c.stroke.accent}`,
});

export const nlField = style({
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});

export const nlHint = style({ ...text.text12.standard, color: c.content.tertiary, padding: '0 10px 4px' });

export const calendar = style({ padding: '0 12px 8px' });

export const calendarHead = style({ display: 'flex', alignItems: 'center', gap: 4, height: 32, ...text.body.standard });

export const calendarMonth = style({ flex: 1, fontWeight: 500, marginLeft: 4 });

export const weekdays = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  ...text.text12.standard,
  color: c.content.secondary,
  textAlign: 'center',
  height: 32,
  alignItems: 'center',
});

export const days = style({ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: 2, columnGap: 2 });

export const day = style({
  position: 'relative',
  boxSizing: 'border-box',
  height: 32,
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  cursor: 'pointer',
  outline: 'none',
  ...text.body.standard,
  transition: `background-color 120ms ease`,
  selectors: {
    '&[data-hovered]': { backgroundColor: c.interactive.ghostHover },
    '&[data-outside]': { visibility: 'hidden' },
    '&[data-selected]': { backgroundColor: c.interactive.primary, color: c.content.onAccent },
    '&[data-focus-visible]': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
  },
});

export const todayDot = style({
  position: 'absolute',
  left: '50%',
  bottom: 4,
  width: 4,
  height: 4,
  marginLeft: -2,
  borderRadius: 999,
  backgroundColor: 'currentColor',
});

export const presets = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, max-content)',
  columnGap: 12,
  rowGap: 0,
  padding: '2px 10px 8px',
});

export const preset = style([
  chip,
  {
    height: 26,
    padding: '0 6px 0 4px',
    gap: 4,
    color: c.content.primary,
    justifyContent: 'flex-start',
    ...text.text12.standard,
    fontSize: 13,
  },
]);

export const timeRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 12px 8px',
  ...text.text12.standard,
  color: c.content.secondary,
});

// ---- bulk toolbar (260 × 32, 36 px above the bottom) ------------------------------------------------------------------

export const bulkBar = style({
  position: 'fixed',
  left: '50%',
  bottom: 36,
  transform: 'translateX(-50%)',
  zIndex: 50,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: 6,
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: vars.elevation.e2,
});

export const bulkCount = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  height: 32,
  padding: '0 6px 0 8px',
  borderRadius: 8,
  backgroundColor: c.surface.tint,
  ...text.body.standard,
  color: c.content.secondary,
});

export const bulkBadge = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 16,
  height: 16,
  padding: '0 4px',
  boxSizing: 'border-box',
  borderRadius: 6,
  backgroundColor: c.surface.accent,
  color: c.content.onAccent,
  ...text.text12.standard,
});

export const bulkDivider = style({ width: 1, height: 20, backgroundColor: c.stroke.primary });

// ---- record tab ------------------------------------------------------------------------------------------------------

export const tabHeader = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: 52,
  padding: '12px 20px',
});

export const tabTitle = style({ ...text.heading.small, fontWeight: 500, color: c.content.primary, margin: 0 });

export const empty = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  padding: '64px 24px',
  textAlign: 'center',
});

export const emptyTitle = style({ ...text.body.standard, fontWeight: 600, color: c.content.primary });
export const emptyText = style({ ...text.body.standard, color: c.content.secondary });

// ---- filter chips --------------------------------------------------------------------------------------------------

export const filterChip = style({
  display: 'inline-flex',
  alignItems: 'stretch',
  height: 28,
  borderRadius: 8,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  overflow: 'hidden',
});

export const filterSegment = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '0 8px',
  border: 'none',
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  cursor: 'pointer',
  outline: 'none',
  whiteSpace: 'nowrap',
  ...text.body.standard,
  selectors: {
    '&:not(:first-child)': { boxShadow: `inset 1px 0 0 ${c.stroke.secondary}` },
    '&[data-hovered]': { backgroundColor: c.interactive.secondaryHover },
  },
});

export const filterMuted = style({ color: c.content.secondary });
