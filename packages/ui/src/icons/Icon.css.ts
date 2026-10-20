import { style } from '@vanilla-extract/css';

// the UI uses `flex: none; transform: translate(0)` — never shrinks, own compositing layer.
export const iconBase = style({
  flex: 'none',
  display: 'block',
  transform: 'translate(0)',
});
