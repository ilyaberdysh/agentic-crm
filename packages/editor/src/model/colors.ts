// Colour keys of the note model: text colours `block_*`, highlights `pastel_*`, in the picker
// order, plus the legacy keys that are still valid when rendering. Keys are what the model stores; rendering maps
// them to theme tokens (text → utilities.content.<hue>, highlight → utilities.surface.<hue>Subtle).
import { colorTokens } from '@agentic-crm/ui/tokens';

/** Text colours offered by the selection toolbar, after "default". */
export const TEXT_COLORS = [
  'block_grey',
  'block_red',
  'block_magenta',
  'block_orange',
  'block_yellow',
  'block_green',
  'block_teal',
  'block_blue',
  'block_purple',
] as const;

/** Highlights offered by the selection toolbar, after "none" (order mirrors the text colours). */
export const HIGHLIGHT_COLORS = [
  'pastel_grey',
  'pastel_red',
  'pastel_magenta',
  'pastel_orange',
  'pastel_yellow',
  'pastel_green',
  'pastel_teal',
  'pastel_blue',
  'pastel_purple',
] as const;

/** Keys that are not offered any more but still render (BUNDLE MAIN#480440, #306639). */
export const LEGACY_TEXT_COLORS = ['block_light-green', 'block_violet', 'block_brown', 'block_light-grey'] as const;
export const LEGACY_HIGHLIGHT_COLORS = ['pastel_light-green', 'pastel_violet', 'pastel_brown'] as const;

export type TextColorKey = (typeof TEXT_COLORS)[number] | (typeof LEGACY_TEXT_COLORS)[number];
export type HighlightColorKey = (typeof HIGHLIGHT_COLORS)[number] | (typeof LEGACY_HIGHLIGHT_COLORS)[number];

export const ALL_TEXT_COLORS: readonly string[] = [...TEXT_COLORS, ...LEGACY_TEXT_COLORS];
export const ALL_HIGHLIGHT_COLORS: readonly string[] = [...HIGHLIGHT_COLORS, ...LEGACY_HIGHLIGHT_COLORS];

export function isTextColor(value: unknown): value is TextColorKey {
  return typeof value === 'string' && ALL_TEXT_COLORS.includes(value);
}

export function isHighlightColor(value: unknown): value is HighlightColorKey {
  return typeof value === 'string' && ALL_HIGHLIGHT_COLORS.includes(value);
}

/** Utility hue of a colour key (magenta → pink, teal → cyan, brown → amber, violet → lavender, light-green → lime). */
export function hueOfColorKey(key: string): string {
  const name = key.replace(/^(block|pastel)_/, '');
  switch (name) {
    case 'magenta':
      return 'pink';
    case 'teal':
      return 'cyan';
    case 'brown':
      return 'amber';
    case 'violet':
      return 'lavender';
    case 'light-green':
      return 'lime';
    case 'light-grey':
      return 'grey';
    default:
      return name;
  }
}

/**
 * Presence colours: the member id's character codes XOR-ed together, mod 8, over
 * [blue, green, orange, pink, purple, red, yellow, cyan], using the bold surface token (observed `#266DF0`).
 */
export const PRESENCE_HUES = ['blue', 'green', 'orange', 'pink', 'purple', 'red', 'yellow', 'cyan'] as const;

export type PresenceHue = (typeof PRESENCE_HUES)[number];

export function presenceHue(memberId: string): PresenceHue {
  let x = 0;
  for (let i = 0; i < memberId.length; i++) x ^= memberId.charCodeAt(i);
  return PRESENCE_HUES[x % PRESENCE_HUES.length] ?? 'blue';
}

export function presenceColor(memberId: string): string {
  const hue = presenceHue(memberId);
  const surface = colorTokens.light.utilities.surface as Record<string, string>;
  return (surface[hue] ?? '#266df0').toUpperCase();
}
