// The composer window (F composer §2.1): modal 808 × 636 (mass sending 1088 wide with a 280 px recipients panel),
// header 45 px, field rows of 36 px with a 72 px label column, footer 44 px; pinned: the 456 × 556 docked panel.
import { text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style } from '@vanilla-extract/css';

const c = vars.color;

// The frame adds 3 px of translucent border on each side: the dialog measures 808 × 636 outside.
export const PANEL_WIDTH = 802;
export const PANEL_HEIGHT = 630;
export const MASS_PANEL_WIDTH = 1082;
export const SIDE_PANEL_WIDTH = 280;

export const root = style({
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  width: PANEL_WIDTH,
  height: PANEL_HEIGHT,
  maxWidth: '100%',
  minHeight: 0,
  backgroundColor: c.surface.primary,
  color: c.content.primary,
  overflow: 'hidden',
  transition: 'width 160ms ease',
  ...text.body.standard,
  selectors: {
    '&[data-mass="true"]': { width: MASS_PANEL_WIDTH },
    '&[data-mode="floating"]': { width: '100%', height: '100%' },
    '&[data-view="template"]': { height: 548 },
  },
});

// ---- header --------------------------------------------------------------------------------------------------

export const header = style({
  boxSizing: 'border-box',
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 45,
  padding: '0 10px 0 16px',
  borderBottom: `1px solid ${c.stroke.primary}`,
  selectors: { '[data-mode="floating"] > &': { height: 41, padding: '0 8px 0 12px' } },
});

export const headerStart = style({ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 });

export const crumb = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  color: c.content.primary,
  ...text.body.standard,
  fontWeight: 500,
  whiteSpace: 'nowrap',
  selectors: {
    '[data-mode="floating"] &': { fontSize: 13 },
  },
});
export const crumbMuted = style({ color: c.content.secondary, fontWeight: 400 });
export const crumbSeparator = style({ color: c.content.tertiary });

export const previewPill = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 20,
  padding: '0 6px',
  borderRadius: 6,
  backgroundColor: c.surface.tertiary,
  color: c.content.secondary,
  ...text.text12.standard,
});

// ---- body: fields, editors ---------------------------------------------------------------------------------------

export const main = style({ flex: 1, minHeight: 0, display: 'flex' });

export const editorColumn = style({
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
});

export const fields = style({ flex: 'none', display: 'flex', flexDirection: 'column', padding: '9px 17px 0' });

export const row = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 0,
  minHeight: 36,
  padding: '6px 0',
  boxSizing: 'border-box',
});

export const rowLabel = style({
  flex: 'none',
  width: 72,
  height: 24,
  display: 'flex',
  alignItems: 'center',
  color: c.content.tertiary,
  ...text.body.standard,
  fontWeight: 400,
});

export const rowValue = style({
  flex: 1,
  minWidth: 0,
  minHeight: 24,
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  columnGap: 6,
  rowGap: 2,
  ...text.body.standard,
  fontWeight: 500,
});

export const rowAction = style({
  flex: 'none',
  height: 24,
  display: 'flex',
  alignItems: 'center',
  paddingLeft: 8,
});

