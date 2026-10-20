import { style, styleVariants } from '@vanilla-extract/css';
import { insetRing } from '../../theme/helpers';
import { text } from '../../theme/text';
import { vars } from '../../theme/vars.css';

const c = vars.color;

export const menu = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  outline: 'none',
  minWidth: 0,
  overflow: 'auto',
});

export const section = style({ display: 'flex', flexDirection: 'column', gap: 1 });

export const itemVariant = styleVariants({
  primary: {},
  danger: { color: c.content.critical },
  link: { color: c.content.secondary },
  help: { color: c.content.secondary },
});

export const itemIcon = style({ flex: 'none' });

export const itemTrailing = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  flex: 'none',
  marginLeft: 'auto',
  color: c.content.tertiary,
});

export const check = style({ color: c.content.accent, flex: 'none' });

export const submenuChevron = style({ color: c.content.secondary, flex: 'none' });

export const itemText = style({ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 });

// Filter input row at the top of a menu or searchable select: padding 8, gap 6, hairline below.
export const filterRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  margin: -4,
  marginBottom: 4,
  padding: 8,
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
  flexShrink: 0,
});

export const filterInput = style({
  flex: 1,
  minWidth: 0,
  margin: 0,
  padding: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: c.content.primary,
  ...text.body.standard,
  fontFamily: 'inherit',
  selectors: {
    '&::placeholder': { color: c.content.tertiary, opacity: 1 },
    '&::-webkit-search-cancel-button': { display: 'none' },
  },
});

export const filterIcon = style({ color: c.content.tertiary, flex: 'none' });

export const empty = style({
  ...text.text12.standard,
  color: c.content.secondary,
  padding: '6px 8px',
});

// Context menu (right click): dark floating surface, 1 px floating border, no shadow.
export const contextual = style({
  backgroundColor: c.surface.floating,
  boxShadow: insetRing(c.stroke.floating),
  color: c.content.floatingPrimary,
});

export const contextualItem = style({
  color: c.content.floatingPrimary,
  selectors: {
    '&[data-focused], &[data-open]': { backgroundColor: c.surface.floatingPrimaryHover },
  },
});

export const contextualDanger = style({
  color: c.content.critical,
  selectors: {
    '&[data-focused], &[data-open]': { backgroundColor: c.surface.floatingPrimaryHover },
  },
});

export const contextualSeparator = style({ backgroundColor: c.stroke.floating });
