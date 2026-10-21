import { style } from '@vanilla-extract/css';
import { type RecipeVariants, recipe } from '@vanilla-extract/recipes';
import { insetRing } from '../../theme/helpers';
import { vars } from '../../theme/vars.css';

export const group = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  flex: 'none',
  fontFamily: 'inherit',
});

// Key caps: Inter, +0.02em, square for single characters.
export const kbd = recipe({
  base: {
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 'none',
    fontFamily: 'inherit',
    fontWeight: 500,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  },
  variants: {
    size: {
      14: { height: 14, minWidth: 14, borderRadius: 3, fontSize: 10, lineHeight: '14px', padding: '0 2px' },
      16: { height: 16, minWidth: 16, borderRadius: 4, fontSize: 10, lineHeight: '16px', padding: '0 3px' },
      18: { height: 18, minWidth: 18, borderRadius: 5, fontSize: 11, lineHeight: '18px', padding: '0 4px' },
      20: { height: 20, minWidth: 20, borderRadius: 6, fontSize: 11, lineHeight: '20px', padding: '0 4px' },
    },
    variant: {
      default: { color: vars.color.content.tertiary, boxShadow: insetRing(vars.color.stroke.primaryTransparent) },
      tooltip: { color: vars.color.content.floatingSecondary, boxShadow: insetRing(vars.color.stroke.floating) },
      'on-accent': { color: vars.color.content.onAccent, boxShadow: insetRing('rgba(255, 255, 255, 0.15)') },
      negative: { color: vars.color.content.critical, boxShadow: insetRing(vars.color.stroke.critical) },
    },
  },
  defaultVariants: { size: 16, variant: 'default' },
});

export type KbdVariants = NonNullable<RecipeVariants<typeof kbd>>;
