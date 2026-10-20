// Approval cards (ask-agentic §8, internals §4.3): the composer's frame with a blue ring — a small title label, the
// editable input, chips for assignee / due date / linked record, and Discard · Create ⌘↵ at the bottom right.
import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const card = style({
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  width: '100%',
  padding: '12px 12px 8px',
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.accentMedium}, 0 0 0 3px ${c.stroke.accentSubtle}, ${vars.elevation.e1}`,
});

export const header = style({ display: 'flex', alignItems: 'center', gap: 8, minHeight: 20 });
export const label = style({ ...text.text12.standard, fontWeight: 400, color: c.content.secondary, flex: 1 });
export const labelStrong = style({ ...text.body.standard, fontWeight: 600, color: c.content.primary });
export const description = style({ ...text.text12.standard, fontWeight: 400, color: c.content.secondary });

export const pager = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  ...text.text12.standard,
  color: c.content.secondary,
});

export const field = style({
  boxSizing: 'border-box',
  width: '100%',
  margin: 0,
  padding: '0 4px',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  resize: 'none',
  fontFamily: 'inherit',
  color: c.content.primary,
  ...text.body.standard,
  fontWeight: 400,
  fieldSizing: 'content',
  selectors: { '&::placeholder': { color: c.content.tertiary } },
} as Parameters<typeof style>[0]);

export const textarea = style({ minHeight: 72, maxHeight: 200, overflowY: 'auto' });

export const chips = style({ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '0 4px' });
export const chip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 24,
  padding: '0 6px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: c.content.secondary,
  cursor: 'pointer',
  ...text.text12.standard,
  fontWeight: 400,
  selectors: {
    '&:hover, &[data-pressed]': { backgroundColor: c.interactive.ghostHover, color: c.content.primary },
    '&[data-focus-visible]': { outline: `2px solid ${c.stroke.accent}` },
  },
});
export const chipStatic = style({
  cursor: 'default',
  selectors: { '&:hover': { backgroundColor: 'transparent', color: c.content.secondary } },
});
export const chipRemove = style({
  display: 'inline-flex',
  border: 'none',
  background: 'transparent',
  color: c.content.tertiary,
  padding: 0,
  cursor: 'pointer',
  selectors: { '&:hover': { color: c.content.primary } },
});

export const footer = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  minHeight: 32,
});
export const footerNote = style({
  ...text.text12.standard,
  color: c.content.critical,
  marginRight: 'auto',
  fontWeight: 400,
});

// ---- attribute diff rows (record cards) ----------------------------------------------------------------------------------------

export const rows = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '0 4px',
  maxHeight: 240,
  overflowY: 'auto',
});
export const row = style({
  display: 'grid',
  gridTemplateColumns: '140px 1fr 20px',
  alignItems: 'center',
  gap: 8,
  minHeight: 28,
  ...text.body.standard,
  fontWeight: 400,
});
export const rowKey = style({
  color: c.content.secondary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const rowValue = style({
  color: c.content.primary,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const rowInput = style({
  boxSizing: 'border-box',
  width: '100%',
  height: 24,
  padding: '0 6px',
  border: 'none',
  outline: 'none',
  borderRadius: 6,
  background: c.interactive.placeholder,
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  fontWeight: 400,
  selectors: { '&:focus': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` } },
});

export const code = style({
  ...text.body.code,
  margin: 0,
  padding: '8px 10px',
  borderRadius: 8,
  backgroundColor: c.surface.tertiary,
  maxHeight: 160,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
});

export const dateInput = style({
  boxSizing: 'border-box',
  height: 32,
  padding: '0 8px',
  border: 'none',
  borderRadius: 8,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  fontWeight: 400,
});
