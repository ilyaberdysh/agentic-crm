// "Read only" chip in object, list and record headers (BACKLOG 6.04 acceptance 2: read-only affordances).
import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const sharePanel = style({ padding: 16, maxHeight: 560, overflowY: 'auto' });

export const readOnly = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 20,
  padding: '0 6px',
  border: 'none',
  borderRadius: 6,
  backgroundColor: c.surface.tint,
  color: c.content.secondary,
  ...text.text12.standard,
  cursor: 'default',
  outline: 'none',
  selectors: { '&[data-focus-visible]': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` } },
});
