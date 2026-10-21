// Import wizard: 48 + 1 header, 52 + 1 stepper, step body, 48 + 1
// footer. Measurements from the curated captures at 1236 × 945 (the main panel).
import { insetRing, scales, text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style, styleVariants } from '@vanilla-extract/css';

const c = vars.color;

export const root = style({
  position: 'relative',
  flex: 1,
  minHeight: 0,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: c.surface.primary,
});

// ---- header ---------------------------------------------------------------------------------------------------------

export const header = style({
  boxSizing: 'border-box',
  flex: 'none',
  height: 49,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '0 16px 1px 16px',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
});

export const headerTitle = style({
  ...text.body.small,
  color: c.content.secondary,
  marginLeft: 4,
});

export const headerFile = style({
  ...text.body.small,
  color: c.content.primary,
  marginLeft: 4,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const destinationChip = style({
  ...text.body.small,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 20,
  padding: '0 5px 0 2px',
  marginLeft: 2,
  borderRadius: 6,
  color: c.content.primary,
  backgroundColor: c.surface.tertiary,
  boxShadow: insetRing(c.stroke.primary),
  whiteSpace: 'nowrap',
});

export const headerSpacer = style({ flex: 1 });

// ---- stepper --------------------------------------------------------------------------------------------------------

export const stepper = style({
  boxSizing: 'border-box',
  flex: 'none',
  height: 53,
  display: 'flex',
  alignItems: 'center',
  gap: 0,
  padding: '0 16px 1px 24px',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
});

export const step = style({
  ...text.body.small,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 24,
  padding: 0,
  border: 0,
  background: 'none',
  color: c.content.secondary,
  cursor: 'default',
  selectors: {
    '&[data-current]': { color: c.content.primary },
    '&[data-clickable]': { cursor: 'pointer' },
    '&[data-clickable]:hover': { color: c.content.primary },
  },
});

export const stepNumber = style({
  ...text.text11.standard,
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 16,
  height: 16,
  padding: '0 4px',
  borderRadius: 4,
  color: c.content.secondary,
  backgroundColor: c.surface.tertiary,
  boxShadow: insetRing(c.stroke.primary),
  selectors: {
    [`${step}[data-current] &`]: {
      color: c.content.accent,
      backgroundColor: c.surface.accentSubtle,
      boxShadow: insetRing(c.stroke.accentSubtle),
    },
  },
});

export const stepChevron = style({ color: c.content.tertiary, margin: '0 12px' });

// ---- body + footer --------------------------------------------------------------------------------------------------

export const body = style({ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' });

export const footer = style({
  boxSizing: 'border-box',
  flex: 'none',
  height: 51,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  padding: '1px 16px 0 16px',
  boxShadow: `inset 0 1px 0 ${c.stroke.primary}`,
});

export const footerMessage = style({
  ...text.body.small,
  flex: 1,
  minWidth: 0,
  color: c.content.critical,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const footerNote = style([footerMessage, { color: c.content.tertiary }]);

export const centered = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: 24,
  textAlign: 'center',
  color: c.content.tertiary,
});

export const stateTitle = style({ ...text.body.standard, color: c.content.primary });
export const stateText = style({ ...text.body.small, color: c.content.secondary, maxWidth: 420 });

// ---- step 1: upload -------------------------------------------------------------------------------------------------

export const uploadBody = style({
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  display: 'flex',
  flexDirection: 'column',
  padding: '20px 24px 0',
});

export const dropZone = style({
  position: 'relative',
  flex: 1,
  minHeight: 360,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 16,
  border: `1px dashed ${c.stroke.secondary}`,
  backgroundColor: c.surface.secondary,
  transition: 'background-color 120ms ease, border-color 120ms ease',
  selectors: {
    '&[data-dragging]': { borderColor: c.stroke.accent, backgroundColor: c.surface.accentSubtle },
  },
});

export const dropText = style({ ...text.body.standard, color: c.content.secondary, marginTop: 28 });

export const orDivider = style({
  ...text.body.small,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: 286,
  margin: '14px 0 12px',
  color: c.content.primary,
  selectors: {
    '&::before, &::after': {
      content: '""',
      flex: 1,
      borderTop: `1px dashed ${c.stroke.secondary}`,
    },
  },
});

export const chooseButton = style({ width: 286 });

export const uploadError = style({ ...text.body.small, color: c.content.critical, marginTop: 12 });

export const fileCard = style({
  boxSizing: 'border-box',
  width: 360,
  padding: 12,
  borderRadius: 16,
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.primary),
});

export const fileHead = style({ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '2px 0 0 0' });
export const fileText = style({ flex: 1, minWidth: 0 });
export const fileName = style({
  ...text.body.standard,
  color: c.content.primary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const fileMeta = style({ ...text.body.standard, color: c.content.primary, marginTop: 4 });
export const fileRule = style({ borderTop: `1px dashed ${c.stroke.primary}`, margin: '15px 0 12px' });
export const stats = style({ display: 'flex', gap: 12 });
export const stat = style({
  flex: 1,
  boxSizing: 'border-box',
  height: 78,
  padding: '12px 12px',
  borderRadius: 12,
  boxShadow: insetRing(c.stroke.primary),
});
export const statLabel = style({
  ...text.body.small,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  color: c.content.tertiary,
});
export const statValue = style({ ...text.heading.medium, fontWeight: 500, color: c.content.primary, marginTop: 12 });

export const learnMore = style({ alignSelf: 'center', width: 630, padding: '24px 0 20px' });
export const learnLabel = style({ ...text.body.small, color: c.content.tertiary, marginBottom: 8 });
export const learnCards = style({ display: 'flex', gap: 13 });
export const learnCard = style({
  ...text.body.standard,
  boxSizing: 'border-box',
  flex: 1,
  height: 74,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: 8,
  border: 0,
  borderRadius: 16,
  fontFamily: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  color: c.content.primary,
  backgroundColor: c.surface.primary,
  textDecoration: 'none',
  boxShadow: insetRing(c.stroke.primary),
  ':hover': { backgroundColor: c.surface.primaryHover },
});
export const learnTile = style({
  flex: 'none',
  width: 56,
  height: 56,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 10,
  color: c.content.secondary,
  backgroundColor: c.surface.tertiary,
  boxShadow: insetRing(c.stroke.primary),
});

// ---- step 2: map columns --------------------------------------------------------------------------------------------

export const mapBody = style({ flex: 1, minHeight: 0, display: 'flex' });

export const mapLeft = style({
  position: 'relative',
  width: 'calc(100% - 433px)',
  minWidth: 520,
  display: 'flex',
  flexDirection: 'column',
  boxShadow: `inset -1px 0 0 ${c.stroke.primary}`,
});

export const mapScroll = style({ flex: 1, minHeight: 0, overflow: 'auto', paddingBottom: 80 });

export const mapHeaderRow = style({
  ...text.text12.standard,
  boxSizing: 'border-box',
  display: 'grid',
  gridTemplateColumns: '1fr 278px',
  alignItems: 'center',
  height: 32,
  padding: '0 21px 1px 24px',
  color: c.content.tertiary,
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}, inset -1px 0 0 ${c.stroke.primary}`,
});

export const mapRow = style({
  boxSizing: 'border-box',
  display: 'grid',
  gridTemplateColumns: '1fr 278px',
  alignItems: 'center',
  height: 44,
  padding: '0 21px 1px 24px',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
  selectors: {
    '&[data-focused]': { backgroundColor: c.surface.secondary },
    '&[data-invalid]': { backgroundColor: c.surface.critical },
  },
});

export const mapColumnCell = style({ display: 'flex', alignItems: 'center', minWidth: 0 });
export const mapColumnName = style({
  ...text.body.standard,
  flex: 1,
  minWidth: 0,
  color: c.content.primary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const mapArrow = style({
  flex: 'none',
  width: 120,
  display: 'flex',
  justifyContent: 'center',
  color: c.content.tertiary,
});

export const mapChip = style({
  ...text.body.standard,
  boxSizing: 'border-box',
  width: 278,
  height: 28,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '0 4px 0 8px',
  borderRadius: 8,
  border: 0,
  textAlign: 'left',
  color: c.content.primary,
  backgroundColor: c.surface.secondary,
  boxShadow: insetRing(c.stroke.primary),
  cursor: 'pointer',
  selectors: {
    '&:hover, &[data-open]': { backgroundColor: c.surface.secondaryHover },
    '&[data-empty]': { color: c.content.tertiary, backgroundColor: c.surface.primary },
    '&[data-empty]:hover': { backgroundColor: c.surface.primaryHover },
  },
});
export const chipLabel = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const chipButton = style({
  flex: 1,
  minWidth: 0,
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: 0,
  border: 0,
  outline: 'none',
  background: 'none',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
});
export const chipIcon = style({ color: c.content.secondary, flex: 'none' });
export const chipClear = style({
  flex: 'none',
  width: 20,
  height: 20,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 0,
  borderRadius: 6,
  color: c.content.secondary,
  background: 'none',
  cursor: 'pointer',
  ':hover': { backgroundColor: c.interactive.ghostHover, color: c.content.primary },
});

export const rowError = style({ ...text.text12.standard, color: c.content.critical, gridColumn: '1 / -1' });

export const mapRight = style({
  flex: 'none',
  width: 433,
  boxSizing: 'border-box',
  padding: '32px 28px',
  overflow: 'auto',
  backgroundColor: c.surface.secondary,
});

export const previewCard = style({
  borderRadius: 16,
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.primary),
  overflow: 'hidden',
});
export const previewHead = style({
  ...text.body.standard,
  boxSizing: 'border-box',
  height: 45,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 12px 1px 20px',
  color: c.content.primary,
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
});
export const previewBadge = style({
  ...text.text12.standard,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 20,
  padding: '0 6px',
  borderRadius: 6,
  color: c.content.secondary,
  backgroundColor: c.surface.tertiary,
});
export const previewValue = style({
  ...text.body.code,
  fontFamily: scales.fontFamily.mono,
  boxSizing: 'border-box',
  height: 44,
  display: 'flex',
  alignItems: 'center',
  padding: '0 20px 1px',
  color: c.content.secondary,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
  selectors: { '&:last-child': { boxShadow: 'none' }, '&[data-empty]': { color: c.content.tertiary } },
});
export const previewNote = style({
  ...text.text12.standard,
  color: c.content.tertiary,
  textAlign: 'center',
  marginTop: 12,
});

export const strategyPill = style({
  position: 'absolute',
  left: '50%',
  bottom: 20,
  transform: 'translateX(-50%)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 6px 6px 12px',
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: vars.elevation.e2,
  ...text.body.small,
  color: c.content.secondary,
  whiteSpace: 'nowrap',
});

// attribute picker
export const picker = style({ display: 'flex', flexDirection: 'column', width: 274, maxHeight: 378 });
export const pickerSearch = style({
  ...text.body.standard,
  boxSizing: 'border-box',
  height: 36,
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '0 8px',
  margin: '-4px -4px 4px',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
});
export const pickerInput = style({
  ...text.body.standard,
  flex: 1,
  minWidth: 0,
  height: 34,
  border: 0,
  outline: 'none',
  background: 'none',
  color: c.content.primary,
  '::placeholder': { color: c.content.tertiary },
});
export const pickerList = style({ flex: 1, minHeight: 0, overflow: 'auto' });
export const pickerGroup = style({ ...text.text12.standard, color: c.content.tertiary, padding: '6px 8px 4px' });
export const pickerRow = style({
  ...text.body.standard,
  boxSizing: 'border-box',
  height: 32,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 8px',
  borderRadius: 8,
  color: c.content.primary,
  cursor: 'pointer',
  selectors: { '&[data-active]': { backgroundColor: c.interactive.secondaryHover } },
});
export const pickerRowIcon = style({ flex: 'none', color: c.content.secondary });
export const pickerRowLabel = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const pickerTrailing = style({ display: 'flex', alignItems: 'center', gap: 2, color: c.content.tertiary });
export const pickerSeparator = style({ border: 0, borderTop: `1px solid ${c.stroke.primary}`, margin: '4px -4px' });
export const pickerEmpty = style({ ...text.body.small, color: c.content.tertiary, padding: '8px 8px' });

// ---- step 3: review values ------------------------------------------------------------------------------------------

export const reviewBody = style({ flex: 1, minHeight: 0, display: 'flex' });
export const rail = style({
  flex: 'none',
  width: 325,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: `inset -1px 0 0 ${c.stroke.primary}`,
});
export const railTitle = style({
  ...text.body.standard,
  boxSizing: 'border-box',
  height: 49,
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  padding: '0 16px 1px',
  color: c.content.secondary,
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}, inset -1px 0 0 ${c.stroke.primary}`,
});
export const railList = style({
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '16px 17px 16px 16px',
});
export const columnCard = style({
  position: 'relative',
  flex: 'none',
  boxSizing: 'border-box',
  height: 70,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: 8,
  padding: '0 12px',
  borderRadius: 12,
  border: 0,
  textAlign: 'left',
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.primary),
  cursor: 'pointer',
  selectors: {
    '&:hover': { backgroundColor: c.surface.primaryHover },
    '&[data-selected]': { boxShadow: insetRing(c.stroke.accent) },
  },
});
export const columnLine = style({ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 });
export const columnTile = style({
  flex: 'none',
  width: 20,
  height: 20,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 6,
  color: c.content.secondary,
  boxShadow: insetRing(c.stroke.primary),
});
export const columnFile = style({
  ...text.body.standard,
  color: c.content.primary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const columnAttr = style([columnFile, { color: c.content.secondary }]);
export const reviewDot = style({
  position: 'absolute',
  top: 18,
  right: 13,
  width: 8,
  height: 8,
  borderRadius: '50%',
  backgroundColor: c.utilities.surface.orange,
});

export const reviewMain = style({ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' });
export const reviewToolbar = style({
  boxSizing: 'border-box',
  flex: 'none',
  height: 49,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '0 16px 1px',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
});
export const buttonStrong = style({ color: c.content.primary });
export const buttonMuted = style({ color: c.content.secondary });
export const reviewScroll = style({ flex: 1, minHeight: 0, overflow: 'auto', paddingBottom: 24 });
export const reviewHead = style({
  ...text.text12.standard,
  boxSizing: 'border-box',
  height: 32,
  display: 'grid',
  gridTemplateColumns: '1fr 140px 384px',
  alignItems: 'center',
  padding: '0 16px 1px 20px',
  color: c.content.secondary,
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
});
export const groupHead = style({
  ...text.body.small,
  boxSizing: 'border-box',
  width: '100%',
  height: 33,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '0 16px 1px 20px',
  border: 0,
  textAlign: 'left',
  color: c.content.secondary,
  backgroundColor: c.surface.secondary,
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
  cursor: 'pointer',
});
export const groupCount = style({
  ...text.text12.standard,
  minWidth: 16,
  height: 16,
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 4px',
  borderRadius: 4,
  color: c.content.secondary,
  backgroundColor: c.surface.tertiary,
  boxShadow: insetRing(c.stroke.primary),
});
export const valueRow = style({
  boxSizing: 'border-box',
  height: 44,
  display: 'grid',
  gridTemplateColumns: '1fr 140px 384px',
  alignItems: 'center',
  margin: '0 12px 0 0',
  padding: '0 4px 0 20px',
  selectors: { '& + &': { boxShadow: `inset 0 1px 0 ${c.stroke.primary}` } },
});
export const rawCell = style({ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 });
export const rawText = style({
  ...text.body.standard,
  color: c.content.primary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  selectors: { '&[data-empty]': { color: c.content.tertiary } },
});
export const rowCount = style({ ...text.text12.standard, color: c.content.tertiary, whiteSpace: 'nowrap' });
export const arrowCell = style({ color: c.content.tertiary, display: 'flex', justifyContent: 'center' });

export const mappedBox = style({
  ...text.body.standard,
  boxSizing: 'border-box',
  height: 28,
  display: 'flex',
  alignItems: 'stretch',
  borderRadius: 8,
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.primary),
  overflow: 'hidden',
});
export const mappedMain = style({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '0 8px',
  overflow: 'hidden',
  color: c.content.primary,
  selectors: { '&[data-skipped]': { color: c.content.tertiary } },
});
export const mappedIcon = style({ flex: 'none', color: c.content.secondary });
export const mappedAction = style({
  flex: 'none',
  width: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 0,
  color: c.content.secondary,
  background: 'none',
  boxShadow: `inset 1px 0 0 ${c.stroke.primary}`,
  cursor: 'pointer',
  ':hover': { backgroundColor: c.interactive.ghostHover, color: c.content.primary },
});
export const invalidLine = style({ display: 'flex', alignItems: 'center', gap: 4, height: 28 });
export const invalidPill = style({
  ...text.text12.standard,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 20,
  padding: '0 6px',
  borderRadius: 6,
  color: c.content.onWarningSubtle,
  backgroundColor: c.surface.warning,
  boxShadow: insetRing(c.stroke.warning),
});
export const missingPill = style({
  ...text.text12.standard,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  height: 20,
  padding: '0 5px',
  borderRadius: 6,
  color: c.content.onCriticalSubtle,
  backgroundColor: c.surface.critical,
  whiteSpace: 'nowrap',
});
export const optionPill = style({
  ...text.text12.standard,
  display: 'inline-flex',
  alignItems: 'center',
  height: 20,
  padding: '0 5px',
  borderRadius: 6,
  color: c.content.primary,
  backgroundColor: c.surface.tertiary,
  boxShadow: insetRing(c.stroke.primary),
  whiteSpace: 'nowrap',
});
export const iconButtons = style({ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 });
export const viewClip = style({ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', alignItems: 'center' });

export const formatItem = style({ display: 'flex', flexDirection: 'column' });

// ---- step 4 / overview ----------------------------------------------------------------------------------------------

export const previewBody = style({ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' });
export const infoAlert = style({
  ...text.body.standard,
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 44,
  margin: '8px 16px 8px 16px',
  padding: '0 16px',
  borderRadius: 12,
  color: c.content.secondary,
  backgroundColor: c.surface.tertiary,
});
/** The alert's band: 8 px around the alert, then a rule (evidence import-4-preview: alert 109–152, rule at 161). */
export const alertBand = style({ flex: 'none', boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`, paddingBottom: 1 });
export const invalidButton = style({ marginLeft: 'auto' });
export const invalidPopover = style({ display: 'flex', flexDirection: 'column', gap: 8, padding: 8, maxWidth: 420 });
export const invalidAlertHead = style({
  ...text.body.standard,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: 0,
  border: 0,
  background: 'none',
  fontFamily: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  color: c.content.onWarningSubtle,
});
export const invalidList = style({
  ...text.text12.standard,
  maxHeight: 112,
  overflow: 'auto',
  color: c.content.secondary,
  margin: 0,
  paddingLeft: 24,
});
/** Tabs: 26 px pills 6 px below the row top, the 2 px underline on the row's bottom rule (evidence 161–201). */
export const tabsRow = style({
  flex: 'none',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  height: 40,
  padding: '6px 16px 0',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
});
export const strategyTab = style({
  ...text.body.standard,
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 26,
  padding: '0 8px',
  border: 0,
  borderRadius: 6,
  color: c.content.secondary,
  background: 'none',
  cursor: 'pointer',
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHover },
    '&[data-selected]': { color: c.content.primary, backgroundColor: c.surface.tertiary },
    '&[data-selected]::after': {
      content: '""',
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: -8,
      height: 2,
      backgroundColor: c.content.primary,
    },
  },
});
export const summaryRow = style({
  ...text.body.standard,
  flex: 'none',
  boxSizing: 'border-box',
  height: 52,
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: '0 16px 1px',
  color: c.content.tertiary,
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
});
export const summaryItem = style({ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' });
export const summaryNumber = style({ color: c.content.primary });
export const outcomeIcon = style({
  flex: 'none',
  width: 16,
  height: 16,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 4,
});
export const outcomeTone = styleVariants({
  create: { color: c.utilities.content.green, backgroundColor: c.surface.success },
  update: { color: c.utilities.content.blue, backgroundColor: c.surface.info },
  skip: { color: c.content.tertiary, backgroundColor: c.surface.tertiary },
  failed: { color: c.content.critical, backgroundColor: c.surface.critical },
  planned: { color: c.content.tertiary, backgroundColor: c.surface.tertiary },
});

export const tableScroll = style({ flex: 1, minHeight: 0, overflow: 'auto' });
export const table = style({ borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', minWidth: '100%' });
export const th = style({
  ...text.body.standard,
  position: 'sticky',
  top: 0,
  zIndex: 1,
  boxSizing: 'border-box',
  height: 40,
  padding: '0 12px',
  textAlign: 'left',
  fontWeight: 500,
  color: c.content.primary,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}, inset -1px 0 0 ${c.stroke.primary}`,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});
export const thInner = style({ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 });
export const thIcon = style({ flex: 'none', color: c.content.secondary });
export const td = style({
  ...text.body.standard,
  boxSizing: 'border-box',
  height: 36,
  padding: 0,
  color: c.content.primary,
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}, inset -1px 0 0 ${c.stroke.primary}`,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
});
export const tdOutcome = style([td, { padding: 0, textAlign: 'center' }]);
export const cellBox = style({ height: 35, display: 'flex', minWidth: 0, overflow: 'hidden' });
export const cellInner = style({ display: 'flex', alignItems: 'center', minWidth: 0, overflow: 'hidden' });
export const tableNote = style({ ...text.text12.standard, color: c.content.tertiary, padding: '8px 16px' });

export const statusCard = style({
  flex: 'none',
  margin: '16px 16px 11px',
  padding: '13px 16px 13px',
  backgroundColor: c.surface.secondary,
  borderRadius: 16,
  boxShadow: insetRing(c.stroke.primary),
});
export const statusHead = style({
  ...text.body.standard,
  display: 'flex',
  justifyContent: 'space-between',
  color: c.content.primary,
});
export const statusCount = style({ color: c.content.secondary });
export const progressTrack = style({
  height: 4,
  marginTop: 12,
  borderRadius: 2,
  overflow: 'hidden',
  backgroundColor: c.surface.tertiary,
});
export const progressFill = style({
  height: '100%',
  borderRadius: 2,
  backgroundColor: c.surface.accent,
  transition: 'width 300ms ease',
  selectors: { '&[data-complete]': { backgroundColor: c.utilities.surface.green } },
});
export const statusMeta = style({
  ...text.text12.standard,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginTop: 12,
  color: c.content.tertiary,
});
export const statusMember = style({ color: c.content.secondary });
export const filterButton = style({ marginLeft: 'auto' });

globalStyle(`${td} [data-density="cell"]`, { minWidth: 0 });
