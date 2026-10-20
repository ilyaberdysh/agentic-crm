// Typed access to the generated design tokens (values reproduced exactly from tokens.json).
import { scales } from './scales.gen';
import { accentColors, identities, surfaceModes } from './theme.gen';

export { type ColorTokens, colorTokens } from './color.gen';
export { palette } from './palette.gen';
export { scales } from './scales.gen';
export {
  accentColors,
  accentOverrides,
  defaultAccent,
  elevatedOverrides,
  elevation,
  identities,
  surfaceModes,
} from './theme.gen';

export type ThemeIdentity = (typeof identities)[number];
export type AccentColor = (typeof accentColors)[number];
export type SurfaceMode = (typeof surfaceModes)[number];
/** The user-facing setting: System follows `prefers-color-scheme`. */
export type ThemePreference = 'light' | 'dark' | 'system';

/** The 12 utility hues used by tags, avatars, badges and status dots. */
export const hues = [
  'grey',
  'red',
  'orange',
  'yellow',
  'amber',
  'lime',
  'green',
  'cyan',
  'blue',
  'purple',
  'lavender',
  'pink',
] as const;
export type Hue = (typeof hues)[number];

/** Spacing scale in px: 0, 1, 2, 4, 6, 8, 10, 12, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96, 128. */
export const space = scales.spacing;
export type Space = keyof typeof space;

/** Radius scale in px (plus `round` 50 % and `squircleAvatar` 30 %). */
export const radius = scales.radius;
/** Control radius follows control height: 20 → 6, 28 → 8, 32 → 9, 34/36 → 10. */
export const controlRadius = scales.controlRadius;

export const fontFamily = scales.fontFamily;
export const fontWeight = scales.fontWeight;
export const textStyles = scales.textStyles;

export const zIndex = scales.zIndex;
export const breakpoints = scales.breakpoints;
export const density = scales.density;
export const springs = scales.springs;

/** Durations in ms: fast 80, comfortable 140, breezy 200, sluggish 300, sloth 400. */
export const duration = scales.duration;
export const easing = scales.easing;

/** `duration.fast` → `'80ms'` */
export function ms(value: number): string {
  return `${value}ms`;
}

/** Media queries for the breakpoint scale (min-width). */
export const media = {
  xs: `screen and (min-width: ${scales.breakpoints.xs}px)`,
  sm: `screen and (min-width: ${scales.breakpoints.sm}px)`,
  md: `screen and (min-width: ${scales.breakpoints.md}px)`,
  lg: `screen and (min-width: ${scales.breakpoints.lg}px)`,
  xl: `screen and (min-width: ${scales.breakpoints.xl}px)`,
  reducedMotion: '(prefers-reduced-motion: reduce)',
  coarseSmall: '(pointer: coarse) and (max-width: 768px)',
} as const;
