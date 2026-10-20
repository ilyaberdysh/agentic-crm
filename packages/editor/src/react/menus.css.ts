// Floating editor chrome: slash / insert menus, mention typeahead, selection toolbar, link popover
// Menu chrome uses an 80 ms side-aware scale and fade.
import { alpha, insetRing, text, vars } from '@agentic-crm/ui/styles';
import { keyframes, style } from '@vanilla-extract/css';

const c = vars.color;

const enter = keyframes({
  from: { opacity: 0, transform: 'scale(0.97) translateY(-1px)' },
  to: { opacity: 1, transform: 'scale(1) translateY(0)' },
});

const panelBase = {
  boxSizing: 'border-box',
  backgroundColor: c.surface.primary,
  boxShadow: vars.elevation.e2,
  color: c.content.primary,
  outline: 'none',
  zIndex: 2147483646,
  animation: `${enter} 80ms ease`,
  ...text.body.standard,
} as const;

/** Menu chrome: radius 12, e2. */
export const panel = style({
  ...panelBase,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  padding: 4,
  borderRadius: 12,
  overflowY: 'auto',
  maxHeight: 'min(420px, 60vh)',
  '@media': { '(prefers-reduced-motion: reduce)': { animation: 'none' } },
});

/** Slash / insert menu: 360 px, items with a 32 px icon tile, title and description (note-editor-slash-menu.png). */
export const insertPanel = style({ width: 360, padding: 8 });

export const insertItem = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 52,
  padding: '6px 8px',
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  textAlign: 'left',
  color: c.content.primary,
  cursor: 'pointer',
  userSelect: 'none',
  flexShrink: 0,
  font: 'inherit',
  selectors: {
    '&[data-active="true"]': { backgroundColor: c.surface.primaryHover },
  },
});

export const iconTile = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  width: 32,
  height: 32,
  borderRadius: 8,
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.primaryTransparent),
  color: c.content.primary,
});

export const itemText = style({ display: 'flex', flexDirection: 'column', minWidth: 0 });
export const itemTitle = style({ ...text.body.standard, color: c.content.primary });
export const itemDescription = style({ ...text.body.standard, color: c.content.secondary });

export const emptyResults = style({ ...text.body.standard, color: c.content.secondary, padding: '6px 8px' });

/** Insert menu search row ("Search items..."): hairline below, like the shared filter input. */
export const searchRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  margin: '-8px -8px 4px',
  padding: '12px 16px',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
  color: c.content.tertiary,
  flexShrink: 0,
});

export const searchInput = style({
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  padding: 0,
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});

/** The 22 px "+" button pinned at the bottom-left of a note window. */
export const insertButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  padding: 0,
  borderRadius: 6,
  border: 'none',
  backgroundColor: c.interactive.secondary,
  boxShadow: vars.elevation.e1,
  color: c.content.secondary,
  cursor: 'pointer',
  selectors: {
    '&:hover, &[data-open="true"]': { backgroundColor: c.interactive.secondaryHover, color: c.content.primary },
    '&:disabled': { opacity: 0.4, cursor: 'default' },
  },
});

// ---- mention typeahead (note-mention-typeahead.png) ------------------------------------------------------------
export const mentionPanel = style({ width: 300 });

export const groupLabel = style({
  ...text.text12.standard,
  color: c.content.secondary,
  padding: '6px 8px 4px',
  flexShrink: 0,
});

export const mentionOption = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 32,
  padding: '6px 8px',
  borderRadius: 8,
  cursor: 'pointer',
  userSelect: 'none',
  flexShrink: 0,
  selectors: {
    '&[data-active="true"]': { backgroundColor: c.surface.primaryHover },
  },
});

export const mentionName = style({
  flex: 'none',
  maxWidth: '70%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: c.content.primary,
});

export const mentionSecondary = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  ...text.body.small,
  color: c.content.secondary,
});

