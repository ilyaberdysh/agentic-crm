// Settings → Email and calendar accounts (F settings §1): a bordered list of accounts (provider tile, address +
// Default, what syncs, status chip, ⋮ Options) with the connect buttons below.
import { insetRing, text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const rule = style({ height: 1, backgroundColor: c.stroke.primary, margin: '24px 0 40px', flex: 'none' });

export const sections = style({ display: 'flex', flexDirection: 'column', gap: 40 });

export const list = style({
  boxSizing: 'border-box',
  margin: 0,
  padding: 0,
  listStyle: 'none',
  borderRadius: 12,
  boxShadow: insetRing(c.stroke.primary),
  backgroundColor: c.surface.primary,
  overflow: 'hidden',
});

export const row = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minHeight: 64,
  boxSizing: 'border-box',
  padding: '12px 12px 12px 12px',
  transition: 'background-color 140ms ease',
  selectors: {
    '& + &': { borderTop: `1px solid ${c.stroke.primary}` },
    '&:hover': { backgroundColor: c.interactive.ghostHoverSubtle },
  },
});

export const rowText = style({ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 });

export const rowTitle = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });

/** The address is the row's link; its ::after stretches the hit area over the whole row. */
export const rowLink = style({
  ...text.body.standard,
  color: c.content.primary,
  textDecoration: 'none',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  outline: 'none',
  selectors: {
    '&::after': { content: '""', position: 'absolute', inset: 0, borderRadius: 12 },
    '&[data-focus-visible]::after': { boxShadow: insetRing(c.stroke.accent) },
  },
});

export const rowSub = style({ ...text.text12.standard, color: c.content.tertiary });

/** Why a Google account must be reconnected (revoked access, missing permissions). */
export const rowSubError = style({ ...text.text12.standard, color: c.content.critical });

export const rowActions = style({ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, flex: 'none' });

export const connectRow = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 });

/** "Google is not configured on this server" next to the disabled connect button. */
export const connectHint = style({ ...text.text12.standard, color: c.content.tertiary });

export const empty = style({
  boxSizing: 'border-box',
  borderRadius: 12,
  boxShadow: insetRing(c.stroke.primary),
  padding: '32px 16px',
});

export const privacy = style({
  color: c.content.secondary,
  textDecoration: 'underline',
  textDecorationColor: c.stroke.secondaryTransparent,
  textUnderlineOffset: '0.14em',
  selectors: { '&:hover': { color: c.content.primary } },
});

export const removeList = style({
  margin: '8px 0 0',
  paddingLeft: 18,
  ...text.body.standard,
  color: c.content.secondary,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
});
