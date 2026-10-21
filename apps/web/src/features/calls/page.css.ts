// The call page (I calls): header, title row, tab bar (Transcript · Speakers · Meeting, with
// Summary first when narrow), the transcript (speaker blocks, timestamps, range dimming, selection popover), the Speakers
// tab (talk share, 4 px timelines, focus), the Meeting tab, and the Summary / Insights column (40 %, resizable).
import { alpha, scales, text, transitionColors, vars } from '@agentic-crm/ui/styles';
import { globalStyle, keyframes, style, styleVariants } from '@vanilla-extract/css';

const c = vars.color;
const ease = `${scales.duration.comfortable}ms ease`;
const HUES = ['blue', 'green', 'orange', 'pink', 'purple', 'red', 'yellow', 'cyan'] as const;

export const page = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: c.surface.primary,
});

export const headerLeft = style({ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 });
export const headerSpacer = style({
  width: 1,
  height: 16,
  backgroundColor: c.stroke.primary,
  margin: '0 4px',
  flex: 'none',
});

export const titleRow = style({
  boxSizing: 'border-box',
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  height: 49,
  padding: '0 12px',
  borderBottom: `1px solid ${c.stroke.primary}`,
});

export const title = style({
  ...text.body.standard,
  fontWeight: 500,
  margin: 0,
  color: c.content.primary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const body = style({ flex: 1, minHeight: 0, display: 'flex', position: 'relative' });

export const main = style({ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' });

// ---- tabs ---------------------------------------------------------------------------------------------------------------------

export const tabsBar = style({
  boxSizing: 'border-box',
  flex: 'none',
  display: 'flex',
  alignItems: 'flex-end',
  height: 48,
  padding: '0 12px',
  borderBottom: `1px solid ${c.stroke.primary}`,
});

export const tabs = style({ display: 'flex', alignItems: 'center', gap: 2, height: 36 });

export const tab = style({
  position: 'relative',
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 8px',
  marginBottom: 4,
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: c.content.secondary,
  fontFamily: 'inherit',
  textDecoration: 'none',
  cursor: 'pointer',
  outline: 'none',
  ...text.body.standard,
  transition: `background-color ${ease}, box-shadow ${ease}, color ${ease}`,
  selectors: {
    '&:hover': { boxShadow: `inset 0 0 0 1px ${c.stroke.primary}` },
    '&[aria-selected="true"]': {
      color: c.content.primary,
      backgroundColor: c.surface.primaryHover,
      boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
    },
    '&[aria-selected="true"]::after': {
      content: '""',
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: -5,
      height: 1,
      backgroundColor: c.content.primary,
    },
    '&[data-focus-visible]': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
  },
});

export const panel = style({ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' });

// ---- summary column -------------------------------------------------------------------------------------------------------------

export const summaryColumn = style({
  position: 'relative',
  boxSizing: 'border-box',
  flex: 'none',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  borderLeft: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
});

export const resizeHandle = style({
  position: 'absolute',
  left: -4,
  top: 0,
  bottom: 0,
  width: 8,
  cursor: 'col-resize',
  zIndex: 3,
  touchAction: 'none',
  selectors: {
    '&::after': {
      content: '""',
      position: 'absolute',
      left: 3,
      top: 0,
      bottom: 0,
      width: 2,
      backgroundColor: 'transparent',
      transition: `background-color ${ease}`,
    },
    '&:hover::after, &[data-dragging="true"]::after': { backgroundColor: c.stroke.accentMedium },
  },
});

export const summaryScroll = style({ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 28px 28px' });
export const summaryNarrow = style({ padding: '0 28px 28px', maxWidth: 'none' });

export const sectionTitle = style({
  ...text.heading.small,
  fontSize: 18,
  lineHeight: '26px',
  fontWeight: 600,
  color: c.content.primary,
  margin: '23px 0 12px',
});

export const summaryText = style({ ...text.body.standard, color: c.content.secondary, margin: 0, userSelect: 'text' });

export const divider = style({ border: 'none', borderTop: `1px solid ${c.stroke.primary}`, margin: '24px 0 0' });

const shimmer = keyframes({ '0%': { backgroundPosition: '200% 0' }, '100%': { backgroundPosition: '-200% 0' } });

export const analyzing = style({
  ...text.body.standard,
  color: 'transparent',
  backgroundImage: `linear-gradient(90deg, ${c.content.tertiary} 40%, ${c.content.primary} 50%, ${c.content.tertiary} 60%)`,
  backgroundSize: '200% 100%',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  animation: `${shimmer} 2.2s linear infinite`,
  '@media': {
    '(prefers-reduced-motion: reduce)': { animation: 'none', color: c.content.tertiary, backgroundImage: 'none' },
  },
});

export const notice = style({
  ...text.body.standard,
  color: c.content.secondary,
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
  padding: '10px 12px',
  borderRadius: 10,
  backgroundColor: c.surface.tint,
  margin: 0,
});
export const noticeIcon = style({ flex: 'none', marginTop: 2, color: c.content.tertiary });

// ---- insights -----------------------------------------------------------------------------------------------------------------

export const insightsHeader = style({
  position: 'sticky',
  top: 0,
  zIndex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '12px 0 4px',
  backgroundColor: c.surface.primary,
});
export const insightsHeaderTitle = style({
  ...text.heading.small,
  fontSize: 18,
  lineHeight: '26px',
  fontWeight: 600,
  margin: 0,
  flex: 1,
});

export const updateButton = style({
  opacity: 0,
  transition: `opacity ${ease}`,
  selectors: { [`${insightsHeader}:hover &, ${insightsHeader}:focus-within &`]: { opacity: 1 } },
});

export const pickerButton = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  maxWidth: 260,
  padding: '0 8px 0 10px',
  border: 'none',
  borderRadius: 8,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  color: c.content.primary,
  fontFamily: 'inherit',
  cursor: 'pointer',
  outline: 'none',
  ...text.body.standard,
  transition: transitionColors,
  selectors: {
    '&[data-hovered], &[aria-expanded="true"]': { backgroundColor: c.interactive.secondaryHover },
    '&[data-focus-visible]': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
  },
});
export const pickerLabel = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });

export const picker = style({ width: 240, display: 'flex', flexDirection: 'column' });
export const pickerSearch = style({
  boxSizing: 'border-box',
  width: '100%',
  height: 36,
  padding: '0 12px',
  border: 'none',
  borderBottom: `1px solid ${c.stroke.primary}`,
  outline: 'none',
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});
export const pickerList = style({
  maxHeight: 260,
  overflow: 'auto',
  padding: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
});
export const pickerItem = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 32,
  padding: '6px 8px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  ...text.body.standard,
  selectors: {
    '&:hover, &:focus-visible': { backgroundColor: c.surface.primaryHover, outline: 'none' },
    '&[aria-checked="true"]': { backgroundColor: c.interactive.selectedSubtle },
  },
});
export const pickerFooter = style({ borderTop: `1px solid ${c.stroke.primary}`, padding: 4 });
export const pickerEmpty = style({
  ...text.body.standard,
  color: c.content.secondary,
  padding: '12px 8px',
  textAlign: 'center',
});

export const insightEmpty = style({
  ...text.body.standard,
  color: c.content.secondary,
  textAlign: 'center',
  padding: '20px 0',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
});

export const outdated = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  borderRadius: 10,
  backgroundColor: c.surface.tint,
  ...text.body.standard,
  color: c.content.secondary,
  margin: '8px 0 0',
});

