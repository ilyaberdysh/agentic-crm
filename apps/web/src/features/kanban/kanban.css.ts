// Kanban board styles: 268 px columns on
// surface.secondary with radius 16 and 8 px gaps, 12 px above the board; 36 px header (10 px stage dot, 14/20 600
// title, count pill, "+" and ⋮⋮); 246 px cards (radius 12, 1 px ring, 8 px apart, inset 11); the calculation line
// under each column; 52 px collapsed strips; the drag placeholder, overlay and drop tint.
import { alpha, scales, text, transitionColors, vars } from '@agentic-crm/ui/styles';
import { globalStyle, keyframes, style } from '@vanilla-extract/css';

const c = vars.color;
const comfortable = `${scales.duration.comfortable}ms ease`;

export const COLUMN_WIDTH = 268;
export const COLLAPSED_WIDTH = 52;
export const COLUMN_GAP = 8;
export const CARD_GAP = 8;
export const CARD_INSET = 11;

// ---- board ---------------------------------------------------------------------------------------------------------

export const boardRoot = style({
  position: 'relative',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: c.surface.primary,
});

export const boardScroller = style({
  flex: 1,
  minHeight: 0,
  overflowX: 'auto',
  overflowY: 'hidden',
  outline: 'none',
});

export const boardRow = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'stretch',
  gap: COLUMN_GAP,
  height: '100%',
  width: 'max-content',
  minWidth: '100%',
  padding: '12px 8px 8px',
});

/** Empty board: short columns faded out at the bottom, the empty state below (evidence kanban-empty-list.png). */
export const boardRowEmpty = style({ height: 'auto', maxHeight: 160, overflow: 'hidden' });
export const emptyFade = style({
  position: 'absolute',
  left: 0,
  right: 0,
  top: 100,
  height: 60,
  pointerEvents: 'none',
  background: `linear-gradient(to bottom, ${alpha('#ffffff', 0)}, ${c.surface.primary})`,
});
export const emptyState = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  // Centred a little above the middle of the space under the short columns (evidence kanban-empty-list.png).
  padding: '24px 16px 96px',
  textAlign: 'center',
  position: 'sticky',
  left: 0,
  width: '100%',
  boxSizing: 'border-box',
});
export const emptyTitle = style({ ...text.heading.small, color: c.content.primary, margin: '16px 0 0' });
export const emptyText = style({ ...text.body.standard, color: c.content.secondary, maxWidth: 280, margin: 0 });
export const emptyActions = style({ display: 'flex', gap: 8, marginTop: 12 });

/** One column and the calculation line under it. */
export const stack = style({
  display: 'flex',
  flexDirection: 'column',
  flex: 'none',
  width: COLUMN_WIDTH,
  minHeight: 0,
});
export const stackCollapsed = style({ width: COLLAPSED_WIDTH });

// ---- column ------------------------------------------------------------------------------------------------------------

export const column = style({
  position: 'relative',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  borderRadius: 16,
  backgroundColor: c.surface.secondary,
  transition: `background-color ${comfortable}, box-shadow ${comfortable}`,
  selectors: {
    // The column under a dragged card: light accent tint over its whole height (evidence kanban-dragging.png).
    '&[data-drop-target]': { backgroundImage: `linear-gradient(${c.surface.accentSubtle}, ${c.surface.accentSubtle})` },
    '&[data-column-dragging]': { opacity: 0.4 },
  },
});

export const header = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  height: 36,
  margin: 8,
  marginBottom: 8,
  padding: '0 8px 0 10px',
  borderRadius: 11,
  flex: 'none',
});

export const headerTitleButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
  minWidth: 0,
  height: 28,
  margin: 0,
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  cursor: 'pointer',
  outline: 'none',
  textAlign: 'left',
  selectors: {
    '&[data-static]': { cursor: 'default' },
    '&[data-focus-visible]': { boxShadow: `0 0 0 2px ${c.stroke.accentMedium}`, borderRadius: 6 },
  },
});

export const dotSlot = style({ display: 'inline-flex', width: 16, justifyContent: 'center', flex: 'none' });

