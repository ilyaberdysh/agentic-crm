// Contributing data modal: toolbar (Sort, Filter) over a table that fills a 600 px panel.
import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const title = style({ display: 'inline-flex', alignItems: 'center', gap: 8 });

export const body = style({
  display: 'flex',
  flexDirection: 'column',
  height: 'min(600px, 80vh)',
  minHeight: 0,
  backgroundColor: c.surface.primary,
});

export const toolbar = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 49,
  boxSizing: 'border-box',
  padding: '0 12px',
  borderBottom: `1px solid ${c.stroke.primary}`,
  ...text.body.standard,
});

export const table = style({ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' });

export const center = style({ flex: 1, display: 'grid', placeItems: 'center' });
