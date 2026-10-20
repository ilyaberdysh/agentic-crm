// Call cards (I calls §11.6; evidence/I/record-company-calls-tab.png, record-company-activity-call.png): the 330 × 183 card
// of a record's Calls tab and of the favourites strip (275 × 152), and the meeting card of the Activity feed (a green
// accent bar, camera tile, title, time, duration, participants and the concise summary).
import { scales, text, transitionColors, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;
const ease = `${scales.duration.comfortable}ms ease`;

export const card = style({
  position: 'relative',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  width: 330,
  minHeight: 183,
  flex: 'none',
  padding: 12,
  borderRadius: 12,
  border: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
  color: 'inherit',
  textDecoration: 'none',
  cursor: 'pointer',
  outline: 'none',
  transition: `border-color ${ease}, box-shadow ${ease}`,
  selectors: {
    '&:hover': { borderColor: c.stroke.secondary, boxShadow: '0 1px 3px rgba(0,0,0,.04)' },
    '&:focus-visible': { borderColor: c.stroke.accent },
  },
});

export const cardFavorite = style({ width: 275, height: 152, minHeight: 0 });

export const cardTop = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, height: 32 });

export const tile = style({
  flex: 'none',
  boxSizing: 'border-box',
  width: 32,
  height: 32,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 10,
  backgroundColor: c.surface.tint,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primaryTransparent}`,
  color: c.content.secondary,
});

export const title = style({
  ...text.body.standard,
  fontWeight: 500,
  color: c.content.primary,
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const menu = style({
  opacity: 0,
  transition: `opacity ${ease}`,
  selectors: {
    [`${card}:hover &, ${card}:focus-within &, &[aria-expanded="true"], &[data-focus-visible]`]: { opacity: 1 },
  },
});

export const summary = style({
  ...text.text12.standard,
  fontSize: 13,
  lineHeight: '18px',
  color: c.content.secondary,
  margin: '8px 0 0',
  flex: 1,
  minHeight: 0,
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
});

export const summaryCompact = style({ WebkitLineClamp: 2 });

export const summaryPending = style({ color: c.content.tertiary, fontStyle: 'italic' });

export const dateChip = style({
  alignSelf: 'flex-start',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 20,
  padding: '0 6px',
  marginTop: 8,
  borderRadius: 6,
  backgroundColor: c.surface.tint,
  ...text.text12.standard,
  color: c.content.secondary,
  whiteSpace: 'nowrap',
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

export const footer = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  marginTop: 10,
  paddingTop: 10,
  borderTop: `1px solid ${c.stroke.primary}`,
  ...text.text12.standard,
  color: c.content.secondary,
});

export const duration = style({ display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none' });

// ---- tab frame ----------------------------------------------------------------------------------------------------------------

export const tabHeader = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  minHeight: 52,
  padding: '12px 20px',
  ...text.body.large,
  fontWeight: 500,
  color: c.content.primary,
});

export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, 330px)',
  gap: 12,
  padding: '0 20px 20px',
});

// ---- activity meeting card --------------------------------------------------------------------------------------------------

export const activityCard = style({
  position: 'relative',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '10px 12px 10px 16px',
  borderRadius: 12,
  border: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
  cursor: 'pointer',
  outline: 'none',
  overflow: 'hidden',
  transition: transitionColors,
  selectors: {
    '&:hover': { backgroundColor: c.surface.primaryHover },
    '&:focus-visible': { borderColor: c.stroke.accent },
    '&::before': {
      content: '""',
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 3,
      backgroundColor: c.utilities.surface.green,
    },
  },
});

export const activityHead = style({ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 });
export const activityTile = style([tile, { width: 28, height: 28, borderRadius: 8, position: 'relative' }]);
export const activityBadge = style({
  position: 'absolute',
  right: -3,
  bottom: -3,
  width: 10,
  height: 10,
  borderRadius: 5,
  backgroundColor: c.utilities.surface.green,
  boxShadow: `0 0 0 2px ${c.surface.primary}`,
});
export const activityTexts = style({ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 });
export const activityTitle = style({
  ...text.body.standard,
  fontWeight: 500,
  color: c.content.primary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const activityMeta = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  ...text.text12.standard,
  color: c.content.secondary,
  whiteSpace: 'nowrap',
});
export const activitySummary = style({
  ...text.text12.standard,
  fontSize: 13,
  lineHeight: '18px',
  color: c.content.secondary,
  margin: 0,
});
