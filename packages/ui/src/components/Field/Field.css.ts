import { style, styleVariants } from '@vanilla-extract/css';
import { insetRing } from '../../theme/helpers';
import { text } from '../../theme/text';
import { vars } from '../../theme/vars.css';
import { scales } from '../../tokens/scales.gen';

const c = vars.color;
const { duration } = scales;

/** Field wrapper (components.md §3): column, 4 px gap, label row indented 4 px. */
export const field = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minWidth: 0,
});

export const label = style({
  ...text.text12.standard,
  color: c.content.tertiary,
  paddingLeft: 4,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  cursor: 'default',
});

export const necessity = style({ color: c.content.tertiary });

export const message = style({
  ...text.text11.standard,
  paddingLeft: 4,
  color: c.content.secondary,
});

export const messageTone = styleVariants({
  info: { color: c.content.secondary },
  warning: { color: c.content.warning },
  error: { color: c.content.critical },
});

/** The visual control box shared by TextInput, SearchField, TextArea and Select (ghost background + hairline ring). */
export const control = style({
  boxSizing: 'border-box',
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
  backgroundColor: c.interactive.ghost,
  boxShadow: insetRing(c.stroke.primaryTransparent),
  color: c.content.primary,
  cursor: 'text',
  transition: `box-shadow ${duration.comfortable}ms ease, background-color ${duration.comfortable}ms ease`,
  selectors: {
    '&:hover:not(:focus-within)': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&:focus-within': { boxShadow: insetRing(c.stroke.accent) },
    '&[data-invalid]': { boxShadow: insetRing(c.stroke.critical) },
    '&[data-readonly]': { backgroundColor: c.interactive.placeholder },
    '&[data-disabled]': { opacity: 0.4, cursor: 'default' },
  },
});

export const controlSize = styleVariants({
  28: { height: 28, borderRadius: 8, paddingInline: 8, gap: 6 },
  32: { height: 32, borderRadius: 9, paddingInline: 10, gap: 6 },
  34: { height: 34, borderRadius: 10, paddingInline: 10, gap: 6 },
});

/** Side with an icon/prefix is 2 px tighter. */
export const controlLeading = styleVariants({
  28: { paddingLeft: 6 },
  32: { paddingLeft: 8 },
  34: { paddingLeft: 8 },
});
export const controlTrailing = styleVariants({
  28: { paddingRight: 4 },
  32: { paddingRight: 6 },
  34: { paddingRight: 6 },
});

export const input = style({
  flex: 1,
  minWidth: 0,
  height: '100%',
  margin: 0,
  padding: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: 'inherit',
  ...text.body.standard,
  fontFamily: 'inherit',
  selectors: {
    '&::placeholder': { color: c.content.tertiary, opacity: 1 },
    '&[type="search"]::-webkit-search-cancel-button': { display: 'none' },
    '&[type="search"]::-webkit-search-decoration': { display: 'none' },
  },
  '@media': { '(pointer: coarse) and (max-width: 768px)': { fontSize: 16 } },
});

export const affix = style({
  ...text.text11.standard,
  color: c.content.secondary,
  flex: 'none',
  whiteSpace: 'nowrap',
});

export const leadingIcon = style({ color: c.content.secondary, flex: 'none' });

export const textarea = style({
  boxSizing: 'border-box',
  display: 'block',
  width: '100%',
  minHeight: 64,
  margin: 0,
  padding: '6px 10px',
  border: 'none',
  borderRadius: 10,
  outline: 'none',
  resize: 'none',
  backgroundColor: c.interactive.ghost,
  boxShadow: insetRing(c.stroke.primaryTransparent),
  color: c.content.primary,
  ...text.body.standard,
  fontFamily: 'inherit',
  transition: `box-shadow ${duration.comfortable}ms ease, background-color ${duration.comfortable}ms ease`,
  selectors: {
    '&::placeholder': { color: c.content.tertiary, opacity: 1 },
    '&[data-hovered]:not([data-focused])': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&[data-focused]': { boxShadow: insetRing(c.stroke.accent) },
    '&[data-invalid]': { boxShadow: insetRing(c.stroke.critical) },
    '&[readonly]': { backgroundColor: c.interactive.placeholder },
    '&[data-disabled]': { opacity: 0.4 },
  },
  '@media': { '(pointer: coarse) and (max-width: 768px)': { fontSize: 16 } },
});

export const resizable = style({ resize: 'vertical' });

export const clearButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  width: 20,
  height: 20,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: c.content.tertiary,
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&[data-hovered]': { backgroundColor: c.interactive.ghostHover, color: c.content.primary },
    '&[data-focus-visible]': { boxShadow: insetRing(c.stroke.accent) },
    '[data-empty] &': { visibility: 'hidden' },
  },
});
