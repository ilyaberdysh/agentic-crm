// Generative cards inside answers (ask-agentic-internals §5.1): bordered rounded containers, max 480 px, clickable as a
// whole, each with a not-found / error line.
import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const card = style({
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  width: '100%',
  maxWidth: 480,
  padding: '10px 12px',
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  color: c.content.primary,
  textAlign: 'left',
  textDecoration: 'none',
  ...text.body.standard,
  fontWeight: 400,
});

export const interactive = style({
  cursor: 'pointer',
  transition: 'background-color 120ms ease',
  selectors: { '&:hover': { backgroundColor: c.surface.primaryHover } },
});

export const row = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });
export const title = style({
  minWidth: 0,
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: c.content.primary,
});
export const titleDone = style({ textDecoration: 'line-through', color: c.content.tertiary });
export const meta = style({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
  paddingLeft: 24,
  ...text.text12.standard,
  fontWeight: 400,
  color: c.content.secondary,
});
export const metaItem = style({ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 });
export const secondary = style({ ...text.text12.standard, fontWeight: 400, color: c.content.secondary });
export const preview = style({
  ...text.text12.standard,
  fontWeight: 400,
  color: c.content.secondary,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
});
export const error = style({ ...text.body.standard, fontWeight: 400, color: c.content.tertiary, padding: '8px 0' });

// ---- call snippets ------------------------------------------------------------------------------------------------------------

export const snippetHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: c.content.primary,
  borderBottom: `1px solid ${c.stroke.primary}`,
  paddingBottom: 8,
});
export const snippetRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 0',
  color: c.content.primary,
  textDecoration: 'none',
  borderRadius: 6,
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHoverSubtle } },
});
export const snippetTitle = style({
  minWidth: 0,
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const snippetTime = style({ ...text.text12.standard, fontWeight: 400, color: c.content.tertiary, flex: 'none' });
