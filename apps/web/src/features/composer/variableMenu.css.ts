// Variable menu (274 × ≤ 378) and "Variable settings" popover (F composer §2.6).
import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const menu = style({
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  maxHeight: 370,
  overflowY: 'auto',
});

export const back = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 32,
  padding: '0 8px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: c.content.secondary,
  cursor: 'pointer',
  flex: 'none',
  ...text.body.standard,
  selectors: { '&[data-hovered]': { backgroundColor: c.surface.tertiary }, '&:focus-visible': { outline: 'none' } },
});
export const backTitle = style({ marginLeft: 'auto', color: c.content.primary, fontWeight: 500 });

export const count = style({ color: c.content.tertiary, ...text.text12.standard, fontSize: 12 });

export const settings = style({ display: 'flex', flexDirection: 'column', color: c.content.primary });
export const settingsTitle = style({ padding: '12px 16px 4px', ...text.body.standard, fontWeight: 500 });
export const settingsBody = style({ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 16px 16px' });
export const fallbackLabel = style({ ...text.text12.standard, fontSize: 12, color: c.content.secondary });
export const fallbackField = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 34,
  padding: '0 10px',
  borderRadius: 8,
  boxShadow: `inset 0 0 0 1px ${c.stroke.accent}, 0 0 0 3px ${c.stroke.accentSubtle}`,
});
export const fallbackIcon = style({ flex: 'none', color: c.content.secondary });
export const fallbackInput = style({
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});
export const settingsFooter = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 16px',
  borderTop: `1px solid ${c.stroke.primary}`,
});
export const changeButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  height: 32,
  padding: '0 10px',
  border: 'none',
  borderRadius: 8,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  background: c.surface.primary,
  color: c.content.primary,
  cursor: 'pointer',
  ...text.body.standard,
  fontWeight: 500,
  selectors: { '&[data-hovered]': { backgroundColor: c.surface.secondary } },
});