export const linkButton = style({
  border: 'none',
  background: 'transparent',
  padding: '0 2px',
  color: c.content.secondary,
  cursor: 'pointer',
  ...text.body.standard,
  fontWeight: 400,
  borderRadius: 4,
  selectors: {
    '&:hover': { color: c.content.primary },
    '&:focus-visible': { outline: `2px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});

export const senderChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  height: 24,
  color: c.content.primary,
  fontWeight: 500,
  selectors: { '&[data-interactive="true"]': { cursor: 'pointer' } },
});

export const senderPicker = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 24,
  padding: '0 6px 0 0',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: c.content.primary,
  cursor: 'pointer',
  ...text.body.standard,
  fontWeight: 500,
  selectors: { '&[data-hovered]': { backgroundColor: c.surface.tertiary } },
});

export const noSender = style({ color: c.content.secondary, fontWeight: 400 });
export const noSenderLink = style({ color: c.content.accent, cursor: 'pointer', textDecoration: 'none' });

export const chip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  maxWidth: '100%',
  height: 24,
  padding: '0 4px 0 2px',
  borderRadius: 6,
  color: c.content.primary,
  fontWeight: 500,
  cursor: 'default',
  selectors: {
    '&:hover': { backgroundColor: c.surface.tertiary },
    '&[data-invalid="true"]': { color: c.content.critical },
  },
});
export const chipLabel = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
export const chipRemove = style({
  display: 'none',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  padding: 0,
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: c.content.secondary,
  cursor: 'pointer',
  selectors: {
    [`${chip}:hover &, &:focus-visible`]: { display: 'inline-flex' },
    '&:hover': { color: c.content.primary, backgroundColor: c.surface.tertiaryHover },
  },
});

export const recipientInput = style({
  flex: 1,
  minWidth: 80,
  height: 24,
  padding: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  fontWeight: 500,
  selectors: { '&:disabled': { cursor: 'not-allowed' } },
});

export const massChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 24,
  padding: '0 6px',
  borderRadius: 6,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  color: c.content.primary,
  fontWeight: 500,
});

export const subjectEditor = style({ flex: 1, minWidth: 0 });
globalStyle(`${subjectEditor} .ProseMirror`, { minHeight: 24, whiteSpace: 'pre', overflow: 'hidden' });
globalStyle(`${subjectEditor} .ProseMirror p`, { margin: 0 });

export const bodyScroll = style({
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '22px 17px 16px',
  cursor: 'text',
});

export const bodyEditor = style({ minHeight: '100%' });

export const placeholderLink = style({
  color: c.content.tertiary,
  textDecoration: 'underline',
  textUnderlineOffset: 3,
  textDecorationColor: c.stroke.tertiary,
  pointerEvents: 'auto',
  cursor: 'pointer',
  border: 'none',
  background: 'transparent',
  padding: 0,
  font: 'inherit',
  selectors: { '&:hover': { color: c.content.secondary } },
});

// ---- attachments ---------------------------------------------------------------------------------------------------

export const attachments = style({
  flex: 'none',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  padding: '8px 12px 12px',
});

export const attachment = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: 186,
  height: 46,
  padding: '0 8px',
  borderRadius: 10,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  backgroundColor: c.surface.primary,
});
export const attachmentTile = style({
  flex: 'none',
  width: 28,
  height: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 6,
  backgroundColor: c.surface.tertiary,
  color: c.content.secondary,
  fontSize: 8,
  fontWeight: 600,
  letterSpacing: '0.02em',
});
export const attachmentText = style({ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' });
export const attachmentName = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  ...text.text12.standard,
  fontWeight: 500,
  color: c.content.primary,
});
export const attachmentMeta = style({ ...text.text11.standard, color: c.content.secondary });

// ---- mass sending: recipients panel --------------------------------------------------------------------------------

export const sidePanel = style({
  boxSizing: 'border-box',
  flex: 'none',
  width: SIDE_PANEL_WIDTH,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  borderLeft: `1px solid ${c.stroke.primary}`,
  padding: '6px 6px 0',
  gap: 2,
});

export const addRecipients = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 32,
  padding: '0 10px',
  borderRadius: 8,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  color: c.content.secondary,
  selectors: {
    '&:focus-within': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}, 0 0 0 3px ${c.stroke.accentSubtle}` },
    '&[data-disabled="true"]': { opacity: 0.5 },
  },
});
export const addRecipientsInput = style({
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  selectors: { '&::placeholder': { color: c.content.secondary } },
});

export const recipientList = style({
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  paddingTop: 4,
});

export const recipientRow = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minHeight: 44,
  padding: '6px 10px',
  borderRadius: 8,
  cursor: 'default',
  selectors: {
    '&:hover': { backgroundColor: c.surface.tertiary },
    '&[data-selected="true"]': { backgroundColor: c.surface.tertiary },
    '&[data-selectable="true"]': { cursor: 'pointer' },
  },
});
export const recipientText = style({ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' });
export const recipientName = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontWeight: 500,
  color: c.content.primary,
});
export const recipientAddress = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  ...text.text12.standard,
  color: c.content.secondary,
});
export const recipientRemove = style({
  display: 'none',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: c.content.secondary,
  cursor: 'pointer',
  selectors: {
    [`${recipientRow}:hover &, &:focus-visible`]: { display: 'inline-flex' },
    '&:hover': { color: c.content.primary, backgroundColor: c.surface.tertiaryHover },
  },
});
export const flagDot = style({
  width: 8,
  height: 8,
  borderRadius: 999,
  backgroundColor: c.content.warning,
  flex: 'none',
});

