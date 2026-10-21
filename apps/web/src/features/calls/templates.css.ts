// Insight templates:
// calls-template-presets.png, calls-template-preset-preview.png): the templates table, the editor (sections on the left,
// the preview pane on the right), the presets gallery and its preview.
import { alpha, scales, text, transitionColors, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style, styleVariants } from '@vanilla-extract/css';

const c = vars.color;
const ease = `${scales.duration.comfortable}ms ease`;

// ---- templates table --------------------------------------------------------------------------------------------------------------

export const toolbar = style({
  boxSizing: 'border-box',
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  height: 49,
  padding: '0 12px',
  borderBottom: `1px solid ${c.stroke.primary}`,
});

const COLUMNS = 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 60px';

export const row = style({
  boxSizing: 'border-box',
  display: 'grid',
  gridTemplateColumns: COLUMNS,
  alignItems: 'center',
  borderBottom: `1px solid ${c.stroke.primary}`,
});

export const head = style({
  position: 'sticky',
  top: 0,
  zIndex: 2,
  height: 32,
  ...text.text12.standard,
  fontSize: 13,
  color: c.content.secondary,
  backgroundColor: c.surface.primary,
});

export const headCell = style({ display: 'flex', alignItems: 'center', gap: 4, padding: '0 16px', minWidth: 0 });

export const dataRow = style({
  height: 52,
  cursor: 'pointer',
  position: 'relative',
  transition: `background-color ${ease}`,
  selectors: { '&:hover, &:focus-within': { backgroundColor: alpha('#000000', 2) } },
});

export const cell = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 16px',
  minWidth: 0,
  ...text.body.standard,
});

