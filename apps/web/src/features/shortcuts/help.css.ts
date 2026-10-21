// Help drawer (system-ui): a floating panel at the right edge —
// x = viewport − 372, y 12, 360 wide, viewport − 24 tall, radius 16, e2 — and the key caps rows it lists.
import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

// ---- caps ------------------------------------------------------------------------------------------------------

export const caps = style({ display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none' });
export const capStep = style({ display: 'inline-flex', alignItems: 'center', gap: 4 });
export const then = style({ ...text.text12.standard, color: c.content.tertiary });
export const tooltipRow = style({ display: 'inline-flex', alignItems: 'center', gap: 6 });

// ---- drawer ----------------------------------------------------------------------------------------------------

export const drawer = style({
  boxSizing: 'border-box',
  position: 'fixed',
  top: 12,
  right: 12,
  bottom: 12,
  width: 360,
  zIndex: 5000,
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 16,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.popoverBorder}, ${vars.elevation.e2}`,
  color: c.content.primary,
  overflow: 'hidden',
  outline: 'none',
  ...text.body.standard,
});

export const header = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 48,
  padding: '12px 12px 0 16px',
});

export const title = style({ ...text.heading.small, margin: 0, flex: 1, minWidth: 0, color: c.content.primary });

export const searchWrap = style({ flex: 'none', padding: '8px 16px 8px' });

export const scroll = style({
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '0 16px 8px',
  scrollbarWidth: 'thin',
});

export const section = style({ display: 'flex', flexDirection: 'column', paddingBottom: 9 });

export const sectionTitle = style({
  ...text.text12.standard,
  color: c.content.secondary,
  margin: 0,
  padding: '9px 0 5px',
  fontWeight: 500,
});

export const cardsTitle = style({ ...text.body.strong, color: c.content.primary, margin: 0, padding: '8px 4px 8px' });

// Cards: 64 px, 48 px icon tile + title + two lines of description.
export const card = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  minHeight: 74,
  padding: '10px 10px 10px 10px',
  marginBottom: 8,
  border: 'none',
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  textAlign: 'left',
  cursor: 'pointer',
  outline: 'none',
  color: c.content.primary,
  selectors: {
    '&[data-hovered]': { backgroundColor: c.surface.primaryHover },
    '&[data-focus-visible]': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
  },
});

export const cardIcon = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 52,
  height: 52,
  borderRadius: 10,
  backgroundColor: c.surface.tertiary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  color: c.content.secondary,
});

export const cardText = style({ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 });
export const cardTitle = style({ ...text.body.standard, color: c.content.primary });
export const cardBody = style({ ...text.text12.standard, color: c.content.secondary, fontWeight: 400 });

export const empty = style({ ...text.body.standard, color: c.content.secondary, padding: '12px 4px' });

// Footer links (pinned under the list).
export const footer = style({
  flex: 'none',
  display: 'flex',
  flexDirection: 'column',
  padding: '4px 8px 8px',
});

export const footerLink = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  height: 31,
  padding: '0 8px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: c.content.primary,
  textAlign: 'left',
  cursor: 'pointer',
  outline: 'none',
  ...text.body.standard,
  selectors: {
    '&[data-hovered]': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&[data-focus-visible]': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: -1 },
  },
});

export const footerIcon = style({ color: c.content.secondary, flex: 'none' });

// ---- shortcuts rows ----------------------------------------------------------------------------------------------

export const row = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  minHeight: 30,
  boxSizing: 'border-box',
});

export const rowLabel = style({ ...text.body.standard, color: c.content.primary, fontWeight: 400, minWidth: 0 });
