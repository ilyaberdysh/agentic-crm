// Attributes tab and the create/edit attribute dialog (J attribute-dialogs; measured on evidence/J/object-attributes-
// tab.png and raw J s11/s12/s15–s25 dialog shots): table columns at x 27 / 50 / 295 / 407 / 553 / 741 inside the card;
// dialog body padding 16, fields 16 apart, 34 px controls, 32 px constraint rows, separators inset 12 px.
import { insetRing, text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style, styleVariants } from '@vanilla-extract/css';

const c = vars.color;

// ---- attributes table -------------------------------------------------------------------------------------------

export const grid = style({
  gridTemplateColumns: '24px 245px 112px 146px minmax(0, 1fr) 28px',
  paddingInline: '15px 13px',
});

export const indent = style({ paddingLeft: 11 });

export const headerRow = style({ minHeight: 40 });

// While the page scrolls, the search row and the table header stay pinned (evidence/J/object-attributes-archived.png:
// search at 16 px below the page header, the column header right under it). The toolbar's padding paints over rows
// passing beneath; negative margins keep the static layout unchanged.
export const stickyToolbar = style({
  position: 'sticky',
  top: 0,
  zIndex: 3,
  margin: '-16px 0 -16px',
  padding: '16px 0',
  backgroundColor: c.surface.primary,
});

export const stickyTable = style({ selectors: { '&&': { overflow: 'visible' } } });

