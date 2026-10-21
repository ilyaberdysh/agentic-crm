// Home: a centred column, max 716 px, padding 0 24 56; blocks 40 px apart.
import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const column = style({
  boxSizing: 'border-box',
  width: '100%',
  maxWidth: 764,
  margin: '0 auto',
  padding: '0 24px 56px',
  display: 'flex',
  flexDirection: 'column',
  gap: 40,
});

export const greeting = style({
  ...text.heading.standard,
  fontSize: 20,
  lineHeight: '24px',
  fontWeight: 600,
  letterSpacing: '-0.4px',
  color: c.content.primary,
  margin: '48px 0 -16px',
  padding: '0 8px',
});

// ---- blocks -------------------------------------------------------------------------------------------------------------

export const block = style({ display: 'flex', flexDirection: 'column', gap: 4 });

export const blockHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 28,
  padding: '0 7px 0 8px',
});

export const blockTitle = style({ ...text.body.standard, color: c.content.secondary, margin: 0 });
export const blockCount = style({ ...text.body.standard, fontWeight: 400, color: c.content.tertiary });
export const blockActions = style({ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 });
export const viewAll = style({
  ...text.text12.standard,
  color: c.content.secondary,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  padding: '2px 6px',
  borderRadius: 6,
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHover, color: c.content.primary } },
});

export const placeholderCard = style({
  boxSizing: 'border-box',
  padding: '12px 14px',
  borderRadius: 12,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  ...text.body.standard,
  fontWeight: 400,
  color: c.content.secondary,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
});
export const placeholderTitle = style({ color: c.content.primary, fontWeight: 500 });

// ---- task / record rows -------------------------------------------------------------------------------------------------

export const rows = style({ display: 'flex', flexDirection: 'column', gap: 0 });

export const row = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  height: 36,
  padding: '2px 8px',
  border: 'none',
  borderRadius: 10,
  background: 'transparent',
  textAlign: 'left',
  color: c.content.primary,
  cursor: 'pointer',
  outline: 'none',
  transition: 'opacity 200ms ease, background-color 120ms ease',
  ...text.body.standard,
  selectors: {
    '&:hover, &:focus-visible': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&:focus-visible': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
    '&[data-done]': { opacity: 0.5 },
  },
});

export const rowTitle = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const rowSecondary = style({
  flex: '0 1 auto',
  minWidth: 0,
  maxWidth: 200,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  ...text.text12.standard,
  fontWeight: 400,
  color: c.content.tertiary,
});

export const due = style({
  flex: 'none',
  ...text.body.standard,
  fontWeight: 400,
  color: c.content.tertiary,
  selectors: {
    '&[data-tone="overdue"]': { color: c.content.critical },
    '&[data-tone="today"]': { color: c.content.warning },
  },
});

export const emptyTasks = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  padding: '28px 16px',
  textAlign: 'center',
});
export const emptyTitle = style({ ...text.body.standard, color: c.content.primary });
export const emptyBody = style({ ...text.body.standard, fontWeight: 400, color: c.content.secondary, marginBottom: 8 });

export const errorLine = style({ ...text.body.standard, color: c.content.critical, padding: '8px' });

export const skeletonRow = style({ display: 'flex', alignItems: 'center', gap: 10, height: 36, padding: '0 8px' });
