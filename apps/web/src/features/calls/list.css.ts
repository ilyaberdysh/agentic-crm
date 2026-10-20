// Calls index: the header tabs "Calls n" /
// "Insight Templates n", the toolbar (sort, filter chips, search, view settings), the favourites strip, date groups and
// the table with 52 px rows (call · record · participant · date).
import { alpha, scales, text, transitionColors, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;
const ease = `${scales.duration.comfortable}ms ease`;

export const page = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: c.surface.primary,
});

export const scroll = style({ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' });

// ---- header tabs --------------------------------------------------------------------------------------------------------

export const tabs = style({ display: 'flex', alignItems: 'center', gap: 4 });

export const tab = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 8px',
  borderRadius: 8,
  color: c.content.secondary,
  textDecoration: 'none',
  outline: 'none',
  cursor: 'pointer',
  ...text.body.standard,
  transition: `background-color ${ease}, box-shadow ${ease}, color ${ease}`,
  selectors: {
    '&:hover': { boxShadow: `inset 0 0 0 1px ${c.stroke.primary}` },
    '&[aria-current="page"]': {
      color: c.content.primary,
      backgroundColor: c.surface.primaryHover,
      boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
    },
    '&:focus-visible': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
  },
});

export const tabIcon = style({ color: c.content.secondary, flex: 'none' });

