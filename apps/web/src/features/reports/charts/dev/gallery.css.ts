import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const page = style({
  boxSizing: 'border-box',
  padding: 24,
  backgroundColor: c.surface.primary,
  color: c.content.primary,
  ...text.body.standard,
});

export const intro = style({ margin: '0 0 16px', color: c.content.secondary });

export const columns = style({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' });

export const column = style({
  boxSizing: 'border-box',
  minWidth: 0,
  padding: 16,
  borderRadius: 16,
  border: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
  color: c.content.primary,
});

export const columnTitle = style({ margin: '0 0 12px', ...text.heading.small });

export const section = style({ margin: '0 0 28px' });
export const sectionTitle = style({
  margin: '0 0 8px',
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  ...text.body.strong,
  color: c.content.primary,
});
export const sectionId = style({ color: c.content.tertiary, ...text.text12.standard });

export const row = style({ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' });

export const canvasBox = style({
  position: 'relative',
  boxSizing: 'border-box',
  flex: '1 1 420px',
  minWidth: 0,
  height: 520,
  borderRadius: 12,
  border: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
});

export const cellBox = style({
  position: 'relative',
  boxSizing: 'border-box',
  flex: 'none',
  width: 385,
  height: 418,
  borderRadius: 12,
  border: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
});

export const single = style({
  position: 'relative',
  boxSizing: 'border-box',
  backgroundColor: c.surface.primary,
});

export const footer = style({ marginTop: 8 });
export const note = style({ margin: '6px 0 0', color: c.content.tertiary, ...text.text12.standard });

export const soloPage = style({ padding: 0, backgroundColor: c.surface.primary });
