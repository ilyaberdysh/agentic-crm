// Colour assignment of chart groups (H chart-types §4). The model deals in `ColorKey`s (the names of the
// `vars.color.chart.*` tokens plus two specials); `view/colors.ts` turns a key into a CSS variable, so the model stays
// pure and testable.
import { toHue } from '@agentic-crm/ui';

/** Chart hue token names (base / Subtle / Bold of the 12 hues). */
export type ChartHue =
  | 'blue'
  | 'cyan'
  | 'green'
  | 'purple'
  | 'red'
  | 'yellow'
  | 'pink'
  | 'amber'
  | 'lavender'
  | 'orange'
  | 'lime'
  | 'grey';
export type ChartShade = '' | 'Subtle' | 'Bold';
export type ChartColorKey = `${ChartHue}${ChartShade}`;
/** `nullGrey` = utilities.surface.grey (the "No {attribute}" bucket, checkbox false); `accent` = surface.accent. */
export type ColorKey = ChartColorKey | 'nullGrey' | 'accent';

/** The categorical order of the 11 colourful hues (grey is reserved for options and empty buckets). */
export const CATEGORICAL_HUES = [
  'blue',
  'cyan',
  'green',
  'purple',
  'red',
  'yellow',
  'pink',
  'amber',
  'lavender',
  'orange',
  'lime',
] as const satisfies readonly ChartHue[];

const SHADES: readonly ChartShade[] = ['', 'Subtle', 'Bold'];

/** 33 colours: the 11 hues, then their Subtle variants, then their Bold variants. */
export const CATEGORICAL_PALETTE: readonly ChartColorKey[] = SHADES.flatMap((shade) =>
  CATEGORICAL_HUES.map((hue) => `${hue}${shade}` as ChartColorKey),
);

/** Categorical colour of the i-th category (cycled). */
export function categoricalColor(index: number): ChartColorKey {
  const n = CATEGORICAL_PALETTE.length;
  return CATEGORICAL_PALETTE[((index % n) + n) % n] as ChartColorKey;
}

/** The `i`-th use of a hue: base, Subtle, Bold, base … */
export function shadeOfHue(hue: ChartHue, occurrence: number): ChartColorKey {
  return `${hue}${SHADES[occurrence % SHADES.length]}` as ChartColorKey;
}

export interface ColorSource {
  key: string | null;
  /** Option / stage colour token (`pastel_teal`, `block_green`, …) or null. */
  color: string | null;
}

export interface ColorOptions {
  /** Checkbox groups: true → accent, false → grey. */
  checkbox?: boolean;
}

/**
 * Colours of a list of groups, in their natural order.
 * - the null group is grey; checkbox: true → accent blue, false → grey;
 * - groups with an option / stage colour use its hue; several groups of one hue take base / Subtle / Bold in turn;
 * - other groups cycle the categorical palette by their index (not counting the null group).
 */
export function assignGroupColors(
  groups: readonly ColorSource[],
  options: ColorOptions = {},
): Map<string | null, ColorKey> {
  const out = new Map<string | null, ColorKey>();
  const uses = new Map<ChartHue, number>();
  const coloured = groups.some((g) => g.key !== null && g.color);
  let index = 0;
  for (const g of groups) {
    if (g.key === null) {
      out.set(null, 'nullGrey');
      continue;
    }
    if (options.checkbox) {
      out.set(g.key, g.key === 'true' ? 'accent' : 'nullGrey');
      continue;
    }
    if (coloured) {
      if (!g.color) {
        out.set(g.key, 'nullGrey');
        continue;
      }
      const hue = toHue(g.color) as ChartHue;
      const n = uses.get(hue) ?? 0;
      uses.set(hue, n + 1);
      out.set(g.key, shadeOfHue(hue, n));
      continue;
    }
    out.set(g.key, categoricalColor(index++));
  }
  return out;
}
