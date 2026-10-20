// AI record summary card on the Overview tab (D README §2.5 item 4): a rounded card with the summary text, a muted
// "Generated at …" line and a regenerate button; an empty state with Generate; an out-of-date hint.
import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const card = style({
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '12px 14px',
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
});
export const body = style({
  ...text.body.standard,
  fontWeight: 400,
  color: c.content.primary,
  margin: 0,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
});
export const meta = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  ...text.text12.standard,
  fontWeight: 400,
  color: c.content.tertiary,
});
export const stale = style({ color: c.content.warning });
export const muted = style({ ...text.body.standard, fontWeight: 400, color: c.content.secondary, margin: 0 });
export const empty = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 });
