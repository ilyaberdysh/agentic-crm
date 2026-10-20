// Radio cards (components.md RadioCard; evidence/F/mailbox-general-email-visibility.png and
// workspace-email-record-creation.png): 1 px border + 8 px padding around a 40 px icon tile, title + description,
// an 18 px indicator at the right; the selected card gets an accent border, a 2 px halo and a selected tint.
import { insetRing, text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const group = style({ display: 'flex', flexDirection: 'column', gap: 8 });

export const card = style({
  boxSizing: 'border-box',
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 16px 8px 8px',
  border: `1px solid ${c.stroke.primary}`,
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  color: c.content.primary,
  cursor: 'pointer',
  outline: 'none',
  transition: 'border-color 200ms ease, box-shadow 200ms ease, background-color 200ms ease',
  selectors: {
    '&[data-hovered]': { backgroundColor: c.surface.primaryHover },
    '&[data-selected]': {
      borderColor: c.stroke.accent,
      boxShadow: `0 0 0 2px ${c.surface.accentSubtle}`,
      backgroundColor: c.interactive.selectedSubtle,
    },
    '&[data-focus-visible]': { boxShadow: `0 0 0 2px ${c.stroke.accent}` },
    '&[data-disabled]': { opacity: 0.5, cursor: 'default' },
  },
});

export const iconTile = style({
  boxSizing: 'border-box',
  flex: 'none',
  display: 'grid',
  placeItems: 'center',
  width: 40,
  height: 40,
  borderRadius: 8,
  backgroundColor: c.surface.tertiary,
  boxShadow: insetRing(c.stroke.primary),
  color: c.content.tertiary,
  selectors: {
    [`${card}[data-selected] &`]: {
      backgroundColor: c.surface.accentSubtle,
      boxShadow: insetRing(c.stroke.accentSubtle),
      color: c.content.accent,
    },
  },
});

export const text_ = style({ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' });

export const titleRow = style({ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 });

/** The "Recommended" tag makes the row one pixel taller (measured: the selected card is 71 px). */
export const titleRowBadge = style({ minHeight: 21 });

export const title = style({ ...text.body.standard, color: c.content.primary });

export const description = style({ ...text.text12.standard, color: c.content.secondary });

export const indicator = style({
  boxSizing: 'border-box',
  position: 'relative',
  flex: 'none',
  width: 18,
  height: 18,
  borderRadius: '50%',
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.primaryTransparent),
  transition: 'background-color 200ms ease, box-shadow 200ms ease',
  selectors: {
    [`${card}[data-selected] &`]: { backgroundColor: c.surface.accent, boxShadow: 'none' },
    '&::after': {
      content: '""',
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: 6,
      height: 6,
      marginLeft: -3,
      marginTop: -3,
      borderRadius: '50%',
      backgroundColor: c.content.onAccent,
      opacity: 0,
      transition: 'opacity 200ms ease',
    },
    [`${card}[data-selected] &::after`]: { opacity: 1 },
  },
});
