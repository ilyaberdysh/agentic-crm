// Share popover and Permissions tab rows.
import { insetRing, text, transitionColors, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const popover = style({ display: 'flex', flexDirection: 'column', padding: '4px 0' });
export const loading = style({ padding: 20, display: 'flex', justifyContent: 'center' });
export const divider = style({ height: 1, backgroundColor: c.stroke.primary, margin: '4px 0' });

export const workspaceRow = style({ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px' });
export const rowText = style({ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' });
export const rowTitle = style({ ...text.body.standard, fontWeight: 500, color: c.content.primary });
export const rowSub = style({ ...text.text12.standard, color: c.content.secondary });

export const addBlock = style({ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 12px' });
export const addRow = style({ display: 'flex', alignItems: 'center', gap: 8 });
export const search = style({
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  height: 32,
  paddingLeft: 8,
  borderRadius: 8,
  boxShadow: insetRing(c.stroke.secondary),
});
export const searchInput = style({
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  fontFamily: 'inherit',
  ...text.body.standard,
  color: c.content.primary,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});
export const suggestions = style({ display: 'flex', flexDirection: 'column', gap: 1, paddingTop: 2 });
export const suggestion = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 30,
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
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHover } },
});

export const sectionLabel = style({ ...text.text12.standard, color: c.content.secondary, padding: '8px 12px 2px' });

export const memberRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 8px 4px 12px',
  minHeight: 36,
});
export const memberName = style({
  ...text.body.standard,
  fontWeight: 500,
  color: c.content.primary,
  whiteSpace: 'nowrap',
});
export const memberEmail = style({
  ...text.text12.standard,
  color: c.content.secondary,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const footer = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 12px',
  ...text.body.standard,
  color: c.content.secondary,
  textDecoration: 'none',
  selectors: { '&:hover': { color: c.content.primary } },
});