/** "No stage": hollow circle. */
export const hollowDot = style({
  boxSizing: 'border-box',
  width: 10,
  height: 10,
  borderRadius: 999,
  boxShadow: `inset 0 0 0 1.5px ${c.content.tertiary}`,
});

export const headerTitle = style({
  ...text.body.strong,
  color: c.content.primary,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const countPill = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box',
  minWidth: 16,
  height: 16,
  padding: '0 4px',
  marginLeft: -4,
  borderRadius: 5,
  backgroundColor: c.surface.tint,
  color: c.content.secondary,
  ...text.text12.standard,
  fontVariantNumeric: 'tabular-nums',
  flex: 'none',
});

export const headerActions = style({ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, flex: 'none' });

export const iconAction = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: c.content.tertiary,
  cursor: 'pointer',
  outline: 'none',
  transition: transitionColors,
  selectors: {
    '&[data-hovered], &:hover': { backgroundColor: c.interactive.ghostHover, color: c.content.primary },
    '&[data-focus-visible]': { boxShadow: `0 0 0 2px ${c.stroke.accentMedium}` },
  },
});

export const dragHandle = style([iconAction, { cursor: 'grab', touchAction: 'none' }]);

export const body = style({
  position: 'relative',
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  padding: `0 ${CARD_INSET}px 8px`,
  scrollbarWidth: 'thin',
  outline: 'none',
});

export const virtualInner = style({ position: 'relative', width: '100%' });

export const cardSlot = style({ position: 'absolute', left: 0, right: 0, top: 0 });

/** Dashed "+ Add {singular}" in an empty column of an empty board (evidence kanban-empty-list.png). */
export const addPlaceholder = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  width: '100%',
  height: 32,
  border: `1px dashed ${c.stroke.primaryTransparent}`,
  borderRadius: 8,
  backgroundColor: c.interactive.placeholder,
  color: c.content.tertiary,
  fontFamily: 'inherit',
  ...text.body.standard,
  cursor: 'pointer',
  transition: transitionColors,
  selectors: { '&:hover': { backgroundColor: c.interactive.placeholderHover, color: c.content.primary } },
});

// ---- calculation line ------------------------------------------------------------------------------------------------------

export const footer = style({
  flex: 'none',
  height: 44,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  paddingRight: 8,
});

export const footerButton = style({
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 4,
  height: 28,
  padding: '0 4px',
  margin: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  fontFamily: 'inherit',
  cursor: 'pointer',
  outline: 'none',
  whiteSpace: 'nowrap',
  ...text.body.standard,
  lineHeight: '28px',
  color: c.content.secondary,
  transition: transitionColors,
  selectors: {
    '&[data-hovered], &[aria-expanded="true"]': { color: c.content.primary },
    '&[data-focus-visible]': { boxShadow: `0 0 0 2px ${c.stroke.accentMedium}` },
  },
});

export const footerValue = style({ color: c.content.primary, fontVariantNumeric: 'tabular-nums' });
export const footerSuffix = style({ color: c.content.secondary });

// ---- collapsed strip  ---------------------------------------------------------------------------------------------------

export const strip = style({
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 10,
  flex: 1,
  minHeight: 0,
  width: COLLAPSED_WIDTH,
  padding: '20px 0 12px',
  border: 'none',
  borderRadius: 16,
  // Measured: #fbfbfb light, #17181a dark (lighter than an expanded column there).
  backgroundColor: c.surface.primaryHover,
  color: c.content.primary,
  fontFamily: 'inherit',
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&[data-drop-target]': { backgroundImage: `linear-gradient(${c.surface.accentSubtle}, ${c.surface.accentSubtle})` },
    '&:focus-visible': { boxShadow: `0 0 0 2px ${c.stroke.accentMedium}` },
  },
});

export const stripTitle = style({
  ...text.body.strong,
  color: c.content.primary,
  writingMode: 'vertical-rl',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxHeight: '100%',
});

// ---- add stage  ---------------------------------------------------------------------------------------------------------

