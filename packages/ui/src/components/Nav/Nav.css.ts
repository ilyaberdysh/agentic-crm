import { style } from '@vanilla-extract/css';
import { focusRing } from '../../theme/shared.css';
import { text } from '../../theme/text';
import { vars } from '../../theme/vars.css';

const c = vars.color;

// Sidebar navigation item (layout.md §2): 28 px, radius 9, padding 0 4 0 8, gap 6, 16 px icon
// in content.secondary (content.primary when active), label Body.Standard content.primary.
// Hover black 2 %, active (aria-current=page) black 4 %; opacity transition .16s.
export const item = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  minWidth: 0,
  padding: '0 4px 0 8px',
  borderRadius: 9,
  color: c.content.primary,
  ...text.body.standard,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  outline: 'none',
  userSelect: 'none',
  transition: 'opacity 160ms',
  selectors: {
    '&[data-hovered]': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&[data-current], &[aria-current="page"]': { backgroundColor: c.interactive.ghostHover },
    '&[data-focus-visible]': { ...focusRing, outlineOffset: -1 },
    '&[data-disabled]': { opacity: 0.4, cursor: 'default' },
  },
});

export const icon = style({
  color: c.content.secondary,
  flex: 'none',
  selectors: {
    [`${item}[data-current] &, ${item}[aria-current="page"] &`]: { color: c.content.primary },
  },
});

export const label = style({ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' });

export const trailing = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  flex: 'none',
  marginLeft: 'auto',
});

export const list = style({ display: 'flex', flexDirection: 'column', gap: 1 });

// Group label: a 28 px row with the 12/16 label 5 px from the top (settings: "Personal", "Workspace").
export const sectionLabel = style({
  ...text.text12.standard,
  color: c.content.secondary,
  padding: '5px 8px 7px',
  minHeight: 28,
  boxSizing: 'border-box',
});

// Accent swatches (Appearance settings): 24 px round radios, 8 px apart, each showing an 18 px
// colour dot (Attio draws a 22 px swatch with a 2 px surface ring); selected = 1 px inset accent ring.
export const swatches = style({ display: 'flex', alignItems: 'center', gap: 8 });

export const swatch = style({
  boxSizing: 'border-box',
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  borderRadius: '50%',
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&[data-selected]': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
    '&[data-focus-visible]': focusRing,
  },
});

export const swatchFill = style({
  width: 18,
  height: 18,
  borderRadius: '50%',
  transition: 'transform 200ms ease',
  selectors: {
    [`${swatch}[data-hovered]:not([data-selected]) &`]: { transform: 'scale(1.1)' },
  },
});
