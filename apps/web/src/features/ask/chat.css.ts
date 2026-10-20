// Chat surfaces (ask-agentic §1, §3): the full page (668 px composer, 652 px transcript column), the side panel (359 px,
// full height, left border), the empty "What can I help with?" state and the banners that replace the composer.
import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const root = style({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  position: 'relative',
});

// ---- scroll area and columns ------------------------------------------------------------------------------------------------

export const scrollArea = style({ flex: 1, minHeight: 0, position: 'relative' });
export const pageColumn = style({
  boxSizing: 'border-box',
  width: '100%',
  maxWidth: 668,
  margin: '0 auto',
  padding: '12px 8px 24px',
});
export const panelColumn = style({ boxSizing: 'border-box', width: '100%', padding: '12px 16px 24px 18px' });

export const dock = style({ flex: 'none', padding: '0 11px 10px', display: 'flex', flexDirection: 'column', gap: 8 });
export const dockPage = style({
  width: '100%',
  maxWidth: 690,
  margin: '0 auto',
  boxSizing: 'border-box',
  padding: '0 11px 10px',
});

// ---- empty state --------------------------------------------------------------------------------------------------------------

export const empty = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 16px 128px',
  position: 'relative',
});
export const emptyInner = style({ width: '100%', maxWidth: 668, display: 'flex', flexDirection: 'column', gap: 12 });
export const emptyTitle = style({
  ...text.heading.standard,
  fontSize: 20,
  lineHeight: '24px',
  fontWeight: 600,
  letterSpacing: '-0.4px',
  color: c.content.primary,
  margin: '6px 0 12px 8px',
});
export const suggestionRow = style({ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' });
export const suggestionChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 10px',
  border: 'none',
  borderRadius: 8,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  backgroundColor: c.surface.primary,
  color: c.content.secondary,
  cursor: 'pointer',
  ...text.body.standard,
  fontWeight: 400,
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHoverSubtle, color: c.content.primary } },
});
export const learnMore = style({
  position: 'absolute',
  left: '50%',
  bottom: 20,
  transform: 'translateX(-50%)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  width: 308,
});
export const learnMoreLabel = style({ ...text.text12.standard, fontWeight: 400, color: c.content.secondary });
export const learnMoreCard = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: 12,
  borderRadius: 12,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  color: c.content.primary,
  textDecoration: 'none',
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHoverSubtle } },
});
export const learnMoreTile = style({
  width: 56,
  height: 56,
  flex: 'none',
  borderRadius: 10,
  backgroundColor: c.surface.tertiary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: c.content.secondary,
});
export const learnMoreTitle = style({ ...text.body.standard, fontWeight: 500, color: c.content.primary });
export const learnMoreText = style({ ...text.text12.standard, fontWeight: 400, color: c.content.secondary });

// ---- banners ----------------------------------------------------------------------------------------------------------------------

export const notice = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '10px 12px',
  borderRadius: 12,
  backgroundColor: c.surface.warning,
  color: c.content.onWarningSubtle,
  ...text.body.standard,
  fontWeight: 400,
});
export const noticeTitle = style({ fontWeight: 500 });
export const noticeLink = style({ color: 'inherit', textDecoration: 'underline', cursor: 'pointer' });
export const notConfigured = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  textAlign: 'center',
  padding: '24px 16px',
  borderRadius: 12,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  color: c.content.secondary,
  ...text.body.standard,
  fontWeight: 400,
});
export const notConfiguredTitle = style({ fontWeight: 500, color: c.content.primary });

export const loading = style({ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' });
export const notFound = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  color: c.content.secondary,
  ...text.body.standard,
  fontWeight: 400,
});

// ---- panel / page chrome ----------------------------------------------------------------------------------------------------

export const panel = style({
  boxSizing: 'border-box',
  flex: 'none',
  width: 359,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  borderLeft: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
  minHeight: 0,
});
export const panelHeader = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  height: 48,
  padding: '0 12px 0 16px',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
});
export const title = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  ...text.body.standard,
  fontWeight: 500,
  color: c.content.primary,
  border: 'none',
  background: 'transparent',
  textAlign: 'left',
  padding: '2px 4px',
  margin: '0 -4px',
  borderRadius: 6,
  cursor: 'text',
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHoverSubtle } },
});
export const titleInput = style({
  flex: 1,
  minWidth: 0,
  height: 28,
  padding: '0 6px',
  border: 'none',
  outline: 'none',
  borderRadius: 6,
  boxShadow: `inset 0 0 0 1px ${c.stroke.accent}`,
  backgroundColor: c.surface.primary,
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  fontWeight: 500,
});

// ---- history popover ----------------------------------------------------------------------------------------------------------

export const history = style({ display: 'flex', flexDirection: 'column', width: 335 });
export const historyList = style({
  maxHeight: 360,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  padding: '4px 0',
});
export const historyRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 32,
  padding: '0 8px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: c.content.primary,
  textAlign: 'left',
  cursor: 'pointer',
  width: '100%',
  ...text.body.standard,
  fontWeight: 400,
  selectors: { '&:hover, &[data-active]': { backgroundColor: c.interactive.ghostHover } },
});
export const historyTitle = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const historyTime = style({ ...text.text12.standard, fontWeight: 400, color: c.content.tertiary, flex: 'none' });
export const historySearch = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 8px',
  borderBottom: `1px solid ${c.stroke.primary}`,
  color: c.content.tertiary,
});
export const historyInput = style({
  flex: 1,
  height: 36,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: c.content.primary,
  ...text.body.standard,
  fontWeight: 400,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});
export const historyEmpty = style({
  ...text.body.standard,
  fontWeight: 400,
  color: c.content.secondary,
  textAlign: 'center',
  padding: '12px 0',
});

// ---- sidebar Chats ----------------------------------------------------------------------------------------------------------------

export const newChatButton = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  width: '100%',
  height: 28,
  border: `1px dashed ${c.stroke.secondary}`,
  borderRadius: 8,
  background: c.interactive.placeholder,
  color: c.content.secondary,
  cursor: 'pointer',
  ...text.body.standard,
  fontWeight: 400,
  selectors: { '&:hover': { backgroundColor: c.interactive.placeholderHover, color: c.content.primary } },
});

// ---- Home block ----------------------------------------------------------------------------------------------------------------------

export const homeBlock = style({ display: 'flex', flexDirection: 'column', gap: 8 });
export const recentChat = style({
  display: 'inline-flex',
  alignSelf: 'flex-start',
  alignItems: 'center',
  gap: 6,
  padding: '0 8px',
  height: 24,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: c.content.tertiary,
  cursor: 'pointer',
  ...text.text12.standard,
  fontWeight: 400,
  selectors: { '&:hover': { color: c.content.primary, backgroundColor: c.interactive.ghostHoverSubtle } },
});
