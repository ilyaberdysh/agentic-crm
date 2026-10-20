// Dev page chrome: the object toolbar row and a stand-in grid (the real one is features/table, C3) so the views UI can
// be checked against evidence/C1 screenshots.
import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const page = style({ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 });

export const toolbar = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 49,
  padding: '0 12px',
  borderBottom: `1px solid ${c.stroke.primary}`,
  flex: 'none',
});

export const spacer = style({ flex: 1 });

export const grid = style({ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' });

export const headerRow = style({
  display: 'flex',
  height: 40,
  borderBottom: `1px solid ${c.stroke.primary}`,
  minWidth: 'max-content',
});

export const cell = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '0 12px',
  borderRight: `1px solid ${c.stroke.primary}`,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
  color: c.content.primary,
  flex: 'none',
  ...text.body.standard,
});

export const headerCell = style([
  cell,
  { cursor: 'pointer', userSelect: 'none', selectors: { '&:hover': { backgroundColor: c.surface.secondary } } },
]);

export const headerIcon = style({ color: c.content.secondary, flex: 'none' });

export const row = style({
  display: 'flex',
  height: 36,
  borderBottom: `1px solid ${c.stroke.primary}`,
  minWidth: 'max-content',
});

export const numeric = style({ justifyContent: 'flex-end', fontVariantNumeric: 'tabular-nums' });

export const footer = style([row, { color: c.content.tertiary }]);

export const muted = style({ color: c.content.tertiary });

export const checkbox = style({
  width: 14,
  height: 14,
  borderRadius: 4,
  boxShadow: `inset 0 0 0 1px ${c.stroke.tertiary}`,
  flex: 'none',
});

export const empty = style({
  position: 'absolute',
  left: 250,
  right: 0,
  top: 40,
  bottom: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  textAlign: 'center',
});

export const emptyIcon = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 44,
  height: 44,
  borderRadius: 22,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  color: c.content.accent,
});

export const emptyTitle = style({ ...text.heading.small, maxWidth: 240 });
export const emptyText = style({ ...text.body.standard, color: c.content.secondary, maxWidth: 270 });
