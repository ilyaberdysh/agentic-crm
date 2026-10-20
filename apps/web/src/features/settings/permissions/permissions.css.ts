// Permissions tab (J permissions §4–5; evidence/J/object-permissions-grants.png measured at 1512 × 945): Members heading,
// the workspace access card (56 px), Teams / Individual members / Automations sections with 40 px grant rows.
import { insetRing, text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const root = style({ display: 'flex', flexDirection: 'column', gap: 24 });

export const block = style({ display: 'flex', flexDirection: 'column', gap: 12 });

/** "Members" heading block: 16 px to the workspace card (Attio), the sections below use 12. */
export const lead = style({ gap: 16 });

/** Attio leaves 16 px more below the member rows than below the teams. */
export const roomBelow = style({ marginBottom: 16 });

export const head = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 });

export const headText = style({ display: 'flex', flexDirection: 'column', minWidth: 0 });

export const title = style({ ...text.heading.small, color: c.content.primary, margin: 0 });

export const subTitle = style({ ...text.body.strong, color: c.content.primary, margin: 0 });

export const description = style({ ...text.body.standard, color: c.content.secondary, margin: 0 });

export const smallDescription = style({ ...text.text12.standard, color: c.content.secondary, margin: 0 });

export const learnMore = style({
  color: c.content.secondary,
  textDecoration: 'underline',
  textDecorationColor: c.stroke.secondaryTransparent,
  textUnderlineOffset: '0.14em',
  selectors: { '&:hover': { color: c.content.primary } },
});

export const workspaceCard = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minHeight: 56,
  padding: '8px 8px 8px 8px',
  borderRadius: 12,
  backgroundColor: c.surface.secondary,
  boxShadow: insetRing(c.stroke.primary),
});

export const workspaceText = style({ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 });

export const workspaceTitle = style({ ...text.body.standard, color: c.content.primary });

export const rows = style({ display: 'flex', flexDirection: 'column', gap: 8 });

export const row = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 40,
  padding: '0 4px 0 12px',
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.primary),
  ...text.body.standard,
  color: c.content.primary,
});

export const rowMain = style({ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 });

export const rowName = style({
  ...text.body.standard,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const rowDetail = style({
  ...text.text12.standard,
  color: c.content.secondary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const count = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 16,
  height: 16,
  padding: '0 4px',
  borderRadius: 5,
  backgroundColor: c.surface.tint,
  color: c.content.secondary,
  ...text.text11.small,
});

export const empty = style({ ...text.body.standard, color: c.content.tertiary, padding: '8px 0' });

// ---- level dropdown ------------------------------------------------------------------------------------------

export const levelButton = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 8px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  ...text.body.standard,
  color: c.content.primary,
  cursor: 'pointer',
  outline: 'none',
  flex: 'none',
  selectors: {
    '&[data-hovered]': { backgroundColor: c.interactive.ghostHover },
    '&[data-focus-visible]': { boxShadow: insetRing(c.stroke.accent) },
    '&[aria-expanded="true"]': { backgroundColor: c.interactive.ghostHover },
    '&[data-disabled]': { cursor: 'default', opacity: 0.6 },
  },
});

export const levelBordered = style({
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.primaryTransparent),
});

export const levelMuted = style({ color: c.content.tertiary });

export const warnIcon = style({ color: c.content.warning, flex: 'none' });
