// Answer markup (ask-agentic §4 item 5): paragraphs 14/20, bold, bullet lists, bordered GFM tables with a muted header
// row and 37 px rows, inline record chips and code.
import { text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style } from '@vanilla-extract/css';

const c = vars.color;

export const root = style({
  ...text.body.standard,
  fontWeight: 400,
  color: c.content.primary,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  minWidth: 0,
  overflowWrap: 'anywhere',
});

export const muted = style({ color: c.content.secondary });

export const paragraph = style({ margin: 0 });

export const list = style({ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 });
export const listItem = style({ paddingLeft: 2 });
globalStyle(`${listItem} > *`, { margin: 0 });
globalStyle(`${listItem} > * + *`, { marginTop: 4 });

export const quote = style({
  margin: 0,
  paddingLeft: 12,
  borderLeft: `2px solid ${c.stroke.secondary}`,
  color: c.content.secondary,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
});

export const bold = style({ fontWeight: 600 });

export const inlineCode = style({
  ...text.body.code,
  padding: '0 4px',
  borderRadius: 4,
  backgroundColor: c.surface.tertiary,
});

export const codeBlock = style({
  ...text.body.code,
  margin: 0,
  padding: '10px 12px',
  borderRadius: 8,
  backgroundColor: c.surface.tertiary,
  overflowX: 'auto',
  whiteSpace: 'pre',
});

export const link = style({
  color: c.content.accent,
  textDecoration: 'none',
  selectors: { '&:hover': { textDecoration: 'underline' } },
});

/** Inline record chip: object icon + name, in the text colour. */
export const recordChip = style({
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 4,
  maxWidth: '100%',
  padding: '0 2px',
  margin: '0 -2px',
  borderRadius: 4,
  color: 'inherit',
  textDecoration: 'none',
  verticalAlign: 'baseline',
  cursor: 'pointer',
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHover } },
});
export const recordChipIcon = style({ alignSelf: 'center', flex: 'none', display: 'inline-flex' });
export const recordChipLabel = style({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' });

export const tableWrap = style({
  overflowX: 'auto',
  borderRadius: 8,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
});
export const table = style({
  width: '100%',
  borderCollapse: 'collapse',
  ...text.body.standard,
  fontWeight: 400,
});
globalStyle(`${table} th`, {
  ...text.text12.standard,
  fontWeight: 400,
  textAlign: 'left',
  color: c.content.secondary,
  padding: '8px 12px',
  height: 32,
  backgroundColor: c.surface.secondary,
  borderBottom: `1px solid ${c.stroke.primary}`,
  whiteSpace: 'nowrap',
});
globalStyle(`${table} td`, {
  padding: '8px 12px',
  verticalAlign: 'top',
  minHeight: 37,
  borderTop: `1px solid ${c.stroke.primary}`,
});
globalStyle(`${table} tbody tr:first-child td`, { borderTop: 'none' });

export const skeleton = style({
  height: 40,
  borderRadius: 12,
  maxWidth: 480,
  backgroundColor: c.surface.tertiary,
});
