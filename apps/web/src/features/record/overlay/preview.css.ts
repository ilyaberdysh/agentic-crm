// Record preview drawer (D README §2.7; evidence D-view-preview-panel): fixed, 8 px from the top / right / bottom,
// ~496 px wide, rounded and elevated; header 48 px; body padding 0 12 with Overview sections 24 apart.
import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const panel = style({
  position: 'fixed',
  top: 8,
  right: 8,
  bottom: 8,
  width: 496,
  maxWidth: 'calc(100vw - 16px)',
  zIndex: 40,
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}, ${vars.elevation.e3}`,
  overflow: 'hidden',
});

export const bar = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 48,
  padding: '0 12px 0 10px',
});

export const position = style({
  flex: 1,
  minWidth: 0,
  marginLeft: 4,
  ...text.text12.standard,
  color: c.content.secondary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const body = style({ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 0 16px' });

export const titleRow = style({ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px 26px' });

export const title = style({
  ...text.heading.medium,
  color: c.content.primary,
  margin: 0,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const sections = style({ display: 'flex', flexDirection: 'column', gap: 24, padding: '0 12px' });