export const count = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 16,
  height: 16,
  padding: '0 4px',
  boxSizing: 'border-box',
  borderRadius: 6,
  ...text.text12.standard,
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
  color: c.content.secondary,
  backgroundColor: c.surface.tint,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primaryTransparent}`,
});

// ---- toolbar -----------------------------------------------------------------------------------------------------------------

export const toolbar = style({
  boxSizing: 'border-box',
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 49,
  padding: '10px 12px',
  borderBottom: `1px solid ${c.stroke.primary}`,
  flexWrap: 'wrap',
});

export const toolbarSpacer = style({ flex: 1 });
export const toolbarSeparator = style({ width: 1, height: 16, backgroundColor: c.stroke.primary, flex: 'none' });

export const toolbarButton = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 8px 0 6px',
  border: 'none',
  borderRadius: 8,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  color: c.content.primary,
  fontFamily: 'inherit',
  cursor: 'pointer',
  outline: 'none',
  whiteSpace: 'nowrap',
  ...text.body.standard,
  transition: transitionColors,
  selectors: {
    '&[data-hovered], &[data-pressed], &[aria-expanded="true"]': { backgroundColor: c.interactive.secondaryHover },
    '&[data-focus-visible]': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
  },
});

/** The "Filter" button is quieter than the others (ghost with a dashed ring, as the visual examples show). */
export const filterButton = style([
  toolbarButton,
  {
    color: c.content.secondary,
    boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
    backgroundColor: c.surface.tint,
  },
]);

export const muted = style({ color: c.content.secondary });

// ---- filter chips -----------------------------------------------------------------------------------------------------------

export const chips = style({ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 });

export const chip = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 4px 0 8px',
  borderRadius: 8,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  ...text.body.standard,
  minWidth: 0,
});

export const chipField = style({ display: 'inline-flex', alignItems: 'center', gap: 4, color: c.content.secondary });

export const chipOperator = style({
  border: 'none',
  background: 'transparent',
  padding: '0 2px',
  fontFamily: 'inherit',
  color: c.content.secondary,
  cursor: 'pointer',
  borderRadius: 4,
  ...text.body.standard,
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHover } },
});

export const chipValue = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
  maxWidth: 220,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

// ---- filter popover ----------------------------------------------------------------------------------------------------------

export const filterPanel = style({ width: 280, display: 'flex', flexDirection: 'column' });
export const filterList = style({ display: 'flex', flexDirection: 'column', gap: 1, padding: 4 });
export const filterBack = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  padding: '0 8px',
  border: 'none',
  borderBottom: `1px solid ${c.stroke.primary}`,
  background: 'transparent',
  color: c.content.secondary,
  fontFamily: 'inherit',
  cursor: 'pointer',
  ...text.body.standard,
});
export const filterInput = style({
  boxSizing: 'border-box',
  width: '100%',
  height: 40,
  padding: '0 12px',
  border: 'none',
  borderBottom: `1px solid ${c.stroke.primary}`,
  outline: 'none',
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});
export const filterResults = style({
  maxHeight: 280,
  overflow: 'auto',
  padding: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
});
export const filterSection = style({ ...text.text12.standard, color: c.content.tertiary, padding: '8px 8px 4px' });
export const filterOption = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 32,
  padding: '6px 8px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  ...text.body.standard,
  selectors: { '&:hover, &:focus-visible': { backgroundColor: c.surface.primaryHover, outline: 'none' } },
});
export const filterOptionText = style({ display: 'flex', flexDirection: 'column', minWidth: 0 });
export const filterOptionSub = style({ ...text.text12.standard, color: c.content.secondary });
export const filterEmpty = style({
  ...text.body.standard,
  color: c.content.secondary,
  padding: '12px 8px',
  textAlign: 'center',
});

// ---- search --------------------------------------------------------------------------------------------------------------------

export const searchBox = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  boxSizing: 'border-box',
  padding: '0 4px 0 8px',
  borderRadius: 8,
  boxShadow: `inset 0 0 0 1px ${c.stroke.accent}`,
  backgroundColor: c.surface.primary,
});

export const searchInput = style({
  boxSizing: 'border-box',
  height: 26,
  width: 200,
  padding: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});

// ---- favourites strip -----------------------------------------------------------------------------------------------------------

export const favorites = style({
  boxSizing: 'border-box',
  padding: '12px 16px 11px',
  backgroundColor: c.surface.secondary,
  borderBottom: `1px solid ${c.stroke.primary}`,
});

export const favoritesLabel = style({ ...text.text12.standard, color: c.content.secondary, margin: '0 0 8px' });

export const favoritesEmpty = style({
  boxSizing: 'border-box',
  height: 152,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  border: `1px dashed ${c.stroke.secondary}`,
  borderRadius: 12,
  textAlign: 'center',
});

export const favoritesEmptyTitle = style({ ...text.heading.small, fontWeight: 500, color: c.content.secondary });
export const favoritesEmptyText = style({ ...text.text12.standard, color: c.content.secondary });
export const favoritesRow = style({ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 1 });

// ---- table ------------------------------------------------------------------------------------------------------------------------

export const table = style({ display: 'flex', flexDirection: 'column', minWidth: 800 });

const COLUMNS = 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 0.5fr) minmax(0, 0.5fr) 76px';

export const tableRow = style({
  boxSizing: 'border-box',
  display: 'grid',
  gridTemplateColumns: COLUMNS,
  alignItems: 'center',
  borderBottom: `1px solid ${c.stroke.primary}`,
});

export const tableHead = style({
  position: 'sticky',
  top: 0,
  zIndex: 2,
  height: 32,
  ...text.text12.standard,
  fontSize: 13,
  color: c.content.secondary,
  backgroundColor: c.surface.primary,
});

export const headCell = style({ display: 'flex', alignItems: 'center', gap: 4, padding: '0 16px', minWidth: 0 });
export const headIcon = style({ color: c.content.secondary, flex: 'none' });

export const tableGroup = style({
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

export const dataRow = style({
  height: 52,
  position: 'relative',
  cursor: 'pointer',
  color: 'inherit',
  textDecoration: 'none',
  outline: 'none',
  transition: `background-color ${ease}`,
  selectors: {
    '&:hover, &:focus-within': { backgroundColor: alpha('#000000', 2) },
  },
});

export const cell = style({ display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px', minWidth: 0 });

export const callCell = style({ gap: 10 });

export const rowTitle = style({
  ...text.body.standard,
  color: c.content.primary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
});

export const rowLink = style({
  minWidth: 0,
  color: 'inherit',
  textDecoration: 'none',
  outline: 'none',
  selectors: { '&:focus-visible': { textDecoration: 'underline' } },
});

export const rowDuration = style({
  ...text.body.standard,
  color: c.content.secondary,
  flex: 'none',
  whiteSpace: 'nowrap',
});
export const rowDate = style({
  ...text.body.standard,
  color: c.content.tertiary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const recordChips = style({ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' });
export const moreChip = style({
  flex: 'none',
  ...text.text12.standard,
  padding: '0 6px',
  height: 20,
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 6,
  color: c.content.secondary,
  backgroundColor: c.surface.tint,
});

export const rowActions = style({
  position: 'absolute',
  right: 12,
  top: '50%',
  transform: 'translateY(-50%)',
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  backgroundColor: c.surface.primary,
  borderRadius: 8,
});

export const rowHoverOnly = style({
  opacity: 0,
  transition: `opacity ${ease}`,
  selectors: {
    [`${dataRow}:hover &, ${dataRow}:focus-visible &, ${dataRow}:focus-within &, &[aria-expanded="true"], &[data-focus-visible]`]:
      {
        opacity: 1,
      },
  },
});

export const starOn = style({ color: c.utilities.surface.yellow });

// ---- states -------------------------------------------------------------------------------------------------------------------------

export const state = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '80px 24px',
  textAlign: 'center',
});
export const stateTitle = style({
  ...text.heading.small,
  fontSize: 20,
  lineHeight: '28px',
  color: c.content.primary,
  marginTop: 16,
});
export const stateText = style({ ...text.body.standard, color: c.content.secondary, maxWidth: 360 });
export const stateError = style({ ...text.body.standard, color: c.content.critical, maxWidth: 360 });
export const stateAction = style({ marginTop: 12 });

export const loadMore = style({ display: 'flex', justifyContent: 'center', padding: 16 });
