// Colour keys stored by the data model map to utility hues. Select options use
// `pastel_*`; pipeline stages use `block_*`.
import type { Hue } from '../tokens';
import { hues } from '../tokens';

const KEY_TO_HUE: Record<string, Hue> = {
  blue: 'blue',
  brown: 'amber',
  green: 'green',
  grey: 'grey',
  gray: 'grey',
  'light-green': 'lime',
  'light-grey': 'grey',
  magenta: 'pink',
  orange: 'orange',
  purple: 'purple',
  red: 'red',
  teal: 'cyan',
  violet: 'lavender',
  yellow: 'yellow',
};

/** Select-option colours, in the picker order. */
export const selectOptionColors = [
  'pastel_grey',
  'pastel_red',
  'pastel_orange',
  'pastel_yellow',
  'pastel_brown',
  'pastel_light-green',
  'pastel_green',
  'pastel_teal',
  'pastel_blue',
  'pastel_purple',
  'pastel_violet',
  'pastel_magenta',
] as const;
export type SelectOptionColor = (typeof selectOptionColors)[number];

/** Status (pipeline stage) colours. */
export const statusColors = [
  'block_grey',
  'block_light-grey',
  'block_red',
  'block_orange',
  'block_yellow',
  'block_brown',
  'block_light-green',
  'block_green',
  'block_teal',
  'block_blue',
  'block_purple',
  'block_violet',
  'block_magenta',
] as const;
export type StatusColor = (typeof statusColors)[number];

export type ColorInput = Hue | SelectOptionColor | StatusColor | (string & {});

/** `pastel_teal` → `cyan`, `block_light-green` → `lime`, `red` → `red`; unknown → `grey`. */
export function toHue(color: ColorInput | undefined): Hue {
  if (!color) return 'grey';
  if ((hues as readonly string[]).includes(color)) return color as Hue;
  const key = color.replace(/^(pastel|block)_/, '');
  return KEY_TO_HUE[key] ?? 'grey';
}

/** Hues an avatar seed can resolve to (main MOD 574263 order). */
export const avatarHues = [
  'blue',
  'green',
  'orange',
  'pink',
  'purple',
  'red',
  'yellow',
  'cyan',
] as const satisfies readonly Hue[];
export type AvatarHue = (typeof avatarHues)[number];

/** Deterministic hue for a seed (record id, email, name): XOR-folds the char codes. */
export function hueForSeed(seed: string): AvatarHue {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) ^ (h >>> 27) ^ seed.charCodeAt(i)) >>> 0;
  return avatarHues[h % avatarHues.length] as AvatarHue;
}
