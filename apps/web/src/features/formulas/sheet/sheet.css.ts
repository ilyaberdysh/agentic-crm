// Formula editor sheet (formulas.md §4.2–4.7, live geometry `EI:formula-editor-*.png`): replaces the attribute
// dialog's content inside the same 808 px frame, 600 px tall — header, CodeMirror editor, AI composer card, helper
// header (output · diagnostics + Fix or record preview · toggle), helper body (list 258 px | detail), footer.
import { fontFamily, insetRing, text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, keyframes, style } from '@vanilla-extract/css';

const c = vars.color;

export const sheet = style({
  height: 600,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  backgroundColor: c.surface.primary,
});

export const header = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: 8,
  height: 44,
  boxSizing: 'border-box',
});

export const headerTitle = style({
  ...text.body.standard,
  color: c.content.primary,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flex: 1,
  margin: 0,
});

export const headerIcon = style({ color: c.content.secondary });

export const editorArea = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
});

export const editor = style({ flex: 1, minHeight: 0, overflow: 'auto' });

// ---- AI composer ----------------------------------------------------------------------------------------------------

export const composerWrap = style({ flex: 'none', padding: '0 12px 12px', display: 'flex', flexDirection: 'column' });

export const banner = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 6px 14px 12px',
  marginBottom: -10,
  borderRadius: '14px 14px 0 0',
  backgroundColor: c.surface.warning,
  color: c.content.onWarningSubtle,
  ...text.text12.standard,
});

export const bannerText = style({ flex: 1, minWidth: 0 });

export const bannerLink = style({ color: 'inherit', textDecoration: 'underline' });

export const composer = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'flex-end',
  gap: 4,
  minHeight: 44,
  padding: '6px 6px 6px 12px',
  boxSizing: 'border-box',
  borderRadius: 14,
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.secondary),
  selectors: {
    '&:focus-within': { boxShadow: `${insetRing(c.stroke.accentMedium)}, 0 0 0 3px ${c.stroke.accentSubtle}` },
  },
});

export const composerInput = style({
  ...text.body.standard,
  flex: 1,
  minWidth: 0,
  maxHeight: 80,
  minHeight: 20,
  margin: '6px 0',
  padding: 0,
  border: 'none',
  outline: 'none',
  resize: 'none',
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  overflowY: 'auto',
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});

const shimmer = keyframes({
  '0%': { backgroundPosition: '100% 0' },
  '100%': { backgroundPosition: '-100% 0' },
});

export const thinking = style({
  ...text.body.standard,
  flex: 1,
  margin: '6px 0',
  color: 'transparent',
  backgroundImage: `linear-gradient(90deg, ${c.content.tertiary} 0%, ${c.content.tertiary} 40%, ${c.content.primary} 50%, ${c.content.tertiary} 60%, ${c.content.tertiary} 100%)`,
  backgroundSize: '200% 100%',
  backgroundClip: 'text',
  WebkitBackgroundClip: 'text',
  animation: `${shimmer} 1.6s linear infinite`,
});

export const composerActions = style({ display: 'flex', alignItems: 'center', gap: 2, flex: 'none' });

export const submit = style({
  width: 28,
  height: 28,
  borderRadius: 999,
  border: 'none',
  display: 'grid',
  placeItems: 'center',
  backgroundColor: c.interactive.primary,
  color: c.content.onAccent,
  cursor: 'pointer',
  selectors: {
    '&[data-disabled]': { opacity: 0.4, cursor: 'default' },
    '&[data-hovered]:not([data-disabled])': { backgroundColor: c.interactive.primaryHover },
  },
});

export const stop = style({
  width: 28,
  height: 28,
  borderRadius: 8,
  border: 'none',
  display: 'grid',
  placeItems: 'center',
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.secondary),
  color: c.content.primary,
  cursor: 'pointer',
});

// ---- helper header ----------------------------------------------------------------------------------------------------

export const helperHeader = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: 8,
  minHeight: 44,
  boxSizing: 'border-box',
  borderTop: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.secondary,
});

export const divider = style({
  width: 1,
  height: 20,
  backgroundColor: c.stroke.secondary,
  margin: '0 4px',
  flex: 'none',
});

export const summary = style({
  ...text.body.standard,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  padding: '0 6px',
  height: 28,
  border: 'none',
  background: 'none',
  color: c.content.critical,
  cursor: 'default',
});

export const summaryText = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

export const summaryList = style({ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 420 });

