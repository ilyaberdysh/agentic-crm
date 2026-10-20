// Quick actions and search frame:
// 748 px frame (the `palette` Modal size) with an input row, a results list (≈ 370 px) and a preview pane (≈ 360 px),
// a footer with "↑ ↓ Navigate" and the primary gesture button.
import { text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style, styleVariants } from '@vanilla-extract/css';

const c = vars.color;
const u = vars.color.utilities;

// ---- frame -------------------------------------------------------------------------------------------------------

/** Root and Search pages: fixed 542 px inner height (frame 548 at 945 px), at most 75 vh. */
export const panelTall = style({ height: 542, maxHeight: '75vh', minHeight: 0 });
/** Single-pane pages (Note templates…): as tall as their content, up to the same limit. */
export const panelAuto = style({ maxHeight: 'min(542px, 75vh)', minHeight: 0 });

export const body = style({ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 });

// Header of pushed pages: back chevron, breadcrumbs ("Quick actions / Note templates"), close.
export const header = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 44,
  padding: '0 12px',
});

export const crumbs = style({ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 });

export const crumb = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  padding: 0,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  color: c.content.secondary,
  ...text.body.standard,
  outline: 'none',
  selectors: {
    '&[data-current]': { color: c.content.primary, cursor: 'default' },
    '&[data-focus-visible]': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 2, borderRadius: 4 },
  },
});

export const crumbIcon = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  borderRadius: 6,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primaryTransparent}`,
  flex: 'none',
});

export const crumbSlash = style({ color: c.content.tertiary, ...text.body.standard });

// Input row: 16/20 500, no field border, a divider below.
export const inputRow = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  boxSizing: 'border-box',
  height: 51,
  padding: '0 16px',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
});

/** Under a pushed page's header the text sits higher in its row (the capture: 20 px below the header). */
export const inputRowPushed = style({ alignItems: 'flex-start', paddingTop: 10 });

export const input = style({
  flex: 1,
  minWidth: 0,
  height: 28,
  padding: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  fontSize: 16,
  lineHeight: '20px',
  fontWeight: 500,
  letterSpacing: '-0.005em',
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});

export const spinner = style({ flex: 'none', color: c.content.tertiary });

// Two panes.
export const panes = style({ display: 'flex', flex: 1, minHeight: 0 });

export const listPane = style({
  boxSizing: 'border-box',
  flex: '0 0 auto',
  width: 380,
  minHeight: 0,
  borderRight: `1px solid ${c.stroke.primary}`,
  display: 'flex',
  flexDirection: 'column',
});
export const listPaneSingle = style({ width: '100%', borderRight: 'none' });

export const list = style({
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '2px 10px 10px',
  scrollbarWidth: 'thin',
  scrollbarColor: `${c.stroke.tertiary} transparent`,
  display: 'flex',
  flexDirection: 'column',
});

export const sectionHeader = style({
  ...text.text12.standard,
  fontWeight: 500,
  color: c.content.secondary,
  height: 24,
  display: 'flex',
  alignItems: 'center',
  padding: '0 6px',
  // Row centre → next header centre 42 px; header centre → next row centre 36 px (the captures).
  margin: '11px 0 6px',
  flex: 'none',
});

export const option = style({
  boxSizing: 'border-box',
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 36,
  marginBottom: 1,
  padding: '0 6px',
  borderRadius: 12,
  cursor: 'pointer',
  color: c.content.primary,
  ...text.body.standard,
  selectors: {
    '&[data-highlighted]': { backgroundColor: c.surface.tertiary },
  },
});

export const optionIcon = style({
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  borderRadius: 6,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primaryTransparent}`,
  color: c.content.secondary,
  overflow: 'hidden',
});

/** Tiles that carry their own fill (object tiles, avatars) have no outline. */
export const optionIconPlain = style({ boxShadow: 'none', borderRadius: 0, overflow: 'visible' });

export const optionTitle = style({
  minWidth: 0,
  flex: '0 1 auto',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const optionSecondary = style({
  minWidth: 0,
  flex: '1 1 0',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  ...text.text12.standard,
  fontWeight: 400,
  color: c.content.tertiary,
});

export const optionTrailing = style({
  marginLeft: 'auto',
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
});
export const optionSpacer = style({ flex: 1 });

export const external = style({ color: c.content.tertiary, flex: 'none' });

/** Coloured object / favorite chip at the end of a record row. */
export const chip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 20,
  padding: '0 6px 0 4px',
  borderRadius: 6,
  ...text.text12.standard,
  fontWeight: 500,
  flex: 'none',
  whiteSpace: 'nowrap',
});

