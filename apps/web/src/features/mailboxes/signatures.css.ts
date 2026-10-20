// Mailbox signatures (evidence/F/mailbox-signature-editor.png, measured on the 790 px crop): a 231 px list of
// signature pills and "+ New signature" on the left, 58 px gap, the title input and a bordered editor box with a
// footer "+" on the right.
import { insetRing, text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const layout = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(160px, 231px) minmax(0, 1fr)',
  columnGap: 58,
  alignItems: 'start',
});

export const list = style({ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 });

export const pill = style({
  boxSizing: 'border-box',
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  height: 34,
  borderRadius: 10,
  transition: 'background-color 140ms ease, box-shadow 140ms ease',
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&[data-selected]': { backgroundColor: c.surface.tertiary, boxShadow: insetRing(c.stroke.primary) },
  },
});

export const pillMain = style({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: '100%',
  padding: '0 0 0 13px',
  border: 'none',
  background: 'transparent',
  borderRadius: 10,
  ...text.body.standard,
  color: c.content.primary,
  textAlign: 'left',
  cursor: 'pointer',
  outline: 'none',
  selectors: { '&[data-focus-visible]': { boxShadow: insetRing(c.stroke.accent) } },
});

export const pillTitle = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });

/** The ⋮ menu button shows on hover, on focus and while its menu is open. */
export const pillMenu = style({
  flex: 'none',
  marginRight: 4,
  opacity: 0,
  transition: 'opacity 120ms ease',
  selectors: {
    [`${pill}:hover &, ${pill}:focus-within &, &[data-pressed], &[data-focus-visible]`]: { opacity: 1 },
  },
});

export const newButton = style({
  alignSelf: 'flex-start',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  height: 34,
  padding: '0 12px 0 7px',
  marginTop: 0,
  border: 'none',
  borderRadius: 10,
  background: 'transparent',
  ...text.body.standard,
  color: c.content.tertiary,
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&[data-hovered]': { color: c.content.primary, backgroundColor: c.interactive.ghostHoverSubtle },
    '&[data-focus-visible]': { boxShadow: insetRing(c.stroke.accent) },
    '&[data-disabled]': { opacity: 0.5 },
  },
});

export const editorColumn = style({ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 });

export const editorBox = style({
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 234,
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.primary),
  transition: 'box-shadow 140ms ease',
  selectors: { '&:focus-within': { boxShadow: insetRing(c.stroke.accent) } },
});

export const editorHost = style({
  flex: 1,
  minHeight: 188,
  boxSizing: 'border-box',
  padding: '11px 16px',
  cursor: 'text',
});

export const editorFooter = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  height: 44,
  flex: 'none',
  padding: '0 11px',
  borderTop: `1px solid ${c.stroke.primary}`,
});

export const readOnlyNote = style({ ...text.text12.standard, color: c.content.tertiary, margin: 0 });
