// Comments panel:
// comments-resolved-filter.png, comment-reaction-tooltip.png, comment-emoji-picker.png, comment-deeplink-view.png):
// 320 px panel, "All comments" header with a filter button (blue dot when active), thread cards (1 px border,
// radius 12, hover action pill), resolved cards, the composer (blue focus border), the thread view with its replies
// divider, reaction chips and the 290 px emoji picker (8 per row, 32 px cells, sticky category headers).
import { alpha, scales, text, transitionColors, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;
const ease = `${scales.duration.comfortable}ms ease`;

export const panel = style({ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 });

export const header = style({
  boxSizing: 'border-box',
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 48,
  padding: '0 10px 0 10px',
});

export const headerTitle = style({
  ...text.body.standard,
  fontWeight: 500,
  color: c.content.primary,
  flex: 1,
  minWidth: 0,
  paddingLeft: 7,
  selectors: { '* + &': { paddingLeft: 2 } },
});

export const filterWrap = style({ position: 'relative', display: 'inline-flex' });

export const filterDot = style({
  position: 'absolute',
  top: 4,
  right: 4,
  width: 6,
  height: 6,
  borderRadius: 999,
  backgroundColor: c.surface.accent,
  pointerEvents: 'none',
});

export const subject = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '0 12px 10px',
  ...text.text12.standard,
  color: c.content.secondary,
  minWidth: 0,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
});

export const scroll = style({
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '6px 12px 12px',
});

// ---- thread card ------------------------------------------------------------------------------------------------------

export const card = style({
  position: 'relative',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '10px 11px 10px',
  borderRadius: 12,
  border: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
  transition: `border-color ${ease}`,
  selectors: {
    '&[data-focused]': { borderColor: c.stroke.accent },
    '&[data-clickable]': { cursor: 'pointer' },
  },
});

export const resolvedLabel = style({ ...text.text12.standard, color: c.content.secondary, marginBottom: 6 });

export const resolved = style({ opacity: 0.6 });

export const comment = style({ position: 'relative', display: 'flex', flexDirection: 'column', gap: 2 });

export const commentHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  ...text.body.standard,
  whiteSpace: 'nowrap',
});

export const author = style({
  fontWeight: 600,
  color: c.content.primary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

export const time = style({
  ...text.body.standard,
  color: c.content.tertiary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

/** The thread line under the author's avatar, down to the replies row (record-comments-panel.png). */
export const threadLine = style({
  selectors: {
    '&::before': {
      content: '""',
      position: 'absolute',
      left: 7,
      top: 26,
      bottom: 14,
      width: 1,
      backgroundColor: c.stroke.secondary,
    },
  },
});

export const body = style({
  ...text.body.standard,
  color: c.content.primary,
  paddingLeft: 22,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
});

export const mention = style({ color: c.content.accent });
export const link = style({
  color: c.content.accent,
  textDecoration: 'none',
  selectors: { '&:hover': { textDecoration: 'underline' } },
});
export const bold = style({ fontWeight: 600 });
export const italic = style({ fontStyle: 'italic' });

export const replies = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  marginTop: 6,
  marginLeft: 22,
  padding: '0 4px',
  height: 24,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: c.content.secondary,
  fontFamily: 'inherit',
  cursor: 'pointer',
  width: 'fit-content',
  ...text.body.standard,
  selectors: { '&[data-hovered]': { backgroundColor: c.interactive.ghostHover, color: c.content.primary } },
});

export const facepile = style({ display: 'inline-flex' });

export const actions = style({
  position: 'absolute',
  top: -4,
  right: -4,
  display: 'flex',
  alignItems: 'center',
  gap: 0,
  padding: 2,
  borderRadius: 10,
  backgroundColor: c.surface.primary,
  boxShadow: vars.elevation.e2,
  opacity: 0,
  pointerEvents: 'none',
  transition: `opacity ${ease}`,
  zIndex: 1,
  selectors: {
    [`${comment}:hover &, &:focus-within, &[data-open]`]: { opacity: 1, pointerEvents: 'auto' },
  },
});

export const actionsStatic = style({
  position: 'static',
  opacity: 1,
  pointerEvents: 'auto',
  boxShadow: 'none',
  padding: 0,
  marginLeft: 'auto',
});

// ---- reactions -----------------------------------------------------------------------------------------------------------

export const reactions = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 4,
  marginTop: 6,
  paddingLeft: 22,
});

