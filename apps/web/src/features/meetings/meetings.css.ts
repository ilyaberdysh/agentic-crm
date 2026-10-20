// Meetings UI (F README §2.4–2.5; D README §3.8; B-shell/home.md §2.3; evidence D/D-add-meeting-dialog.png): the
// meeting modal (808 × 584 outer), the "New meeting" dialog, the RSVP pill, and the Home Meetings widget.
import { scales, text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style } from '@vanilla-extract/css';

const c = vars.color;

const truncate = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

// ---- shared ---------------------------------------------------------------------------------------------------------

export const pill = style({
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 22,
  padding: '0 8px 0 7px',
  borderRadius: 7,
  backgroundColor: c.surface.tint,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primaryTransparent}`,
  ...text.text12.standard,
  fontWeight: 500,
  color: c.content.primary,
  whiteSpace: 'nowrap',
});

export const dot = style({
  width: 8,
  height: 8,
  borderRadius: '50%',
  flex: 'none',
  backgroundColor: c.content.tertiary,
  selectors: {
    '&[data-tone="positive"]': { backgroundColor: c.content.success },
    '&[data-tone="warning"]': { backgroundColor: c.content.warning },
    '&[data-tone="critical"]': { backgroundColor: c.content.critical },
  },
});

export const hostTag = style({
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  height: 20,
  padding: '0 5px',
  borderRadius: 6,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  ...text.text12.standard,
  fontWeight: 400,
  color: c.content.primary,
});

export const email = style({ ...text.text12.standard, fontWeight: 400, color: c.content.tertiary, ...truncate });

// ---- meeting modal --------------------------------------------------------------------------------------------------------

export const modal = style({
  boxSizing: 'border-box',
  width: 802,
  maxWidth: '100%',
  height: 578,
  maxHeight: 'calc(100vh - 14vh - 22px)',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
});

export const modalScroll = style({ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 0 8px' });

export const titleRow = style({ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px 8px' });

export const tile = style({
  flex: 'none',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  width: 40,
  height: 40,
  borderRadius: 10,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
  lineHeight: 1,
});
export const tileMonth = style({
  fontSize: 9,
  lineHeight: '11px',
  fontWeight: 600,
  letterSpacing: '0.4px',
  color: c.content.critical,
});
export const tileDay = style({ fontSize: 16, lineHeight: '19px', fontWeight: 600, color: c.content.primary });

export const titleText = style({
  flex: 1,
  minWidth: 0,
  fontSize: 16,
  lineHeight: '24px',
  fontWeight: 600,
  color: c.content.primary,
  margin: 0,
  overflowWrap: 'anywhere',
  selectors: { '&[data-private]': { fontWeight: 400, fontStyle: 'italic', color: c.content.tertiary } },
});

export const titleInput = style({
  flex: 1,
  minWidth: 0,
  boxSizing: 'border-box',
  height: 32,
  padding: '0 6px',
  margin: '0 -6px',
  border: 'none',
  borderRadius: 8,
  outline: 'none',
  background: 'transparent',
  fontSize: 16,
  lineHeight: '24px',
  fontWeight: 600,
  color: c.content.primary,
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHover },
    '&:focus': { backgroundColor: c.surface.primary, boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
    '&::placeholder': { color: c.content.tertiary },
  },
});

export const infoRow = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  minHeight: 32,
  padding: '6px 20px',
  ...text.body.standard,
  color: c.content.primary,
});
export const infoIcon = style({ flex: 'none', color: c.content.tertiary, marginTop: 2 });
export const infoText = style({ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' });
export const infoEmpty = style({ color: c.content.tertiary });

export const descriptionInput = style({
  flex: 1,
  minWidth: 0,
  boxSizing: 'border-box',
  margin: '-2px -6px',
  padding: '2px 6px',
  border: 'none',
  borderRadius: 8,
  outline: 'none',
  resize: 'none',
  background: 'transparent',
  ...text.body.standard,
  color: c.content.primary,
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHover },
    '&:focus': { backgroundColor: c.surface.primary, boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
    '&::placeholder': { color: c.content.tertiary },
  },
});

export const section = style({ display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 20px 4px' });
export const sectionHead = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 20,
  ...text.text12.standard,
  fontWeight: 500,
  color: c.content.secondary,
});
export const sectionCount = style({ fontWeight: 400, color: c.content.tertiary });
export const sectionSpacer = style({ flex: 1 });

export const callLine = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 32,
  ...text.body.standard,
  color: c.content.secondary,
});
export const callRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 32,
  padding: '0 8px',
  margin: '0 -8px',
  borderRadius: 8,
  ...text.body.standard,
  color: c.content.primary,
});
export const link = style({
  color: c.content.accent,
  textDecoration: 'none',
  selectors: { '&:hover': { textDecoration: 'underline' } },
});

export const person = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 36,
  minWidth: 0,
  ...text.body.standard,
  color: c.content.primary,
});
export const personName = style({
  fontWeight: 500,
  ...truncate,
  flex: '0 1 auto',
});
export const personNameLink = style({
  fontWeight: 500,
  color: 'inherit',
  textDecoration: 'none',
  ...truncate,
  selectors: { '&:hover': { textDecoration: 'underline' } },
});
export const personRight = style({ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flex: 'none' });

export const showAll = style({
  alignSelf: 'flex-start',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  height: 24,
  padding: '0 6px',
  margin: '0 -6px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  ...text.body.standard,
  color: c.content.secondary,
  cursor: 'pointer',
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHover, color: c.content.primary } },
});

export const linked = style({ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 4 });
export const linkedItem = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  maxWidth: '100%',
  minHeight: 28,
  padding: '0 4px 0 6px',
  borderRadius: 8,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  ...text.body.standard,
});
export const linkRecords = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  alignSelf: 'flex-start',
  padding: '0 10px',
  border: `1px dashed ${c.stroke.secondary}`,
  borderRadius: 8,
  background: 'transparent',
  ...text.body.standard,
  color: c.content.secondary,
  cursor: 'pointer',
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHover, color: c.content.primary } },
});

export const footer = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  padding: 8,
  borderTop: `1px solid ${c.stroke.primary}`,
});

export const stateBox = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  padding: '64px 24px',
  textAlign: 'center',
});
export const stateTitle = style({ ...text.body.standard, fontWeight: 600, color: c.content.primary });
export const stateText = style({ ...text.body.standard, color: c.content.secondary });

// ---- New meeting dialog (evidence D/D-add-meeting-dialog.png) -----------------------------------------------------------

export const newBody = style({ display: 'flex', flexDirection: 'column' });

export const newHead = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '14px 0 13px',
  borderBottom: `1px solid ${c.stroke.primary}`,
  margin: '0 16px',
});

export const newTitle = style({
  boxSizing: 'border-box',
  width: '100%',
  height: 28,
  padding: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  fontSize: 18,
  lineHeight: '28px',
  fontWeight: 500,
  letterSpacing: '-0.35px',
  color: c.content.primary,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});

export const newDescription = style({
  boxSizing: 'border-box',
  width: '100%',
  minHeight: 48,
  padding: 0,
  border: 'none',
  outline: 'none',
  resize: 'none',
  background: 'transparent',
  ...text.body.standard,
  color: c.content.primary,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});

export const newSection = style({ display: 'flex', flexDirection: 'column', padding: '0 16px' });
/** Section offsets measured on the capture (evidence D-add-meeting-dialog): label, then the row. */
export const whenSection = style({ paddingTop: 13 });
export const peopleSection = style({ paddingTop: 19 });
export const linkedSection = style({ paddingTop: 13 });
export const newLabelRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  minHeight: 20,
  paddingRight: 4,
  ...text.text12.standard,
  fontWeight: 400,
  color: c.content.secondary,
});
export const newError = style({ ...text.text12.standard, fontWeight: 400, color: c.content.critical });

export const whenRow = style({ display: 'flex', alignItems: 'center', minHeight: 28, marginTop: 7 });
export const dateButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  height: 28,
  padding: '0 2px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  ...text.body.standard,
  fontWeight: 500,
  color: c.content.primary,
  cursor: 'pointer',
  selectors: { '&:hover, &[aria-expanded="true"]': { backgroundColor: c.interactive.ghostHover } },
});
export const whenDivider = style({
  flex: 'none',
  width: 1,
  height: 16,
  margin: '0 9px',
  backgroundColor: c.stroke.primary,
});
export const timeInput = style({
  boxSizing: 'border-box',
  width: 68,
  height: 28,
  padding: '0 2px',
  border: 'none',
  borderRadius: 6,
  outline: 'none',
  background: 'transparent',
  ...text.body.standard,
  fontWeight: 500,
  fontVariantNumeric: 'tabular-nums',
  color: c.content.primary,
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHover },
    '&:focus': { backgroundColor: c.surface.primary, boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
    '&[aria-invalid="true"]': { boxShadow: `inset 0 0 0 1px ${c.stroke.critical}` },
  },
});
export const arrow = style({ flex: 'none', margin: '0 9px 0 10px', color: c.content.tertiary });
export const duration = style({ ...text.text12.standard, fontWeight: 400, color: c.content.secondary, marginLeft: 8 });

export const newPerson = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 36,
  minWidth: 0,
  ...text.body.standard,
  color: c.content.primary,
});
export const firstRow = style({ marginTop: 10 });
export const recordRow = style({ minHeight: 32, marginTop: 9 });
export const reveal = style({ opacity: 0, transition: `opacity ${scales.duration.comfortable}ms ease` });
globalStyle(`${newPerson}:hover ${reveal}, ${newPerson}:focus-within ${reveal}`, { opacity: 1 });

export const newFooter = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  padding: '8px 8px 7px',
  marginTop: 17,
  borderTop: `1px solid ${c.stroke.primary}`,
});

export const pickerBox = style({ width: 320, display: 'flex', flexDirection: 'column' });

// ---- Home widget (B-shell/home.md §2.3) ---------------------------------------------------------------------------------

export const homeBlock = style({ display: 'flex', flexDirection: 'column', gap: 4 });
export const homeHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  minHeight: 28,
  padding: '0 7px 0 8px',
});
export const homeTitle = style({ ...text.body.standard, color: c.content.secondary, margin: 0, marginRight: 'auto' });
export const homeDate = style({
  display: 'inline-flex',
  alignItems: 'center',
  height: 20,
  padding: '0 6px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  ...text.text12.standard,
  color: c.content.secondary,
  cursor: 'pointer',
  selectors: {
    '&:hover, &[aria-expanded="true"]': { backgroundColor: c.interactive.ghostHover, color: c.content.primary },
  },
});

export const homeRows = style({ display: 'flex', flexDirection: 'column', gap: 2 });

export const homeRow = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  height: 36,
  padding: '2px 8px',
  border: 'none',
  borderRadius: 10,
  background: 'transparent',
  textAlign: 'left',
  color: c.content.primary,
  cursor: 'pointer',
  outline: 'none',
  ...text.body.standard,
  selectors: {
    '&:hover, &:focus-visible': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&:focus-visible': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
    '&[data-ended]': { opacity: 0.3 },
  },
});
globalStyle(`${homeRow}[data-ended] [data-title]`, { textDecoration: 'line-through' });
export const homeRowTitle = style({ flex: 1, ...truncate });
export const homeRowTime = style({ flex: 'none', ...text.body.standard, fontWeight: 400, color: c.content.tertiary });
export const homeStatus = style({
  flex: 'none',
  width: 10,
  height: 10,
  borderRadius: '50%',
  border: 'none',
  padding: 0,
  backgroundColor: c.content.tertiary,
  selectors: {
    '&[data-tone="positive"]': { backgroundColor: c.content.success },
    '&[data-tone="warning"]': { backgroundColor: c.content.warning },
    '&[data-tone="critical"]': { backgroundColor: c.content.critical },
  },
});

export const homeMore = style({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  height: 32,
  padding: '0 8px',
  border: 'none',
  borderRadius: 10,
  background: 'transparent',
  ...text.body.standard,
  fontWeight: 400,
  color: c.content.tertiary,
  cursor: 'pointer',
  textAlign: 'left',
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHoverSubtle, color: c.content.secondary } },
});

export const homeCard = style({
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 14,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}, ${vars.elevation.e1}`,
  margin: '2px 0',
  overflow: 'hidden',
});
export const homeCardHead = style({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  height: 40,
  padding: '0 8px 0 12px',
  ...text.body.standard,
  color: c.content.primary,
});
export const homeCardBody = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  maxHeight: 240,
  overflowY: 'auto',
  padding: '4px 12px 12px',
});
export const homeCardLabel = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 4,
  ...text.text12.standard,
  fontWeight: 500,
  color: c.content.secondary,
});
export const homeCardText = style({
  ...text.body.standard,
  fontWeight: 400,
  color: c.content.primary,
  overflow: 'hidden',
  display: '-webkit-box',
  WebkitLineClamp: 1,
  WebkitBoxOrient: 'vertical',
});
export const homeCardFoot = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  padding: 8,
  borderTop: `1px solid ${c.stroke.primary}`,
});

export const homeEmpty = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  padding: '28px 16px',
  textAlign: 'center',
});
export const homeEmptyTitle = style({ ...text.body.standard, color: c.content.primary });
export const homeEmptyText = style({
  ...text.body.standard,
  fontWeight: 400,
  color: c.content.secondary,
  marginBottom: 8,
});
export const homeError = style({ ...text.body.standard, color: c.content.critical, padding: 8 });
export const homeSkeleton = style({ display: 'flex', alignItems: 'center', gap: 10, height: 36, padding: '0 8px' });

export const filterMenu = style({
  boxSizing: 'border-box',
  minWidth: 300,
  display: 'flex',
  flexDirection: 'column',
  padding: 4,
});
export const filterLabel = style({ ...text.text12.standard, color: c.content.tertiary, padding: '6px 8px 4px' });
export const filterItem = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 32,
  padding: '0 8px',
  ...text.body.standard,
});
