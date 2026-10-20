import { globalStyle, style } from '@vanilla-extract/css';
import { type RecipeVariants, recipe } from '@vanilla-extract/recipes';
import { insetRing } from '../../theme/helpers';
import { focusRing, transitionColors } from '../../theme/shared.css';
import { text } from '../../theme/text';
import { vars } from '../../theme/vars.css';

const c = vars.color;
const mix = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

/** Primary/destructive shadow formula: hairline + two tinted drops. */
const tintedShadow = (tint: string) =>
  `${insetRing(c.stroke.primaryTransparent)}, 0 2px 4px -2px ${mix(tint, 12)}, 0 3px 6px -2px ${mix(tint, 8)}`;

const HOVER = '&[data-hovered]:not([data-disabled]):not([data-pending])';
const ACTIVE = '&[data-pressed], &[data-active], &[aria-expanded="true"], &[data-state="open"]';

const size = (height: number, py: number, px: number, gap: number, radius: number, small = false) =>
  ({
    height,
    minWidth: height,
    padding: `${py}px ${px}px`,
    gap,
    borderRadius: radius,
    ...(small ? { ...text.text12.standard } : { ...text.body.standard }),
    selectors: {
      // "x next to an icon": the side holding an icon, chevron or shortcut is 2 px tighter.
      '&[data-leading]': { paddingLeft: px - 2 },
      '&[data-trailing]': { paddingRight: px - 2 },
    },
  }) as const;

export const button = recipe({
  base: {
    boxSizing: 'border-box',
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 'none',
    margin: 0,
    border: 'none',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    textDecoration: 'none',
    userSelect: 'none',
    cursor: 'pointer',
    outline: 'none',
    WebkitTapHighlightColor: 'transparent',
    transition: transitionColors,
    selectors: {
      '&[data-focus-visible]': focusRing,
      '&[data-disabled]': { opacity: 0.4, cursor: 'default' },
      '&[data-pending]': { cursor: 'default' },
    },
  },
  variants: {
    variant: {
      primary: {
        backgroundColor: c.interactive.primary,
        color: c.content.onAccent,
        boxShadow: tintedShadow(c.interactive.primary),
        selectors: {
          [HOVER]: { backgroundColor: c.interactive.primaryHover },
          [ACTIVE]: { backgroundColor: c.interactive.primaryHover },
        },
      },
      secondary: {
        backgroundColor: c.interactive.secondary,
        color: c.content.primary,
        boxShadow: vars.elevation.e1,
        selectors: {
          [HOVER]: { backgroundColor: c.interactive.secondaryHover },
          [ACTIVE]: { backgroundColor: c.interactive.secondaryHover },
        },
      },
      'secondary-destructive': {
        backgroundColor: c.interactive.secondary,
        color: c.content.critical,
        boxShadow: vars.elevation.e1,
        selectors: {
          [HOVER]: { backgroundColor: c.interactive.secondaryHover },
          [ACTIVE]: { backgroundColor: c.interactive.secondaryHover },
        },
      },
      ghost: {
        backgroundColor: c.interactive.ghost,
        color: c.content.ghost,
        selectors: {
          [HOVER]: { backgroundColor: c.interactive.ghostHover, color: c.content.primary },
          [ACTIVE]: { backgroundColor: c.interactive.ghostHover, color: c.content.primary },
        },
      },
      destructive: {
        backgroundColor: c.interactive.critical,
        color: c.content.onAccent,
        boxShadow: tintedShadow(c.utilities.surface.red),
        selectors: {
          [HOVER]: { backgroundColor: c.interactive.criticalHover },
          [ACTIVE]: { backgroundColor: c.interactive.criticalHover },
        },
      },
    },
    size: {
      '20': size(20, 2, 6, 4, 6, true),
      // 20s: the compact 20 px button with tighter sides (used in dense rows).
      '20s': size(20, 2, 4, 4, 6, true),
      // 20l: 20 px tall with a 16 px icon (e.g. menu back buttons).
      '20l': size(20, 2, 6, 4, 6, true),
      '28': size(28, 4, 8, 6, 8),
      '32': size(32, 6, 10, 6, 9),
      '36': size(36, 8, 12, 6, 10),
    },
    iconOnly: {
      true: { paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 },
      false: {},
    },
    fullWidth: {
      true: { width: '100%' },
      false: {},
    },
  },
  compoundVariants: [
    { variants: { iconOnly: true, size: '20' }, style: { width: 20 } },
    { variants: { iconOnly: true, size: '20s' }, style: { width: 20 } },
    { variants: { iconOnly: true, size: '20l' }, style: { width: 20 } },
    { variants: { iconOnly: true, size: '28' }, style: { width: 28 } },
    { variants: { iconOnly: true, size: '32' }, style: { width: 32 } },
    { variants: { iconOnly: true, size: '36' }, style: { width: 36 } },
  ],
  defaultVariants: { variant: 'primary', size: '32', iconOnly: false, fullWidth: false },
});

export type ButtonRecipe = NonNullable<RecipeVariants<typeof button>>;

export const label = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

/** Count pill inside a button (padding-inline 4, radius 6, 12/16). */
export const badge = style({
  display: 'inline-flex',
  alignItems: 'center',
  height: 16,
  paddingInline: 4,
  borderRadius: 6,
  ...text.text12.standard,
  fontVariantNumeric: 'tabular-nums',
  color: 'inherit',
  backgroundColor: mix('currentColor', 1),
  boxShadow: `inset 0 0 0 1px ${mix('currentColor', 10)}`,
});

export const badgeOnAccent = style({
  backgroundColor: 'rgba(255, 255, 255, 0.05)',
  boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.3)',
});

/** Square-off inner radii and overlap borders by 1 px (groups). */
export const group = style({ display: 'inline-flex', alignItems: 'center', isolation: 'isolate' });

globalStyle(`${group} > *:not(:first-child)`, {
  marginLeft: -1,
  borderTopLeftRadius: 0,
  borderBottomLeftRadius: 0,
});
globalStyle(`${group} > *:not(:last-child)`, { borderTopRightRadius: 0, borderBottomRightRadius: 0 });
globalStyle(`${group} > [data-hovered], ${group} > [data-focus-visible]`, { zIndex: 1 });
