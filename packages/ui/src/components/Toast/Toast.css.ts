import { globalStyle, style, styleVariants } from '@vanilla-extract/css';
import { insetRing } from '../../theme/helpers';
import { focusRing } from '../../theme/shared.css';
import { text } from '../../theme/text';
import { vars } from '../../theme/vars.css';
import { scales } from '../../tokens/scales.gen';

const c = vars.color;
const u = c.utilities;

// Viewport: top-right, inset 16 (8 at ≤ 520 px), above everything.
export const viewport = style({
  position: 'fixed',
  top: 16,
  right: 16,
  zIndex: scales.zIndex.toast,
  width: 350,
  maxWidth: 'calc(100vw - 32px)',
  margin: 0,
  padding: 0,
  listStyle: 'none',
  outline: 'none',
  pointerEvents: 'none',
  '@media': {
    'screen and (max-width: 520px)': { top: 8, right: 8, maxWidth: 'calc(100vw - 16px)' },
  },
});

export const item = style({
  position: 'absolute',
  top: 0,
  right: 0,
  pointerEvents: 'auto',
  transformOrigin: '50% 0%',
  touchAction: 'pan-y',
  borderRadius: 8,
});

// Card (components.md §7): min 300 / max 350, radius 8, padding 10, e2, elevated surface.
export const card = style({
  boxSizing: 'border-box',
  position: 'relative',
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  minWidth: 300,
  maxWidth: 350,
  width: 'max-content',
  padding: 10,
  borderRadius: 8,
  backgroundColor: c.surface.primary,
  boxShadow: vars.elevation.e2,
  color: c.content.primary,
  overflow: 'hidden',
  ...text.body.standard,
  '@media': {
    'screen and (max-width: 520px)': { minWidth: 0, width: '100%' },
  },
});

/** Inside the stack the card fills its (height-animated) slot. */
export const cardFill = style({ height: '100%' });

export const cardForced = style({ width: '100%', minWidth: 0, maxWidth: 'none' });

/** Stacked behind the front toast: content hidden, card chrome kept. */
export const contentHidden = style({});
globalStyle(`${card} > *`, { transition: 'opacity 0.4s ease' });
globalStyle(`${contentHidden} > *`, { opacity: 0 });

export const content = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  flex: 1,
  minWidth: 0,
});

export const iconBox = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  width: 20,
  height: 20,
  borderRadius: 6,
});

export const iconTone = styleVariants({
  neutral: { backgroundColor: u.surface.greySubtle, boxShadow: insetRing(u.stroke.grey), color: u.content.grey },
  success: { backgroundColor: c.surface.success, boxShadow: insetRing(c.stroke.success), color: c.content.success },
  warning: { backgroundColor: c.surface.warning, boxShadow: insetRing(c.stroke.warning), color: c.content.warning },
  error: { backgroundColor: c.surface.critical, boxShadow: insetRing(c.stroke.critical), color: c.content.critical },
});

export const textBlock = style({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  maxWidth: 236,
});

export const title = style({ ...text.body.standard, color: c.content.primary, overflowWrap: 'anywhere' });
export const description = style({ ...text.body.standard, color: c.content.secondary, overflowWrap: 'anywhere' });

export const actionLink = style({
  alignSelf: 'flex-start',
  margin: '2px 0 0',
  padding: 0,
  border: 'none',
  background: 'none',
  ...text.text12.standard,
  color: c.content.primary,
  textDecoration: 'underline',
  textDecorationColor: c.stroke.secondaryTransparent,
  textUnderlineOffset: '0.14em',
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&[data-hovered]': { textDecorationColor: 'currentColor' },
    '&[data-focus-visible]': focusRing,
  },
});

export const actionButton = style({ marginTop: 6, alignSelf: 'flex-start' });

export const close = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  width: 18,
  height: 18,
  marginTop: 1,
  padding: 0,
  border: 'none',
  borderRadius: '50%',
  background: 'transparent',
  color: c.content.secondary,
  cursor: 'pointer',
  outline: 'none',
  transition: `background-color ${scales.duration.breezy}ms ease, color ${scales.duration.breezy}ms ease`,
  selectors: {
    '&[data-hovered]': { backgroundColor: c.interactive.ghostHover, color: c.content.primary },
    '&[data-focus-visible]': focusRing,
  },
});

export const progressTrack = style({
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  height: 2,
  backgroundColor: c.surface.tint,
});

export const progressFill = style({
  height: '100%',
  backgroundColor: c.surface.accent,
  transition: 'width 0.4s ease',
});
