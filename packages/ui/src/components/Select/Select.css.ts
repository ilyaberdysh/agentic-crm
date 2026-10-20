import { style, styleVariants } from '@vanilla-extract/css';
import { focusRing } from '../../theme/shared.css';
import { text } from '../../theme/text';
import { vars } from '../../theme/vars.css';
import { scales } from '../../tokens/scales.gen';

const c = vars.color;
const t = `${scales.duration.fast}ms ease-in-out`;

// Select trigger (components.md §3): ghost background, 1 px black-6 % border (default variant),
// hover/expanded black 2 %, focus border accent, error border critical; 80 ms ease-in-out.
export const trigger = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  minWidth: 0,
  margin: 0,
  border: '1px solid transparent',
  backgroundColor: c.interactive.ghost,
  color: c.content.primary,
  ...text.body.standard,
  fontFamily: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  outline: 'none',
  transition: `border-color ${t}, background-color ${t}`,
  selectors: {
    '&[data-hovered], &[aria-expanded="true"]': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&[data-disabled]': { opacity: 0.4, cursor: 'default' },
  },
});

export const triggerVariant = styleVariants({
  default: {
    borderColor: c.stroke.primaryTransparent,
    selectors: {
      '&[data-focus-visible], &[aria-expanded="true"]': { borderColor: c.stroke.accent },
      '[data-invalid] > &': { borderColor: c.stroke.critical },
    },
  },
  ghost: {
    selectors: { '&[data-focus-visible]': focusRing },
  },
});

// Height / radius / padding-left / padding-right / gap: 20 6 4 4 4 · 22 6 4 4 4 · 28 8 8 6 4 · 32 9 10 8 12 · 36 10 12 4 12
export const triggerSize = styleVariants({
  20: { height: 20, borderRadius: 6, paddingLeft: 4, paddingRight: 4, gap: 4, ...text.text12.standard },
  22: { height: 22, borderRadius: 6, paddingLeft: 4, paddingRight: 4, gap: 4 },
  28: { height: 28, borderRadius: 8, paddingLeft: 8, paddingRight: 6, gap: 4 },
  32: { height: 32, borderRadius: 9, paddingLeft: 10, paddingRight: 8, gap: 12 },
  36: { height: 36, borderRadius: 10, paddingLeft: 12, paddingRight: 4, gap: 12 },
});

export const value = style({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
  selectors: { '&[data-placeholder]': { color: c.content.tertiary } },
});

export const chevron = style({ color: c.content.secondary, flex: 'none' });

export const listBox = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  outline: 'none',
  overflow: 'auto',
  minHeight: 0,
});

export const searchableList = style({ maxHeight: 250 });

export const selectedItem = style({
  selectors: { '&[data-selected]': { backgroundColor: c.surface.primaryHover } },
});

export const comboControl = style({ cursor: 'text' });

export const comboButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  width: 20,
  height: 20,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: c.content.secondary,
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&[data-hovered]': { backgroundColor: c.interactive.ghostHover },
  },
});
