// Report editor frame and configuration panel (builder §1–2; evidence editor-*.png): an overlay over the main pane
// (not the sidebar): 48 px top bar, ≈52 px title row, chart canvas on the left and the 416 px panel on the right.
import { insetRing, text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style } from '@vanilla-extract/css';

const c = vars.color;

// ---- frame ---------------------------------------------------------------------------------------------------------

/** A frame inset 6 px from the sidebar side with rounded left corners (evidence report-viewer-fullscreen.png). */
export const overlay = style({
  position: 'absolute',
  inset: '0 0 0 6px',
  zIndex: 40,
  display: 'flex',
  flexDirection: 'column',
  boxSizing: 'border-box',
  backgroundColor: c.surface.primary,
  color: c.content.primary,
  border: `1px solid ${c.stroke.primary}`,
  borderRight: 0,
  borderRadius: '16px 0 0 16px',
  overflow: 'hidden',
});

export const topBar = style({
  flex: 'none',
  height: 49,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '0 10px',
  borderBottom: `1px solid ${c.stroke.primary}`,
});
export const topBarGroup = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });
export const counter = style({ ...text.text12.standard, color: c.content.secondary, marginLeft: 4 });

export const titleRow = style({
  flex: 'none',
  height: 53,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '0 16px',
  borderBottom: `1px solid ${c.stroke.primary}`,
});
export const titleGroup = style({ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: 1 });
export const titleActions = style({ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' });
export const saveGroup = style({ display: 'inline-flex', alignItems: 'center', gap: 1 });

export const body = style({ flex: 1, minHeight: 0, display: 'flex' });

export const canvas = style({
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  padding: '12px 6px 8px',
});
/** Toolbar and chart sit 14 px further in than the calculated-values bar (evidence editor-historical-…png). */
export const canvasBody = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '0 14px',
});
export const canvasChart = style({ flex: 1, minHeight: 0, position: 'relative' });
export const canvasToolbarRow = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
});

export const panel = style({
  flex: 'none',
  width: 402,
  boxSizing: 'border-box',
  borderLeft: `1px solid ${c.stroke.primary}`,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
});
export const panelScroll = style({ flex: 1, minHeight: 0, overflowY: 'auto' });
export const panelTypeRow = style({
  flex: 'none',
  height: 44,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  padding: '0 16px',
  borderBottom: `1px solid ${c.stroke.primary}`,
});
export const typeSwitcher = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  height: 28,
  padding: '0 8px',
  margin: '0 -8px',
  border: 0,
  borderRadius: 8,
  backgroundColor: 'transparent',
  color: c.content.primary,
  ...text.body.standard,
  cursor: 'pointer',
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHover },
    '&[data-focus-visible]': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});
export const typeSwitcherChevron = style({ color: c.content.secondary });

export const section = style({
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 22,
  borderBottom: `1px solid ${c.stroke.primary}`,
  selectors: { '&:last-child': { borderBottom: 0 } },
});
/** Query and visualization sections: tighter rows (cards 13 px apart, chips 6 px). */
export const sectionTight = style({ gap: 13 });
export const sectionRows = style({ gap: 6 });
export const sourceSection = style({ paddingBottom: 25 });
export const targetSection = style({ paddingTop: 11 });
export const switchStack = style({ display: 'flex', flexDirection: 'column', gap: 0 });
export const sectionHeading = style({ ...text.body.standard, color: c.content.primary, marginBottom: 5 });
export const fieldLabel = style({ ...text.text12.standard, color: c.content.secondary });
export const field = style({ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 });

// ---- selects, cards, chips -----------------------------------------------------------------------------------------

export const selectButton = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  minWidth: 0,
  height: 32,
  padding: '0 8px',
  border: 0,
  borderRadius: 9,
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.secondaryTransparent),
  color: c.content.primary,
  ...text.body.standard,
  textAlign: 'left',
  cursor: 'pointer',
  selectors: {
    '&:hover': { backgroundColor: c.surface.primaryHover },
    '&[data-focus-visible], &[aria-expanded="true"]': { boxShadow: insetRing(c.stroke.accent) },
    '&[data-disabled]': { opacity: 0.5, cursor: 'default' },
  },
});
export const selectLabel = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const selectChevron = style({ flex: 'none', color: c.content.secondary });

