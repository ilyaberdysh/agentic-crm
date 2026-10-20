// Style fragments shared by several primitives.
import { style } from '@vanilla-extract/css';
import { scales } from '../tokens/scales.gen';
import { popoverMotion } from './motion.css';
import { text } from './text';
import { vars } from './vars.css';

const { duration } = scales;

/** Buttons: `outline: 1px solid stroke.accent; outline-offset: 1px`. */
export const focusRing = {
  outline: `1px solid ${vars.color.stroke.accent}`,
  outlineOffset: 1,
} as const;

export const visuallyHidden = style({
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
});

/**
 * Menu / popover / dropdown chrome: elevated surface, e2, radius 12,
 * padding 4, items stacked with a 1 px gap, 80 ms side-aware entrance.
 */
export const floatingPanel = style([
  popoverMotion,
  {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    padding: 4,
    borderRadius: 12,
    backgroundColor: vars.color.surface.primary,
    boxShadow: vars.elevation.e2,
    color: vars.color.content.primary,
    outline: 'none',
    overflow: 'auto',
    maxHeight: 'var(--ar-panel-max-height, min(480px, var(--visual-viewport-height, 100vh)))',
    ...text.body.standard,
  },
]);

/** Menu item / list option (32 px, padding 6 8, radius 8, gap 6). */
export const listItem = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 32,
  padding: '6px 8px',
  borderRadius: 8,
  color: vars.color.content.primary,
  cursor: 'default',
  outline: 'none',
  userSelect: 'none',
  flexShrink: 0,
  ...text.body.standard,
  selectors: {
    '&[data-focused], &[data-focus-visible], &[data-open]': { backgroundColor: vars.color.surface.primaryHover },
    '&[data-disabled]': { opacity: 0.4 },
  },
});

export const listItemLabel = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const listItemDescription = style({
  ...text.text12.standard,
  color: vars.color.content.secondary,
});

/** 1 px rule with 3 px vertical margin (menus). */
export const menuSeparator = style({
  height: 1,
  margin: '3px 0',
  border: 'none',
  backgroundColor: vars.color.stroke.primary,
  flexShrink: 0,
});

/** Section label: text12 secondary, padding 2 8. */
export const menuLabel = style({
  ...text.text12.standard,
  color: vars.color.content.secondary,
  padding: '2px 8px',
  minHeight: 20,
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
});

export const transitionColors = `background-color ${duration.breezy}ms ease, color ${duration.breezy}ms ease, box-shadow ${duration.breezy}ms ease`;
