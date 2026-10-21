// Side panel ("Side panel", block-catalog; evidence G/G-trigger-config.png, G-panel-create-record.png,
// G-update-record-config.png, G-select-next-step.png, G-version-history.png): 400 px card, 12 px from the right, 10 px
// below the tab bar; block header (32 px tile, title, category, ⋮), "Add a description...", alerts, Configuration with
// one field per input (label row with the {x} button, red issue text under the control), Cost, Next step rows.
import { alpha, insetRing, text, transitionColors, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style } from '@vanilla-extract/css';

const c = vars.color;
const blue = '#266df0';

export const panel = style({
  position: 'absolute',
  top: 10,
  right: 12,
  bottom: 12,
  width: 400,
  zIndex: 6,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: `0 0 0 1px ${c.stroke.secondary}, 0 1px 2px ${alpha('#000000', 3)}`,
  overflow: 'hidden',
});

export const topBar = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  height: 46,
  padding: '0 12px 0 14px',
});

export const topSpacer = style({ flex: 1 });

export const scroll = style({ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' });

export const head = style({ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px 0 16px', minHeight: 32 });

export const headTitle = style({ ...text.body.standard, fontWeight: 600, color: c.content.primary });
export const headCategory = style({ ...text.text12.standard, color: c.content.secondary, marginLeft: -4 });
export const headTexts = style({ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8 });

export const description = style({
  boxSizing: 'border-box',
  display: 'block',
  width: 'calc(100% - 24px)',
  margin: '8px 12px 12px',
  padding: '4px 6px',
  minHeight: 30,
  border: 'none',
  borderRadius: 8,
  resize: 'none',
  overflow: 'hidden',
  background: 'transparent',
  fontFamily: 'inherit',
  ...text.body.standard,
  color: c.content.primary,
  outline: 'none',
  selectors: {
    '&::placeholder': { color: c.content.tertiary },
    '&:hover': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&:focus': { boxShadow: insetRing(c.stroke.accent) },
    '&[readonly]': { cursor: 'default' },
  },
});

export const divider = style({ height: 1, backgroundColor: c.stroke.primary, margin: 0, border: 'none' });

export const section = style({ padding: '16px 16px 18px', display: 'flex', flexDirection: 'column', gap: 14 });

export const sectionTitle = style({
  ...text.body.standard,
  fontWeight: 500,
  color: c.content.primary,
  margin: '0 0 -2px 4px',
});

export const alert = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  boxSizing: 'border-box',
  minHeight: 36,
  padding: '8px 12px',
  borderRadius: 8,
  ...text.body.standard,
});

export const alertCritical = style({
  backgroundColor: c.surface.critical,
  color: c.content.onCriticalSubtle,
  boxShadow: insetRing(c.stroke.critical),
});
export const alertInfo = style({ backgroundColor: c.surface.tertiary, color: c.content.secondary });
export const alertWrap = style({ padding: '16px 16px 0' });

// ---- fields --------------------------------------------------------------------------------------------------------------

export const field = style({ display: 'flex', flexDirection: 'column', gap: 6 });

export const labelRow = style({ display: 'flex', alignItems: 'center', gap: 6, minHeight: 20, padding: '0 4px' });

export const label = style({ flex: 1, ...text.text12.standard, color: c.content.secondary });

export const fieldError = style({ ...text.text12.standard, color: c.content.critical, padding: '0 4px' });
export const fieldHint = style({ ...text.text12.standard, color: c.content.tertiary, padding: '0 4px' });

export const control = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  minHeight: 38,
  padding: '0 12px',
  borderRadius: 8,
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.secondary),
  ...text.body.standard,
  color: c.content.primary,
  border: 'none',
  fontFamily: 'inherit',
  textAlign: 'left',
  outline: 'none',
  cursor: 'pointer',
  transition: transitionColors,
  selectors: {
    '&:hover:not([data-disabled])': { backgroundColor: c.surface.primaryHover },
    '&:focus-visible, &[data-focused], &[aria-expanded="true"]': { boxShadow: insetRing(c.stroke.accent) },
    '&[data-invalid]': { boxShadow: insetRing(alpha('#eb3b3b', 60)) },
    '&[data-disabled]': { cursor: 'default', color: c.content.tertiary, backgroundColor: c.surface.secondary },
  },
});

export const controlValue = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const placeholder = style({ color: c.content.tertiary });
export const chevron = style({ color: c.content.secondary, flex: 'none' });

