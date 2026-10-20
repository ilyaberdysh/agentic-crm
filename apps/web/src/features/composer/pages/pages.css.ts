// Drafts list, Outbox and Templates pages:
// drafts-list-minimized-composer-dark.png, emails-outbox-empty.png, emails-templates-empty.png,
// templates-list-view-settings-dark.png). Tab chrome, toolbar, cards and states come from the notes index pages.
import { scales, text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;
const ease = `${scales.duration.comfortable}ms ease`;

export const toolbarActions = style({ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' });

// ---- drafts table --------------------------------------------------------------------------------------------------

export const table = style({ display: 'flex', flexDirection: 'column', minWidth: 640 });

export const head = style({
  boxSizing: 'border-box',
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 280px',
  alignItems: 'center',
  height: 32,
  borderBottom: `1px solid ${c.stroke.primary}`,
  ...text.text12.standard,
  fontSize: 12,
  color: c.content.secondary,
  position: 'sticky',
  top: 0,
  backgroundColor: c.surface.primary,
  zIndex: 1,
});
export const headCell = style({ display: 'flex', alignItems: 'center', gap: 4, padding: '0 16px', minWidth: 0 });

export const row = style({
  boxSizing: 'border-box',
  position: 'relative',
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 280px',
  alignItems: 'center',
  height: 52,
  borderBottom: `1px solid ${c.stroke.primary}`,
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&:hover': { backgroundColor: c.surface.primaryHover },
    '&:focus-visible': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
  },
});
export const cell = style({ display: 'flex', alignItems: 'center', padding: '0 16px', minWidth: 0 });
export const draftCell = style({ flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 0 });
export const draftSubject = style({
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  ...text.body.standard,
  fontWeight: 500,
  color: c.content.primary,
});
export const draftPreview = style({
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  ...text.text12.standard,
  fontSize: 12,
  color: c.content.secondary,
});
export const dateCell = style({ ...text.body.standard, color: c.content.secondary });
export const rowMenu = style({
  position: 'absolute',
  right: 12,
  opacity: 0,
  transition: `opacity ${ease}`,
  selectors: { [`${row}:hover &, &[aria-expanded="true"], &[data-focus-visible]`]: { opacity: 1 } },
});

// ---- empty states (illustration, title, text, action, "Learn more" card) -------------------------------------------

export const empty = style({
  position: 'relative',
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '24px 24px 120px',
  textAlign: 'center',
});
export const emptyTitle = style({ ...text.heading.small, fontSize: 18, lineHeight: '24px', color: c.content.primary });
export const emptyText = style({ ...text.body.standard, color: c.content.secondary, maxWidth: 420 });
export const emptyAction = style({ marginTop: 14 });

export const learn = style({
  position: 'absolute',
  left: '50%',
  bottom: 20,
  transform: 'translateX(-50%)',
  width: 310,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
});
export const learnLabel = style({ ...text.text12.standard, fontSize: 12, color: c.content.secondary });
export const learnCard = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minHeight: 74,
  padding: 8,
  border: `1px solid ${c.stroke.primary}`,
  borderRadius: 12,
  color: c.content.primary,
  textDecoration: 'none',
  ...text.body.standard,
  selectors: { '&:hover': { backgroundColor: c.surface.primaryHover } },
});
export const learnTile = style({
  flex: 'none',
  width: 56,
  height: 56,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 8,
  backgroundColor: c.surface.secondary,
  color: c.content.secondary,
});

// ---- outbox (two panes) ----------------------------------------------------------------------------------------------

