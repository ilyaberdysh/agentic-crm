// Settings → Objects screens (J objects-lists; measured on,
// object-attributes-tab.png, object-configuration-custom.png at 1512 × 945): 768 px column, 72 px top padding,
// table cards with a 1 px stroke.primary border and radius 12, 41 px row pitch.
import { insetRing, text, vars } from '@agentic-crm/ui/styles';
import { style, styleVariants } from '@vanilla-extract/css';

const c = vars.color;

// ---- page column ------------------------------------------------------------------------------------------------

export const page = style({
  boxSizing: 'border-box',
  maxWidth: 816,
  margin: '0 auto',
  padding: '72px 24px 96px',
  display: 'flex',
  flexDirection: 'column',
});

export const headerRow = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 });

export const pageTitle = style({ ...text.heading.large, color: c.content.primary, margin: '0 0 2px' });

export const pageDescription = style({ ...text.body.standard, color: c.content.secondary, margin: 0 });

export const pageRule = style({ height: 1, backgroundColor: c.stroke.primary, margin: '24px 0', flex: 'none' });

export const toolbar = style({ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 });

export const toolbarSearch = style({ flex: 1 });

export const centered = style({ display: 'flex', justifyContent: 'center', padding: '48px 0' });

// ---- table card ---------------------------------------------------------------------------------------------------

export const table = style({
  boxSizing: 'border-box',
  width: '100%',
  borderRadius: 12,
  boxShadow: insetRing(c.stroke.primary),
  backgroundColor: c.surface.primary,
  overflow: 'hidden',
});

export const tableHeader = style({
  display: 'grid',
  alignItems: 'center',
  minHeight: 43,
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
  ...text.text12.standard,
  color: c.content.secondary,
});

export const headerCell = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  whiteSpace: 'nowrap',
});

export const headerIcon = style({ color: c.content.tertiary, flex: 'none' });

export const row = style({
  position: 'relative',
  display: 'grid',
  alignItems: 'center',
  height: 41,
  boxSizing: 'border-box',
  borderTop: `1px solid ${c.stroke.primary}`,
  ...text.body.standard,
  color: c.content.primary,
  cursor: 'pointer',
  outline: 'none',
  transition: 'background-color 140ms ease',
  selectors: {
    [`${tableHeader} + &`]: { borderTop: 'none' },
    '&:hover': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&:focus-visible': { boxShadow: insetRing(c.stroke.accent) },
    '&[data-muted]': { color: c.content.tertiary },
    '&[data-static]': { cursor: 'default' },
    '&:last-child': { borderRadius: '0 0 12px 12px' },
  },
});

export const cell = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
});

export const cellText = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });

export const muted = style({ color: c.content.tertiary });

export const rowActions = style({ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4 });

/** Objects list columns: Object · Type · Records · Attributes · actions (x 533 / 688 / 849 / 1011 / 1248). */
export const objectsGrid = style({
  gridTemplateColumns: '161px 161px 162px 1fr auto',
  paddingInline: '15px 12px',
});

export const usageBadge = style({ marginLeft: 2 });

export const tableEmpty = style({
  padding: '32px 16px',
  textAlign: 'center',
  ...text.body.standard,
  color: c.content.tertiary,
});

// ---- object settings header ------------------------------------------------------------------------------------

export const backLink = style({
  alignSelf: 'flex-start',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 28,
  padding: '0 6px 0 4px',
  marginLeft: -4,
  borderRadius: 6,
  ...text.body.standard,
  color: c.content.secondary,
  textDecoration: 'none',
  cursor: 'pointer',
  selectors: {
    '&:hover': { color: c.content.primary, backgroundColor: c.interactive.ghostHover },
    '&:focus-visible': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});

export const objectHeader = style({ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 });

export const objectHeaderText = style({ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 });

export const objectTitleRow = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });

export const objectTitle = style({
  ...text.heading.large,
  color: c.content.primary,
  margin: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const tabs = style({ marginTop: 28 });

export const tabPanel = style({ paddingTop: 40, outline: 'none' });

export const moreTab = style({ marginLeft: 0 });

/** Tab list + the "+N more" overflow button on one ruled row. */
export const tabRow = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 4,
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
});

// ---- sections ---------------------------------------------------------------------------------------------------

export const sections = style({ display: 'flex', flexDirection: 'column', gap: 40 });

export const section = style({ display: 'flex', flexDirection: 'column', gap: 16 });

/** A section that continues the previous one (24 px instead of the 40 px section gap). */
export const joinedSection = style({ marginTop: -16 });

export const sectionHeader = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 });

export const sectionTitle = style({ ...text.heading.small, color: c.content.primary, margin: 0 });

export const sectionDescription = style({ ...text.body.standard, color: c.content.secondary, margin: 0 });