export const reaction = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 22,
  padding: '0 6px',
  border: 'none',
  borderRadius: 7,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  color: c.content.primary,
  fontFamily: 'inherit',
  cursor: 'pointer',
  ...text.text12.standard,
  transition: transitionColors,
  selectors: {
    '&[data-hovered]': { backgroundColor: c.interactive.secondaryHover },
    '&[aria-pressed="true"]': {
      backgroundColor: c.surface.accentSubtle,
      boxShadow: `inset 0 0 0 1px ${c.stroke.accentMedium}`,
      color: c.content.accent,
    },
  },
});

// ---- composer ------------------------------------------------------------------------------------------------------------

export const composer = style({
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '11px 8px 8px 12px',
  borderRadius: 12,
  border: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
  transition: `border-color ${ease}`,
  selectors: { '&:focus-within, &[data-focused]': { borderColor: c.stroke.accent } },
});

export const composerFlat = style({ border: 'none', padding: '8px 2px', borderRadius: 0 });

export const composerRow = style({ display: 'flex', alignItems: 'flex-start', gap: 8 });

export const composerAvatar = style({ marginTop: 2, flex: 'none' });

export const composerFooter = style({ display: 'flex', alignItems: 'center', gap: 2 });

export const composerSpacer = style({ flex: 1 });

// ---- thread view ----------------------------------------------------------------------------------------------------------

export const threadRoot = style({ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' });

export const divider = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  ...text.text12.standard,
  color: c.content.secondary,
  margin: '6px 0 2px',
  selectors: { '&::after': { content: '""', flex: 1, height: 1, backgroundColor: c.stroke.primary } },
});

export const reply = style({
  position: 'relative',
  padding: '6px 2px 6px 0',
  selectors: {
    '&::before': {
      content: '""',
      position: 'absolute',
      left: 7,
      top: 26,
      bottom: 0,
      width: 1,
      backgroundColor: alpha('#000000', 8),
    },
  },
});

// ---- empty states -----------------------------------------------------------------------------------------------------

export const empty = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  padding: '40px 16px',
  textAlign: 'center',
});

export const emptyTitle = style({ ...text.body.standard, fontWeight: 600, color: c.content.primary });
export const emptyText = style({ ...text.text12.standard, color: c.content.secondary });

// ---- emoji picker (290 wide) -------------------------------------------------------------------------------------------

export const picker = style({ display: 'flex', flexDirection: 'column', width: 290, outline: 'none' });

export const pickerSearch = style({ padding: 8, flex: 'none' });

export const pickerInput = style({
  boxSizing: 'border-box',
  width: '100%',
  height: 32,
  padding: '0 10px',
  border: 'none',
  borderRadius: 8,
  outline: 'none',
  boxShadow: `inset 0 0 0 1px ${c.stroke.accent}`,
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});

export const pickerScroll = style({ height: 252, overflowY: 'auto', padding: '0 8px 6px' });

export const pickerCategory = style({
  position: 'sticky',
  top: 0,
  zIndex: 1,
  padding: '4px 4px',
  backgroundColor: c.surface.primary,
  ...text.text12.standard,
  color: c.content.secondary,
});

export const pickerGrid = style({ display: 'grid', gridTemplateColumns: 'repeat(8, 32px)' });

export const pickerEmoji = style({
  height: 32,
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  fontSize: 19,
  lineHeight: '32px',
  cursor: 'pointer',
  padding: 0,
  outline: 'none',
  selectors: {
    '&:hover, &:focus-visible': { backgroundColor: c.interactive.ghostHover },
  },
});
