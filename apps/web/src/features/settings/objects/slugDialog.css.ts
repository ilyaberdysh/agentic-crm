// Type-to-confirm alert (components.md §7 AlertDialog metrics: 440 px, radius 12, e2, overlay 25 % / 55 %).
import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const overlay = style({
  position: 'fixed',
  inset: 0,
  zIndex: 10000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  boxSizing: 'border-box',
  backgroundColor: c.surface.overlay,
});

export const alert = style({
  boxSizing: 'border-box',
  width: 440,
  maxWidth: '100%',
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: vars.elevation.e2,
  color: c.content.primary,
  outline: 'none',
  overflow: 'hidden',
});

export const dialog = style({ display: 'flex', flexDirection: 'column', outline: 'none' });

export const body = style({ display: 'flex', flexDirection: 'column', gap: 4, padding: 16 });

export const title = style({ ...text.heading.medium, color: c.content.primary, margin: 0 });

export const description = style({ ...text.body.standard, color: c.content.secondary, margin: 0 });

export const phrase = style({ fontWeight: 600, color: c.content.secondary });

export const input = style({ marginTop: 12 });

export const footer = style({
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  padding: 8,
  borderTop: `1px solid ${c.stroke.primary}`,
});