export const addStage = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  width: 52,
  height: 52,
  border: `1px dashed ${c.stroke.secondaryTransparent}`,
  borderRadius: 16,
  background: 'transparent',
  color: c.content.tertiary,
  cursor: 'pointer',
  outline: 'none',
  transition: transitionColors,
  selectors: {
    '&[data-hovered], &:hover': { backgroundColor: c.interactive.ghostHover, color: c.content.primary },
    '&[data-focus-visible]': { boxShadow: `0 0 0 2px ${c.stroke.accentMedium}` },
  },
});

export const addStageColumn = style({ height: 'auto', alignSelf: 'flex-start', padding: 8, gap: 8 });

export const stageInput = style({
  boxSizing: 'border-box',
  width: '100%',
  height: 32,
  padding: '0 10px',
  border: 'none',
  borderRadius: 8,
  outline: 'none',
  boxShadow: `inset 0 0 0 1px ${c.stroke.accent}`,
  backgroundColor: c.surface.primary,
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  selectors: {
    '&::placeholder': { color: c.content.tertiary, opacity: 1 },
    '&[data-invalid]': { boxShadow: `inset 0 0 0 1px ${c.content.critical}` },
  },
});

export const stageError = style({ ...text.text12.standard, color: c.content.critical, paddingLeft: 4 });

// ---- card (K2) ----------------------------------------------------------------------------------------------------------

export const card = style({
  position: 'relative',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: `0 0 0 1px ${c.stroke.primaryTransparent}`,
  color: c.content.primary,
  cursor: 'pointer',
  outline: 'none',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  touchAction: 'manipulation',
  transition: `box-shadow ${comfortable}, background-color ${comfortable}`,
  selectors: {
    '&:hover': { boxShadow: `0 0 0 1px ${c.stroke.secondaryTransparent}` },
    '&:focus-visible': { boxShadow: `0 0 0 1px ${c.stroke.accent}, 0 0 0 3px ${c.stroke.accentSubtle}` },
    '&[data-selected]': { boxShadow: `0 0 0 1px ${c.stroke.accent}` },
  },
});

/** The dragged card's slot: an empty grey placeholder of the card's size. */
export const cardPlaceholder = style({
  boxSizing: 'border-box',
  width: '100%',
  borderRadius: 12,
  backgroundColor: c.surface.quaternary,
});

const lift = keyframes({
  from: { transform: 'scale(1) rotate(0deg)', boxShadow: `0 0 0 1px ${c.stroke.primaryTransparent}` },
  to: { transform: 'scale(1.02) rotate(1.5deg)' },
});

/** The floating copy under the pointer: elevated, slightly tilted (settles flat on drop). */
export const cardOverlay = style({
  cursor: 'grabbing',
  boxShadow: vars.elevation.e2,
  animation: `${lift} 160ms ease forwards`,
  selectors: { '&:hover': { boxShadow: vars.elevation.e2 } },
});

export const titleRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  padding: '10px 8px 10px 12px',
});

export const avatarSlot = style({
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  flex: 'none',
});

export const cardCheckbox = style({
  position: 'absolute',
  inset: 0,
  boxSizing: 'border-box',
  display: 'none',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  padding: 0,
  margin: 0,
  borderRadius: 4,
  border: 'none',
  boxShadow: `inset 0 0 0 1px ${c.stroke.tertiary}`,
  backgroundColor: c.surface.primary,
  color: c.content.onAccent,
  cursor: 'pointer',
  selectors: {
    [`${card}:hover &, ${card}[data-overlay] &, &[aria-checked="true"]`]: { display: 'inline-flex' },
    '&[aria-checked="true"]': { backgroundColor: c.interactive.primary, boxShadow: 'none' },
  },
});

export const avatarWhenIdle = style({
  display: 'inline-flex',
  selectors: { [`${card}:hover &, ${card}[data-overlay] &, ${card}[data-selected] &`]: { display: 'none' } },
});

export const cardTitle = style({
  ...text.body.standard,
  color: c.content.primary,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textDecoration: 'underline',
  textDecorationColor: c.stroke.secondary,
  textUnderlineOffset: 4,
  textDecorationThickness: 1,
  selectors: { '&:hover': { textDecorationColor: c.content.tertiary } },
});

