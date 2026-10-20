// Auth page shell (K legacy-welcome,  measurements at 1512 × 945): logo top-centre at y 32, centred
// 360 px column, legal line and footer pinned to the bottom (footer text at y ≈ 905). Phone: 15 px gutters.
import { text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style } from '@vanilla-extract/css';

const c = vars.color;

export const page = style({
  boxSizing: 'border-box',
  // Fills the root page area (below the announcement banner slot).
  flex: '1 0 auto',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 24,
  padding: '32px 15px 24px',
  backgroundColor: c.surface.primary,
  color: c.content.primary,
});

export const pageWide = style({ gap: 64 });

export const header = style({ display: 'flex', justifyContent: 'center', width: '100%', flex: 'none' });

export const wordmark = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 24,
  color: c.content.primary,
  textDecoration: 'none',
  outline: 'none',
  borderRadius: 6,
  selectors: { '&:focus-visible': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 2 } },
});

export const logoMark = style({
  flex: 'none',
  vars: { '--ar-logo-cut': c.surface.primary },
});

export const wordmarkText = style({
  fontSize: 20,
  lineHeight: '24px',
  fontWeight: 600,
  letterSpacing: '-0.04em',
  whiteSpace: 'nowrap',
});

export const content = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  width: '100%',
  maxWidth: 360,
});

export const contentWide = style({ maxWidth: 400 });

export const title = style({
  ...text.heading.large,
  color: c.content.primary,
  textAlign: 'center',
  margin: 0,
});

export const subtitle = style({
  ...text.body.standard,
  color: c.content.secondary,
  textAlign: 'center',
  margin: '8px 0 0',
});

export const form = style({ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 32 });

/**
 * the sign-in block also holds "Sign in with Google" and a divider (40 + 28 + 1 + 28 px) where we have one
 * more field (34 + 12): the difference is kept as bottom space so the centred block puts the title at the same height.
 * (y ≈ 329 at 1512 × 945).
 */
export const signInBlock = style({ paddingBottom: 51 });

export const formError = style({
  ...text.text12.standard,
  color: c.content.critical,
  textAlign: 'center',
});

export const helper = style({
  ...text.text12.standard,
  color: c.content.secondary,
  textAlign: 'center',
  marginTop: 16,
});

export const legal = style({
  ...text.text12.standard,
  color: c.content.secondary,
  textAlign: 'center',
  maxWidth: 300,
  margin: 0,
  flex: 'none',
});

export const footer = style({
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  alignItems: 'center',
  gap: '4px 20px',
  ...text.text12.standard,
  color: c.content.secondary,
  flex: 'none',
});

export const link = style({
  color: 'inherit',
  textDecoration: 'underline',
  textDecorationColor: c.stroke.secondaryTransparent,
  textUnderlineOffset: '0.14em',
  cursor: 'pointer',
  background: 'none',
  border: 'none',
  padding: 0,
  font: 'inherit',
  letterSpacing: 'inherit',
  selectors: {
    '&:hover': { color: c.content.primary },
    '&:focus-visible': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 1, borderRadius: 2 },
  },
});

globalStyle(`${helper} a`, { color: c.content.accent, textDecoration: 'none' });

// ---- status pages (no access, errors): centred icon + message ------------------------------------------------

export const status = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  textAlign: 'center',
  maxWidth: 300,
});

export const statusCritical = style({ ...text.body.standard, color: c.content.critical });

export const statusText = style({ ...text.body.standard, color: c.content.secondary });

// ---- invite card (join page) -----------------------------------------------------------------------------------

export const inviteCard = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: 12,
  borderRadius: 12,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  marginTop: 40,
});

export const inviteText = style({ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 });

export const inviteName = style({ ...text.body.standard, color: c.content.primary });

export const inviteUrl = style({ ...text.text12.standard, color: c.content.secondary });

export const buttonRow = style({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 24 });
