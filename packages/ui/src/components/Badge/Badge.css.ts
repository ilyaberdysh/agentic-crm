import { style, styleVariants } from '@vanilla-extract/css';
import { insetRing } from '../../theme/helpers';
import { text } from '../../theme/text';
import { vars } from '../../theme/vars.css';
import { hues } from '../../tokens';
import { scales } from '../../tokens/scales.gen';

const c = vars.color;
const u = c.utilities;
const surfaces = u.surface as Record<string, string>;
const strokes = u.stroke as Record<string, string>;
const contents = u.content as Record<string, string>;
const cap = (h: string) => h.charAt(0).toUpperCase() + h.slice(1);
type HueKey = (typeof hues)[number];

// ---- Badge (count / status pill): 14 / 16 / 20, padding-inline 4, tabular-nums.
export const badge = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  paddingInline: 4,
  fontWeight: 500,
  letterSpacing: 0,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
});

export const badgeSize = styleVariants({
  14: { height: 14, minWidth: 14, borderRadius: 4, fontSize: 10, lineHeight: '14px' },
  16: { height: 16, minWidth: 16, borderRadius: 6, fontSize: 12, lineHeight: '16px' },
  20: { height: 20, minWidth: 20, borderRadius: 6, fontSize: 14, lineHeight: '20px', letterSpacing: '-0.005em' },
});

export const badgeVariant = styleVariants({
  primary: { color: c.content.onAccent, backgroundColor: c.surface.accent },
  secondary: {
    color: c.content.accent,
    backgroundColor: c.surface.accentSubtle,
    boxShadow: insetRing(c.stroke.accentSubtle),
  },
  tertiary: { color: u.content.onGreySubtle, backgroundColor: c.surface.tint, boxShadow: insetRing(u.stroke.grey) },
  warning: {
    color: u.content.onYellowSubtle,
    backgroundColor: u.surface.yellowSubtle,
    boxShadow: insetRing(u.stroke.yellow),
  },
  danger: { color: u.content.onRedSubtle, backgroundColor: u.surface.redSubtle, boxShadow: insetRing(u.stroke.red) },
  ghost: { color: c.content.tertiary, backgroundColor: u.surface.greySubtle },
});

// ---- Tag (select-option label): <hue>Subtle bg + inset <hue> stroke + on<Hue>Subtle text.
export const tag = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  flex: 'none',
  maxWidth: '100%',
  paddingInline: 4,
  whiteSpace: 'nowrap',
  verticalAlign: 'middle',
});

export const tagSize = styleVariants({
  20: { height: 20, borderRadius: 6, ...text.text12.standard },
  22: { height: 22, borderRadius: 7, ...text.body.standard },
});

export const tagHue = styleVariants(
  Object.fromEntries(
    hues.map((h) => [
      h,
      {
        backgroundColor: surfaces[`${h}Subtle`],
        boxShadow: insetRing(strokes[h] as string),
        color: contents[`on${cap(h)}Subtle`],
      },
    ]),
  ) as Record<HueKey, { backgroundColor: string; boxShadow: string; color: string }>,
);

export const tagText = style({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' });

export const tagRemove = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  padding: 0,
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  outline: 'none',
  opacity: 0.8,
  selectors: {
    '&[data-hovered]': { opacity: 1 },
    '&[data-focus-visible]': { boxShadow: insetRing(c.stroke.accent) },
  },
});

// ---- Status dot: 6 / 8 / 10 / 14 in utilities.surface.<hue>.
export const dot = style({ display: 'inline-block', flex: 'none', borderRadius: '50%' });
export const dotHue = styleVariants(
  Object.fromEntries(hues.map((h) => [h, { backgroundColor: surfaces[h] }])) as Record<
    HueKey,
    { backgroundColor: string }
  >,
);

export const status = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  ...text.body.standard,
  color: c.content.primary,
  whiteSpace: 'nowrap',
});

// ---- Chip: 20 (text12, padding 2 4) / 22 (Body, padding 1 3), gap 5, radius 7, transparent.
export const chip = style({
  boxSizing: 'border-box',
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  flex: 'none',
  maxWidth: '100%',
  margin: 0,
  border: 'none',
  borderRadius: 7,
  backgroundColor: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
  textDecoration: 'none',
  outline: 'none',
  transition: `background-color ${scales.duration.breezy}ms ease, box-shadow ${scales.duration.breezy}ms ease`,
  selectors: {
    '&[data-interactive]': { cursor: 'pointer' },
    '&[data-interactive][data-hovered], &[data-interactive][aria-expanded="true"]': {
      backgroundColor: c.interactive.ghostHover,
    },
    '&[data-focus-visible]': { boxShadow: insetRing(c.stroke.accent) },
    '&[data-disabled]': { opacity: 0.4, cursor: 'default' },
  },
});

export const chipSize = styleVariants({
  20: { height: 20, padding: '2px 4px', ...text.text12.standard },
  22: { height: 22, padding: '1px 3px', ...text.body.standard },
});

const underline = {
  textDecorationLine: 'underline',
  textDecorationColor: c.stroke.secondaryTransparent,
  textUnderlineOffset: '0.14em',
} as const;

export const chipVariant = styleVariants({
  primary: {},
  secondary: { color: c.content.secondary },
  link: {},
  preview: {},
  'external-link': {},
  error: { color: c.content.critical },
  'stroke-primary': { boxShadow: insetRing(c.stroke.primary) },
  'stroke-secondary': { boxShadow: insetRing(c.stroke.secondary) },
});

export const chipText = style({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' });

export const chipTextLink = style({
  ...underline,
  selectors: { [`${chip}[data-hovered] &`]: { textDecorationColor: 'transparent' } },
});

export const chipTextPreview = style({
  ...underline,
  textDecorationStyle: 'dashed',
  textDecorationThickness: '0.07em',
});

export const chipSuffix = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: c.content.secondary,
  cursor: 'pointer',
  outline: 'none',
  // Revealed after hovering the chip for 100 ms, sliding in from 4 px.
  opacity: 0,
  transform: 'translateX(4px)',
  transition: `opacity ${scales.duration.breezy}ms ease, transform ${scales.duration.breezy}ms ease, background-color ${scales.duration.breezy}ms ease`,
  selectors: {
    [`${chip}:hover &, &[data-focus-visible]`]: { opacity: 1, transform: 'none', transitionDelay: '100ms' },
    '&[data-hovered]': { backgroundColor: c.interactive.ghostHover, color: c.content.primary },
    '&[data-focus-visible]': { boxShadow: insetRing(c.stroke.accent) },
  },
});
