// Inbox: the legacy popover — 387 px, 580 px tall, radius 12,
// "Notifications" heading, "Notifications (n) | Requests (n)" tabs — holding the v2 rows (32 px avatar with an event
// badge, eyebrow with the actors, title, snippet, relative time, hover options).
import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

// ---- sidebar button + badge --------------------------------------------------------------------------------------------

export const buttonWrap = style({ position: 'relative', display: 'inline-flex', flex: 'none' });

export const badge = style({
  position: 'absolute',
  top: -4,
  right: -4,
  pointerEvents: 'none',
  zIndex: 1,
});

// ---- popover --------------------------------------------------------------------------------------------------------------

export const popover = style({
  boxSizing: 'border-box',
  width: 387,
  height: 580,
  maxHeight: 'calc(100vh - 20px)',
  display: 'flex',
  flexDirection: 'column',
  outline: 'none',
  overflow: 'hidden',
  borderRadius: 12,
});

export const head = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '20px 14px 0 34px',
  height: 52,
  boxSizing: 'border-box',
});

export const title = style({
  ...text.heading.standard,
  fontSize: 20,
  lineHeight: '24px',
  letterSpacing: '-0.4px',
  margin: 0,
  color: c.content.primary,
});

export const tabs = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  padding: '0 14px',
  height: 40,
  boxSizing: 'border-box',
});

export const tabsRule = style({ boxShadow: `inset 0 -1px 0 ${c.stroke.primary}` });

export const tab = style({
  height: 40,
  padding: '0 20px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  outline: 'none',
  color: c.content.secondary,
  ...text.body.standard,
  selectors: {
    '&[aria-selected="true"]': { color: c.content.accent },
    '&:focus-visible': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: -2, borderRadius: 6 },
  },
});

export const scroll = style({
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  scrollbarWidth: 'thin',
});

// ---- rows ------------------------------------------------------------------------------------------------------------------

export const row = style({
  position: 'relative',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  width: '100%',
  padding: '12px 16px 12px 24px',
  border: 'none',
  background: 'transparent',
  textAlign: 'left',
  cursor: 'pointer',
  outline: 'none',
  color: c.content.primary,
  selectors: {
    '&:hover, &:focus-visible, &[data-menu-open]': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&:focus-visible': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
  },
});

export const unreadDot = style({
  position: 'absolute',
  left: 9,
  top: 24,
  width: 8,
  height: 8,
  borderRadius: 4,
  backgroundColor: c.surface.accent,
});

export const avatarSlot = style({ position: 'relative', flex: 'none', width: 32, height: 32 });

export const avatarPair = style({ position: 'relative', width: 32, height: 32 });
export const avatarBack = style({ position: 'absolute', top: 0, left: 0 });
export const avatarFront = style({
  position: 'absolute',
  right: 0,
  bottom: 0,
  borderRadius: '50%',
  boxShadow: `0 0 0 2px ${c.surface.primary}`,
});

// 18 px event badge: coloured circle, 12 px white glyph.
export const eventBadge = style({
  position: 'absolute',
  right: -5,
  bottom: -5,
  width: 18,
  height: 18,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '50%',
  backgroundColor: c.surface.accent,
  color: c.content.onAccent,
  boxShadow: `0 0 0 2px ${c.surface.primary}`,
});

export const textCol = style({ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 });

export const eyebrowRow = style({ display: 'flex', alignItems: 'center', gap: 8, minHeight: 20 });
export const eyebrow = style({
  ...text.body.standard,
  color: c.content.primary,
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const time = style({ ...text.text12.standard, fontWeight: 400, color: c.content.tertiary, flex: 'none' });
export const rowActions = style({ display: 'none', flex: 'none' });
export const timeSlot = style({
  display: 'inline-flex',
  alignItems: 'center',
  flex: 'none',
  minWidth: 28,
  justifyContent: 'flex-end',
  selectors: {
    [`${row}:hover &, ${row}[data-menu-open] &, ${row}:focus-within &`]: { display: 'none' },
  },
});
export const actionsSlot = style({
  display: 'none',
  flex: 'none',
  selectors: {
    [`${row}:hover &, ${row}[data-menu-open] &, ${row}:focus-within &`]: { display: 'inline-flex' },
  },
});

export const rowTitle = style({
  ...text.body.standard,
  fontWeight: 400,
  color: c.content.secondary,
  selectors: { '&[data-unread]': { color: c.content.primary } },
});
export const rowTitleStrong = style({ fontWeight: 500, color: c.content.primary });

export const snippet = style({
  ...text.text12.standard,
  fontWeight: 400,
  color: c.content.tertiary,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  wordBreak: 'break-word',
  selectors: { '&[data-muted]': { fontStyle: 'normal', color: c.content.tertiary } },
});

// ---- states ----------------------------------------------------------------------------------------------------------------

export const spinnerBox = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 120,
  color: c.content.tertiary,
});

export const empty = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  padding: '81px 36px 0',
  gap: 2,
});
export const emptyTitle = style({ ...text.body.standard, fontWeight: 600, color: c.content.primary, marginTop: 35 });
export const emptyBody = style({
  ...text.body.standard,
  fontWeight: 400,
  color: c.content.secondary,
  maxWidth: 290,
});
export const emptyAction = style({ marginTop: 14 });

export const error = style({
  ...text.body.standard,
  color: c.content.critical,
  padding: '24px 20px',
  textAlign: 'center',
});

export const sentinel = style({ height: 1 });