export const stickyHeader = style({
  position: 'sticky',
  top: 64,
  zIndex: 2,
  backgroundColor: c.surface.primary,
  borderRadius: '12px 12px 0 0',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}, inset 0 1px 0 ${c.stroke.primary}, inset 1px 0 0 ${c.stroke.primary}, inset -1px 0 0 ${c.stroke.primary}`,
});

export const dragHandle = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  borderRadius: 6,
  color: c.content.tertiary,
  cursor: 'grab',
  opacity: 0.8,
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHover, color: c.content.secondary } },
});

export const dragHandleDisabled = style({ cursor: 'default', opacity: 0.35, pointerEvents: 'none' });

export const typeIcon = style({ color: c.content.secondary, flex: 'none' });

export const relationChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
  maxWidth: 110,
  ...text.text12.standard,
  color: c.content.secondary,
});

export const relationIcon = style({ color: c.utilities.content.onPurpleSubtle, flex: 'none' });

export const dropBefore = style({ boxShadow: `inset 0 2px 0 ${c.stroke.accent}` });
export const dropAfter = style({ boxShadow: `inset 0 -2px 0 ${c.stroke.accent}` });
export const dragging = style({ opacity: 0.4 });

export const archivedBand = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 41,
  boxSizing: 'border-box',
  padding: '0 14px',
  borderTop: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.secondary,
  ...text.text12.standard,
  color: c.content.secondary,
  cursor: 'pointer',
  userSelect: 'none',
  outline: 'none',
  selectors: {
    '&:focus-visible': { boxShadow: insetRing(c.stroke.accent) },
    '&:last-child': { borderRadius: '0 0 12px 12px' },
  },
});

export const bandChevron = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  borderRadius: 6,
  boxShadow: insetRing(c.stroke.primary),
  backgroundColor: c.surface.primary,
  color: c.content.secondary,
});

export const filterPanel = style({ width: 200, display: 'flex', flexDirection: 'column' });

export const filterHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 8px 6px 12px',
  ...text.text12.standard,
  color: c.content.secondary,
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
});

export const filterList = style({
  display: 'flex',
  flexDirection: 'column',
  padding: 4,
  maxHeight: 420,
  overflowY: 'auto',
});

export const filterItem = style({ height: 32, padding: '0 8px', display: 'flex', alignItems: 'center' });

export const filterSeparator = style({ height: 1, backgroundColor: c.stroke.primary, margin: '3px 0' });

export const linkButton = style({
  border: 'none',
  background: 'none',
  padding: '2px 4px',
  borderRadius: 6,
  ...text.text12.standard,
  color: c.content.secondary,
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&[data-hovered]': { color: c.content.primary, backgroundColor: c.interactive.ghostHover },
    '&[data-focus-visible]': { boxShadow: insetRing(c.stroke.accent) },
  },
});

// ---- dialog -----------------------------------------------------------------------------------------------------

export const dialogBody = style({
  padding: '16px 16px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  maxHeight: 'min(670px, calc(100vh - 14vh - 120px))',
  overflowY: 'auto',
});

/** The relationship layout sits tighter under the header (raw J s12-dlg-relationship). */
export const relationshipBody = style({ paddingTop: 10, gap: 13 });

export const relConfigure = style({ marginTop: 11 });

export const relConfigureLabel = style({ selectors: { '&&': { paddingLeft: 0 } } });

export const separator = style({ height: 1, backgroundColor: c.stroke.primary, margin: '0 -4px', flex: 'none' });

export const twoCols = style({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 });

export const fieldLabel = style({
  ...text.text12.standard,
  color: c.content.tertiary,
  paddingLeft: 4,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
});

export const field = style({ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 });

export const constraints = style({ display: 'flex', flexDirection: 'column', marginTop: -5 });

export const description = style({ minHeight: 56 });

export const constraintRow = style({
  height: 32,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  paddingLeft: 4,
  ...text.body.standard,
});

/** Select-like trigger used by type picker, default value menus, options/statuses fields. */
export const fieldButton = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  minHeight: 34,
  padding: '0 8px 0 10px',
  border: 'none',
  borderRadius: 10,
  backgroundColor: c.interactive.ghost,
  boxShadow: insetRing(c.stroke.primaryTransparent),
  ...text.body.standard,
  color: c.content.primary,
  textAlign: 'left',
  cursor: 'pointer',
  outline: 'none',
  transition: 'box-shadow 140ms ease, background-color 140ms ease',
  selectors: {
    '&[data-hovered]': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&[data-focus-visible], &[data-pressed], &[aria-expanded="true"]': { boxShadow: insetRing(c.stroke.accent) },
    '&[data-disabled]': { cursor: 'default', backgroundColor: c.interactive.placeholder, color: c.content.secondary },
    '&[data-invalid]': { boxShadow: insetRing(c.stroke.critical) },
  },
});

export const fieldButtonDisabledType = style({ selectors: { '&[data-disabled]': { opacity: 0.5 } } });

export const fieldButtonValue = style({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
});

export const placeholderText = style({ color: c.content.tertiary });

export const chevron = style({ color: c.content.secondary, flex: 'none' });

export const chipRow = style({ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '6px 0' });

export const stageChip = style({ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 4 });

export const aiCard = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 38,
  padding: '0 10px',
  borderRadius: 10,
  boxShadow: insetRing(c.stroke.primary),
  ...text.body.standard,
  color: c.content.primary,
});

export const aiIcon = style({ color: c.content.secondary });

export const formulaButton = style({
  boxSizing: 'border-box',
  width: '100%',
  height: 32,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  borderRadius: 9,
  border: `1px dashed ${c.stroke.primaryTransparent}`,
  backgroundColor: c.interactive.placeholder,
  color: c.content.tertiary,
  ...text.body.standard,
});

// Option previews ("Code 1 200,50 USD") show in the list only, not in the closed select.
export const configSelect = style({});
export const optionPreview = style({ ...text.text12.standard, color: c.content.secondary, marginLeft: 4 });
globalStyle(`${configSelect} ${optionPreview}`, { display: 'none' });

// "Available object types" checklist (raw J s24-dd-record_objects).
export const checkList = style({
  display: 'flex',
  flexDirection: 'column',
  padding: 4,
  maxHeight: 320,
  overflowY: 'auto',
});
export const checkListLabel = style({ ...text.text12.standard, color: c.content.secondary, padding: '4px 8px' });
export const checkListRow = style({
  height: 32,
  display: 'flex',
  alignItems: 'center',
  padding: '0 8px',
  borderRadius: 8,
  selectors: { '&:hover': { backgroundColor: c.surface.primaryHover } },
});
export const checkListItem = style({ display: 'inline-flex', alignItems: 'center', gap: 8, ...text.body.standard });

// ---- type picker ------------------------------------------------------------------------------------------------

export const pickerList = style({ maxHeight: 640, overflowY: 'auto', padding: 4 });

// ---- options / statuses editor ----------------------------------------------------------------------------------

export const editorPanel = style({ display: 'flex', flexDirection: 'column', padding: 4, gap: 2 });

export const editorRows = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  maxHeight: 320,
  overflowY: 'auto',
});

export const editorRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  padding: '0 4px',
  borderRadius: 8,
  selectors: { '&:focus-within': { backgroundColor: c.surface.primaryHover } },
});

export const editorRowError = style({ ...text.text11.standard, color: c.content.critical, padding: '0 0 4px 62px' });

export const editorInput = style({
  flex: 1,
  minWidth: 0,
  height: 28,
  padding: '0 6px',
  border: 'none',
  borderRadius: 6,
  outline: 'none',
  background: 'transparent',
  ...text.body.standard,
  fontFamily: 'inherit',
  color: c.content.primary,
  selectors: {
    '&::placeholder': { color: c.content.tertiary },
    '&:focus': { boxShadow: insetRing(c.stroke.accent) },
  },
});

export const editorFooter = style({ padding: '6px 8px 8px' });

export const limitNote = style({ ...text.text12.standard, color: c.content.warning, margin: '0 0 6px 4px' });

export const colorButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  padding: 0,
  border: 'none',
  borderRadius: 10,
  cursor: 'pointer',
  outline: 'none',
  flex: 'none',
  selectors: { '&[data-focus-visible]': { boxShadow: `0 0 0 2px ${c.stroke.accent}` } },
});

export const stageDot = style({ width: 10, height: 10, borderRadius: 5, flex: 'none' });

export const colorGrid = style({ display: 'grid', gridTemplateColumns: 'repeat(3, 32px)', padding: 8, gap: 0 });

export const colorCell = style({
  width: 32,
  height: 32,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  background: 'transparent',
  borderRadius: 8,
  padding: 0,
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&[data-hovered]': { backgroundColor: c.interactive.ghostHover },
    '&[data-focus-visible]': { boxShadow: insetRing(c.stroke.accent) },
  },
});

export const colorSample = style({
  width: 18,
  height: 18,
  borderRadius: 9,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 9,
  fontWeight: 600,
});

export const colorSampleSelected = style({ boxShadow: `0 0 0 2px ${c.surface.primary}, 0 0 0 3px ${c.stroke.accent}` });

export const stageMenu = style({ width: 260, display: 'flex', flexDirection: 'column', padding: 4 });

export const stageMenuRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: 32,
  padding: '0 8px',
  ...text.body.standard,
});

export const stageMenuLabel = style({ ...text.body.standard, color: c.content.secondary, padding: '4px 8px 4px' });

export const timeRow = style({ display: 'flex', gap: 0, padding: '0 8px 8px' });

export const timeInput = style({
  flex: 1,
  minWidth: 0,
  height: 32,
  padding: '0 10px',
  border: 'none',
  borderRadius: '9px 0 0 9px',
  outline: 'none',
  boxShadow: insetRing(c.stroke.primaryTransparent),
  background: 'transparent',
  ...text.body.standard,
  fontFamily: 'inherit',
  color: c.content.primary,
  textAlign: 'right',
  selectors: { '&:focus': { boxShadow: insetRing(c.stroke.accent) }, '&::placeholder': { color: c.content.tertiary } },
});

// ---- relationship -------------------------------------------------------------------------------------------------

export const infoBanner = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '8px 12px',
  borderRadius: 10,
  backgroundColor: c.surface.secondary,
  boxShadow: insetRing(c.stroke.primary),
  ...text.body.standard,
  color: c.content.secondary,
});

export const bannerIcon = style({ flex: 'none', marginTop: 2, color: c.content.secondary });

export const bannerLink = style({ color: c.content.accent, textDecoration: 'none' });

export const relLayout = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 202px minmax(0, 1fr)',
  alignItems: 'start',
});

export const relCard = style({
  boxSizing: 'border-box',
  borderRadius: 12,
  boxShadow: insetRing(c.stroke.primary),
  backgroundColor: c.surface.primary,
  overflow: 'hidden',
});

export const relCardHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 37,
  padding: '0 12px',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
  ...text.body.strong,
  color: c.content.primary,
});

export const relCardPicker = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  height: 37,
  padding: '0 12px',
  border: 'none',
  background: 'transparent',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
  ...text.body.strong,
  color: c.content.primary,
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&[data-hovered]': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&[data-focus-visible]': { boxShadow: insetRing(c.stroke.accent) },
    '&[data-disabled]': { cursor: 'default', color: c.content.tertiary, opacity: 0.6 },
  },
});

export const relCardBody = style({ padding: '12px 12px 12px' });

export const relCenter = style({ position: 'relative', display: 'flex', justifyContent: 'center', paddingTop: 41 });

export const relLine = style({
  position: 'absolute',
  top: 58,
  left: 0,
  right: 0,
  height: 1,
  backgroundColor: c.stroke.secondary,
});

export const relSelect = style({ position: 'relative', zIndex: 1 });

export const cardinalityButton = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 34,
  padding: '0 8px 0 12px',
  border: 'none',
  borderRadius: 10,
  backgroundColor: c.surface.primary,
  boxShadow: `${insetRing(c.stroke.primaryTransparent)}, 0 0 0 4px ${c.surface.primary}`,
  ...text.body.standard,
  color: c.content.primary,
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&[data-hovered]': { backgroundColor: c.surface.primaryHover },
    '&[data-focus-visible], &[aria-expanded="true"]': { boxShadow: insetRing(c.stroke.accent) },
    '&[data-disabled]': { cursor: 'default', opacity: 0.5 },
  },
});

export const warning = style({ ...text.text12.standard, color: c.content.warning, paddingLeft: 4 });

// Cardinality menu + dark side card (raw J s24-dd-rel_cardinality): the popover itself is transparent and holds
// the menu card and the hint card side by side.
export const hintPopover = style({
  selectors: {
    '&&': { padding: 0, backgroundColor: 'transparent', boxShadow: 'none', overflow: 'visible', borderRadius: 0 },
  },
});

export const hintRow = style({ display: 'flex', alignItems: 'flex-start', gap: 4 });

export const hintMenu = style({
  width: 200,
  padding: 4,
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: vars.elevation.e2,
});

export const hintCard = style({
  width: 320,
  boxSizing: 'border-box',
  padding: 12,
  marginTop: -60,
  borderRadius: 12,
  backgroundColor: c.surface.floating,
  boxShadow: vars.elevation.e2,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
});

export const hintDiagram = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 120,
  marginBottom: 10,
});

export const hintStack = style({
  selectors: {
    '&[data-many]': { boxShadow: `3px 3px 0 -1px ${c.surface.floating}, 3px 3px 0 0 ${c.stroke.floating}` },
  },
  borderRadius: 6,
});

export const hintBox = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 104,
  height: 32,
  padding: '0 12px',
  borderRadius: 6,
  backgroundColor: c.surface.floating,
  boxShadow: insetRing(c.stroke.floating),
  ...text.body.standard,
  color: c.content.floatingPrimary,
});

export const hintLine = style({ width: 64, height: 1, backgroundColor: c.content.floatingTertiary });

export const hintTitle = style({ ...text.body.strong, color: c.content.floatingPrimary });

export const hintText = style({ ...text.text12.standard, color: c.content.floatingSecondary });

// ---- default values -----------------------------------------------------------------------------------------------

export const stars = style({ display: 'flex', alignItems: 'center', gap: 2 });

export const star = style({
  display: 'inline-flex',
  padding: 1,
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  color: c.surface.tintStrong,
  outline: 'none',
  selectors: {
    '&[data-filled]': { color: c.interactive.primary },
    '&[data-focus-visible]': { boxShadow: insetRing(c.stroke.accent), borderRadius: 4 },
  },
});

export const ratingRow = style({ display: 'flex', alignItems: 'center', gap: 6 });

export const ratingBox = style({
  boxSizing: 'border-box',
  flex: 1,
  height: 32,
  display: 'flex',
  alignItems: 'center',
  padding: '0 8px',
  borderRadius: 9,
  boxShadow: insetRing(c.stroke.primaryTransparent),
});

export const checkboxBox = style({
  boxSizing: 'border-box',
  height: 32,
  display: 'flex',
  alignItems: 'center',
  padding: '0 8px',
  borderRadius: 9,
  boxShadow: insetRing(c.stroke.primaryTransparent),
});

export const phoneRow = style({ display: 'flex', gap: 6 });

export const locationPanel = style({ width: 360, padding: 12, display: 'flex', flexDirection: 'column', gap: 12 });

export const hueDot = styleVariants({
  grey: { backgroundColor: c.utilities.surface.grey },
  red: { backgroundColor: c.utilities.surface.red },
  orange: { backgroundColor: c.utilities.surface.orange },
  yellow: { backgroundColor: c.utilities.surface.yellow },
  amber: { backgroundColor: c.utilities.surface.amber },
  lime: { backgroundColor: c.utilities.surface.lime },
  green: { backgroundColor: c.utilities.surface.green },
  cyan: { backgroundColor: c.utilities.surface.cyan },
  blue: { backgroundColor: c.utilities.surface.blue },
  purple: { backgroundColor: c.utilities.surface.purple },
  lavender: { backgroundColor: c.utilities.surface.lavender },
  pink: { backgroundColor: c.utilities.surface.pink },
});

export const hueSubtle = styleVariants({
  grey: { backgroundColor: c.utilities.surface.greySubtle, color: c.utilities.content.onGreySubtle },
  red: { backgroundColor: c.utilities.surface.redSubtle, color: c.utilities.content.onRedSubtle },
  orange: { backgroundColor: c.utilities.surface.orangeSubtle, color: c.utilities.content.onOrangeSubtle },
  yellow: { backgroundColor: c.utilities.surface.yellowSubtle, color: c.utilities.content.onYellowSubtle },
  amber: { backgroundColor: c.utilities.surface.amberSubtle, color: c.utilities.content.onAmberSubtle },
  lime: { backgroundColor: c.utilities.surface.limeSubtle, color: c.utilities.content.onLimeSubtle },
  green: { backgroundColor: c.utilities.surface.greenSubtle, color: c.utilities.content.onGreenSubtle },
  cyan: { backgroundColor: c.utilities.surface.cyanSubtle, color: c.utilities.content.onCyanSubtle },
  blue: { backgroundColor: c.utilities.surface.blueSubtle, color: c.utilities.content.onBlueSubtle },
  purple: { backgroundColor: c.utilities.surface.purpleSubtle, color: c.utilities.content.onPurpleSubtle },
  lavender: { backgroundColor: c.utilities.surface.lavenderSubtle, color: c.utilities.content.onLavenderSubtle },
  pink: { backgroundColor: c.utilities.surface.pinkSubtle, color: c.utilities.content.onPinkSubtle },
});
