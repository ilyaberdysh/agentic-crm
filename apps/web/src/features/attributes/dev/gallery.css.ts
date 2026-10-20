// Dev gallery chrome (not product UI): a plain page listing every attribute type, plus fixed-geometry visual review frames.
import { insetRing, text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style } from '@vanilla-extract/css';

const c = vars.color;

export const page = style({
  minHeight: '100vh',
  overflow: 'auto',
  backgroundColor: c.surface.primary,
  color: c.content.primary,
  padding: '24px 32px 96px',
  boxSizing: 'border-box',
  ...text.body.standard,
});

globalStyle(`${page} h1`, { ...text.heading.large, margin: '0 0 4px' });
globalStyle(`${page} h2`, { ...text.heading.small, margin: '32px 0 12px' });

export const lead = style({ color: c.content.secondary, margin: '0 0 16px' });

export const toolbar = style({ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 });

export const table = style({ borderCollapse: 'collapse', tableLayout: 'fixed' });
globalStyle(`${table} th`, {
  ...text.text12.standard,
  color: c.content.tertiary,
  textAlign: 'left',
  padding: '4px 8px 6px',
  fontWeight: 500,
});
globalStyle(`${table} td`, { padding: '6px 8px', verticalAlign: 'top' });

export const typeName = style({ ...text.body.standard, color: c.content.secondary, whiteSpace: 'nowrap' });

/** A table cell box: 36 px (35 + bottom border), right border, like  */
export const cellBox = style({
  position: 'relative',
  boxSizing: 'border-box',
  height: 36,
  borderRight: `1px solid ${c.stroke.primary}`,
  borderBottom: `1px solid ${c.stroke.primary}`,
  borderLeft: `1px solid ${c.stroke.primary}`,
  borderTop: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
  overflow: 'hidden',
  cursor: 'default',
});

export const cellSelected = style({
  outline: `1px solid ${c.stroke.accent}`,
  outlineOffset: -1,
  borderRadius: 4,
  backgroundColor: c.interactive.selectedSubtle,
});

export const fieldBox = style({
  width: 300,
  borderRadius: 9,
  cursor: 'pointer',
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHoverSubtle } },
});

export const fieldOpen = style({ boxShadow: insetRing(c.stroke.accent) });

// ---- visual review frames ----------------------------------------------------------------------------------------------------

export const frame = style({
  position: 'fixed',
  inset: 0,
  overflow: 'hidden',
  backgroundColor: c.surface.primary,
});

export const gridCell = style({
  position: 'absolute',
  boxSizing: 'border-box',
  height: 36,
  borderRight: `1px solid ${c.stroke.primary}`,
  borderBottom: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
  overflow: 'hidden',
});

export const gridSelected = style({
  boxShadow: `inset 0 0 0 1px ${c.stroke.accent}`,
  borderRadius: 4,
});
