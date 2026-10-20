// Relationship tab: 45 px rows separated by 1 px rules —
// checkbox, record chip (link), then the configured related attributes right-aligned; selected rows light blue;
// the floating bulk bar centred at the bottom of the tab area.
import { scales, text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const list = style({ display: 'flex', flexDirection: 'column', marginTop: 12 });

export const row = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  height: 45,
  padding: '0 20px',
  borderBottom: `1px solid ${c.stroke.primary}`,
  ...text.body.standard,
  color: c.content.primary,
  transition: `background-color ${scales.duration.comfortable}ms ease`,
  selectors: {
    '&:hover': { backgroundColor: c.surface.primaryHover },
    '&[data-selected]': { backgroundColor: c.interactive.selectedSubtle },
  },
});

export const checkbox = style({
  flex: 'none',
  width: 16,
  height: 16,
  padding: 0,
  boxSizing: 'border-box',
  borderRadius: 6,
  border: `1px solid ${c.stroke.secondaryTransparent}`,
  backgroundColor: c.surface.primary,
  display: 'grid',
  placeItems: 'center',
  color: c.content.onAccent,
  cursor: 'pointer',
  selectors: {
    '&[aria-checked="true"]': { backgroundColor: c.surface.accent, borderColor: c.stroke.accent },
    '&:focus-visible': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});

export const title = style({ flex: '0 1 auto', minWidth: 0, display: 'flex', overflow: 'hidden' });

export const columns = style({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  gap: 8,
  overflow: 'hidden',
});

export const column = style({
  display: 'flex',
  minWidth: 0,
  maxWidth: 220,
  overflow: 'hidden',
  justifyContent: 'flex-end',
});

export const empty = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  gap: 4,
  padding: '80px 20px',
});
export const emptyTitle = style({ ...text.body.standard, fontWeight: 600, color: c.content.primary });
export const emptyText = style({ ...text.body.standard, color: c.content.secondary, marginBottom: 12 });

export const bar = style({
  position: 'absolute',
  left: '50%',
  bottom: 20,
  transform: 'translateX(-50%)',
  zIndex: 6,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 48,
  boxSizing: 'border-box',
  padding: '6px 6px 6px 12px',
  borderRadius: 14,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}, ${vars.elevation.e2}`,
  whiteSpace: 'nowrap',
});

export const pickerPanel = style({ width: 300 });