export const titleActions = style({
  display: 'none',
  alignItems: 'center',
  gap: 2,
  marginLeft: 'auto',
  flex: 'none',
  selectors: { [`${card}:hover &, ${card}[data-overlay] &, ${card}:focus-within &`]: { display: 'inline-flex' } },
});

export const fields = style({ display: 'flex', flexDirection: 'column', padding: '0 8px 0 12px' });

export const fieldRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 28,
  minWidth: 0,
  padding: '3px 0',
});

export const fieldRowLabelled = style({ flexDirection: 'column', alignItems: 'stretch', gap: 4, padding: '4px 0' });

export const fieldIcon = style({ flex: 'none', color: c.content.secondary });

export const fieldLabel = style({
  ...text.text12.standard,
  color: c.content.secondary,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
});

export const fieldValue = style({
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
  minHeight: 24,
  maxWidth: '100%',
  margin: '0 -4px',
  padding: '0 4px',
  borderRadius: 6,
  outline: 'none',
  overflow: 'hidden',
  transition: transitionColors,
  selectors: {
    '&[data-editable]:hover': { backgroundColor: c.interactive.ghostHover },
    '&[data-editable]:focus-visible': { boxShadow: `0 0 0 1px ${c.stroke.accent}` },
  },
});

export const fieldEmpty = style({ ...text.body.standard, color: c.content.tertiary });

export const cardFooter = style({
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  height: 34,
  padding: '0 8px 3px 8px',
});

export const counter = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 22,
  minWidth: 22,
  padding: '0 7px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: c.content.secondary,
  fontFamily: 'inherit',
  ...text.body.small,
  fontVariantNumeric: 'tabular-nums',
  cursor: 'pointer',
  outline: 'none',
  transition: transitionColors,
  selectors: {
    '&[data-hovered], &:hover': { backgroundColor: c.interactive.ghostHover, color: c.content.primary },
    '&[data-focus-visible]': { boxShadow: `0 0 0 2px ${c.stroke.accentMedium}` },
  },
});

export const counterIcon = style({ color: c.content.tertiary, flex: 'none' });

export const timeChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  marginLeft: 'auto',
  height: 22,
  padding: '0 4px',
  borderRadius: 6,
  color: c.content.secondary,
  ...text.body.small,
  fontVariantNumeric: 'tabular-nums',
  selectors: { '&[data-over]': { color: c.content.critical, backgroundColor: c.surface.critical } },
});

// ---- stage menu  ----------------------------------------------------------------------------------------------------------

export const menuPanel = style({ width: 276, padding: 0, overflow: 'hidden' });

export const menuSection = style({
  display: 'flex',
  flexDirection: 'column',
  padding: 4,
  selectors: { '& + &': { borderTop: `1px solid ${c.stroke.primary}` } },
});

export const nameRow = style({ padding: 12 });

export const nameField = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 36,
  padding: '0 10px',
  borderRadius: 8,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  backgroundColor: c.surface.primary,
  selectors: {
    '&:focus-within': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}, 0 0 0 2px ${c.stroke.accentSubtle}` },
  },
});

export const nameInput = style({
  flex: 1,
  minWidth: 0,
  height: '100%',
  margin: 0,
  padding: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.strong,
});

export const colorButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  padding: 0,
  border: 'none',
  borderRadius: 999,
  background: 'transparent',
  cursor: 'pointer',
  flex: 'none',
  outline: 'none',
  selectors: { '&[data-focus-visible]': { boxShadow: `0 0 0 2px ${c.stroke.accentMedium}` } },
});

export const swatchGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 24px)',
  gap: 9,
  padding: 8,
});

export const swatch = style({
  width: 24,
  height: 24,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  outline: 'none',
  transition: `transform ${scales.duration.breezy}ms ease`,
  selectors: {
    '&:hover': { transform: 'scale(1.1)' },
    '&[data-selected]': { boxShadow: `0 0 0 2px ${c.surface.primary}, 0 0 0 3.5px ${c.content.warning}` },
    '&[data-focus-visible]': { boxShadow: `0 0 0 2px ${c.surface.primary}, 0 0 0 3.5px ${c.stroke.accent}` },
  },
});

export const switchRow = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 32,
  padding: '6px 8px',
  borderRadius: 8,
  color: c.content.primary,
  ...text.body.standard,
});

export const switchLabel = style({ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 });

export const targetBlock = style({ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 8px 8px' });
export const targetLabel = style({ ...text.text12.standard, color: c.content.secondary, paddingLeft: 4 });
export const targetField = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  height: 28,
  padding: '0 4px 0 8px',
  borderRadius: 8,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  backgroundColor: c.surface.primary,
  selectors: {
    '&:focus-within': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}, 0 0 0 2px ${c.stroke.accentSubtle}` },
  },
});
export const targetInput = style({
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  MozAppearance: 'textfield',
  selectors: { '&::-webkit-inner-spin-button, &::-webkit-outer-spin-button': { WebkitAppearance: 'none', margin: 0 } },
});
export const unitButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  height: 20,
  padding: '0 6px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: c.content.secondary,
  fontFamily: 'inherit',
  ...text.text12.standard,
  cursor: 'pointer',
  outline: 'none',
  selectors: { '&[data-hovered], &[aria-expanded="true"]': { backgroundColor: c.interactive.ghostHover } },
});

