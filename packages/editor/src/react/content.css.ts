// Note body typography and blocks: 14/24 px at weight 500, −0.07 px tracking, 12 px paragraph gaps, 4 px list gaps,
// 36 px per indent level, and accent-colour mentions and links. Shared by the editor and <RichTextPreview>.
import { text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, keyframes, style } from '@vanilla-extract/css';
import { MAX_INDENT } from '../model/blocks.ts';
import { ALL_HIGHLIGHT_COLORS, ALL_TEXT_COLORS, hueOfColorKey } from '../model/colors.ts';

const c = vars.color;
const utilityContent = c.utilities.content as unknown as Record<string, string>;
const utilitySurface = c.utilities.surface as unknown as Record<string, string>;

/** Horizontal step of one list indent level (text starts at 36 px × (indent + 1)). */
export const INDENT_STEP = 36;

/** The block container: the ProseMirror root in the editor, a div in previews. */
export const content = style({
  position: 'relative',
  color: c.content.primary,
  fontSize: 14,
  lineHeight: '24px',
  fontWeight: 500,
  letterSpacing: '-0.005em',
  outline: 'none',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
  wordBreak: 'break-word',
  fontVariantLigatures: 'none',
  caretColor: c.content.primary,
});

const sel = (s: string) => `${content} ${s}`;

globalStyle(`${content} > *`, { margin: 0 });
globalStyle(`${content} > * + *`, { marginTop: 12 });
// Lists are tight; content right after a heading sits close to it (template-editor.png: heading → list ≈ 4 px).
globalStyle(`${content} > .agentic-crm-note-list-item + .agentic-crm-note-list-item`, { marginTop: 4 });
globalStyle(`${content} > :is(h1, h2, h3) + *`, { marginTop: 4 });

globalStyle(sel('p'), { minHeight: 24 });
globalStyle(sel('h1'), { ...text.heading.large, lineHeight: '32px', color: c.content.primary });
globalStyle(sel('h2'), { ...text.heading.standard, lineHeight: '28px', color: c.content.primary });
globalStyle(sel('h3'), { ...text.heading.small, lineHeight: '24px', color: c.content.primary });

// ---- flat list items -------------------------------------------------------------------------------------------
globalStyle(sel('.agentic-crm-note-list-item'), {
  position: 'relative',
  display: 'block',
  minHeight: 24,
});
globalStyle(sel('.agentic-crm-note-list-item::before'), {
  position: 'absolute',
  top: 0,
  width: INDENT_STEP - 6,
  textAlign: 'right',
  color: c.content.primary,
  fontVariantNumeric: 'tabular-nums',
  userSelect: 'none',
  pointerEvents: 'none',
});
globalStyle(sel('.agentic-crm-note-list-item[data-list="ul"]::before'), { content: '"•"', paddingRight: 2 });
globalStyle(sel('.agentic-crm-note-list-item[data-list="ol"]::before'), { content: 'attr(data-number) "."' });
for (let indent = 0; indent <= MAX_INDENT; indent++) {
  globalStyle(sel(`.agentic-crm-note-list-item[data-indent="${indent}"]`), {
    paddingLeft: INDENT_STEP * (indent + 1),
  });
  globalStyle(sel(`.agentic-crm-note-list-item[data-indent="${indent}"]::before`), { left: INDENT_STEP * indent });
}

// ---- inline marks ----------------------------------------------------------------------------------------------
globalStyle(sel('strong, .agentic-crm-note-bold'), { fontWeight: 600 });
globalStyle(sel('em, .agentic-crm-note-italic'), { fontStyle: 'italic' });
globalStyle(sel('s, .agentic-crm-note-strikethrough'), { textDecoration: 'line-through' });
globalStyle(sel('.agentic-crm-note-link'), {
  color: c.content.accent,
  textDecoration: 'underline',
  textDecorationColor: c.stroke.secondaryTransparent,
  textUnderlineOffset: '0.14em',
  textDecorationThickness: 1,
  cursor: 'pointer',
});
globalStyle(sel('.agentic-crm-note-link:hover'), { textDecorationColor: c.content.accent });

for (const key of ALL_TEXT_COLORS) {
  const hue = hueOfColorKey(key);
  const color =
    key === 'block_grey' ? c.content.secondary : key === 'block_light-grey' ? c.content.tertiary : utilityContent[hue];
  if (color) globalStyle(sel(`[data-text-color="${key}"]`), { color });
}
for (const key of ALL_HIGHLIGHT_COLORS) {
  const color = utilitySurface[`${hueOfColorKey(key)}Subtle`];
  if (color) globalStyle(sel(`[data-highlight="${key}"]`), { backgroundColor: color, borderRadius: 2 });
}

// ---- mentions --------------------------------------------------------------------------------------------------
globalStyle(sel('.agentic-crm-note-mention'), {
  color: c.content.accent,
  borderRadius: 4,
  textDecoration: 'none',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
});
globalStyle(sel('.agentic-crm-note-mention:hover'), { backgroundColor: c.interactive.selectedSubtle });