export const tile = style({
  flex: 'none',
  width: 24,
  height: 24,
  borderRadius: 8,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: c.surface.tint,
  color: c.content.secondary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primaryTransparent}`,
});

export const link = style({
  color: c.content.primary,
  textDecoration: 'none',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
  outline: 'none',
  selectors: { '&:focus-visible': { textDecoration: 'underline' } },
});

export const muted = style({ color: c.content.secondary });

export const rowMenu = style({
  opacity: 0,
  transition: `opacity ${ease}`,
  selectors: {
    [`${dataRow}:hover &, ${dataRow}:focus-within &, &[aria-expanded="true"], &[data-focus-visible]`]: { opacity: 1 },
  },
});

export const state = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '80px 24px',
  textAlign: 'center',
});
export const stateTitle = style({
  ...text.heading.small,
  fontSize: 20,
  lineHeight: '28px',
  color: c.content.primary,
  marginTop: 16,
});
export const stateText = style({ ...text.body.standard, color: c.content.secondary, maxWidth: 360 });
export const stateAction = style({ marginTop: 12 });
export const stateError = style({ ...text.body.standard, color: c.content.critical, maxWidth: 360 });

// ---- editor ------------------------------------------------------------------------------------------------------------------------

export const editor = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: c.surface.primary,
});

export const editorHeader = style({
  boxSizing: 'border-box',
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  height: 49,
  padding: '0 16px 0 12px',
  borderBottom: `1px solid ${c.stroke.primary}`,
});

export const titleInput = style({
  boxSizing: 'border-box',
  flex: 1,
  minWidth: 0,
  maxWidth: 520,
  height: 32,
  margin: '0 0 0 -8px',
  padding: '0 8px',
  border: 'none',
  borderRadius: 8,
  outline: 'none',
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  fontSize: 16,
  fontWeight: 500,
  letterSpacing: '-0.16px',
  textOverflow: 'ellipsis',
  transition: `background-color ${ease}, box-shadow ${ease}`,
  selectors: {
    '&:hover': { backgroundColor: c.surface.tint },
    '&:focus': { backgroundColor: c.surface.primary, boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
    '&::placeholder': { color: c.content.primary },
  },
});

export const headerActions = style({ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 });

export const panes = style({ flex: 1, minHeight: 0, display: 'flex' });

export const sectionsPane = style({
  boxSizing: 'border-box',
  width: '50%',
  minWidth: 400,
  flex: 'none',
  overflow: 'auto',
  padding: '56px 56px 80px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
});

export const previewPane = style({
  flex: 1,
  minWidth: 400,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  borderLeft: `1px solid ${c.stroke.primary}`,
});

export const sectionCard = style({
  position: 'relative',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 116,
  borderRadius: 12,
  border: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
  transition: `border-color ${ease}, box-shadow ${ease}`,
  selectors: { '&:focus-within': { borderColor: c.stroke.accent } },
});

export const sectionTop = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 8px 0 16px',
  minHeight: 40,
});
export const sectionTitle = style({ flex: 1, minWidth: 0 });
export const sectionRule = style({ border: 'none', borderTop: `1px solid ${c.stroke.primary}`, margin: '4px 16px 0' });
export const sectionPrompt = style({ padding: '8px 16px', minHeight: 56, flex: 1 });
export const sectionFooter = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 16px 10px',
  ...text.text12.standard,
  color: c.content.secondary,
});

export const formatButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 22,
  padding: '0 4px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  cursor: 'pointer',
  ...text.text12.standard,
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHover } },
});

export const dragHandle = style({
  position: 'absolute',
  left: -29,
  top: 10,
  opacity: 0,
  cursor: 'grab',
  color: c.content.tertiary,
  transition: `opacity ${ease}`,
  selectors: { [`${sectionCard}:hover &`]: { opacity: 1 } },
});

export const dropLine = style({ height: 2, borderRadius: 1, backgroundColor: c.stroke.accent, margin: '-7px 0' });

export const addSection = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  height: 34,
  border: `1px dashed ${c.stroke.secondary}`,
  borderRadius: 8,
  background: 'transparent',
  color: c.content.secondary,
  fontFamily: 'inherit',
  cursor: 'pointer',
  ...text.body.standard,
  transition: transitionColors,
  selectors: { '&:hover, &:focus-visible': { backgroundColor: c.surface.primaryHover, outline: 'none' } },
});

export const orRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  color: c.content.tertiary,
  ...text.text12.standard,
});
export const orLine = style({ flex: 1, height: 1, backgroundColor: c.stroke.primary });

// ---- the rich text of titles and prompts ------------------------------------------------------------------------------------------

export const richTitle = style({ fontSize: 14, fontWeight: 500 });
export const richPrompt = style({});
globalStyle(`${richTitle} .ProseMirror`, { outline: 'none', minHeight: 24 });
globalStyle(`${richTitle} p`, { margin: 0 });
globalStyle(`${richPrompt} .ProseMirror`, { outline: 'none', minHeight: 40 });
globalStyle(`${richPrompt} p`, { margin: 0 });
export const plainText = style({ ...text.body.standard, color: c.content.primary, margin: 0, whiteSpace: 'pre-wrap' });

// ---- preview pane --------------------------------------------------------------------------------------------------------------------

export const previewBar = style({
  boxSizing: 'border-box',
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  height: 40,
  padding: '0 12px',
  backgroundColor: c.surface.secondary,
  borderBottom: `1px solid ${c.stroke.primary}`,
  ...text.text12.standard,
  color: c.content.secondary,
});

export const sourceButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  maxWidth: 320,
  padding: '0 8px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  cursor: 'pointer',
  ...text.text12.standard,
  fontSize: 13,
  selectors: { '&:hover, &[aria-expanded="true"]': { backgroundColor: c.interactive.ghostHover } },
});

export const sourceList = style({
  width: 340,
  maxHeight: 320,
  overflow: 'auto',
  padding: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
});
export const sourceOption = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 40,
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
export const sourceTexts = style({ display: 'flex', flexDirection: 'column', minWidth: 0 });
export const sourceSub = style({ ...text.text12.standard, color: c.content.secondary });

export const previewBody = style({ flex: 1, minHeight: 0, overflow: 'auto', padding: '24px 28px 48px' });
export const previewCenter = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  textAlign: 'center',
  padding: 24,
  ...text.body.standard,
  color: c.content.secondary,
});
export const previewHeading = style({
  ...text.heading.small,
  fontSize: 18,
  lineHeight: '26px',
  fontWeight: 600,
  margin: '0 0 4px',
  color: c.content.primary,
});

export const gallery = style({ overflow: 'hidden' });

// ---- gallery ---------------------------------------------------------------------------------------------------------------------------

export const galleryTop = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 16px',
  height: 44,
  flex: 'none',
  ...text.body.standard,
});
export const galleryBody = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  borderTop: `1px solid ${c.stroke.primary}`,
});
export const galleryAside = style({
  boxSizing: 'border-box',
  width: 260,
  flex: 'none',
  padding: '16px 12px',
  borderRight: `1px solid ${c.stroke.primary}`,
  overflow: 'auto',
});
export const asideLabel = style({
  ...text.text11.standard,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: c.content.tertiary,
  padding: '0 4px 8px',
});
export const categoryRow = style({
  display: 'flex',
  flexDirection: 'row-reverse',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  boxSizing: 'border-box',
  gap: 8,
  height: 36,
  padding: '0 4px',
  borderRadius: 8,
  cursor: 'pointer',
  ...text.body.standard,
  selectors: { '&:hover': { backgroundColor: c.surface.primaryHover } },
});
export const categoryTile = style({
  width: 20,
  height: 20,
  borderRadius: 6,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
});
export const categoryHue = styleVariants({
  general: { backgroundColor: c.utilities.surface.cyanSubtle, color: c.utilities.surface.cyan },
  sales: { backgroundColor: c.utilities.surface.purpleSubtle, color: c.utilities.surface.purple },
  success: { backgroundColor: c.utilities.surface.orangeSubtle, color: c.utilities.surface.orange },
  product: { backgroundColor: c.utilities.surface.amberSubtle, color: c.utilities.surface.amber },
  marketing: { backgroundColor: c.utilities.surface.blueSubtle, color: c.utilities.surface.blue },
  recruiting: { backgroundColor: c.utilities.surface.greenSubtle, color: c.utilities.surface.green },
  fundraising: { backgroundColor: c.utilities.surface.lavenderSubtle, color: c.utilities.surface.lavender },
  investing: { backgroundColor: c.utilities.surface.yellowSubtle, color: c.utilities.surface.yellow },
});
export const categoryLabel = style({ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 });
export const categoryName = style({ flex: 1 });

export const galleryMain = style({ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' });
export const gallerySearch = style({
  boxSizing: 'border-box',
  width: '100%',
  height: 52,
  padding: '0 16px',
  border: 'none',
  borderBottom: `1px solid ${c.stroke.primary}`,
  outline: 'none',
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.large,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});
export const galleryList = style({
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
});

export const presetCard = style({
  boxSizing: 'border-box',
  display: 'flex',
  gap: 16,
  padding: 12,
  border: `1px solid ${c.stroke.primary}`,
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: 'inherit',
  color: 'inherit',
  transition: `background-color ${ease}, border-color ${ease}`,
  selectors: {
    '&:hover, &[data-active="true"]': { backgroundColor: c.surface.secondary },
    '&:focus-visible': { outline: 'none', borderColor: c.stroke.accent },
  },
});
export const presetMini = style({
  boxSizing: 'border-box',
  width: 148,
  height: 112,
  flex: 'none',
  overflow: 'hidden',
  borderRadius: 8,
  backgroundColor: c.surface.secondary,
  padding: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  maskImage: 'linear-gradient(to bottom, #000 60%, transparent 100%)',
  WebkitMaskImage: 'linear-gradient(to bottom, #000 60%, transparent 100%)',
});
export const miniRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 4,
  height: 24,
  padding: '0 6px',
  borderRadius: 4,
  backgroundColor: c.surface.primary,
  ...text.text11.standard,
  fontSize: 9,
  color: c.content.primary,
});
export const miniFormat = style({ color: c.content.tertiary, whiteSpace: 'nowrap' });
export const presetInfo = style({ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 });
export const presetHead = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 });
export const presetTitle = style({ ...text.body.standard, fontWeight: 500 });
export const presetDescription = style({
  ...text.text12.standard,
  fontSize: 13,
  color: c.content.secondary,
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
});
export const countBadge = style({
  ...text.text12.standard,
  flex: 'none',
  padding: '0 8px',
  height: 20,
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 6,
  backgroundColor: c.surface.tint,
  color: c.content.secondary,
});
export const tags = style({ display: 'flex', gap: 6, marginTop: 'auto', flexWrap: 'wrap' });
export const tag = style({
  ...text.text12.standard,
  padding: '0 6px',
  height: 20,
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 6,
});

export const galleryFooter = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  height: 52,
  padding: '0 16px',
  borderTop: `1px solid ${c.stroke.primary}`,
  ...text.text12.standard,
  color: c.content.secondary,
});

export const presetPreview = style({ flex: 1, minHeight: 0, display: 'flex' });
export const presetSections = style({
  flex: 1,
  minWidth: 0,
  overflow: 'auto',
  padding: '32px 48px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
});
export const presetSide = style({
  boxSizing: 'border-box',
  width: 356,
  flex: 'none',
  borderLeft: `1px solid ${c.stroke.primary}`,
  padding: 20,
  overflow: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
});
export const sideTitle = style({ ...text.heading.small, fontSize: 18, lineHeight: '26px', fontWeight: 600, margin: 0 });
export const sideDescription = style({ ...text.body.standard, color: c.content.secondary, margin: 0 });
export const sideRule = style({ border: 'none', borderTop: `1px solid ${c.stroke.primary}`, margin: '4px 0' });
export const sideList = style({ display: 'flex', flexDirection: 'column', gap: 10, ...text.body.standard });
export const sideLabel = style({ ...text.body.standard, color: c.content.secondary });
export const sideItem = style({ display: 'flex', alignItems: 'center', gap: 8, color: c.content.secondary });

export const readOnlyPrompt = style({
  ...text.body.standard,
  margin: 0,
  color: c.content.primary,
  padding: '8px 16px',
  minHeight: 56,
  whiteSpace: 'pre-wrap',
});
export const readOnlyTitle = style({
  ...text.body.standard,
  fontWeight: 500,
  margin: 0,
  color: c.content.primary,
  padding: '12px 16px 4px',
});

// ---- badges -------------------------------------------------------------------------------------------------------------------------------

export const statusBadge = style({
  ...text.text12.standard,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 20,
  padding: '0 6px',
  borderRadius: 6,
});
export const statusTone = styleVariants({
  enabled: { backgroundColor: c.utilities.surface.greenSubtle, color: c.utilities.surface.greenHover },
  disabled: { backgroundColor: c.surface.tint, color: c.content.secondary },
  draft: { backgroundColor: c.utilities.surface.blueSubtle, color: c.utilities.surface.blueHover },
});

export const incomplete = style({
  margin: '8px 0 0',
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  ...text.body.standard,
  color: c.content.secondary,
});
