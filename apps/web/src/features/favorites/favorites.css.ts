// Favourites: the star (filled yellow when on) and the sidebar section (B sidebar §6; evidence
// B/sidebar-favorites-dragging.png, sidebar-favorites-folder-menu.png): 28 px rows (radius 9), folder rows with an
// animated glyph, children indented 16 px, "No items", hover actions, drag placeholder, overlay and 2 px drop lines.
import { alpha, scales, text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style } from '@vanilla-extract/css';

const c = vars.color;
const ease = `${scales.duration.comfortable}ms ease`;

export const starOn = style({ color: c.utilities.surface.yellow });
globalStyle(`${starOn} svg`, { fill: 'currentColor' });
export const starOff = style({});

// ---- sidebar section ------------------------------------------------------------------------------------------------

export const list = style({ display: 'flex', flexDirection: 'column', gap: 1, position: 'relative' });

export const row = style({
  position: 'relative',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 4px 0 8px',
  borderRadius: 9,
  color: c.content.primary,
  cursor: 'pointer',
  outline: 'none',
  userSelect: 'none',
  textDecoration: 'none',
  ...text.body.standard,
  transition: `background-color ${ease}`,
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&[data-current]': { backgroundColor: c.interactive.ghostHover },
    '&:focus-visible': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
    '&[data-drop-folder]': { backgroundColor: alpha(c.surface.secondaryHover, 60) },
  },
});

export const indented = style({ paddingLeft: 24 });

export const rowIcon = style({ flex: 'none', color: c.content.secondary, display: 'inline-flex' });

export const label = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
  flex: '0 1 auto',
});

export const secondary = style({
  color: c.content.secondary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
  flex: '1 1 0',
});

export const rowSpacer = style({ flex: 1 });

export const action = style({
  flex: 'none',
  width: 0,
  overflow: 'hidden',
  opacity: 0,
  transition: `width ${ease}, opacity ${ease}`,
  selectors: {
    [`${row}:hover &, &:focus-within, &[data-open]`]: { width: 20, opacity: 1 },
  },
});

export const noItems = style({
  ...text.text12.standard,
  color: c.content.secondary,
  height: 20,
  display: 'flex',
  alignItems: 'center',
  paddingLeft: 30,
});

export const skeleton = style({ display: 'flex', alignItems: 'center', gap: 8, height: 28, padding: '0 8px' });

export const folderInput = style({
  flex: 1,
  minWidth: 0,
  height: 22,
  padding: '0 4px',
  border: 'none',
  borderRadius: 4,
  outline: 'none',
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  boxShadow: `inset 0 0 0 1px ${c.stroke.accent}`,
  ...text.body.standard,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});

export const placeholder = style({
  height: 28,
  borderRadius: 9,
  backgroundColor: alpha('#000000', 3.5),
});

export const overlay = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  width: 258,
  padding: '0 8px',
  borderRadius: 9,
  backgroundColor: c.surface.secondaryHover,
  color: c.content.primary,
  boxShadow: vars.elevation.e2,
  cursor: 'grabbing',
  ...text.body.standard,
});

export const overlayFolder = style({ boxShadow: `${vars.elevation.e2}, inset 0 0 0 1px ${c.stroke.accent}` });

export const dropLine = style({
  position: 'absolute',
  left: 8,
  right: 8,
  height: 2,
  marginTop: -1,
  borderRadius: 2,
  backgroundColor: c.stroke.accent,
  pointerEvents: 'none',
  zIndex: 1,
});

export const folderGlyph = style({ transition: `transform ${ease}` });