export const summaryLine = style({ color: c.content.floatingTertiary, marginRight: 6 });

export const preview = style({ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: 1 });

export const previewEquals = style({ ...text.body.standard, color: c.content.tertiary, padding: '0 4px' });

export const previewValue = style({
  ...text.body.standard,
  color: c.content.primary,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const previewMuted = style([previewValue, { color: c.content.tertiary }]);

export const spacer = style({ flex: 1 });

// ---- helper body ------------------------------------------------------------------------------------------------------

export const helperBody = style({
  flex: 'none',
  height: 252,
  display: 'flex',
  borderTop: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.secondary,
});

export const list = style({
  width: 258,
  flex: 'none',
  display: 'flex',
  flexDirection: 'column',
  borderRight: `1px solid ${c.stroke.primary}`,
  minHeight: 0,
});

export const search = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 36,
  padding: '0 16px',
  borderBottom: `1px solid ${c.stroke.primary}`,
  color: c.content.tertiary,
});

export const searchInput = style({
  ...text.body.standard,
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: c.content.primary,
  selectors: {
    '&::placeholder': { color: c.content.tertiary },
    '&:disabled': { color: c.content.tertiary },
  },
});

export const listScroll = style({ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 8px 12px' });

export const groupLabel = style({
  ...text.text12.standard,
  color: c.content.tertiary,
  padding: '6px 8px 4px',
});

export const row = style({
  ...text.body.standard,
  width: '100%',
  minHeight: 32,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 8px',
  boxSizing: 'border-box',
  border: 'none',
  borderRadius: 6,
  background: 'none',
  color: c.content.primary,
  textAlign: 'left',
  cursor: 'pointer',
  selectors: {
    '&[data-active]': { backgroundColor: c.interactive.ghostHover },
    '&[data-disabled]': { opacity: 0.4 },
  },
});

export const rowIcon = style({ color: c.content.secondary, flex: 'none' });

export const rowLabel = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const rowCrumb = style({ color: c.content.tertiary });

export const rowMono = style({ fontFamily: fontFamily.mono, fontSize: 13 });

export const rowTrailing = style({
  ...text.text12.standard,
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  color: c.content.tertiary,
  flex: 'none',
});

export const drill = style({
  border: 'none',
  background: 'none',
  padding: 2,
  borderRadius: 4,
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  color: c.content.tertiary,
  cursor: 'pointer',
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHover } },
});

export const detail = style({
  flex: 1,
  minWidth: 0,
  overflowY: 'auto',
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
});

export const detailEmpty = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  gap: 4,
});

export const detailEmptyTitle = style({ ...text.body.standard, color: c.content.secondary });

export const detailEmptyText = style({ ...text.text12.standard, color: c.content.secondary, maxWidth: 286 });

export const detailTitle = style({
  ...text.body.standard,
  color: c.content.primary,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
});

export const detailSignature = style({ fontFamily: fontFamily.mono, fontSize: 13, color: c.utilities.content.blue });

export const detailText = style({ ...text.text12.standard, color: c.content.secondary });

export const examplesLabel = style({ ...text.text12.standard, color: c.content.primary, marginTop: 16 });

export const examplesHint = style({ color: c.content.tertiary });

export const examples = style({
  marginTop: 8,
  borderRadius: 8,
  boxShadow: insetRing(c.stroke.primary),
  backgroundColor: c.surface.primary,
  display: 'flex',
  flexDirection: 'column',
});

export const example = style({
  border: 'none',
  background: 'none',
  textAlign: 'left',
  padding: '10px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  cursor: 'pointer',
  selectors: {
    '& + &': { borderTop: `1px solid ${c.stroke.primary}` },
    '&:hover': { backgroundColor: c.interactive.ghostHoverSubtle },
  },
});

export const exampleCode = style({ fontFamily: fontFamily.mono, fontSize: 13, color: c.content.primary });

export const exampleOutput = style({ ...text.body.standard, color: c.content.secondary });

// ---- footer -----------------------------------------------------------------------------------------------------------

export const footer = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: 8,
  borderTop: `1px solid ${c.stroke.primary}`,
});

// ---- output menu ------------------------------------------------------------------------------------------------------

export const outputAuto = style({ color: c.content.tertiary, marginLeft: 6 });

// ---- record picker ------------------------------------------------------------------------------------------------------

export const pickerPanel = style({ width: 300 });

globalStyle(`${examples} .cm-formula-chip`, { fontSize: 12 });
