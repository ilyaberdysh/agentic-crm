import { globalStyle, style } from '@vanilla-extract/css';
import { text } from '../../src/theme/text';
import { vars } from '../../src/theme/vars.css';

const c = vars.color;

globalStyle('html, body, #root', { minHeight: '100%' });

export const shell = style({ display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr)', minHeight: '100vh' });

export const nav = style({
  position: 'sticky',
  top: 0,
  alignSelf: 'start',
  height: '100vh',
  overflow: 'auto',
  padding: '16px 8px',
  boxSizing: 'border-box',
  backgroundColor: c.surface.secondary,
  borderRight: `1px solid ${c.stroke.primary}`,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
});

export const brand = style({ ...text.heading.small, color: c.content.primary, padding: '4px 8px 12px' });

export const main = style({ minWidth: 0, display: 'flex', flexDirection: 'column' });

export const topbar = style({
  position: 'sticky',
  top: 0,
  zIndex: 5,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  height: 48,
  padding: '0 24px',
  borderBottom: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
});

export const topbarTitle = style({ ...text.heading.extraSmall, color: c.content.primary, marginRight: 'auto' });

export const content = style({ padding: '24px 24px 96px', display: 'flex', flexDirection: 'column', gap: 48 });

export const section = style({ display: 'flex', flexDirection: 'column', gap: 16, scrollMarginTop: 64 });
export const sectionTitle = style({ ...text.heading.medium, color: c.content.primary });
export const sectionNote = style({ ...text.body.standard, color: c.content.secondary, maxWidth: 760 });

export const panels = style({ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 });

export const panel = style({
  minWidth: 0,
  padding: 20,
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  color: c.content.primary,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
});

export const panelSecondary = style({ backgroundColor: c.surface.secondary });

export const panelLabel = style({
  ...text.text11.standard,
  color: c.content.tertiary,
  textTransform: 'uppercase',
  letterSpacing: '0.02em',
});

export const row = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 });
export const rowTop = style({ alignItems: 'flex-start' });
export const col = style({ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 });
export const label = style({ ...text.text12.standard, color: c.content.tertiary, minWidth: 96 });

export const grid = style({ display: 'grid', gap: 8 });

export const swatch = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  ...text.text11.standard,
  color: c.content.secondary,
});

export const swatchChip = style({
  height: 32,
  borderRadius: 8,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primaryTransparent}`,
});

export const mono = style({ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 });

export const frameRoot = style({ position: 'absolute', top: 0, left: 0 });

export const refRow = style({ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' });
export const refImg = style({ display: 'block', borderRadius: 4, boxShadow: `0 0 0 1px ${c.stroke.primary}` });