/** Metric attribute + aggregation: two selects joined into one control. */
export const joined = style({ display: 'flex', alignItems: 'stretch' });
export const joinedLeft = style({ flex: 1, minWidth: 0, borderTopRightRadius: 0, borderBottomRightRadius: 0 });
export const joinedRight = style({ width: 137, flex: 'none', borderTopLeftRadius: 0, borderBottomLeftRadius: 0 });

export const card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  padding: 12,
  borderRadius: 12,
  boxShadow: insetRing(c.stroke.primary),
});
export const cardRow = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 7,
  padding: '12px 0',
  borderTop: `1px solid ${c.stroke.primary}`,
  selectors: { '&:first-child': { borderTop: 0, paddingTop: 0 }, '&:last-child': { paddingBottom: 0 } },
});
/** A card row without the divider or padding (the "Include empty values" switch sits under the select's 12 px). */
export const cardRowBare = style({ display: 'flex', flexDirection: 'column' });
export const cardHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  minHeight: 20,
});

export const ghostDashed = style({
  alignSelf: 'flex-start',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  height: 28,
  padding: '0 10px',
  borderRadius: 8,
  border: `1px dashed ${c.stroke.secondaryTransparent}`,
  backgroundColor: c.interactive.placeholder,
  color: c.content.secondary,
  ...text.body.standard,
  cursor: 'pointer',
  selectors: {
    '&:hover': { backgroundColor: c.interactive.placeholderHover },
    '&[data-focus-visible]': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});

export const switchRow = style({ display: 'flex', alignItems: 'center', gap: 8, minHeight: 32 });
export const switchRowCompact = style({ display: 'flex', alignItems: 'center', gap: 8, minHeight: 20 });
export const switchRowSplit = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  minHeight: 32,
});

export const sortButton = style({
  alignSelf: 'flex-start',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  height: 28,
  padding: '0 10px',
  border: 0,
  borderRadius: 8,
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.secondaryTransparent),
  color: c.content.secondary,
  ...text.body.standard,
  cursor: 'pointer',
  selectors: {
    '&:hover': { backgroundColor: c.surface.primaryHover },
    '&[data-focus-visible]': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});
export const sortStrong = style({ color: c.content.primary });

export const targetInput = style({
  boxSizing: 'border-box',
  width: '100%',
  height: 32,
  padding: '0 8px',
  border: 0,
  borderRadius: 9,
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.secondaryTransparent),
  color: c.content.primary,
  ...text.body.standard,
  outline: 'none',
  selectors: { '&:focus': { boxShadow: insetRing(c.stroke.accent) } },
});

// ---- type picker --------------------------------------------------------------------------------------------------

export const pickerWrap = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  padding: '16px 16px 16px',
});
export const pickerHeading = style({ ...text.heading.small, color: c.content.primary, margin: 0 });
export const pickerSub = style({ ...text.body.standard, color: c.content.secondary, margin: '2px 0 0' });
export const pickerGroup = style({ ...text.text12.standard, color: c.content.secondary, margin: '16px 0 6px' });
export const typeCard = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 8px',
  marginBottom: 8,
  border: 0,
  borderRadius: 8,
  backgroundColor: c.surface.secondary,
  boxShadow: insetRing(c.stroke.primary),
  textAlign: 'left',
  color: c.content.primary,
  cursor: 'pointer',
  selectors: {
    '&:hover': { backgroundColor: c.surface.secondaryHover },
    '&[data-focus-visible]': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});
