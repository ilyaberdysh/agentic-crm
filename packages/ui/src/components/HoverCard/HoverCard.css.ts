import { style } from '@vanilla-extract/css';
import { text } from '../../theme/text';
import { vars } from '../../theme/vars.css';

const c = vars.color;

export const card = style({
  boxSizing: 'border-box',
  maxWidth: 'calc(100vw - 64px)',
  padding: 12,
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: vars.elevation.e2,
  color: c.content.primary,
  outline: 'none',
  ...text.body.standard,
});

export const tooltip = style({
  backgroundColor: c.surface.floating,
  color: c.content.floatingPrimary,
  boxShadow: vars.elevation.e1,
});