export const fieldGrid = style({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 16px' });

export const fieldFull = style({ gridColumn: '1 / -1' });

export const nounRow = style({ display: 'flex', alignItems: 'flex-end', gap: 8 });

export const iconButton = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  width: 32,
  height: 32,
  padding: 0,
  border: 'none',
  borderRadius: 9,
  background: c.interactive.ghost,
  boxShadow: insetRing(c.stroke.primaryTransparent),
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&[data-hovered]': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&[data-focus-visible]': { boxShadow: insetRing(c.stroke.accent) },
    '&[data-disabled]': { opacity: 0.4, cursor: 'default' },
    '&[data-pressed], &[aria-expanded="true"]': { boxShadow: insetRing(c.stroke.accent) },
  },
});

export const slugRow = style({ display: 'flex', alignItems: 'flex-end', gap: 8 });

export const slugPrefix = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 18,
  height: 20,
  borderRadius: 5,
  backgroundColor: c.surface.tint,
  color: c.content.tertiary,
  ...text.text12.standard,
});

/** Read-only slug value (grey, as observed). */
export const readonlyText = style({ color: c.content.tertiary });

export const note = style({ ...text.text12.standard, color: c.content.tertiary, paddingLeft: 4 });

export const labelWithInfo = style({ display: 'inline-flex', alignItems: 'center', gap: 4 });

export const infoIcon = style({ color: c.content.tertiary, display: 'inline-flex' });

// Appearance block: settings on the left, preview card on the right (Configuration tab).
export const appearanceGrid = style({
  display: 'grid',
  gridTemplateColumns: '404px 1fr',
  gap: 24,
  alignItems: 'start',
});

export const subTitle = style({ ...text.body.strong, color: c.content.primary, margin: 0 });

export const subDescription = style({ ...text.text12.standard, color: c.content.secondary, margin: 0 });

export const previewCard = style({
  boxSizing: 'border-box',
  height: 168,
  borderRadius: 16,
  backgroundColor: c.surface.secondary,
  boxShadow: insetRing(c.stroke.primary),
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 14,
  ...text.body.strong,
  color: c.content.tertiary,
});

export const previewInner = style({
  width: 220,
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: `${insetRing(c.stroke.primary)}, ${vars.elevation.e1}`,
  padding: '6px 12px',
  display: 'flex',
  flexDirection: 'column',
});

export const previewLine = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  ...text.body.standard,
  color: c.content.primary,
  selectors: { '& + &': { borderTop: `1px solid ${c.stroke.primary}` } },
});

export const settingRow = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 });

export const dangerCard = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '12px 16px',
  borderRadius: 12,
  boxShadow: insetRing(c.utilities.stroke.red),
  backgroundColor: c.surface.primary,
});

// ---- create object dialog -------------------------------------------------------------------------------------

export const dialogBody = style({ padding: '16px 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 });

export const dialogSectionTitle = style({
  ...text.body.strong,
  color: c.content.primary,
  margin: '0 0 3px',
  paddingLeft: 4,
});

export const dialogSectionDescription = style({
  ...text.text12.standard,
  color: c.content.secondary,
  margin: 0,
  paddingLeft: 4,
});

// ---- icon picker ------------------------------------------------------------------------------------------------

export const iconPicker = style({ width: 296, display: 'flex', flexDirection: 'column', gap: 8, padding: 8 });

export const iconPickerTop = style({ display: 'flex', gap: 8, alignItems: 'center' });

export const iconGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(9, 32px)',
  gap: 0,
  maxHeight: 352,
  overflowY: 'auto',
});

export const iconCell = style({
  width: 32,
  height: 32,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&[data-hovered]': { backgroundColor: c.interactive.ghostHover },
    '&[data-focus-visible]': { boxShadow: insetRing(c.stroke.accent) },
    '&[data-selected]': { boxShadow: insetRing(c.stroke.accent) },
  },
});

export const swatchButton = style({
  width: 28,
  height: 28,
  flex: 'none',
  border: 'none',
  borderRadius: 8,
  padding: 0,
  cursor: 'pointer',
  outline: 'none',
  selectors: { '&[data-focus-visible]': { boxShadow: `0 0 0 2px ${c.stroke.accent}` } },
});

export const swatchGrid = style({ display: 'grid', gridTemplateColumns: 'repeat(3, 32px)', gap: 0, padding: 4 });

export const swatch = style({
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

export const swatchDot = style({ width: 18, height: 18, borderRadius: 6 });

export const swatchSelected = style({ boxShadow: `0 0 0 2px ${c.surface.primary}, 0 0 0 3px ${c.stroke.accent}` });

export const hueFill = styleVariants({
  blue: { backgroundColor: c.utilities.surface.blue },
  green: { backgroundColor: c.utilities.surface.green },
  grey: { backgroundColor: c.utilities.surface.grey },
  pink: { backgroundColor: c.utilities.surface.pink },
  orange: { backgroundColor: c.utilities.surface.orange },
  purple: { backgroundColor: c.utilities.surface.purple },
  red: { backgroundColor: c.utilities.surface.red },
  cyan: { backgroundColor: c.utilities.surface.cyan },
  yellow: { backgroundColor: c.utilities.surface.yellow },
});

// ---- placeholder tabs -------------------------------------------------------------------------------------------

export const placeholder = style({ padding: '56px 24px' });