export const typeCardIcon = style({
  flex: 'none',
  width: 32,
  height: 32,
  display: 'grid',
  placeItems: 'center',
  borderRadius: 8,
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.primary),
  color: c.content.primary,
});
export const typeCardText = style({ display: 'flex', flexDirection: 'column', minWidth: 0 });
export const typeCardTitle = style({ ...text.body.standard, color: c.content.primary });
export const typeCardDescription = style({ ...text.text12.standard, color: c.content.secondary });
export const resources = style({ marginTop: 'auto', paddingTop: 16 });
export const resourceCard = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '12px 12px',
  borderRadius: 8,
  boxShadow: insetRing(c.stroke.primary),
  color: c.content.primary,
  textDecoration: 'none',
  ...text.body.standard,
  selectors: { '&:hover': { backgroundColor: c.surface.secondary } },
});

// ---- time toolbar ----------------------------------------------------------------------------------------------------

export const timeGroup = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0,
  height: 32,
  padding: 2,
  borderRadius: 9,
  backgroundColor: c.surface.tertiary,
  boxSizing: 'border-box',
});
export const timeButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 28,
  padding: '0 8px',
  border: 0,
  borderRadius: 8,
  backgroundColor: 'transparent',
  color: c.content.secondary,
  ...text.body.standard,
  cursor: 'pointer',
  selectors: {
    '&:hover': { color: c.content.primary },
    '&[data-selected]': { backgroundColor: c.surface.primary, color: c.content.primary, boxShadow: vars.elevation.e1 },
    '&[data-focus-visible]': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});
export const timeDivider = style({ width: 1, height: 14, backgroundColor: c.stroke.secondary, margin: '0 2px' });
export const compareButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  height: 32,
  padding: '0 10px',
  borderRadius: 9,
  border: `1px dashed ${c.stroke.secondaryTransparent}`,
  backgroundColor: c.interactive.placeholder,
  color: c.content.secondary,
  ...text.body.standard,
  cursor: 'pointer',
  selectors: {
    '&[data-disabled]': { opacity: 0.5, cursor: 'default' },
    '&[data-active]': {
      border: 0,
      boxShadow: insetRing(c.stroke.secondaryTransparent),
      backgroundColor: c.surface.primary,
      color: c.content.secondary,
    },
    '&[data-focus-visible]': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});
export const compareStrong = style({ color: c.content.primary });

export const note = style({
  ...text.text12.standard,
  color: c.content.secondary,
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
  padding: '8px 12px',
});

// ---- stage picker popover ---------------------------------------------------------------------------------------------

export const stageHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 8px',
  height: 40,
  borderBottom: `1px solid ${c.stroke.primary}`,
});
export const stageSearch = style({
  flex: 1,
  minWidth: 0,
  border: 0,
  outline: 'none',
  backgroundColor: 'transparent',
  color: c.content.primary,
  ...text.body.standard,
  '::placeholder': { color: c.content.tertiary },
});
export const stageToggleAll = style({
  border: 0,
  background: 'transparent',
  color: c.content.secondary,
  ...text.body.standard,
  cursor: 'pointer',
  selectors: { '&:hover': { color: c.content.primary } },
});
export const stageList = style({
  display: 'flex',
  flexDirection: 'column',
  padding: 4,
  maxHeight: 280,
  overflowY: 'auto',
});
export const stageRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 32,
  padding: '0 8px',
  borderRadius: 8,
  cursor: 'pointer',
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHover } },
});
export const stageDot = style({ width: 8, height: 8, borderRadius: '50%', flex: 'none' });
export const stageName = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  ...text.body.standard,
});
export const dotsIcon = style({ display: 'inline-flex', alignItems: 'center', flex: 'none', height: 16 });
export const dotsIconDot = style({
  display: 'inline-flex',
  width: 10,
  height: 10,
  borderRadius: '50%',
  marginLeft: -4,
  boxShadow: `0 0 0 1.5px ${c.surface.primary}`,
  selectors: { '&:first-child': { marginLeft: 0 } },
});

globalStyle(`${typeSwitcher} svg`, { flex: 'none' });
// Selects inside the query cards are 34 px tall with a 10 px radius (evidence editor-insight-bar-grouped-status.png).
globalStyle(`${card} ${selectButton}`, { height: 34, borderRadius: 10 });
globalStyle(`${selectButton}[data-placeholder] > span`, { color: c.content.tertiary });