// ---- placeholder variables (F composer): chips "{ Name › First }", yellow without a fallback, blue with ------
globalStyle(sel('.agentic-crm-variable'), {
  display: 'inline-block',
  boxSizing: 'border-box',
  height: 21,
  padding: '0 4px',
  borderRadius: 7,
  backgroundColor: c.surface.warning,
  color: c.content.onWarningSubtle,
  lineHeight: '21px',
  fontSize: 14,
  fontWeight: 400,
  letterSpacing: 0,
  whiteSpace: 'nowrap',
  verticalAlign: 'baseline',
  cursor: 'pointer',
  userSelect: 'none',
});
globalStyle(sel('.agentic-crm-variable[data-variable-fallback]'), {
  backgroundColor: c.surface.info,
  color: c.content.onInfoSubtle,
});
globalStyle(sel('.agentic-crm-variable.ProseMirror-selectednode'), {
  boxShadow: `0 0 0 1px ${c.stroke.accent}`,
});

// ---- images ----------------------------------------------------------------------------------------------------
globalStyle(sel('img.agentic-crm-note-image'), {
  display: 'block',
  maxWidth: '100%',
  height: 'auto',
  margin: '0 auto',
});
globalStyle(sel('img.agentic-crm-note-image[data-align="left"]'), { marginLeft: 0 });
globalStyle(sel('img.agentic-crm-note-image[data-align="right"]'), { marginRight: 0 });

// ---- editor-only chrome ----------------------------------------------------------------------------------------
// Placeholder of an empty body ("Start typing your note").
globalStyle(sel('p.is-editor-empty:first-child::before'), {
  content: 'attr(data-placeholder)',
  float: 'left',
  height: 0,
  color: c.content.tertiary,
  pointerEvents: 'none',
});
// Slash query: the hint after "/" while nothing is typed ("Find item (use ↑↓ to navigate)").
globalStyle(sel('.agentic-crm-slash-query.is-empty::after'), {
  content: 'attr(data-decoration-content)',
  color: c.content.tertiary,
  pointerEvents: 'none',
});
globalStyle(sel('.ProseMirror-selectednode'), { outline: 'none' });
globalStyle(`${content}.ProseMirror-focused .ProseMirror-gapcursor:after`, { borderTopColor: c.content.primary });

// Remote carets: 2 px caret in the peer colour with a name pill above it.
globalStyle(sel('.collaboration-carets__caret'), {
  position: 'relative',
  marginLeft: -1,
  marginRight: -1,
  borderLeft: '1px solid',
  borderRight: '1px solid',
  wordBreak: 'normal',
  pointerEvents: 'none',
});
globalStyle(sel('.collaboration-carets__label'), {
  position: 'absolute',
  left: -2,
  // Overlaps the top of the line slightly, as in note-realtime-remote-caret.png.
  bottom: 'calc(100% - 5px)',
  padding: '0 5px',
  borderRadius: 6,
  boxShadow: 'inset 0 0 0 1px rgba(16, 17, 18, 0.24)',
  color: '#ffffff',
  fontSize: 12,
  lineHeight: '18px',
  fontWeight: 500,
  fontStyle: 'normal',
  letterSpacing: 0,
  whiteSpace: 'nowrap',
  userSelect: 'none',
  pointerEvents: 'none',
});

// ---- image node view -------------------------------------------------------------------------------------------
export const figure = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  margin: 0,
  selectors: {
    '&[data-align="center"]': { alignItems: 'center' },
    '&[data-align="left"]': { alignItems: 'flex-start' },
    '&[data-align="right"]': { alignItems: 'flex-end' },
  },
});

export const frame = style({ position: 'relative', maxWidth: '100%', lineHeight: 0 });

export const image = style({
  display: 'block',
  width: '100%',
  height: 'auto',
  userSelect: 'none',
  selectors: {
    [`${figure}[data-selected="true"] &`]: { boxShadow: `0 0 0 1px ${c.stroke.accent}` },
  },
});

const pulse = keyframes({ '0%, 100%': { opacity: 0.6 }, '50%': { opacity: 1 } });

export const imagePlaceholder = style({
  display: 'block',
  width: '100%',
  minHeight: 120,
  borderRadius: 4,
  backgroundColor: c.surface.tertiary,
  animation: `${pulse} 1.5s ease infinite`,
});

export const imageMenuButton = style({
  position: 'absolute',
  top: 8,
  right: 8,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 8,
  border: 'none',
  padding: 0,
  backgroundColor: c.interactive.secondary,
  boxShadow: vars.elevation.e1,
  color: c.content.primary,
  cursor: 'pointer',
  opacity: 0,
  transition: 'opacity 140ms ease',
  selectors: {
    [`${figure}:hover &, &[data-pressed], &[data-focus-visible]`]: { opacity: 1 },
    '&:hover': { backgroundColor: c.interactive.secondaryHover },
  },
});

export const resizeHandle = style({
  position: 'absolute',
  top: '50%',
  width: 6,
  height: 40,
  marginTop: -20,
  borderRadius: 3,
  backgroundColor: 'rgba(255, 255, 255, 0.85)',
  boxShadow: `0 0 0 1px ${c.stroke.secondaryTransparent}`,
  cursor: 'ew-resize',
  opacity: 0,
  transition: 'opacity 140ms ease',
  touchAction: 'none',
  selectors: {
    [`${figure}:hover &, ${figure}[data-resizing="true"] &`]: { opacity: 1 },
  },
});
export const resizeHandleLeft = style({ left: 8 });
export const resizeHandleRight = style({ right: 8 });

export const caption = style({
  width: '100%',
  marginTop: 6,
  padding: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: c.content.secondary,
  textAlign: 'center',
  fontFamily: 'inherit',
  ...text.body.small,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});
