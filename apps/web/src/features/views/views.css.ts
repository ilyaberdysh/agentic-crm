// Styles of the views feature: pickers (PopoverMenu), filter/sort chip groups ( DynamicGroup),
// the advanced filter editor, view switcher, view settings and the "Start with a view" empty state.
import { alpha, scales, text, transitionColors, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style, styleVariants } from '@vanilla-extract/css';

const c = vars.color;
const fast = `${scales.duration.breezy}ms ease`;

// ---- generic list rows inside popovers --------------------------------------------------------------------------

export const panelColumn = style({ display: 'flex', flexDirection: 'column', minHeight: 0, outline: 'none' });

/** Search input row at the top of a picker: padding 8, hairline below (overlaps the panel padding). */
export const searchRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  margin: '-4px -4px 4px',
  padding: '8px 14px',
  minHeight: 40,
  boxSizing: 'border-box',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
  flexShrink: 0,
});

export const searchRowWithBack = style({ paddingLeft: 10 });

export const searchInput = style({
  flex: 1,
  minWidth: 0,
  margin: 0,
  padding: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  selectors: {
    '&::placeholder': { color: c.content.tertiary, opacity: 1 },
    '&::-webkit-search-cancel-button': { display: 'none' },
  },
});

export const searchIcon = style({ color: c.content.tertiary, flex: 'none' });

export const backButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  flex: 'none',
  border: 'none',
  borderRadius: 6,
  padding: 0,
  background: 'transparent',
  color: c.content.secondary,
  cursor: 'pointer',
  selectors: { '&:hover, &[data-hovered]': { backgroundColor: c.interactive.ghostHover, color: c.content.primary } },
});

// Rows sit on a 32 px pitch (evidence C1/05, 07, 12).
export const list = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  overflowY: 'auto',
  minHeight: 0,
  outline: 'none',
});

export const row = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 32,
  padding: '6px 8px',
  borderRadius: 8,
  color: c.content.primary,
  cursor: 'default',
  userSelect: 'none',
  flexShrink: 0,
  outline: 'none',
  ...text.body.standard,
  selectors: {
    '&[data-active], &[data-focused], &[data-open]': { backgroundColor: c.surface.primaryHover },
    '&[data-disabled]': { opacity: 0.4 },
  },
});

export const rowSelected = style({ color: c.content.accent });

export const rowIcon = style({ flex: 'none', color: c.content.primary });
export const rowIconMuted = style({ flex: 'none', color: c.content.secondary });

export const rowLabel = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const rowTrailing = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  flex: 'none',
  marginLeft: 'auto',
  color: c.content.tertiary,
  ...text.text12.standard,
});

export const chevron = style({ color: c.content.secondary, flex: 'none' });

/** Drilled-in children: 21 px indent with a 1 px guide line at x 16 (PopoverMenu Indent). */
export const indent = style({ position: 'relative', paddingLeft: 21 });
globalStyle(`${indent}::before`, {
  content: '""',
  position: 'absolute',
  left: 16,
  top: -1,
  bottom: -1,
  width: 1,
  backgroundColor: c.stroke.primary,
});

export const separator = style({
  height: 1,
  margin: '3px -4px',
  border: 'none',
  backgroundColor: c.stroke.primary,
  flexShrink: 0,
});

export const empty = style({ ...text.text12.standard, color: c.content.secondary, padding: '6px 8px' });

export const sectionLabel = style({
  ...text.text12.standard,
  color: c.content.secondary,
  padding: '2px 8px',
  minHeight: 20,
  display: 'flex',
  alignItems: 'center',
});

export const menuFooterNote = style({
  ...text.text12.standard,
  color: c.content.tertiary,
  padding: '4px 8px 4px',
  whiteSpace: 'pre-line',
});

// ---- chip groups (filter pills, sort pill) ------------------------------------------------------------------------

export const bar = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 49,
  padding: '0 12px',
  borderBottom: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
  minWidth: 0,
});

export const barScroll = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  flex: '0 1 auto',
  overflowX: 'auto',
  scrollbarWidth: 'none',
  selectors: { '&::-webkit-scrollbar': { display: 'none' } },
});

export const barSpacer = style({ flex: 1, minWidth: 8 });

