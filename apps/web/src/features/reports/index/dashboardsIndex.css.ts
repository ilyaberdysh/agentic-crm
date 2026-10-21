// Dashboards index: page header 48 px,
// toolbar 49 px, favourites strip (12 px padding, cards 275 × 150), table header 32 px, group rows 32 px, dashboard
// rows 52 px with columns Dashboard | Reports | Created at at 32 / 46 / 22 % of the width.
import { alpha, insetRing, scales, text, vars } from '@agentic-crm/ui/styles';
import { style, styleVariants } from '@vanilla-extract/css';

const c = vars.color;
const u = c.utilities;
const ease = `${scales.duration.comfortable}ms ease`;

export const page = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: c.surface.primary,
});

export const scroll = style({ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' });

// ---- toolbar ---------------------------------------------------------------------------------------------------------

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

export const searchField = style({ width: 240, flex: 'none' });

// ---- favourites strip --------------------------------------------------------------------------------------------------

export const favorites = style({
  boxSizing: 'border-box',
  padding: '12px 16px',
  backgroundColor: c.surface.secondary,
  borderBottom: `1px solid ${c.stroke.primary}`,
});

export const favoritesLabel = style({ ...text.text12.standard, color: c.content.secondary, margin: '0 0 13px' });

export const favoritesRow = style({ display: 'flex', gap: 12, overflowX: 'auto' });

export const favoritesEmpty = style({
  boxSizing: 'border-box',
  height: 150,
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

// ---- favourite card (275 × 150) ------------------------------------------------------------------------------------------

export const card = style({
  position: 'relative',
  boxSizing: 'border-box',
  flex: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  width: 275,
  height: 150,
  padding: '10px 11px',
  borderRadius: 12,
  border: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
  cursor: 'pointer',
  transition: `border-color ${ease}, box-shadow ${ease}`,
  selectors: {
    '&:hover': { borderColor: c.stroke.secondary, boxShadow: '0 1px 3px rgba(0,0,0,.04)' },
    '&:has(a:focus-visible)': { borderColor: c.stroke.accent },
  },
});

export const thumbs = style({ display: 'flex', gap: 6, height: 96, flex: 'none' });

export const thumb = style({
  boxSizing: 'border-box',
  flex: '0 0 62px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 8,
  border: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.secondary,
});

export const thumbMore = style({
  boxSizing: 'border-box',
  flex: '0 0 46px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 8,
  border: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.secondary,
  ...text.body.standard,
  color: c.content.secondary,
  fontVariantNumeric: 'tabular-nums',
});

export const thumbGlyph = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 9,
  backgroundColor: u.surface.cyanSubtle,
  boxShadow: insetRing(u.stroke.cyan),
  color: u.content.onCyanSubtle,
});

export const cardTitle = style({
  ...text.body.standard,
  fontWeight: 500,
  color: c.content.primary,
  textDecoration: 'none',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  outline: 'none',
  selectors: { '&::after': { content: '""', position: 'absolute', inset: 0, borderRadius: 12 } },
});

// ---- table -----------------------------------------------------------------------------------------------------------

export const table = style({ display: 'flex', flexDirection: 'column', minWidth: 760 });

/** Dashboard | Reports | Created at (x 0 / 489 / 1183 of 1512 in the capture). */
export const grid = style({
  boxSizing: 'border-box',
  display: 'grid',
  gridTemplateColumns: 'minmax(220px, 32.34fr) minmax(0, 45.9fr) minmax(120px, 21.76fr)',
  alignItems: 'center',
  borderBottom: `1px solid ${c.stroke.primary}`,
});

export const head = style({
  height: 32,
  ...text.text12.standard,
  fontSize: 13,
  color: c.content.secondary,
  backgroundColor: c.surface.primary,
});

export const headCell = style({ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, whiteSpace: 'nowrap' });
export const headFirst = style({ paddingLeft: 16 });
export const headIcon = style({ color: c.content.secondary, flex: 'none' });

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

export const count = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 16,
  height: 16,
  padding: '0 4px',
  boxSizing: 'border-box',
  borderRadius: 6,
  fontSize: 11,
  lineHeight: '16px',
  fontVariantNumeric: 'tabular-nums',
  color: c.content.secondary,
  backgroundColor: c.surface.tint,
  boxShadow: insetRing(c.stroke.primaryTransparent),
});

