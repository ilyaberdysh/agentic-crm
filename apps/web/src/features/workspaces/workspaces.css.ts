// `/workspaces`: 400 px column, rows 388 × 62 with a
// 1 px stroke.primary ring and radius 12, faint dividers, "Add new workspace" ghost row at the bottom.
import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const column = style({
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  // Title at the top, "Add new workspace" at the bottom of a ~530 px column centred in the page.
  height: 528,
  maxHeight: '100%',
  minHeight: 0,
});

export const titleBlock = style({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 });

export const title = style({ ...text.heading.standard, color: c.content.primary, margin: 0 });

export const subtitle = style({ ...text.body.standard, color: c.content.secondary, margin: 0, textAlign: 'center' });

export const divider = style({
  height: 1,
  flex: 'none',
  backgroundColor: c.stroke.primary,
  margin: '16px 0',
});

/** The rule under the title is barely visible (`rgba(16,17,18,.05)` in light). */
export const dividerFaint = style({ backgroundColor: c.stroke.primarySubtle });

export const search = style({ marginBottom: 12 });

export const list = style({
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: '0 6px 6px',
  outline: 'none',
});

export const row = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minHeight: 62,
  padding: 12,
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  color: c.content.primary,
  textDecoration: 'none',
  cursor: 'pointer',
  outline: 'none',
  transition: 'background-color 140ms ease',
  selectors: {
    '&:hover': { backgroundColor: c.surface.primaryHover },
    '&:focus-visible': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
  },
});

export const rowText = style({ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 });

export const rowName = style({
  ...text.body.standard,
  color: c.content.primary,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
});

export const rowUrl = style({
  ...text.text12.standard,
  color: c.content.secondary,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
});

export const rowChevron = style({
  color: c.content.secondary,
  opacity: 0,
  transition: 'opacity 140ms ease',
  selectors: {
    [`${row}:hover &, ${row}:focus-visible &`]: { opacity: 1 },
  },
});

export const empty = style({ ...text.body.standard, color: c.content.tertiary, textAlign: 'center', padding: 24 });

export const addRow = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  height: 36,
  padding: '8px 12px 8px 10px',
  borderRadius: 10,
  ...text.body.standard,
  color: c.content.ghost,
  textDecoration: 'none',
  outline: 'none',
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHover, color: c.content.primary },
    '&:focus-visible': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});

export const errorIllustration = style({ color: c.content.tertiary, marginBottom: 16 });