export const barDivider = style({ width: 1, height: 16, flex: 'none', backgroundColor: c.stroke.secondary });

export const group = style({
  display: 'inline-flex',
  alignItems: 'stretch',
  flex: 'none',
  height: 28,
  borderRadius: 8,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  color: c.content.primary,
  maxWidth: 520,
  transition: `box-shadow ${fast}`,
  selectors: { '&[data-invalid]': { boxShadow: `inset 0 0 0 1px ${c.content.critical}` } },
});

export const segment = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  maxWidth: 220,
  height: 28,
  padding: '0 8px',
  margin: 0,
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
  outline: 'none',
  cursor: 'pointer',
  ...text.body.standard,
  transition: transitionColors,
  selectors: {
    '&:first-child': { borderTopLeftRadius: 8, borderBottomLeftRadius: 8 },
    '&:last-child': { borderTopRightRadius: 8, borderBottomRightRadius: 8 },
    '&:not(:first-child)': { boxShadow: `inset 1px 0 0 ${c.stroke.secondary}` },
    '&[data-hovered], &[data-pressed], &[aria-expanded="true"]': { backgroundColor: c.interactive.secondaryHover },
    '&[data-focus-visible]': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: -1 },
  },
});

export const segmentText = style({ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 });
export const segmentMuted = style({ color: c.content.secondary });

// Placeholder text stays tertiary while its menu is open (evidence C1/19, 20).
export const segmentPlaceholder = style({
  backgroundColor: c.interactive.placeholder,
  color: c.content.tertiary,
  selectors: { '&[data-hovered]:not([aria-expanded="true"])': { color: c.content.primary } },
});

/** An empty value segment truncates its placeholder ("enter numbe…", evidence C1/20). */
export const segmentValuePlaceholder = style({ maxWidth: 110 });

export const segmentIcon = style({ padding: '0 5px', justifyContent: 'center', color: c.content.secondary });

export const badge = style({
  display: 'inline-flex',
  alignItems: 'center',
  height: 16,
  padding: '0 4px',
  borderRadius: 6,
  ...text.text12.standard,
  color: c.content.secondary,
  backgroundColor: alpha('#000000', 1),
  boxShadow: `inset 0 0 0 1px ${c.stroke.primaryTransparent}`,
});

/** Dashed placeholder chip: "Sort", "Filter", "+" (DynamicGroup placeholder). */
export const placeholderChip = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  flex: 'none',
  padding: '0 8px 0 6px',
  borderRadius: 8,
  border: `1px dashed ${c.stroke.primaryTransparent}`,
  backgroundColor: c.interactive.placeholder,
  color: c.content.tertiary,
  fontFamily: 'inherit',
  cursor: 'pointer',
  outline: 'none',
  whiteSpace: 'nowrap',
  ...text.body.standard,
  transition: transitionColors,
  selectors: {
    '&[data-hovered], &[aria-expanded="true"], &[data-pressed]': {
      backgroundColor: c.interactive.placeholderHover,
      color: c.content.primary,
    },
    '&[data-focus-visible]': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});

export const placeholderChipIconOnly = style({ width: 28, padding: 0, justifyContent: 'center' });

// ---- filter value editors ---------------------------------------------------------------------------------------

export const valuePanel = style({ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 });

export const inlineInput = style({
  boxSizing: 'border-box',
  width: '100%',
  height: 32,
  padding: '0 10px',
  borderRadius: 8,
  border: 'none',
  outline: 'none',
  boxShadow: `inset 0 0 0 1px ${c.stroke.accent}`,
  backgroundColor: c.surface.primary,
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  selectors: { '&::placeholder': { color: c.content.tertiary, opacity: 1 } },
});

export const numberWrap = style({ position: 'relative', display: 'flex', alignItems: 'center' });
export const spin = style({
  position: 'absolute',
  right: 6,
  display: 'flex',
  flexDirection: 'column',
  color: c.content.secondary,
});
export const spinButton = style({
  display: 'flex',
  border: 'none',
  padding: 0,
  height: 10,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
});

