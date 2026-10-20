import { style, styleVariants } from '@vanilla-extract/css';
import { insetRing } from '../../theme/helpers';
import { focusRing } from '../../theme/shared.css';
import { text } from '../../theme/text';
import { vars } from '../../theme/vars.css';

const c = vars.color;

export const root = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  color: c.content.primary,
  ...text.body.standard,
  cursor: 'pointer',
  outline: 'none',
  WebkitTapHighlightColor: 'transparent',
  selectors: {
    '&[data-disabled]': { opacity: 0.4, cursor: 'default' },
  },
});

// Checkbox (components.md §3): 1 px black-9 % border on surface.primary; checked = accent fill
// with an accent border and a white 1.5 px check revealed by a circular clip-path (200 ms ease-in).
export const box = style({
  boxSizing: 'border-box',
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  border: `1px solid ${c.stroke.secondaryTransparent}`,
  backgroundColor: c.surface.primary,
  color: c.content.onAccent,
  transition: 'border-color 200ms ease-in-out, background-color 200ms ease-in-out',
  selectors: {
    [`${root}[data-hovered] &`]: { backgroundColor: c.interactive.secondaryHover },
    [`${root}[data-selected] &, ${root}[data-indeterminate] &`]: {
      backgroundColor: c.surface.accent,
      borderColor: c.stroke.accent,
    },
    [`${root}[data-hovered][data-selected] &, ${root}[data-hovered][data-indeterminate] &`]: {
      backgroundColor: c.interactive.primaryHover,
      borderColor: c.interactive.primaryHover,
    },
    [`${root}[data-focus-visible] &`]: focusRing,
    [`${root}[data-invalid] &`]: { borderColor: c.content.critical },
  },
});

export const boxSize = styleVariants({
  16: { width: 16, height: 16, borderRadius: 6 },
  20: { width: 20, height: 20, borderRadius: 8 },
});

export const round = style({ borderRadius: 16 });

export const mark = style({
  display: 'block',
  clipPath: 'circle(0% at 50% 50%)',
  transition: 'clip-path 200ms ease-in',
  selectors: {
    [`${root}[data-selected] &, ${root}[data-indeterminate] &`]: { clipPath: 'circle(100% at 50% 50%)' },
  },
});

// Radio (components.md §3): inset ring when off; accent with a white dot when on.
export const radioGroup = style({ display: 'flex', flexDirection: 'column', gap: 8 });
export const radioGroupHorizontal = style({ flexDirection: 'row', gap: 16 });

export const radio = style({
  boxSizing: 'border-box',
  position: 'relative',
  flex: 'none',
  borderRadius: '50%',
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.secondaryTransparent),
  transition: 'background-color 200ms ease, box-shadow 200ms ease',
  selectors: {
    [`${root}[data-hovered] &`]: { backgroundColor: c.interactive.secondaryHover },
    [`${root}[data-selected] &`]: { backgroundColor: c.surface.accent, boxShadow: 'none' },
    [`${root}[data-hovered][data-selected] &`]: { backgroundColor: c.interactive.primaryHover },
    [`${root}[data-focus-visible] &`]: { boxShadow: `0 0 0 2px ${c.stroke.accent}` },
    '&::after': {
      content: '""',
      position: 'absolute',
      inset: 0,
      margin: 'auto',
      borderRadius: '50%',
      backgroundColor: c.content.onAccent,
      transform: 'scale(0)',
      transition: 'transform 200ms ease',
    },
    [`${root}[data-selected] &::after`]: { transform: 'scale(1)' },
  },
});

export const radioSize = styleVariants({
  16: { width: 16, height: 16, selectors: { '&::after': { width: 6, height: 6 } } },
  20: { width: 20, height: 20, selectors: { '&::after': { width: 8, height: 8 } } },
});

// Switch (components.md §3).
export const track = style({
  boxSizing: 'border-box',
  position: 'relative',
  flex: 'none',
  borderRadius: 16,
  backgroundColor: c.stroke.secondaryTransparent,
  transition: 'background-color 200ms ease',
  selectors: {
    [`${root}[data-selected] &`]: { backgroundColor: c.interactive.primary },
    [`${root}[data-hovered][data-selected] &`]: { backgroundColor: c.interactive.primaryHover },
    [`${root}[data-focus-visible] &`]: focusRing,
  },
});

export const thumb = style({
  position: 'absolute',
  left: 0,
  borderRadius: '50%',
  backgroundColor: c.content.onAccent,
  boxShadow: insetRing(c.stroke.tertiary),
  transition: 'transform 200ms ease, box-shadow 200ms ease',
  selectors: {
    [`${root}[data-selected] &`]: { boxShadow: 'none' },
  },
});

// Track 24×16 / 30×20 / 36×24; thumb 12 / 16 / 19; x 2→10 / 2→12 / 2.5→15.5.
export const trackSize = styleVariants({
  16: { width: 24, height: 16 },
  20: { width: 30, height: 20 },
  24: { width: 36, height: 24 },
});

export const thumbSize = styleVariants({
  16: {
    width: 12,
    height: 12,
    top: 2,
    transform: 'translateX(2px)',
    selectors: { [`${root}[data-selected] &`]: { transform: 'translateX(10px)' } },
  },
  20: {
    width: 16,
    height: 16,
    top: 2,
    transform: 'translateX(2px)',
    selectors: { [`${root}[data-selected] &`]: { transform: 'translateX(12px)' } },
  },
  24: {
    width: 19,
    height: 19,
    top: 2.5,
    transform: 'translateX(2.5px)',
    selectors: { [`${root}[data-selected] &`]: { transform: 'translateX(15.5px)' } },
  },
});