export const input = style({
  boxSizing: 'border-box',
  width: '100%',
  height: 38,
  padding: '0 12px',
  borderRadius: 8,
  border: 'none',
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.secondary),
  fontFamily: 'inherit',
  ...text.body.standard,
  color: c.content.primary,
  outline: 'none',
  selectors: {
    '&::placeholder': { color: c.content.tertiary },
    '&:focus': { boxShadow: insetRing(c.stroke.accent) },
    '&[data-invalid]': { boxShadow: insetRing(alpha('#eb3b3b', 60)) },
    '&[readonly]': { backgroundColor: c.surface.secondary },
  },
});

export const textarea = style([
  input,
  {
    height: 'auto',
    minHeight: 90,
    padding: '8px 12px',
    resize: 'vertical',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
  },
]);

export const row = style({ display: 'flex', alignItems: 'center', gap: 8 });

export const varButton = style({
  boxSizing: 'border-box',
  width: 20,
  height: 20,
  padding: 0,
  border: 'none',
  borderRadius: 5,
  background: 'transparent',
  color: c.content.secondary,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  selectors: {
    '&:hover, &[aria-expanded="true"]': { backgroundColor: c.interactive.ghostHover, color: c.content.primary },
  },
});

export const toggles = style({ display: 'flex', flexWrap: 'wrap', gap: 4 });

export const toggle = style({
  boxSizing: 'border-box',
  minWidth: 36,
  height: 28,
  padding: '0 8px',
  border: 'none',
  borderRadius: 8,
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.secondary),
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.text12.standard,
  cursor: 'pointer',
  selectors: {
    '&[aria-pressed="true"]': { backgroundColor: alpha(blue, 10), boxShadow: insetRing(alpha(blue, 50)), color: blue },
  },
});

export const listRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 4px',
  minHeight: 28,
  ...text.body.standard,
});

export const subtle = style({ color: c.content.secondary, ...text.text12.standard });

export const nested = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 12,
  borderRadius: 10,
  backgroundColor: c.surface.secondary,
  boxShadow: insetRing(c.stroke.primary),
});

// ---- cost / next step ------------------------------------------------------------------------------------------------------

export const costRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px 16px 0 16px',
  ...text.body.standard,
  color: c.content.secondary,
});

export const nextHead = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '16px 16px 12px',
  border: 'none',
  background: 'transparent',
  width: '100%',
  textAlign: 'left',
  cursor: 'pointer',
  fontFamily: 'inherit',
});

export const nextTitle = style({ ...text.body.standard, fontWeight: 500, color: c.content.primary, display: 'block' });
export const nextText = style({ ...text.body.standard, color: c.content.secondary, display: 'block' });

export const nextRows = style({ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 16px 16px 16px' });

export const outcomeLabel = style({ ...text.text12.standard, color: c.content.secondary, padding: '4px 0 0 4px' });

export const nextRow = style({
  position: 'relative',
  marginLeft: 18,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 38,
  padding: '0 8px',
  borderRadius: 8,
  border: 'none',
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.secondary),
  ...text.body.standard,
  color: c.content.secondary,
  fontFamily: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  selectors: {
    '&::before': {
      content: '""',
      position: 'absolute',
      left: -18,
      top: -14,
      width: 12,
      height: 32,
      borderLeft: `1px solid ${c.stroke.secondary}`,
      borderBottom: `1px solid ${c.stroke.secondary}`,
      borderBottomLeftRadius: 6,
    },
    '&:hover': { backgroundColor: c.surface.primaryHover, color: c.content.primary },
  },
});

export const plusBox = style({
  width: 18,
  height: 18,
  borderRadius: 5,
  boxShadow: insetRing(c.stroke.secondary),
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: c.content.secondary,
});

export const connectedTitle = style({
  flex: 1,
  minWidth: 0,
  color: c.content.primary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

// ---- palette -------------------------------------------------------------------------------------------------------------

export const paletteSearch = style({
  flex: 1,
  minWidth: 0,
  height: 28,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  fontFamily: 'inherit',
  ...text.body.standard,
  color: c.content.primary,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});

export const paletteKind = style({ ...text.text12.standard, color: c.content.secondary });

export const paletteHeading = style({ padding: '8px 20px 4px' });
export const paletteTitle = style({ ...text.heading.small, fontSize: 16, color: c.content.primary, margin: 0 });
export const paletteSub = style({ ...text.body.standard, color: c.content.secondary, margin: '2px 0 0' });

export const paletteGroup = style({ padding: '6px 12px 2px' });

export const paletteGroupLabel = style({ ...text.text12.standard, color: c.content.secondary, padding: '8px 8px 6px' });

export const paletteItem = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  height: 40,
  margin: '0 0 6px',
  padding: '0 8px',
  border: 'none',
  borderRadius: 10,
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.primary),
  fontFamily: 'inherit',
  ...text.body.standard,
  color: c.content.primary,
  textAlign: 'left',
  cursor: 'pointer',
  transition: transitionColors,
  selectors: {
    '&:hover:not([data-disabled]), &[data-focused]': { backgroundColor: c.surface.primaryHover },
    '&[data-disabled]': { cursor: 'default', color: c.content.tertiary },
  },
});

