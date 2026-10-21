// Mention input (reduced editor: text + member / record mention tokens) and its typeahead.
import { text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style } from '@vanilla-extract/css';

const c = vars.color;

export const wrap = style({ position: 'relative', minWidth: 0, flex: 1 });

const shared = {
  boxSizing: 'border-box' as const,
  margin: 0,
  padding: 0,
  border: 'none',
  fontFamily: 'inherit',
  ...text.body.standard,
  whiteSpace: 'pre-wrap' as const,
  overflowWrap: 'break-word' as const,
  wordBreak: 'break-word' as const,
};

export const mirror = style({
  ...shared,
  position: 'absolute',
  inset: 0,
  color: c.content.primary,
  pointerEvents: 'none',
  overflow: 'hidden',
});

export const input = style({
  ...shared,
  position: 'relative',
  display: 'block',
  width: '100%',
  minHeight: 20,
  resize: 'none',
  overflow: 'hidden',
  outline: 'none',
  background: 'transparent',
  color: 'transparent',
  caretColor: c.content.primary,
  fieldSizing: 'content',
  selectors: { '&::placeholder': { color: c.content.tertiary } },
} as Parameters<typeof style>[0]);

globalStyle(`${input}::selection`, { color: 'transparent', backgroundColor: c.interactive.selectedStrong });

export const mention = style({ color: c.content.accent });

// ---- typeahead --------------------------------------------------------------------------------------------------

export const menu = style({ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 320, overflowY: 'auto' });

export const menuLabel = style({ ...text.text12.standard, color: c.content.secondary, padding: '6px 8px 4px' });

export const option = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 32,
  padding: '0 8px',
  borderRadius: 8,
  color: c.content.primary,
  cursor: 'pointer',
  ...text.body.standard,
  selectors: { '&[data-active]': { backgroundColor: c.interactive.ghostHover } },
});

export const optionLabel = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
  flex: '0 1 auto',
  maxWidth: '70%',
});
export const optionSecondary = style({
  color: c.content.tertiary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
  flex: '1 1 0',
});
export const optionObject = style({
  marginLeft: 'auto',
  color: c.content.secondary,
  ...text.text12.standard,
  flex: 'none',
});
export const empty = style({ ...text.body.standard, color: c.content.tertiary, padding: '6px 8px' });
