// Notes and templates index pages (E README §2.1, §2.4; CROSS-DOMAIN B.19 index-page pattern; evidence
// E/notes-page-grid.png, notes-page-list.png, templates-page.png): header tabs, toolbar, favourites strip, date-bucket
// groups, 395 × 208 cards in a responsive grid (gap 12), or a table with 32 px headers and 52 px rows.
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

// ---- header tabs ("Notes 5 | Templates 0") ------------------------------------------------------------------------

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

// ---- toolbar -------------------------------------------------------------------------------------------------------

export const toolbar = style({
  boxSizing: 'border-box',
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 49,
  padding: '0 12px',
  borderBottom: `1px solid ${c.stroke.primary}`,
});

export const toolbarSpacer = style({ flex: 1 });

export const sortButton = style({
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

export const muted = style({ color: c.content.secondary });

export const segmented = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  padding: 2,
  borderRadius: 8,
  backgroundColor: c.surface.tint,
});

export const segment = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: c.content.secondary,
  cursor: 'pointer',
  outline: 'none',
  transition: `background-color ${ease}, box-shadow ${ease}`,
  selectors: {
    '&[data-hovered]': { backgroundColor: c.interactive.ghostHover },
    '&[aria-pressed="true"]': {
      backgroundColor: c.surface.primary,
      color: c.content.primary,
      boxShadow: '0 1px 2px -1px rgba(0,0,0,.04), 0 0 0 1px rgba(0,0,0,.04)',
    },
    '&[data-focus-visible]': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
  },
});

// ---- favourites strip -----------------------------------------------------------------------------------------------

export const favorites = style({
  boxSizing: 'border-box',
  padding: '12px 16px 11px',
  backgroundColor: c.surface.secondary,
  borderBottom: `1px solid ${c.stroke.primary}`,
});

export const favoritesLabel = style({ ...text.text12.standard, color: c.content.secondary, margin: '0 0 8px' });

export const favoritesEmpty = style({
  boxSizing: 'border-box',
  height: 177,
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

// ---- groups -------------------------------------------------------------------------------------------------------

export const groupHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 40,
  padding: '0 26px',
  ...text.text12.standard,
  fontSize: 13,
  color: c.content.secondary,
});

export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
  gap: 12,
  padding: '0 12px 12px',
});

// ---- card (395 × 208) --------------------------------------------------------------------------------------------------

export const card = style({
  position: 'relative',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  height: 208,
  minWidth: 0,
  padding: '16px 15px 0',
  borderRadius: 12,
  border: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
  cursor: 'pointer',
  outline: 'none',
  transition: `border-color ${ease}, box-shadow ${ease}`,
  selectors: {
    '&:hover': { borderColor: c.stroke.secondary, boxShadow: '0 1px 3px rgba(0,0,0,.04)' },
    '&:focus-visible': { borderColor: c.stroke.accent },
  },
});

export const cardFavorite = style({ width: 275, flex: 'none', height: 177 });

export const cardTop = style({ display: 'flex', alignItems: 'center', gap: 8, height: 16, minWidth: 0 });

export const cardRecord = style({ minWidth: 0, flex: '0 1 auto', fontSize: 12 });

export const cardTopSpacer = style({ flex: 1 });

export const cardMenu = style({
  opacity: 0,
  transition: `opacity ${ease}`,
  selectors: { [`${card}:hover &, &[aria-expanded="true"], &[data-focus-visible]`]: { opacity: 1 } },
});

export const cardTitle = style({
  ...text.body.standard,
  fontWeight: 500,
  color: c.content.primary,
  margin: '12px 0 0',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const cardPreview = style({
  position: 'relative',
  flex: 1,
  minHeight: 0,
  marginTop: 8,
  overflow: 'hidden',
  maskImage: 'linear-gradient(to bottom, #000 55%, transparent 100%)',
  WebkitMaskImage: 'linear-gradient(to bottom, #000 55%, transparent 100%)',
});

export const cardEmpty = style({ ...text.body.standard, fontSize: 13, color: c.content.tertiary });

export const cardFooter = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 42,
  borderTop: `1px solid ${c.stroke.primary}`,
  ...text.text12.standard,
  fontSize: 12,
});

export const cardDate = style({ marginLeft: 'auto', color: c.content.secondary });

// ---- list (table) -----------------------------------------------------------------------------------------------------

export const table = style({ display: 'flex', flexDirection: 'column', minWidth: 900 });

export const tableRow = style({
  boxSizing: 'border-box',
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 173px 172px 174px 248px',
  alignItems: 'center',
  borderBottom: `1px solid ${c.stroke.primary}`,
});

export const tableHead = style({
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
  cursor: 'pointer',
  position: 'relative',
  transition: `background-color ${ease}`,
  selectors: { '&:hover': { backgroundColor: alpha('#000000', 2) } },
});

export const cell = style({ display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px', minWidth: 0 });

export const noteCell = style({ flexDirection: 'column', alignItems: 'flex-start', gap: 0 });

export const rowTitle = style({
  ...text.body.standard,
  color: c.content.primary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: '100%',
});

export const rowPreview = style({
  ...text.body.standard,
  color: c.content.secondary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: '100%',
});

export const rowActions = style({
  position: 'absolute',
  right: 12,
  top: '50%',
  transform: 'translateY(-50%)',
  display: 'flex',
  alignItems: 'center',
  gap: 2,
});

export const rowHoverOnly = style({
  opacity: 0,
  transition: `opacity ${ease}`,
  selectors: { [`${dataRow}:hover &, &[aria-expanded="true"], &[data-focus-visible]`]: { opacity: 1 } },
});

export const starOn = style({ color: c.utilities.surface.yellow });

// ---- states ----------------------------------------------------------------------------------------------------------

export const state = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '80px 24px',
  textAlign: 'center',
});
export const stateTitle = style({ ...text.heading.small, color: c.content.primary });
export const stateText = style({ ...text.body.standard, color: c.content.secondary, maxWidth: 360 });
export const stateError = style({ ...text.body.standard, color: c.content.critical, maxWidth: 360 });

// ---- actors ----------------------------------------------------------------------------------------------------------

export const actor = style({ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 });

export const actorTile = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  borderRadius: 4,
  backgroundColor: c.utilities.surface.purple,
  color: c.content.onAccent,
  fontWeight: 600,
  lineHeight: 1,
});

export const actorName = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: c.content.primary,
});

export const actorNameBold = style({ fontWeight: 600 });

// ---- template search (toolbar) -----------------------------------------------------------------------------------

export const searchInput = style({
  boxSizing: 'border-box',
  height: 28,
  width: 220,
  padding: '0 8px',
  border: 'none',
  borderRadius: 8,
  outline: 'none',
  boxShadow: `inset 0 0 0 1px ${c.stroke.accent}`,
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});