export const outbox = style({ flex: 1, minHeight: 0, display: 'flex' });
export const outboxList = style({
  boxSizing: 'border-box',
  flex: 'none',
  width: '35%',
  minWidth: 340,
  maxWidth: 420,
  overflowY: 'auto',
  borderRight: `1px solid ${c.stroke.primary}`,
});
export const outboxItem = style({
  boxSizing: 'border-box',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '12px 16px',
  border: 'none',
  borderBottom: `1px solid ${c.stroke.primary}`,
  background: 'transparent',
  textAlign: 'left',
  cursor: 'pointer',
  font: 'inherit',
  color: c.content.primary,
  selectors: {
    '&:hover': { backgroundColor: c.surface.primaryHover },
    '&[data-selected="true"]': { backgroundColor: c.surface.tertiary },
    '&:focus-visible': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
  },
});
export const itemLine = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });
export const itemSubject = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  ...text.body.standard,
  fontWeight: 500,
});
export const itemPreview = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  ...text.text12.standard,
  fontSize: 12,
  color: c.content.secondary,
});
export const itemSource = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  ...text.text12.standard,
  fontSize: 12,
  color: c.content.secondary,
});
export const failedBadge = style({
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  height: 20,
  padding: '0 6px',
  borderRadius: 6,
  backgroundColor: c.surface.critical,
  color: c.content.onCriticalSubtle,
  ...text.text12.standard,
  fontSize: 12,
  fontWeight: 500,
});
export const timeChip = style({
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 20,
  padding: '0 6px',
  borderRadius: 6,
  backgroundColor: c.surface.tertiary,
  color: c.content.secondary,
  ...text.text12.standard,
  fontSize: 12,
});
export const outboxStatus = style({ flex: 'none', ...text.text12.standard, fontSize: 12, color: c.content.secondary });

export const preview = style({ flex: 1, minWidth: 0, overflowY: 'auto', padding: '24px 24px 24px 24px' });
export const previewBar = style({ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 });
export const previewTitle = style({ ...text.heading.small, flex: 1, minWidth: 0 });
export const previewFields = style({ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 });
export const previewField = style({ display: 'flex', gap: 12, ...text.body.standard });
export const previewLabel = style({ flex: 'none', width: 56, color: c.content.secondary });
export const previewValue = style({ flex: 1, minWidth: 0, overflowWrap: 'anywhere' });
export const previewBody = style({ ...text.body.standard, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' });
export const failureBanner = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 16,
  padding: '8px 12px',
  borderRadius: 8,
  backgroundColor: c.surface.critical,
  color: c.content.onCriticalSubtle,
  ...text.body.standard,
});

// ---- templates ---------------------------------------------------------------------------------------------------------

export const templateCard = style({
  position: 'relative',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  height: 158,
  minWidth: 0,
  padding: '12px 15px 0',
  borderRadius: 12,
  border: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
  cursor: 'pointer',
  outline: 'none',
  transition: `border-color ${ease}`,
  selectors: {
    '&:hover': { borderColor: c.stroke.secondary },
    '&:focus-visible': { borderColor: c.stroke.accent },
  },
});
export const templateTop = style({ display: 'flex', alignItems: 'center', gap: 8, minHeight: 20 });
export const templateTitle = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  ...text.body.standard,
  fontWeight: 500,
});
export const templateMenu = style({
  opacity: 0,
  transition: `opacity ${ease}`,
  selectors: { [`${templateCard}:hover &, &[aria-expanded="true"], &[data-focus-visible]`]: { opacity: 1 } },
});
export const templateSubject = style({
  marginTop: 6,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  ...text.text12.standard,
  fontSize: 12,
  fontWeight: 500,
});
export const templatePreview = style({
  flex: 1,
  minHeight: 0,
  marginTop: 2,
  overflow: 'hidden',
  ...text.text12.standard,
  fontSize: 12,
  color: c.content.secondary,
  maskImage: 'linear-gradient(to bottom, #000 55%, transparent 100%)',
  WebkitMaskImage: 'linear-gradient(to bottom, #000 55%, transparent 100%)',
});
export const templateFooter = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 38,
  marginTop: 'auto',
  borderTop: `1px solid ${c.stroke.primary}`,
  ...text.text12.standard,
  fontSize: 12,
});
export const templateGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
  gap: 12,
  padding: '12px',
});

/** The template dialog (808 × 548 outside, the frame adds 3 px each side). */
export const templateDialog = style({ height: 542, display: 'flex', flexDirection: 'column' });