export const insightSection = style({ margin: '0 0 4px' });
export const insightHeading = style({
  ...text.heading.small,
  fontSize: 16,
  lineHeight: '24px',
  fontWeight: 600,
  margin: '20px 0 8px',
});
export const insightList = style({
  margin: 0,
  paddingLeft: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  color: c.content.secondary,
  ...text.body.standard,
  userSelect: 'text',
});
export const insightText = style({
  ...text.body.standard,
  color: c.content.secondary,
  margin: 0,
  userSelect: 'text',
  whiteSpace: 'pre-wrap',
});
export const insightNothing = style({ ...text.body.standard, color: c.content.tertiary, margin: 0 });

// ---- transcript -----------------------------------------------------------------------------------------------------------------

export const transcript = style({ position: 'relative', padding: '6px 0 48px' });

export const block = style({
  boxSizing: 'border-box',
  padding: '16px 28px 6px 28px',
  scrollMarginTop: 48,
  transition: `opacity ${ease}`,
});

export const blockHead = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  height: 20,
  marginBottom: 8,
});

export const timestamp = style({
  flex: 'none',
  border: 'none',
  padding: '0 4px',
  borderRadius: 4,
  background: 'transparent',
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 500,
  lineHeight: '20px',
  fontVariantNumeric: 'tabular-nums',
  color: alpha('#000000', 50),
  cursor: 'pointer',
  userSelect: 'none',
  outline: 'none',
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHover, color: c.content.primary },
    '&:focus-visible': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
  },
});

export const paragraph = style({
  ...text.body.standard,
  color: c.content.secondary,
  margin: 0,
  userSelect: 'text',
  overflowWrap: 'anywhere',
});

globalStyle(`${paragraph} + ${paragraph}`, { marginTop: 8 });

export const utterance = style({ transition: `color ${ease}` });
export const dimmed = style({ color: c.content.tertiary });
export const blockDimmed = style({ opacity: 0.72 });

