// Editor chrome (C1,  "Cell editor", /; measured on, 51,
// D-project-text-editor, D-project-tags-editor).
import { alpha, insetRing, scales, text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style, styleVariants } from '@vanilla-extract/css';

const c = vars.color;

// ---- inline overlay (text, number, currency, name, location field) ----------------------------------------------

/** Over the cell: 1 px accent border, radius 2, white, padding 7 12 8 incl. the border; 351 px wide (51-cell). */
export const overlay = style({
  boxSizing: 'border-box',
  position: 'fixed',
  zIndex: 2147483646,
  display: 'flex',
  alignItems: 'flex-start',
  border: `1px solid ${c.stroke.accent}`,
  borderRadius: 2,
  backgroundColor: c.surface.primary,
  color: c.content.primary,
  ...text.body.standard,
  boxShadow: 'none',
});

export const overlayField = style({
  borderRadius: 9,
  border: 'none',
  boxShadow: insetRing(c.stroke.accent),
});

export const overlayInline = style({ position: 'relative', zIndex: 'auto', width: '100%' });

export const overlayInput = style({
  boxSizing: 'border-box',
  flex: 1,
  minWidth: 0,
  margin: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  letterSpacing: 'inherit',
  padding: '7px 11px 8px',
  resize: 'none',
  overflow: 'hidden',
  selectors: { '&::placeholder': { color: c.content.tertiary, opacity: 1 } },
});

export const overlayInputField = style({ padding: '6px 10px' });
export const overlayInputEnd = style({ textAlign: 'right', fontVariantNumeric: 'tabular-nums' });
export const overlayInvalid = style({ borderColor: c.stroke.critical });

export const affix = style({
  flex: 'none',
  alignSelf: 'center',
  paddingRight: 11,
  ...text.body.standard,
  color: c.content.tertiary,
});

export const nameRow = style({ display: 'flex', flex: 1, minWidth: 0, gap: 0 });
globalStyle(`${nameRow} > input + input`, { borderLeft: `1px solid ${c.stroke.primary}` });

// ---- popover panel ---------------------------------------------------------------------------------------------------

/** Picker panel: 282 px (or the anchor width), radius 12, e2, no padding (sections pad themselves). */
export const panel = style({ padding: 0, gap: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' });
export const panelInline = style({
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: vars.elevation.e2,
  color: c.content.primary,
  ...text.body.standard,
  overflow: 'hidden',
});

export const dialog = style({ outline: 'none', display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 });

/** Search row: 36 px, icon at 12, text at 36, hairline below. */
export const searchRow = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  height: 36,
  padding: '0 12px 0 11px',
  flex: 'none',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
});

export const searchIcon = style({ color: c.content.tertiary, flex: 'none' });

export const searchInput = style({
  flex: 1,
  minWidth: 0,
  margin: 0,
  padding: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: c.content.primary,
  font: 'inherit',
  ...text.body.standard,
  selectors: {
    '&::placeholder': { color: c.content.tertiary, opacity: 1 },
    '&::-webkit-search-cancel-button': { display: 'none' },
  },
});

/** Listbox: padding 4, 32 px options with no gap (pitch 32), max-height like SelectCombobox (250 + chrome). */
export const list = style({
  display: 'flex',
  flexDirection: 'column',
  padding: 4,
  overflowY: 'auto',
  maxHeight: 296,
  outline: 'none',
});

export const option = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 32,
  padding: '5px 5px',
  borderRadius: 8,
  color: c.content.primary,
  cursor: 'default',
  userSelect: 'none',
  flexShrink: 0,
  ...text.body.standard,
});

export const optionPadded = style({ paddingInline: 8 });
export const optionActive = style({ backgroundColor: c.surface.primaryHover });

export const optionMain = style({ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 });
export const optionTrailing = style({ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', flex: 'none' });
export const optionCheck = style({ color: c.content.accent, flex: 'none' });

/** Status rows in the picker: 10 px between dot and title (cells use 8). */
export const statusOption = style({ selectors: { '&&': { gap: 10 } } });
export const optionDescription = style({ ...text.text12.standard, color: c.content.secondary, minWidth: 0 });
export const optionTexts = style({ display: 'flex', flexDirection: 'column', minWidth: 0 });

export const separator = style({ height: 1, margin: '4px 0', backgroundColor: c.stroke.primary, flexShrink: 0 });

export const sectionLabel = style({
  ...text.text12.standard,
  color: c.content.secondary,
  padding: '4px 8px 2px',
  flexShrink: 0,
});

export const empty = style({ ...text.text12.standard, color: c.content.secondary, padding: '8px 8px' });

export const createIcon = style({ color: c.content.secondary, flex: 'none' });

/** Sticky footer row of pickers ("+ Create Person"). */
export const footer = style({
  flex: 'none',
  padding: 4,
  boxShadow: `inset 0 1px 0 ${c.stroke.primary}`,
});

// Option checkbox (multi pickers): the 16 px table checkbox.
export const optionCheckbox = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  borderRadius: 6,
  border: `1px solid ${c.stroke.secondaryTransparent}`,
  backgroundColor: c.surface.primary,
  color: c.content.onAccent,
  flex: 'none',
});
export const optionCheckboxOn = style({ backgroundColor: c.surface.accent, borderColor: c.stroke.accent });

// ---- Calendar ------------------------------------------------------------------------

export const calendar = style({ display: 'flex', flexDirection: 'column', padding: '17px 16px 0' });

export const calHeader = style({ display: 'flex', alignItems: 'center', gap: 4, height: 22, marginBottom: 12 });

export const calNav = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: c.content.ghost,
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHover, color: c.content.primary },
    '&:focus-visible': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});

