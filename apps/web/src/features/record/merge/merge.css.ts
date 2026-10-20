// Merge modal: ~800 px; info alert; [dashed slot | ⇄ | priority card] in a
// framed group, "=" and the result preview; record cards (40 px avatar, name, primary identifier, counters footer).
import { scales, text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const headerTitle = style({ display: 'inline-flex', alignItems: 'center', gap: 8 });

export const headerChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 20,
  padding: '0 6px 0 4px',
  borderRadius: 6,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  backgroundColor: c.surface.tintSubtle,
  ...text.text12.standard,
  color: c.content.secondary,
});

export const body = style({ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 16px 20px' });

export const info = style({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minHeight: 44,
  padding: '0 12px',
  borderRadius: 12,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  backgroundColor: c.surface.tintSubtle,
  ...text.body.standard,
  color: c.content.secondary,
});

export const row = style({ display: 'flex', alignItems: 'center', gap: 8 });

export const sources = style({
  flex: 2,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: 6,
  borderRadius: 14,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
});

export const slot = style({
  flex: 1,
  minWidth: 0,
  height: 214,
  boxSizing: 'border-box',
  borderRadius: 10,
  border: `1px dashed ${c.stroke.tertiary}`,
  backgroundColor: c.surface.tintSubtle,
  display: 'grid',
  placeItems: 'center',
});

export const card = style({
  flex: 1,
  minWidth: 0,
  height: 214,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 10,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
  overflow: 'hidden',
});

export const result = style([card, { flex: '1 1 0', height: 228, borderRadius: 14 }]);

export const cardMain = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: '0 12px',
  minWidth: 0,
});

export const cardName = style({
  ...text.body.standard,
  fontWeight: 600,
  color: c.content.primary,
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const identifier = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  maxWidth: '100%',
  minWidth: 0,
  ...text.body.standard,
  color: c.content.accent,
});

export const identifierText = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const counters = style({
  flex: 'none',
  display: 'flex',
  justifyContent: 'center',
  gap: 6,
  padding: '8px 8px',
  borderTop: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.tintSubtle,
});

export const counter = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  height: 20,
  padding: '0 4px',
  borderRadius: 6,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
  ...text.text12.standard,
  color: c.content.secondary,
});

export const operator = style({
  flex: 'none',
  width: 22,
  height: 22,
  display: 'grid',
  placeItems: 'center',
  borderRadius: 6,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
  color: c.content.tertiary,
});

export const swap = style({
  flex: 'none',
  width: 28,
  height: 28,
  display: 'grid',
  placeItems: 'center',
  borderRadius: 8,
  border: 'none',
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
  color: c.content.secondary,
  cursor: 'pointer',
  transition: `background-color ${scales.duration.comfortable}ms ease`,
  selectors: {
    '&:hover:not([data-disabled])': { backgroundColor: c.interactive.secondaryHover, color: c.content.primary },
    '&[data-disabled]': { opacity: 0.4, cursor: 'default' },
  },
});

export const merging = style({ display: 'flex', alignItems: 'center', gap: 8, ...text.body.standard });
