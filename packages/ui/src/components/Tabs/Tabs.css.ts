import { style } from '@vanilla-extract/css';
import { insetRing } from '../../theme/helpers';
import { text } from '../../theme/text';
import { vars } from '../../theme/vars.css';
import { scales } from '../../tokens/scales.gen';

const c = vars.color;
const t = `${scales.duration.comfortable}ms ease`;

export const tabs = style({ display: 'flex', flexDirection: 'column', minWidth: 0 });

// List: row, gap 4. The default variant adds 8 px bottom padding and a full-width 1 px rule.
export const list = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
  outline: 'none',
});

export const listDefault = style({
  paddingBottom: 8,
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
});

// Tab: 28 px, padding 4 8, radius 8, gap 6; hover adds the ring; selected adds
// surface.primaryHover + ring + a 1 px content.primary underline on the list rule.
export const tab = style({
  boxSizing: 'border-box',
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '4px 8px',
  borderRadius: 8,
  color: c.content.secondary,
  ...text.body.standard,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  outline: 'none',
  userSelect: 'none',
  transition: `box-shadow ${t}, background-color ${t}, color ${t}`,
  selectors: {
    '&[data-hovered]': { color: c.content.primary, boxShadow: insetRing(c.stroke.primary) },
    '&[data-selected]': {
      color: c.content.primary,
      backgroundColor: c.surface.primaryHover,
      boxShadow: insetRing(c.stroke.primary),
    },
    '&[data-focus-visible]': { boxShadow: insetRing(c.stroke.accent) },
    '&[data-disabled]': { opacity: 0.4, cursor: 'default' },
  },
});

export const underline = style({
  selectors: {
    [`${listDefault} ${tab}[data-selected] > &`]: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: -8,
      height: 1,
      backgroundColor: c.content.primary,
    },
  },
});

// Divider before a tab (create-record dialog: "All | Create templates"): 1 × 16 rule, 12 px clear.
export const divided = style({
  marginLeft: 20,
  selectors: {
    '&::before': {
      content: '""',
      position: 'absolute',
      left: -12,
      top: 6,
      width: 1,
      height: 16,
      backgroundColor: c.stroke.primary,
      pointerEvents: 'none',
    },
  },
});

/** Count after the label: a small grey pill (evidence J/object-attributes-tab: "Attributes 21"). */
export const count = style({
  boxSizing: 'border-box',
  minWidth: 16,
  height: 16,
  padding: '0 4px',
  borderRadius: 4,
  backgroundColor: c.surface.tint,
  color: c.content.tertiary,
  fontSize: 11,
  lineHeight: '16px',
  fontWeight: 500,
  textAlign: 'center',
  fontVariantNumeric: 'tabular-nums',
});

export const panel = style({ outline: 'none', minHeight: 0 });

// Segmented control (components.md §2): tint track, padding 2, gap 2, radius 10.
export const segmented = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  padding: 2,
  borderRadius: 10,
  backgroundColor: c.surface.tint,
});

export const segment = style({
  boxSizing: 'border-box',
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  margin: 0,
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: c.content.secondary,
  ...text.body.standard,
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  outline: 'none',
  transition: `background-color ${t}, box-shadow ${t}, color ${t}`,
  selectors: {
    '&[data-hovered]:not([data-selected])': { backgroundColor: c.interactive.ghostHover },
    '&[data-selected]': {
      backgroundColor: c.surface.primary,
      color: c.content.primary,
      boxShadow: '0 1px 2px -1px rgba(0, 0, 0, 0.04)',
    },
    '&[data-focus-visible]': { boxShadow: insetRing(c.stroke.accent) },
    '&[data-disabled]': { opacity: 0.4, cursor: 'default' },
    // 1 × 18 separators between unselected neighbours.
    '&:not(:first-child)::before': {
      content: '""',
      position: 'absolute',
      left: -2,
      top: '50%',
      width: 1,
      height: 18,
      marginTop: -9,
      backgroundColor: c.stroke.primaryTransparent,
      transition: 'opacity 100ms ease-out',
    },
    '&[data-selected]::before, [data-selected] + &::before': { opacity: 0, transitionTimingFunction: 'ease-in' },
  },
});

export const segmentSize28 = style({ height: 24, padding: '2px 6px' });
export const segmentSize32 = style({ height: 28, padding: '4px 8px' });
export const segmentIcon28 = style({ width: 24, padding: 0 });
export const segmentIcon32 = style({ width: 28, padding: 0 });