export const calMonth = style({ ...text.body.standard, color: c.content.primary, marginLeft: 0 });

export const calYear = style({
  marginLeft: 'auto',
  width: 46,
  padding: '0 6px 0 4px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  outline: 'none',
  textAlign: 'right',
  color: c.content.primary,
  font: 'inherit',
  ...text.body.standard,
  fontVariantNumeric: 'tabular-nums',
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&:focus': { boxShadow: insetRing(c.stroke.accent) },
  },
});

export const calGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 32px)',
  gridTemplateRows: '29px',
  gridAutoRows: 32,
  gap: 2,
  outline: 'none',
});

export const calWeekday = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  ...text.text12.standard,
  color: c.content.secondary,
});

export const calDay = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  padding: 0,
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: c.content.primary,
  ...text.body.standard,
  fontVariantNumeric: 'tabular-nums',
  cursor: 'pointer',
  outline: 'none',
  transition: `box-shadow ${scales.duration.fast + 40}ms ease, background-color ${scales.duration.fast + 40}ms ease`,
  selectors: {
    '&:hover': { boxShadow: insetRing(alpha(c.stroke.accent, 50)) },
  },
});

export const calDayFocused = style({ boxShadow: insetRing(alpha(c.stroke.accent, 50)) });
export const calDayToday = style({
  color: c.content.accent,
  selectors: {
    '&::after': {
      content: '""',
      position: 'absolute',
      bottom: 3,
      left: '50%',
      width: 4,
      height: 4,
      marginLeft: -2,
      borderRadius: '50%',
      backgroundColor: 'currentColor',
    },
  },
});
export const calDaySelected = style({
  backgroundColor: c.interactive.primary,
  color: c.content.onAccent,
  selectors: { '&::after': { backgroundColor: c.content.onAccent } },
});
export const calDayOutside = style({ visibility: 'hidden' });

export const timeInputs = style({ display: 'flex', gap: 8, marginBottom: 10 });

/** Below the grid: 10 px to the fields / quick actions, 16 px bottom padding (27). */
export const calendarFooter = style({ padding: '10px 16px 16px' });

/** Field shells: radius 10, inset stroke.primary, accent on focus (Dates). */
export const timeInput = style({
  boxSizing: 'border-box',
  height: 32,
  padding: '0 10px',
  border: 'none',
  borderRadius: 10,
  outline: 'none',
  boxShadow: insetRing(c.stroke.primary),
  background: 'transparent',
  color: c.content.primary,
  font: 'inherit',
  ...text.body.standard,
  fontVariantNumeric: 'tabular-nums',
  minWidth: 0,
  selectors: {
    '&::placeholder': { color: c.content.tertiary, opacity: 1 },
    '&:focus': { boxShadow: insetRing(c.stroke.accent) },
    '&[data-invalid]': { boxShadow: insetRing(c.stroke.critical) },
  },
});

export const quickActions = style({ display: 'flex', flexWrap: 'wrap', gap: '4px 2px', width: 200 });

/** Quick-action chips: ghost button 20 (padding 2 6, 4 next to the icon; text12; icon 12). */
export const quickAction = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 20,
  padding: '2px 6px 2px 4px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: c.content.primary,
  ...text.text12.standard,
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHover },
    '&:focus-visible': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});

// ---- Value lists (emails, domains, phones) ------------------------------------------------------

export const valueList = style({ display: 'flex', flexDirection: 'column', padding: 4 });

/** Value row: 12 px handle centred at x 20, text at x 36. */
export const valueRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minHeight: 32,
  padding: '0 8px 0 10px',
  borderRadius: 8,
  selectors: { '&:hover': { backgroundColor: c.surface.primaryHover } },
});

export const dragHandle = style({ color: c.stroke.tertiary, cursor: 'grab', flex: 'none', display: 'inline-flex' });

export const rowRemove = style({
  marginLeft: 'auto',
  display: 'inline-flex',
  padding: 2,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: c.content.secondary,
  cursor: 'pointer',
  opacity: 0,
  selectors: {
    [`${valueRow}:hover &, &:focus-visible`]: { opacity: 1 },
    '&:hover': { backgroundColor: c.interactive.ghostHover, color: c.content.primary },
  },
});

/** "+ Add email…" row: 39 px, the + centred at x 20, text at x 36. */
export const addRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  height: 39,
  padding: '0 12px 0 13px',
  flex: 'none',
});

/** Hairline between the values and the add row, inset 4 px. */
export const listSeparator = style({ height: 1, margin: '0 4px', backgroundColor: c.stroke.primary, flex: 'none' });

export const phoneRow = style({ display: 'flex', alignItems: 'center', gap: 3, height: 38, padding: '0 12px 0 10px' });

/** The calling code before the masked input: secondary; the mask itself is placeholder text. */
export const phonePrefix = style({ ...text.body.standard, color: c.content.secondary, flex: 'none' });

export const countryButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  height: 24,
  padding: '0 4px 0 8px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: c.content.primary,
  ...text.body.standard,
  cursor: 'pointer',
  flex: 'none',
  selectors: { '&:hover, &[data-pressed]': { backgroundColor: c.interactive.ghostHover } },
});

export const countryChevron = style({ color: c.content.secondary });

// ---- location form (D) ------------------------------------------------------------------------------------------

export const form = style({ display: 'flex', flexDirection: 'column', gap: 12, padding: 12 });
export const formRow = style({ display: 'flex', gap: 8 });
export const formActions = style({ display: 'flex', justifyContent: 'flex-end', gap: 8 });

export const ratingOverlay = style({ padding: '8px 12px', display: 'flex', alignItems: 'center' });

export const widthVariant = styleVariants({ cell: { width: 282 }, field: {} });