type Hue = 'blue' | 'cyan' | 'orange' | 'purple' | 'grey' | 'yellow' | 'green' | 'pink' | 'red';
const chipHue = (hue: Hue) => ({
  backgroundColor: u.surface[`${hue}Subtle` as const],
  color: u.content[`on${hue.charAt(0).toUpperCase()}${hue.slice(1)}Subtle` as 'onBlueSubtle'],
});
export const chipVariant = styleVariants({
  blue: chipHue('blue'),
  cyan: chipHue('cyan'),
  orange: chipHue('orange'),
  purple: chipHue('purple'),
  grey: chipHue('grey'),
  yellow: chipHue('yellow'),
  green: chipHue('green'),
  pink: chipHue('pink'),
  red: chipHue('red'),
});

export const emptyList = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  padding: 24,
  textAlign: 'center',
  color: c.content.secondary,
});
export const emptyTitle = style({ ...text.body.standard, color: c.content.primary });
export const emptyBody = style({ ...text.body.standard, fontWeight: 400, color: c.content.secondary });

// ---- preview pane --------------------------------------------------------------------------------------------------

export const preview = style({
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
});

export const previewHeader = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 45,
  boxSizing: 'border-box',
  padding: '0 12px',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
  ...text.body.standard,
});

export const previewTitle = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: c.content.primary,
});

export const previewLink = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  color: c.content.primary,
  textDecoration: 'none',
  selectors: { '&:hover': { textDecoration: 'underline' } },
});

export const statusChip = style({
  marginLeft: 'auto',
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 20,
  padding: '0 6px 0 4px',
  borderRadius: 6,
  backgroundColor: c.surface.tint,
  color: c.content.secondary,
  ...text.text12.standard,
  fontWeight: 500,
  whiteSpace: 'nowrap',
});

export const previewSection = style({
  flex: 'none',
  display: 'flex',
  flexDirection: 'column',
  padding: '17px 12px 13px',
  selectors: { '& + &': { boxShadow: `inset 0 1px 0 ${c.stroke.primary}` } },
});

export const previewLabel = style({
  ...text.text12.standard,
  fontWeight: 500,
  color: c.content.secondary,
  margin: '0 0 5px',
  height: 16,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
});

export const countBadge = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 16,
  height: 16,
  padding: '0 4px',
  borderRadius: 6,
  boxSizing: 'border-box',
  backgroundColor: c.surface.tint,
  color: c.content.secondary,
  fontSize: 11,
  fontWeight: 500,
});

export const factRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 26,
  ...text.body.standard,
  color: c.content.primary,
  minWidth: 0,
});
export const factIcon = style({ color: c.content.secondary, flex: 'none' });
export const factText = style({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
export const factLink = style({
  color: c.content.accent,
  textDecoration: 'none',
  selectors: { '&:hover': { textDecoration: 'underline' } },
});

export const viewRow = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 32,
  padding: '0 8px 0 4px',
  width: '100%',
  border: 'none',
  borderRadius: 10,
  backgroundColor: c.surface.tertiary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  cursor: 'pointer',
  color: c.content.primary,
  textAlign: 'left',
  outline: 'none',
  ...text.body.standard,
  selectors: {
    '& + &': { marginTop: 6 },
    '&[data-hovered]': { backgroundColor: c.surface.tertiaryHover },
    '&[data-focus-visible]': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
  },
});

export const viewTile = style({
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  borderRadius: 6,
  backgroundColor: u.surface.green,
  color: u.content.onGreen,
});

export const previewPlaceholder = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: 24,
  textAlign: 'center',
  color: c.content.tertiary,
  ...text.body.standard,
});

// ---- footer --------------------------------------------------------------------------------------------------------

export const footer = style({
  position: 'relative',
  flex: 'none',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  height: 46,
  padding: '0 8px 0 12px',
  boxShadow: `inset 0 1px 0 ${c.stroke.primary}`,
});

export const hint = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  ...text.text12.standard,
  fontWeight: 400,
  color: c.content.secondary,
});
export const hintCaps = style({ display: 'inline-flex', gap: 2 });
export const hintCap = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 18,
  height: 18,
  borderRadius: 5,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primaryTransparent}`,
  color: c.content.tertiary,
});

export const footerActions = style({ display: 'inline-flex', alignItems: 'center', gap: 8 });

// ---- record actions menu (anchored above the footer) ---------------------------------------------------------------

export const menuAnchor = style({ position: 'relative', display: 'inline-flex' });

export const menu = style({
  position: 'absolute',
  right: -2,
  bottom: 'calc(100% + 13px)',
  zIndex: 2,
  minWidth: 252,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  padding: 4,
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primaryTransparent}, ${vars.elevation.e2}`,
});

export const menuItem = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  height: 33,
  padding: '0 8px',
  borderRadius: 8,
  cursor: 'pointer',
  color: c.content.primary,
  ...text.body.standard,
  selectors: { '&[data-highlighted]': { backgroundColor: c.surface.tertiary } },
});

globalStyle(`${menuItem} kbd`, { alignItems: 'center' });
