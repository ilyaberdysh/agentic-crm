// Workflows index: 32 px column header with icons, 32 px
// group rows on the secondary surface, 52 px rows (24 px tile + title), hover star and ⋮; the empty state with the
// cubes illustration and the academy card.
import { alpha, text, transitionColors, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const page = style({ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' });

export const scroll = style({ flex: 1, minHeight: 0, overflow: 'auto' });

export const columns = style({
  boxSizing: 'border-box',
  display: 'grid',
  gridTemplateColumns: 'minmax(260px, 1fr) 95px 109px 159px 184px minmax(180px, 261px)',
  alignItems: 'center',
  minWidth: 1000,
});

export const head = style({
  height: 32,
  borderTop: `1px solid ${c.stroke.primary}`,
  borderBottom: `1px solid ${c.stroke.primary}`,
  ...text.text12.standard,
  color: c.content.secondary,
});

export const headFirst = style({ borderTop: 'none' });

export const headCell = style({ display: 'flex', alignItems: 'center', gap: 4, padding: '0 16px', minWidth: 0 });
export const headIcon = style({ color: c.content.secondary });

export const group = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  padding: '0 16px',
  minWidth: 1000,
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
  borderRadius: 4,
  backgroundColor: c.surface.tertiaryHover,
  ...text.text11.standard,
  color: c.content.secondary,
});

export const row = style({
  position: 'relative',
  height: 52,
  borderBottom: `1px solid ${c.stroke.primary}`,
  cursor: 'pointer',
  textDecoration: 'none',
  color: c.content.primary,
  outline: 'none',
  transition: transitionColors,
  selectors: {
    '&:hover, &[data-menu-open]': { backgroundColor: alpha('#000000', 2) },
    '&:focus-visible': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
  },
});

export const cell = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 16px',
  minWidth: 0,
  ...text.body.standard,
  color: c.content.primary,
});

export const muted = style({ color: c.content.tertiary });

export const title = style({
  flex: '0 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  ...text.body.standard,
  fontWeight: 500,
});

export const archivedTitle = style({ color: c.content.tertiary });

export const truncate = style({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

export const rowActions = style({
  marginLeft: 'auto',
  display: 'none',
  alignItems: 'center',
  gap: 2,
  selectors: {
    [`${row}:hover &, ${row}[data-menu-open] &, ${row}:focus-within &`]: { display: 'inline-flex' },
  },
});

export const starOn = style({ display: 'inline-flex' });

// ---- empty state ----------------------------------------------------------------------------------------------------

export const empty = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  position: 'relative',
});

export const emptyArt = style({
  position: 'relative',
  width: 206,
  height: 140,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: c.content.secondary,
  backgroundImage: `radial-gradient(${alpha('#000000', 18)} 1px, transparent 1px)`,
  backgroundSize: '10px 10px',
  maskImage: 'radial-gradient(ellipse at center, #000 45%, transparent 75%)',
  marginBottom: 32,
});

export const emptyTitle = style({ ...text.heading.small, color: c.content.primary, margin: '0 0 6px' });

export const emptyText = style({
  ...text.body.standard,
  color: c.content.secondary,
  maxWidth: 250,
  textAlign: 'center',
  margin: '0 0 16px',
});

export const learnMore = style({
  position: 'absolute',
  bottom: 20,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  width: 310,
});

export const learnLabel = style({ ...text.text12.standard, color: c.content.secondary });

export const academyCard = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 74,
  padding: 8,
  borderRadius: 14,
  border: `1px solid ${c.stroke.secondary}`,
  color: c.content.primary,
  textDecoration: 'none',
  ...text.body.standard,
  fontWeight: 500,
  transition: transitionColors,
  selectors: { '&:hover': { backgroundColor: c.surface.secondary } },
});

export const academyTile = style({
  width: 56,
  height: 56,
  borderRadius: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: c.surface.secondary,
  border: `1px solid ${c.stroke.primary}`,
  color: c.content.secondary,
});

export const searchBox = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  width: 220,
  padding: '0 8px',
  boxSizing: 'border-box',
  borderRadius: 8,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  backgroundColor: c.surface.primary,
});

export const searchInput = style({
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  fontFamily: 'inherit',
  ...text.body.standard,
  color: c.content.primary,
  '::placeholder': { color: c.content.tertiary },
});

export const filterButton = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 8px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  backgroundImage: 'none',
  outline: `1px dashed ${c.stroke.tertiary}`,
  outlineOffset: -1,
  color: c.content.secondary,
  fontFamily: 'inherit',
  cursor: 'pointer',
  ...text.body.standard,
  selectors: {
    '&[data-hovered], &[aria-expanded="true"]': { backgroundColor: c.interactive.secondaryHover },
    '&[data-active]': { outline: 'none', color: c.content.primary },
  },
});

export const divider = style({ width: 1, height: 16, background: c.stroke.secondary, margin: '0 4px' });
