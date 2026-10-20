// Email modal ("View email"): 808 × ≈670 dialog (the overlay frame adds 3 px each side), header,
// subject block (18/600 + Share), message blocks (28 px avatar, name, "to …", actions, timestamp), the body in a
// sandboxed iframe on white, attachment chips, and the restricted / unavailable cards.
import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const root = style({
  boxSizing: 'border-box',
  width: 802,
  maxWidth: '100%',
  height: 664,
  maxHeight: 'calc(100vh - 14vh - 22px)',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
});

export const scroll = style({ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 0 16px' });

export const subjectBlock = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  padding: '20px 20px 12px',
});

export const subject = style({
  flex: 1,
  minWidth: 0,
  margin: 0,
  fontSize: 18,
  lineHeight: '24px',
  fontWeight: 600,
  letterSpacing: '-0.2px',
  color: c.content.primary,
  overflowWrap: 'anywhere',
  selectors: { '&[data-private]': { fontWeight: 400, fontStyle: 'italic', color: c.content.tertiary } },
});

export const message = style({
  display: 'flex',
  flexDirection: 'column',
  padding: '12px 20px',
  borderTop: `1px solid ${c.stroke.primary}`,
  selectors: { '&:first-of-type': { borderTop: 'none' } },
});

export const collapsed = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  minHeight: 44,
  padding: '6px 20px',
  border: 'none',
  borderTop: `1px solid ${c.stroke.primary}`,
  background: 'transparent',
  textAlign: 'left',
  color: c.content.primary,
  cursor: 'pointer',
  ...text.body.standard,
  selectors: { '&:hover': { backgroundColor: c.surface.primaryHover } },
});
export const collapsedName = style({
  flex: 'none',
  maxWidth: 180,
  fontWeight: 500,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const collapsedSnippet = style({
  flex: 1,
  minWidth: 0,
  color: c.content.secondary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const messageHead = style({ display: 'flex', alignItems: 'center', gap: 12, minHeight: 36 });
export const headText = style({ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' });
export const senderName = style({
  ...text.body.standard,
  fontWeight: 500,
  color: c.content.primary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const toLine = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  maxWidth: '100%',
  padding: 0,
  border: 'none',
  background: 'transparent',
  ...text.text12.standard,
  fontWeight: 400,
  color: c.content.secondary,
  cursor: 'pointer',
  textAlign: 'left',
  selectors: { '&:hover': { color: c.content.primary } },
});
export const toLabel = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
export const headRight = style({ flex: 'none', display: 'flex', alignItems: 'center', gap: 2 });
export const timestamp = style({
  ...text.text12.standard,
  fontWeight: 400,
  color: c.content.secondary,
  whiteSpace: 'nowrap',
  marginLeft: 8,
});

export const details = style({
  display: 'grid',
  gridTemplateColumns: '48px 1fr',
  gap: '2px 8px',
  margin: '4px 0 0 40px',
  padding: '8px 12px',
  borderRadius: 8,
  backgroundColor: c.surface.secondary,
  ...text.text12.standard,
  fontWeight: 400,
  color: c.content.secondary,
});
export const detailLabel = style({ color: c.content.tertiary });
export const detailValue = style({ color: c.content.primary, overflowWrap: 'anywhere' });
export const detailLink = style({
  color: 'inherit',
  textDecoration: 'underline',
  textUnderlineOffset: 2,
  cursor: 'pointer',
});

export const bodyWrap = style({ margin: '8px 0 0 40px', minWidth: 0 });

export const frame = style({
  display: 'block',
  width: '100%',
  border: 'none',
  borderRadius: 8,
  backgroundColor: '#fff',
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  colorScheme: 'light',
});

export const attachments = style({ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '12px 0 0 40px' });
export const attachment = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  maxWidth: 280,
  height: 28,
  padding: '0 8px',
  border: 'none',
  borderRadius: 8,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  ...text.body.standard,
  color: c.content.primary,
  cursor: 'pointer',
  selectors: { '&:hover': { backgroundColor: c.surface.primaryHover } },
});
export const attachmentName = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const attachmentSize = style({
  flex: 'none',
  ...text.text12.standard,
  fontWeight: 400,
  color: c.content.tertiary,
});

export const restricted = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  margin: '12px 0 0 40px',
  padding: '28px 16px',
  borderRadius: 12,
  textAlign: 'center',
  backgroundColor: c.surface.secondary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
});
export const restrictedIcon = style({ color: c.content.tertiary, marginBottom: 4 });
export const restrictedTitle = style({ ...text.body.standard, fontWeight: 600, color: c.content.primary });
export const restrictedText = style({ ...text.body.standard, color: c.content.secondary, marginBottom: 12 });

export const state = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  padding: '64px 24px',
  textAlign: 'center',
});

export const skeletons = style({ display: 'flex', flexDirection: 'column', gap: 12, padding: '24px 20px' });
