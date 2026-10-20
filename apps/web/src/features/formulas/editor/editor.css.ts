// CodeMirror theme of the formula editor (formulas.md §4.4): mono 13 / 26 px lines, 12 px vertical padding, line
// padding 0 12 px, a tertiary line-number gutter (min 39 px), selection = accent 20 %, `cm-formula-error` = red-subtle
// background with a dotted critical underline, `cm-highlighted` = blue-subtle (AI result), chips as grey pills.
import { alpha, fontFamily, text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style } from '@vanilla-extract/css';

const c = vars.color;

export const root = style({
  position: 'relative',
  minWidth: 0,
  cursor: 'text',
});

export const formula = style({});
export const prompt = style({});

globalStyle(`${root} .cm-editor`, { outline: 'none', backgroundColor: 'transparent', height: '100%' });
globalStyle(`${root} .cm-scroller`, { fontFamily: fontFamily.mono, overflow: 'auto' });

globalStyle(`${formula} .cm-content`, {
  fontSize: 13,
  lineHeight: '26px',
  padding: '12px 0',
  color: c.content.primary,
  caretColor: c.content.primary,
});
globalStyle(`${formula} .cm-line`, { padding: '0 12px 0 8px' });
globalStyle(`${formula} .cm-gutters`, {
  backgroundColor: 'transparent',
  border: 'none',
  color: c.content.tertiary,
  fontSize: 13,
  lineHeight: '26px',
});
globalStyle(`${formula} .cm-lineNumbers .cm-gutterElement`, {
  minWidth: 39,
  padding: '0 4px 0 12px',
  boxSizing: 'border-box',
  textAlign: 'right',
});
globalStyle(`${formula} .cm-placeholder`, { color: c.content.tertiary, fontFamily: fontFamily.mono });

// Prompt mode: the AI autofill prompt is prose, not code.
globalStyle(`${prompt} .cm-scroller`, { fontFamily: 'inherit' });
globalStyle(`${prompt} .cm-content`, {
  ...text.body.standard,
  padding: '8px 0',
  color: c.content.primary,
  caretColor: c.content.primary,
});
globalStyle(`${prompt} .cm-line`, { padding: '0 10px' });
globalStyle(`${prompt} .cm-placeholder`, { color: c.content.tertiary });

globalStyle(`${root} .cm-focused`, { outline: 'none' });
globalStyle(`${root} .cm-content ::selection, ${root} .cm-line::selection`, {
  backgroundColor: alpha(c.content.accent, 20),
});
globalStyle(`${root} .cm-selectionBackground, ${root} .cm-focused .cm-selectionBackground`, {
  backgroundColor: `${alpha(c.content.accent, 20)} !important`,
});
globalStyle(`${root} .cm-cursor`, { borderLeftColor: c.content.primary });

globalStyle(`${root} .cm-formula-error`, {
  backgroundColor: c.utilities.surface.redSubtle,
  textDecorationLine: 'underline',
  textDecorationStyle: 'dotted',
  textDecorationColor: c.content.critical,
  textDecorationThickness: 2,
  textUnderlineOffset: 3,
});
globalStyle(`${root} .cm-highlighted`, {
  backgroundColor: c.utilities.surface.blueSubtle,
  borderRadius: 4,
});

// ---- chips ----------------------------------------------------------------------------------------------------------

globalStyle('.cm-formula-chip', {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  height: 20,
  padding: '0 3px',
  margin: '0 1px',
  borderRadius: 4,
  backgroundColor: c.utilities.surface.greySubtle,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  color: c.content.secondary,
  fontFamily: fontFamily.mono,
  fontSize: 12,
  lineHeight: '20px',
  verticalAlign: 'baseline',
  whiteSpace: 'nowrap',
  cursor: 'default',
});
globalStyle(`${prompt} .cm-formula-chip`, { fontFamily: 'inherit', fontSize: 13 });
globalStyle('.cm-formula-chip[data-state="selected"]', {
  backgroundColor: c.surface.accentSubtle,
  boxShadow: `inset 0 0 0 1px ${c.stroke.accentSubtle}`,
  color: c.content.onAccentSubtle,
});
globalStyle('.cm-formula-chip[data-state="error"]', {
  backgroundColor: c.utilities.surface.redSubtle,
  boxShadow: 'none',
  color: c.content.onCriticalSubtle,
  textDecorationLine: 'underline',
  textDecorationStyle: 'dotted',
  textDecorationColor: c.content.critical,
  textUnderlineOffset: 3,
});
globalStyle('.cm-formula-chip-brace, .cm-formula-chip-sep, .cm-formula-chip-field', {
  color: c.content.tertiary,
});

// ---- tooltips and popups (portalled inside .cm-editor) ------------------------------------------------------------

globalStyle(`${root} .cm-tooltip`, { border: 'none', backgroundColor: 'transparent' });
globalStyle(`${root} .cm-formula-tooltip`, {
  ...text.text12.standard,
  maxWidth: 500,
  padding: '4px 8px',
  borderRadius: 6,
  backgroundColor: c.surface.floating,
  color: c.content.floatingPrimary,
  marginTop: 4,
});
globalStyle(`${root} .cm-tooltip.cm-formula-completion`, {
  width: 240,
  padding: 4,
  borderRadius: 10,
  backgroundColor: c.surface.primary,
  boxShadow: vars.elevation.e2,
});
globalStyle(`${root} .cm-formula-completion > ul`, {
  fontFamily: 'inherit !important',
  maxHeight: '240px !important',
});
globalStyle(`${root} .cm-formula-completion > ul > li`, {
  ...text.body.standard,
  height: 32,
  display: 'flex !important',
  alignItems: 'center',
  padding: '0 8px !important',
  borderRadius: 6,
  color: c.content.primary,
  fontFamily: fontFamily.mono,
});
globalStyle(`${root} .cm-formula-completion > ul > li[aria-selected]`, {
  backgroundColor: `${c.interactive.ghostHover} !important`,
  color: `${c.content.primary} !important`,
});
