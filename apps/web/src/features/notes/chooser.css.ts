// "Choose record" dialog: system-ui modal frame with an "↑ ↓ Navigate" footer.
import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const root = style({ display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: 'min(560px, 70vh)' });

export const searchRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 48,
  padding: '0 16px',
  borderBottom: `1px solid ${c.stroke.primary}`,
  flex: 'none',
});

export const searchIcon = style({ color: c.content.secondary, flex: 'none' });

export const searchInput = style({
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  fontSize: 15,
  lineHeight: '20px',
  fontWeight: 500,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});

export const list = style({
  flex: 1,
  minHeight: 120,
  overflowY: 'auto',
  padding: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
});

export const label = style({ ...text.text12.standard, color: c.content.secondary, padding: '8px 8px 4px' });

export const option = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 36,
  padding: '0 10px',
  borderRadius: 10,
  color: c.content.primary,
  cursor: 'pointer',
  ...text.body.standard,
  selectors: {
    '&[data-active]': { backgroundColor: c.surface.primaryHover, boxShadow: `inset 0 0 0 1px ${c.stroke.primary}` },
  },
});

export const optionTitle = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });
export const optionSecondary = style({
  color: c.content.tertiary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
});
export const optionObject = style({
  marginLeft: 'auto',
  flex: 'none',
  color: c.content.secondary,
  ...text.text12.standard,
});

export const createIcon = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  borderRadius: 6,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primaryTransparent}`,
  color: c.content.secondary,
  flex: 'none',
});

export const footer = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: 8,
  borderTop: `1px solid ${c.stroke.primary}`,
});

export const hint = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  ...text.text12.standard,
  color: c.content.secondary,
  paddingLeft: 4,
});
