// Calculated-values footer (evidence H/editor-calculated-values-dark.png, editor-insight-bar-grouped-status.png):
// a 40 px collapsed bar, ≈ 260 px expanded with a 40 px header row and 45 px rows.
import { text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style } from '@vanilla-extract/css';

const c = vars.color;

export const bar = style({
  boxSizing: 'border-box',
  flex: 'none',
  margin: '0 8px 8px',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  borderRadius: 10,
  border: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.secondary,
  color: c.content.secondary,
});

export const head = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  height: 38,
  flex: 'none',
  padding: '0 8px 0 4px',
});

export const toggle = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 8px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: c.content.secondary,
  cursor: 'pointer',
  ...text.text12.standard,
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHover } },
});

export const actions = style({ display: 'flex', alignItems: 'center', gap: 8 });

export const body = style({
  boxSizing: 'border-box',
  height: 220,
  overflowY: 'auto',
  borderTop: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
});

export const table = style({ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' });

export const headRow = style({ height: 40 });
export const headCell = style({
  position: 'sticky',
  top: 0,
  zIndex: 1,
  boxSizing: 'border-box',
  padding: '0 16px',
  textAlign: 'left',
  backgroundColor: c.surface.primary,
  borderBottom: `1px solid ${c.stroke.primary}`,
  color: c.content.secondary,
  ...text.text12.standard,
  selectors: { '&:first-child': { width: '50%' } },
});
export const headTitle = style({ display: 'inline-flex', alignItems: 'center', gap: 4 });

export const row = style({
  height: 45,
  borderBottom: `1px solid ${c.stroke.primary}`,
  selectors: { '&:last-child': { borderBottom: 'none' } },
});
export const rowHighlighted = style({ backgroundColor: c.interactive.ghostHover });
globalStyle(`${row}:hover`, { backgroundColor: c.interactive.ghostHover });

export const cell = style({
  boxSizing: 'border-box',
  padding: '0 16px',
  verticalAlign: 'middle',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  ...text.body.standard,
});
export const cellFirst = style({ color: c.content.primary });
export const cellValue = style({ color: c.content.secondary });

export const labelWrap = style({ display: 'inline-flex', alignItems: 'center', gap: 8, maxWidth: '100%' });
export const labelText = style({ overflow: 'hidden', textOverflow: 'ellipsis' });
export const dot = style({ flex: 'none', width: 8, height: 8, borderRadius: 4 });
export const flag = style({
  flex: 'none',
  padding: '0 6px',
  borderRadius: 6,
  backgroundColor: c.surface.tint,
  color: c.content.secondary,
  ...text.text12.standard,
});