// ---- strips, footer --------------------------------------------------------------------------------------------------

export const infoStrip = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 40,
  padding: '0 16px',
  backgroundColor: c.surface.secondary,
  color: c.content.secondary,
  ...text.text12.standard,
  fontSize: 12,
});
export const infoStripText = style({ flex: 1 });
export const infoLink = style({
  color: c.content.secondary,
  textDecoration: 'underline',
  textUnderlineOffset: 2,
  cursor: 'pointer',
  background: 'transparent',
  border: 'none',
  padding: 0,
  font: 'inherit',
});
export const infoAction = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  color: c.content.secondary,
  cursor: 'pointer',
  background: 'transparent',
  border: 'none',
  padding: 0,
  font: 'inherit',
  selectors: { '&:hover': { color: c.content.primary } },
});

export const warning = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  margin: '0 12px 8px',
  padding: '8px 12px',
  borderRadius: 8,
  backgroundColor: c.surface.warning,
  color: c.content.onWarningSubtle,
  ...text.body.standard,
  fontSize: 13,
});
export const warningText = style({ flex: 1, minWidth: 0 });

export const footer = style({
  boxSizing: 'border-box',
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  height: 44,
  padding: '0 12px',
  borderTop: `1px solid ${c.stroke.primary}`,
});
export const footerTools = style({ display: 'flex', alignItems: 'center', gap: 4, flex: 1 });
export const footerRight = style({ display: 'flex', alignItems: 'center', gap: 8 });
export const massSwitch = style({ display: 'inline-flex', alignItems: 'center', gap: 6, color: c.content.secondary });

export const stateBox = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: 24,
  textAlign: 'center',
});
export const stateTitle = style({ ...text.body.standard, fontWeight: 600 });
export const stateText = style({ ...text.body.standard, color: c.content.secondary });

// ---- review ---------------------------------------------------------------------------------------------------------

export const reviewBody = style({
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '12px 16px 16px',
  fontSize: 14,
  lineHeight: '24px',
  fontWeight: 500,
  wordBreak: 'break-word',
});
globalStyle(`${reviewBody} p`, { margin: '0 0 12px', minHeight: 24 });
globalStyle(`${reviewBody} ul, ${reviewBody} ol`, { margin: '0 0 12px', paddingLeft: 24 });
globalStyle(`${reviewBody} a`, { color: c.content.accent, textDecoration: 'underline' });
globalStyle(`${reviewBody} h1, ${reviewBody} h2, ${reviewBody} h3`, { margin: '0 0 8px' });

export const reviewSubject = style({ ...text.body.standard, fontWeight: 500, minHeight: 24 });
export const reviewMissing = style({ color: c.content.onWarningSubtle });

// ---- template view -----------------------------------------------------------------------------------------------

export const templateSubject = style({
  flex: 'none',
  boxSizing: 'border-box',
  minHeight: 44,
  padding: '10px 16px',
  borderBottom: `1px solid ${c.stroke.primary}`,
  display: 'flex',
  alignItems: 'center',
});
// ---- recipient suggestions (294 px popover, rows with 16 px avatar, bold name, grey address) -------------------------

export const suggestionList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  maxHeight: 280,
  overflowY: 'auto',
});

export const suggestionRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 32,
  padding: '0 8px',
  borderRadius: 8,
  cursor: 'pointer',
  ...text.body.standard,
  selectors: { '&[data-active]': { backgroundColor: c.surface.tertiary } },
});
export const suggestionName = style({
  flex: 'none',
  maxWidth: '60%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontWeight: 600,
  color: c.content.primary,
});
export const suggestionAddress = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: c.content.secondary,
});
export const suggestionHint = style({
  padding: '6px 8px',
  color: c.content.secondary,
  ...text.text12.standard,
  fontSize: 12,
});

export const templateTitleInput = style({
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  fontWeight: 500,
  padding: 0,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});