export const row = style({
  position: 'relative',
  height: 52,
  ...text.body.standard,
  color: c.content.primary,
  transition: `background-color ${ease}`,
  selectors: {
    '&:hover, &:has([aria-expanded="true"])': { backgroundColor: alpha('#000000', 2) },
    '&:has(a:focus-visible)': { boxShadow: insetRing(c.stroke.accent) },
  },
});

export const cell = style({ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' });
export const cellFirst = style({ paddingLeft: 16, gap: 6 });

export const tile = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  width: 24,
  height: 24,
  borderRadius: 8,
});

export const tint = styleVariants({
  red: { backgroundColor: u.surface.redSubtle, color: u.content.onRedSubtle },
  orange: { backgroundColor: u.surface.orangeSubtle, color: u.content.onOrangeSubtle },
  pink: { backgroundColor: u.surface.pinkSubtle, color: u.content.onPinkSubtle },
  lavender: { backgroundColor: u.surface.lavenderSubtle, color: u.content.onLavenderSubtle },
  purple: { backgroundColor: u.surface.purpleSubtle, color: u.content.onPurpleSubtle },
  blue: { backgroundColor: u.surface.blueSubtle, color: u.content.onBlueSubtle },
  cyan: { backgroundColor: u.surface.cyanSubtle, color: u.content.onCyanSubtle },
  green: { backgroundColor: u.surface.greenSubtle, color: u.content.onGreenSubtle },
  amber: { backgroundColor: u.surface.amberSubtle, color: u.content.onAmberSubtle },
});

/** The title is the row's link; its::after stretches over the whole row (the star and the menu sit above it). */
export const titleLink = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
  fontWeight: 500,
  color: c.content.primary,
  textDecoration: 'none',
  outline: 'none',
  selectors: { '&::after': { content: '""', position: 'absolute', inset: 0 } },
});

export const above = style({ position: 'relative', zIndex: 1 });

export const infoButton = style({
  position: 'relative',
  zIndex: 1,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  width: 16,
  height: 16,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: c.content.tertiary,
  cursor: 'default',
  outline: 'none',
  selectors: { '&[data-focus-visible]': { boxShadow: insetRing(c.stroke.accent) } },
});

export const chips = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  minWidth: 0,
  width: '100%',
  paddingRight: 28,
});

export const chip = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  flex: '0 1 auto',
  minWidth: 0,
  height: 20,
  padding: '0 5px',
  borderRadius: 6,
  backgroundColor: c.surface.tertiary,
  boxShadow: insetRing(c.stroke.primary),
  ...text.text12.standard,
  color: c.content.secondary,
});

export const chipGlyph = style({ flex: 'none', color: c.content.secondary });

export const chipText = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });

export const chipMore = style({ flex: 'none', color: c.content.secondary, fontVariantNumeric: 'tabular-nums' });

export const created = style({ color: c.content.secondary, whiteSpace: 'nowrap' });

export const rowActions = style({
  position: 'absolute',
  right: 20,
  top: '50%',
  transform: 'translateY(-50%)',
  zIndex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 0,
});

export const hoverOnly = style({
  opacity: 0,
  transition: `opacity ${ease}`,
  selectors: {
    [`${row}:hover &, ${row}:focus-within &, &[aria-expanded="true"], &[data-focus-visible]`]: { opacity: 1 },
  },
});

/** The disabled "Created by …" item at the bottom of the row menu. */
export const metaItem = style({
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 0,
  height: 'auto',
  cursor: 'default',
  opacity: '1 !important',
  selectors: { '&[data-hovered], &[data-focused]': { backgroundColor: 'transparent' } },
});
export const metaLine = style({ ...text.text12.standard, color: c.content.secondary });
export const metaSub = style({ ...text.text12.standard, color: c.content.tertiary });

// ---- states ---------------------------------------------------------------------------------------------------------

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
export const stateText = style({ ...text.body.standard, color: c.content.secondary, maxWidth: 380 });
export const stateActions = style({ marginTop: 10 });