export const recordGlyph = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  width: 16,
  height: 16,
  borderRadius: 4,
  backgroundColor: c.surface.tertiary,
  boxShadow: insetRing(c.stroke.primaryTransparent),
  color: c.content.tertiary,
  selectors: { '&[data-shape="round"]': { borderRadius: '50%' } },
});

export const objectBadge = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  width: 16,
  height: 16,
  marginLeft: 'auto',
  borderRadius: 4,
  backgroundColor: c.utilities.surface.blue,
  color: '#ffffff',
});

// ---- selection toolbar (note-selection-toolbar.png: 32 px, radius 10, padding 2, buttons 28 px) ----------------
export const toolbar = style({
  ...panelBase,
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  height: 32,
  padding: 2,
  borderRadius: 10,
  userSelect: 'none',
});

export const toolbarDivider = style({
  width: 1,
  height: 20,
  margin: '0 2px',
  backgroundColor: c.stroke.primary,
  flex: 'none',
});

const toolbarButtonBase = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  height: 28,
  padding: '0 6px',
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  color: c.content.secondary,
  cursor: 'pointer',
  font: 'inherit',
  whiteSpace: 'nowrap',
  flex: 'none',
  transition: 'background-color 140ms ease, color 140ms ease',
} as const;

export const toolbarButton = style({
  ...toolbarButtonBase,
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHover, color: c.content.primary },
    '&[aria-pressed="true"]': { color: c.content.primary, backgroundColor: c.interactive.ghostHover },
    '&:focus-visible': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: -1 },
  },
});

export const toolbarIconButton = style([toolbarButton, { width: 30, padding: 0 }]);
export const swatchButton = style([toolbarButton, { width: 28, padding: 0 }]);

export const swatch = style({
  display: 'inline-block',
  width: 16,
  height: 16,
  borderRadius: '50%',
  flex: 'none',
});

/** The "no highlight" swatch: white rounded square with a red diagonal. */
export const noneSwatch = style({
  position: 'relative',
  display: 'inline-block',
  width: 16,
  height: 16,
  borderRadius: 4,
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.secondaryTransparent),
  flex: 'none',
  overflow: 'hidden',
  selectors: {
    '&::after': {
      content: '""',
      position: 'absolute',
      left: '50%',
      top: 3,
      width: 1.5,
      height: 10,
      backgroundColor: c.utilities.surface.red,
      transform: 'translateX(-50%) rotate(45deg)',
      borderRadius: 1,
    },
  },
});

export const linkForm = style({ display: 'flex', alignItems: 'center', gap: 2, width: 278 });

export const linkInput = style({
  flex: 1,
  minWidth: 0,
  height: 28,
  padding: '0 6px',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});

export const linkError = style({
  ...text.text12.standard,
  color: c.content.critical,
  padding: '0 6px',
  whiteSpace: 'nowrap',
});

// ---- link popover (Open / Edit / Unlink) -----------------------------------------------------------------------
export const linkPopover = style({
  ...panelBase,
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: 2,
  borderRadius: 10,
  maxWidth: 420,
});

export const linkHref = style({
  ...text.body.small,
  color: c.content.secondary,
  padding: '0 6px',
  maxWidth: 220,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

// ---- presence avatars (PresenceAvatarStack) ---------------------------------------------------
export const presenceStack = style({ display: 'inline-flex', alignItems: 'center', flexDirection: 'row' });
export const presenceItem = style({
  display: 'inline-flex',
  borderRadius: '50%',
  boxShadow: `0 0 0 2px ${c.surface.primary}`,
  selectors: { '& + &': { marginLeft: -6 } },
});
export const presenceMore = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 20,
  height: 20,
  marginLeft: -6,
  padding: '0 4px',
  borderRadius: 10,
  backgroundColor: c.utilities.surface.greySubtle,
  boxShadow: `0 0 0 2px ${c.surface.primary}, ${insetRing(alpha(c.content.primary, 8))}`,
  color: c.content.secondary,
  ...text.text11.standard,
});