export const focusChip = style({
  position: 'sticky',
  top: 8,
  zIndex: 2,
  display: 'flex',
  justifyContent: 'center',
  pointerEvents: 'none',
  height: 0,
});
export const focusChipInner = style({
  pointerEvents: 'auto',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 4px 0 10px',
  borderRadius: 14,
  backgroundColor: c.surface.primary,
  boxShadow: `0 0 0 1px ${c.stroke.secondary}, 0 2px 8px rgba(0,0,0,.08)`,
  ...text.body.standard,
});

export const rangeBar = style({
  position: 'sticky',
  top: 8,
  zIndex: 2,
  display: 'flex',
  justifyContent: 'center',
  pointerEvents: 'none',
  height: 0,
});

// ---- selection popover ----------------------------------------------------------------------------------------------------------

export const selectionMenu = style({
  position: 'fixed',
  zIndex: 60,
  boxSizing: 'border-box',
  width: 176,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  padding: 4,
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: vars.elevation.e2,
  ...text.body.standard,
  color: c.content.primary,
});

export const selectionItem = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 32,
  padding: '0 8px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  ...text.body.standard,
  selectors: { '&:hover, &:focus-visible': { backgroundColor: c.surface.primaryHover, outline: 'none' } },
});

// ---- speakers --------------------------------------------------------------------------------------------------------------------

export const speakers = style({ padding: '12px 12px 24px' });

export const speakerRow = style({
  boxSizing: 'border-box',
  padding: '12px 12px 8px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  transition: `opacity ${ease}`,
  selectors: { '&[data-dimmed="true"]': { opacity: 0.45 } },
});

export const speakerHead = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });
export const speakerHeadChip = style({ flex: 1, minWidth: 0, display: 'flex' });
export const speakerFigure = style({
  ...text.body.standard,
  fontSize: 13,
  color: c.content.secondary,
  fontVariantNumeric: 'tabular-nums',
  flex: 'none',
});

export const focusButton = style({
  boxSizing: 'border-box',
  flex: 'none',
  width: 20,
  height: 20,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 'none',
  borderRadius: 10,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
  color: c.content.primary,
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHover },
    '&:focus-visible': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
  },
});

export const timeline = style({
  position: 'relative',
  height: 4,
  borderRadius: 2,
  backgroundColor: c.surface.tint,
  selectors: {
    '&::before': {
      content: '""',
      position: 'absolute',
      left: -1,
      top: -2,
      width: 2,
      height: 8,
      borderRadius: 1,
      backgroundColor: c.content.primary,
    },
  },
});

export const segment = style({
  position: 'absolute',
  top: 0,
  height: 4,
  borderRadius: 2,
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&:hover': { filter: 'brightness(0.9)', height: 6, top: -1 },
    '&:focus-visible': { boxShadow: `0 0 0 1px ${c.stroke.accent}` },
  },
});

export const segmentHue = styleVariants(
  Object.fromEntries(HUES.map((hue) => [hue, { backgroundColor: c.utilities.surface[hue] }])) as Record<
    (typeof HUES)[number],
    { backgroundColor: string }
  >,
);

// ---- meeting tab ---------------------------------------------------------------------------------------------------------------------

export const meeting = style({ padding: '16px 12px 32px', display: 'flex', flexDirection: 'column' });
export const detailsRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  ...text.body.standard,
  color: c.content.primary,
  padding: '4px 12px',
});
export const detailsDay = style({ fontWeight: 500 });
export const detailsMuted = style({ color: c.content.secondary });
export const detailsLink = style({
  color: c.content.accent,
  textDecoration: 'none',
  selectors: { '&:hover': { textDecoration: 'underline' } },
});

// ---- states --------------------------------------------------------------------------------------------------------------------------

export const state = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '64px 24px',
  textAlign: 'center',
  flex: 1,
});
export const stateTitle = style({ ...text.heading.small, color: c.content.primary });
export const stateText = style({ ...text.body.standard, color: c.content.secondary, maxWidth: 360 });

// ---- share popover ---------------------------------------------------------------------------------------------------------------

export const share = style({ width: 360, display: 'flex', flexDirection: 'column' });
export const shareRow = style({ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' });
export const shareTile = style({
  flex: 'none',
  width: 32,
  height: 32,
  borderRadius: 8,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: c.surface.tint,
  color: c.content.secondary,
});
export const shareTexts = style({ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 });
export const shareTitle = style({ ...text.body.standard, fontWeight: 500 });
export const shareSub = style({ ...text.text12.standard, color: c.content.secondary });
export const shareFooter = style({
  borderTop: `1px solid ${c.stroke.primary}`,
  padding: '8px 12px',
  ...text.body.standard,
  color: c.content.secondary,
});