export const stars = style({ display: 'flex', gap: 2, padding: 4 });
export const star = style({
  display: 'inline-flex',
  border: 'none',
  padding: 4,
  borderRadius: 6,
  background: 'transparent',
  color: c.content.tertiary,
  cursor: 'pointer',
  selectors: {
    '&[data-on]': { color: c.utilities.content.yellow },
    '&:hover': { backgroundColor: c.interactive.ghostHover },
  },
});

export const daysForm = style({ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 });
export const daysLabel = style({ ...text.text12.standard, color: c.content.tertiary, paddingLeft: 4 });

// ---- advanced filter editor ---------------------------------------------------------------------------------------

export const advanced = style({ display: 'flex', flexDirection: 'column', gap: 13, padding: 16, minWidth: 688 });

export const advancedRows = style({ display: 'flex', flexDirection: 'column', gap: 8 });

export const advancedRow = style({ display: 'flex', alignItems: 'flex-start', gap: 16 });

export const prefix = style({ width: 64, flex: 'none', display: 'flex', alignItems: 'center', height: 28 });

export const prefixStatic = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  height: 28,
  padding: '0 8px',
  borderRadius: 8,
  border: `1px dashed ${c.stroke.primaryTransparent}`,
  color: c.content.tertiary,
  ...text.body.standard,
});

export const prefixText = style({ ...text.body.standard, color: c.content.secondary, paddingLeft: 8 });

export const advancedFields = style({ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 });

export const advancedRowMenu = style({ marginLeft: 'auto', flex: 'none' });

export const nestedGroup = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  flex: 1,
  minWidth: 0,
  padding: 10,
  borderRadius: 10,
  backgroundColor: c.surface.secondary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
});

export const advancedFooter = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 });

export const dropdownValue = style({ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 });

// ---- sort popover ----------------------------------------------------------------------------------------------

export const sortPanel = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: '16px 16px 0',
  width: 480,
});
export const sortRow = style({ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' });
export const sortRowDragging = style({ opacity: 0.5 });
export const dragHandle = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 28,
  flex: 'none',
  color: c.content.tertiary,
  cursor: 'grab',
  touchAction: 'none',
  selectors: { '&:active': { cursor: 'grabbing' } },
});
export const sortField = style({ flex: '1 1 242px', minWidth: 0, justifyContent: 'flex-start' });
export const sortDirection = style({ flex: '0 0 142px', justifyContent: 'flex-start' });
export const sortFooter = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  margin: '0 -16px',
  padding: '10px 12px',
  borderTop: `1px solid ${c.stroke.primary}`,
  color: c.content.secondary,
  ...text.body.standard,
});
export const dropLine = style({
  position: 'absolute',
  left: 0,
  right: 0,
  height: 2,
  borderRadius: 1,
  backgroundColor: c.stroke.accent,
  pointerEvents: 'none',
});

// ---- view switcher / settings ------------------------------------------------------------------------------------

export const switcherPanel = style({ width: 264 });

export const viewRowMenu = style({
  marginLeft: 'auto',
  opacity: 0,
  selectors: {
    [`${row}[data-active] &, ${row}:hover &, &[aria-expanded="true"]`]: { opacity: 1 },
  },
});

export const settingsPanel = style({ width: 270, maxHeight: '60vh' });

export const pathSep = style({ color: c.content.secondary, flex: 'none', display: 'inline-block' });
export const pathLabel = style({ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, maxWidth: '100%' });
export const pathPart = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });

export const viewTypeIcon = styleVariants({
  table: { color: c.utilities.content.green },
  kanban: { color: c.utilities.content.blue },
});

// ---- dialogs -----------------------------------------------------------------------------------------------------

export const dialogBody = style({ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 16px 24px' });

export const fieldLabel = style({
  ...text.text12.standard,
  color: c.content.tertiary,
  paddingLeft: 4,
  marginBottom: 6,
});

export const typeCards = style({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 });

export const typeCard = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: 8,
  borderRadius: 10,
  border: 'none',
  textAlign: 'left',
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  color: c.content.primary,
  fontFamily: 'inherit',
  cursor: 'pointer',
  outline: 'none',
  transition: `box-shadow ${fast}, background-color ${fast}`,
  selectors: {
    '&[data-selected]': { backgroundColor: c.surface.accentSubtle, boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
    '&[data-focus-visible]': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});

export const typeCardTile = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 40,
  height: 40,
  flex: 'none',
  borderRadius: 8,
  backgroundColor: c.surface.secondary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  color: c.content.secondary,
  selectors: { [`${typeCard}[data-selected] &`]: { color: c.content.accent, backgroundColor: c.surface.accentSubtle } },
});