export const paletteBadge = style({
  marginLeft: 'auto',
  padding: '1px 6px',
  borderRadius: 6,
  ...text.text11.standard,
  color: '#7c4dff',
  backgroundColor: alpha('#7c4dff', 10),
});

export const paletteReason = style({
  marginLeft: 'auto',
  ...text.text12.standard,
  color: c.content.tertiary,
  whiteSpace: 'nowrap',
});

export const segmentedWrap = style({ padding: '4px 16px 4px' });

// ---- overview -------------------------------------------------------------------------------------------------------------

export const overviewTitle = style({
  flex: 1,
  minWidth: 0,
  height: 32,
  padding: '0 6px',
  margin: '0 -6px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  fontFamily: 'inherit',
  ...text.heading.small,
  fontSize: 16,
  color: c.content.primary,
  outline: 'none',
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&:focus': { boxShadow: insetRing(c.stroke.accent) },
    '&::placeholder': { color: c.content.primary },
  },
});

export const resources = style({
  marginTop: 'auto',
  padding: '16px 16px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
});
export const resourcesLabel = style({ ...text.text12.standard, color: c.content.secondary, padding: '0 4px' });
export const resourceCard = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '10px 12px 12px',
  borderRadius: 10,
  boxShadow: insetRing(c.stroke.secondary),
  textDecoration: 'none',
  color: c.content.primary,
  ...text.body.standard,
  fontWeight: 500,
  selectors: { '&:hover': { backgroundColor: c.surface.primaryHover } },
});
export const resourceText = style({ ...text.text12.standard, color: c.content.secondary, fontWeight: 400 });

export const checklist = style({
  margin: '0 16px',
  padding: 12,
  borderRadius: 10,
  backgroundColor: c.surface.critical,
  boxShadow: insetRing(c.stroke.critical),
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  ...text.body.standard,
  color: c.content.onCriticalSubtle,
});

export const checklistTitle = style({ fontWeight: 600 });

// ---- version history ------------------------------------------------------------------------------------------------------

export const timeline = style({ display: 'flex', flexDirection: 'column', padding: '4px 12px' });

export const versionRow = style({
  position: 'relative',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '7px 8px 9px 32px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  textAlign: 'left',
  fontFamily: 'inherit',
  cursor: 'pointer',
  ...text.body.standard,
  color: c.content.primary,
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHover },
    '&[data-selected]': { backgroundColor: c.surface.tertiary },
    '&::before': {
      content: '""',
      position: 'absolute',
      left: 12,
      top: 0,
      bottom: 0,
      width: 1,
      backgroundColor: c.stroke.secondary,
    },
    '&:first-child::before': { top: 16 },
    '&:last-child::before': { bottom: 'calc(100% - 16px)' },
  },
});

export const versionDot = style({
  position: 'absolute',
  left: 8,
  top: 11,
  width: 9,
  height: 9,
  boxSizing: 'border-box',
  borderRadius: '50%',
  border: `1px solid ${c.stroke.tertiary}`,
  backgroundColor: c.surface.primary,
  zIndex: 1,
  selectors: {
    '&[data-current]': {
      borderColor: blue,
      boxShadow: `inset 0 0 0 2px ${c.surface.primary}, inset 0 0 0 5px ${blue}`,
    },
  },
});

export const versionTitle = style({ display: 'flex', alignItems: 'center', gap: 8 });
export const versionCurrent = style({ color: blue });
export const versionBy = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  ...text.text12.standard,
  color: c.content.secondary,
});

globalStyle(`${scroll} > *:last-child`, { marginBottom: 0 });
