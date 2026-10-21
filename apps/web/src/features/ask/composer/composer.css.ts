// The Ask composer (ask-agentic §2): a ~12 px rounded card (668 px in the full page), min 72 px of text, a footer with the
// context chip on the left and model picker · Insert prompt · submit on the right; the border turns blue on focus.
import { text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style } from '@vanilla-extract/css';

const c = vars.color;

export const card = style({
  boxSizing: 'border-box',
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  minHeight: 115,
  padding: '12px 12px 8px',
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}, ${vars.elevation.e1}`,
  transition: 'box-shadow 120ms ease',
  selectors: {
    '&:focus-within': {
      boxShadow: `inset 0 0 0 1px ${c.stroke.accentMedium}, 0 0 0 3px ${c.stroke.accentSubtle}, ${vars.elevation.e1}`,
    },
    '&[data-disabled]': { opacity: 0.6 },
  },
});

export const cardLarge = style({ minHeight: 116 });

export const inputWrap = style({ position: 'relative', flex: 1, minHeight: 48, maxHeight: '35vh', overflowY: 'auto' });

const shared = {
  boxSizing: 'border-box' as const,
  margin: 0,
  padding: '0 4px',
  border: 'none',
  fontFamily: 'inherit',
  ...text.body.standard,
  fontWeight: 400,
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
});

export const input = style({
  ...shared,
  position: 'relative',
  display: 'block',
  width: '100%',
  minHeight: 48,
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

export const tokenMention = style({ color: c.content.accent });
export const tokenPrompt = style({
  color: c.content.accent,
  backgroundColor: c.interactive.selectedSubtle,
  borderRadius: 4,
  boxShadow: `0 0 0 1px ${c.interactive.selectedSubtle}`,
});

export const footer = style({ display: 'flex', alignItems: 'center', gap: 4, minHeight: 28, marginTop: 4 });
export const spacer = style({ flex: 1 });
export const targetNote = style({ color: c.content.tertiary, fontSize: 11, lineHeight: '16px', marginTop: 4 });

export const modelButton = style({
  height: 28,
  padding: '0 8px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: c.content.secondary,
  cursor: 'pointer',
  ...text.body.standard,
  fontWeight: 400,
  selectors: {
    '&:hover, &[data-pressed]': { backgroundColor: c.interactive.ghostHover, color: c.content.primary },
    '&[data-focus-visible]': { outline: `2px solid ${c.stroke.accent}` },
  },
});

export const submit = style({
  width: 28,
  height: 28,
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: 14,
  backgroundColor: c.interactive.primary,
  color: c.content.onAccent,
  cursor: 'pointer',
  transition: 'opacity 120ms ease, background-color 120ms ease',
  selectors: {
    '&:hover:not([data-disabled])': { backgroundColor: c.interactive.primaryHover },
    '&[data-disabled]': { opacity: 0.4, cursor: 'default' },
    '&[data-focus-visible]': { outline: `2px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});
export const stop = style({
  backgroundColor: c.surface.primary,
  color: c.content.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  selectors: { '&:hover:not([data-disabled])': { backgroundColor: c.surface.tertiary } },
});

/** The context chip (28 px, subtle grey, 16 px icon + truncated label). */
export const contextChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 24,
  maxWidth: 220,
  padding: '0 8px 0 6px',
  borderRadius: 8,
  backgroundColor: c.surface.tertiary,
  color: c.content.secondary,
  ...text.text12.standard,
  fontWeight: 400,
  minWidth: 0,
});
export const contextChipLabel = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

// ---- typeahead and prompt menu -------------------------------------------------------------------------------------------------

export const menu = style({ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 320, overflowY: 'auto' });
export const menuLabel = style({
  ...text.text12.standard,
  fontWeight: 400,
  color: c.content.secondary,
  padding: '6px 8px 4px',
});
export const option = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 32,
  padding: '0 8px',
  borderRadius: 8,
  color: c.content.primary,
  cursor: 'pointer',
  ...text.body.standard,
  fontWeight: 400,
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
  ...text.text12.standard,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
  flex: '1 1 0',
});
export const optionTrailing = style({
  marginLeft: 'auto',
  flex: 'none',
  display: 'inline-flex',
  color: c.content.secondary,
});
export const empty = style({ ...text.body.standard, fontWeight: 400, color: c.content.tertiary, padding: '8px' });
export const divider = style({ height: 1, backgroundColor: c.stroke.primary, margin: '4px 0' });

export const searchInput = style({
  boxSizing: 'border-box',
  width: '100%',
  height: 32,
  padding: '0 8px',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  borderBottom: `1px solid ${c.stroke.primary}`,
  color: c.content.primary,
  ...text.body.standard,
  fontWeight: 400,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});