export const typeCardTitle = style({ ...text.body.standard, fontWeight: 500 });
export const typeCardText = style({ ...text.text12.standard, color: c.content.secondary });

export const hint = style({ ...text.text11.standard, color: c.content.secondary, paddingLeft: 4, marginTop: 6 });
export const errorText = style({ ...text.text11.standard, color: c.content.critical, paddingLeft: 4, marginTop: 6 });

// ---- Start with a view ------------------------------------------------------------------------------------------

export const start = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  minHeight: '100%',
  padding: '17px 16px 20px',
  boxSizing: 'border-box',
});

export const startInner = style({ width: 600, maxWidth: '100%', display: 'flex', flexDirection: 'column' });

export const startTitle = style({ ...text.heading.medium, color: c.content.primary, margin: 0 });
export const startText = style({
  ...text.body.standard,
  color: c.content.secondary,
  margin: '4px 0 16px',
  maxWidth: 260,
});

export const startCards = style({ display: 'grid', gridTemplateColumns: '292px 292px', gap: 16 });

export const startCard = style({
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  justifyContent: 'center',
  gap: 0,
  height: 184,
  padding: '0 20px',
  borderRadius: 20,
  border: 'none',
  textAlign: 'left',
  backgroundColor: c.surface.secondary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  color: c.content.primary,
  fontFamily: 'inherit',
  cursor: 'pointer',
  outline: 'none',
  transition: transitionColors,
  selectors: {
    '&[data-hovered]': { backgroundColor: c.surface.secondaryHover },
    '&[data-focus-visible]': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});

export const startCardTile = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 8,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  color: c.content.secondary,
  marginBottom: 20,
});

export const startCardTitle = style({ ...text.body.standard, fontWeight: 500, marginBottom: 2 });
export const startCardText = style({ ...text.body.standard, color: c.content.secondary });

export const learnMore = style({ marginTop: 'auto', paddingTop: 24, width: 630, maxWidth: '100%' });
export const learnMoreLabel = style({ ...text.text12.standard, color: c.content.secondary, marginBottom: 8 });
export const learnCards = style({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 });
export const learnCard = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 74,
  padding: 8,
  boxSizing: 'border-box',
  borderRadius: 16,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  color: c.content.primary,
  textDecoration: 'none',
  ...text.body.standard,
  fontWeight: 500,
  selectors: { '&:hover': { backgroundColor: c.surface.secondary } },
});
export const learnCardTile = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 56,
  height: 56,
  flex: 'none',
  borderRadius: 10,
  backgroundColor: c.surface.secondary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  color: c.content.secondary,
});

// ---- select-like trigger (sort rows: label left, chevron at the right edge; evidence C1/17) ------------------------

export const selectButton = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  minWidth: 0,
  padding: '0 6px 0 8px',
  border: 'none',
  borderRadius: 8,
  backgroundColor: c.interactive.secondary,
  boxShadow: vars.elevation.e1,
  color: c.content.primary,
  fontFamily: 'inherit',
  cursor: 'pointer',
  outline: 'none',
  ...text.body.standard,
  transition: transitionColors,
  selectors: {
    '&[data-hovered], &[data-pressed], &[aria-expanded="true"], &[data-active]': {
      backgroundColor: c.interactive.secondaryHover,
    },
    '&[data-focus-visible]': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});

export const selectLabel = style({
  flex: 1,
  minWidth: 0,
  textAlign: 'left',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

/** "Current user" row above the member picker in actor filters. */
export const currentUserRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  margin: '4px 4px 0',
  padding: '6px 8px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: c.content.primary,
  ...text.body.standard,
  textAlign: 'left',
  cursor: 'pointer',
  selectors: { '&:hover, &:focus-visible': { backgroundColor: c.surface.primaryHover, outline: 'none' } },
});

export const currentUserCheck = style({ marginLeft: 'auto', color: c.content.accent });