export const menuItem = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  minHeight: 32,
  padding: '6px 8px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  outline: 'none',
  ...text.body.standard,
  selectors: {
    '&[data-hovered], &[data-focus-visible], &:hover': { backgroundColor: c.surface.primaryHover },
    '&[data-danger]': { color: c.content.critical },
  },
});

// ---- toolbar toggles  ------------------------------------------------------------------------------------------------------

export const toggles = style({ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' });

export const toggleGroup = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  height: 28,
  padding: 2,
  boxSizing: 'border-box',
  borderRadius: 8,
  backgroundColor: c.surface.tertiary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primaryTransparent}`,
});

export const toggleButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: c.content.secondary,
  cursor: 'pointer',
  outline: 'none',
  transition: `background-color ${comfortable}, box-shadow ${comfortable}, color ${comfortable}`,
  selectors: {
    '&[data-hovered]': { color: c.content.primary },
    '&[data-selected]': {
      backgroundColor: c.surface.primary,
      color: c.content.primary,
      boxShadow: `0 0 0 1px ${c.stroke.primaryTransparent}, 0 1px 2px ${alpha('#000000', 0.06)}`,
    },
    '&[data-focus-visible]': { boxShadow: `0 0 0 2px ${c.stroke.accentMedium}` },
  },
});

// ---- view settings  -----------------------------------------------------------------------------------------------------

export const settingsPanel = style({ width: 270, maxHeight: '60vh' });
export const settingsTrailing = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  marginLeft: 'auto',
  color: c.content.secondary,
  ...text.body.standard,
});
export const settingsMuted = style({ color: c.content.secondary });

// ---- bulk selection bar -------------------------------------------------------------------------------------------------------

export const bulkBar = style({
  position: 'absolute',
  left: '50%',
  bottom: 56,
  transform: 'translateX(-50%)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 40,
  padding: '0 6px 0 12px',
  borderRadius: 10,
  backgroundColor: c.surface.floating,
  color: c.content.floatingPrimary,
  boxShadow: vars.elevation.e3,
  zIndex: 5,
  ...text.body.standard,
});

export const bulkButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 8px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: c.content.floatingPrimary,
  fontFamily: 'inherit',
  ...text.body.standard,
  cursor: 'pointer',
  selectors: { '&:hover, &[data-hovered]': { backgroundColor: c.surface.floatingPrimaryHover } },
});

globalStyle(`${body}::-webkit-scrollbar`, { width: 6 });
globalStyle(`${body}::-webkit-scrollbar-thumb`, { backgroundColor: c.surface.tintStrong, borderRadius: 3 });

export const srOnly = style({
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
});

/** Popover rows rendered as buttons (views' `row` look without the native button chrome). */
export const rowButton = style({
  width: '100%',
  margin: 0,
  border: 'none',
  background: 'transparent',
  fontFamily: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  selectors: { '&[data-hovered], &[data-focus-visible]': { backgroundColor: c.surface.primaryHover } },
});
