import { vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const art = style({
  position: 'relative',
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: c.stroke.tertiary,
  backgroundImage: `radial-gradient(${c.stroke.primary} 1px, transparent 1.2px)`,
  backgroundSize: '6px 6px',
});

// A crosshair: two 9 px hairlines meeting at the corner of the square.
export const mark = style({
  position: 'absolute',
  width: 9,
  height: 9,
  selectors: {
    '&::before, &::after': { content: '""', position: 'absolute', backgroundColor: c.stroke.secondary },
    '&::before': { left: 4, top: 0, width: 1, height: 9 },
    '&::after': { left: 0, top: 4, width: 9, height: 1 },
  },
});
export const markTopLeft = style({ top: -4, left: -4 });
export const markTopRight = style({ top: -4, right: -4 });
export const markBottomLeft = style({ bottom: -4, left: -4 });
export const markBottomRight = style({ bottom: -4, right: -4 });
