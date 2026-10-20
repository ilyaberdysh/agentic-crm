import { style } from '@vanilla-extract/css';
import { insetRing } from '../../theme/helpers';
import { text } from '../../theme/text';
import { vars } from '../../theme/vars.css';
import { scales } from '../../tokens/scales.gen';

const c = vars.color;
const t = `${scales.duration.comfortable}ms ease`;

export const list = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
  margin: 0,
  padding: 0,
  listStyle: 'none',
});

export const item = style({ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 });

// Crumb: 24 px, radius 6, padding 2 4, gap 4, icon 16, Body.Standard; last crumb primary.
export const crumb = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 24,
  minWidth: 0,
  padding: '2px 4px',
  borderRadius: 6,
  color: c.content.secondary,
  ...text.body.standard,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  outline: 'none',
  transition: `background-color ${t}, box-shadow ${t}`,
  selectors: {
    '&[data-hovered]:not([data-current])': { backgroundColor: c.interactive.secondaryHover, cursor: 'pointer' },
    '&[data-current]': { color: c.content.primary },
    '&[data-focus-visible]': { boxShadow: insetRing(c.stroke.accent) },
    '&[data-disabled]:not([data-current])': { opacity: 0.4 },
  },
});

export const crumbText = style({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' });

// Separator: a 10 px vertical rule skewed −10° (reads as a slash).
export const separator = style({
  display: 'inline-block',
  flex: 'none',
  width: 1,
  height: 10,
  margin: '0 2px',
  backgroundColor: c.stroke.tertiary,
  transform: 'skewX(-10deg)',
});
