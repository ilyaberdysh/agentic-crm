// Select workflow dialog (README §3.8): ⌘K-style panel — search row, grouped options, footer key hints.
import { text, transitionColors, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const root = style({ display: 'flex', flexDirection: 'column', maxHeight: 460 });
export const search = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 48,
  padding: '0 16px',
  borderBottom: `1px solid ${c.stroke.primary}`,
  color: c.content.secondary,
});
export const input = style({
  flex: 1,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  fontFamily: 'inherit',
  ...text.body.large,
  color: c.content.primary,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});
export const list = style({ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 8px 8px' });
export const groupLabel = style({ ...text.text12.standard, color: c.content.secondary, padding: '10px 8px 4px' });
export const item = style({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  height: 40,
  padding: '0 8px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  fontFamily: 'inherit',
  ...text.body.standard,
  color: c.content.primary,
  textAlign: 'left',
  cursor: 'pointer',
  transition: transitionColors,
  selectors: { '&[data-active]': { backgroundColor: c.interactive.ghostHover } },
});
export const empty = style({ padding: '8px 8px 4px', ...text.body.standard, color: c.content.tertiary });
export const footer = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: 40,
  padding: '0 12px',
  borderTop: `1px solid ${c.stroke.primary}`,
});
export const hint = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  ...text.text12.standard,
  color: c.content.secondary,
});
