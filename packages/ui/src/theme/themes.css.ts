// Theme classes: one full class per identity, then partial classes for the accent and
// elevated-surface axes. Definition order matters: accent and elevated classes come later
// in the stylesheet so they win over the identity class at equal specificity.
import { style } from '@vanilla-extract/css';
import { colorTokens } from '../tokens/color.gen';
import { accentOverrides, elevatedOverrides, elevation } from '../tokens/theme.gen';
import { derivedVars, vars } from './vars.css';

type Identity = keyof typeof colorTokens;
type Tree = { readonly [key: string]: string | Tree };

/** Maps a (partial) value tree onto the matching contract variables. */
function assign(contract: Tree, values: Tree, out: Record<string, string> = {}): Record<string, string> {
  for (const [key, value] of Object.entries(values)) {
    const target = contract[key];
    if (target === undefined) throw new Error(`unknown token ${key}`);
    if (typeof value === 'string') {
      if (typeof target !== 'string') throw new Error(`token ${key} is a group`);
      out[target] = value;
    } else {
      if (typeof target === 'string') throw new Error(`token ${key} is a leaf`);
      assign(target, value, out);
    }
  }
  return out;
}

const derived: Record<Identity, { dialogFrame: string; dialogPanelRing: string }> = {
  light: { dialogFrame: 'rgba(255, 255, 255, 0.6)', dialogPanelRing: 'rgba(0, 0, 0, 0.07)' },
  dark: { dialogFrame: 'rgba(28, 29, 31, 0.6)', dialogPanelRing: 'rgba(255, 255, 255, 0.07)' },
  hacker: { dialogFrame: 'rgba(28, 29, 31, 0.6)', dialogPanelRing: 'rgba(255, 255, 255, 0.07)' },
};

function identityTheme(id: Identity) {
  return style(
    {
      vars: {
        ...assign(vars, { color: colorTokens[id], elevation: elevation[id] }),
        ...assign(derivedVars, derived[id]),
      },
    },
    `theme-${id}`,
  );
}

export const identityClass = {
  light: identityTheme('light'),
  dark: identityTheme('dark'),
  hacker: identityTheme('hacker'),
} as const;

type OverriddenAccent = keyof typeof accentOverrides;

function accentTheme(accent: OverriddenAccent) {
  return {
    light: style({ vars: assign(vars.color, accentOverrides[accent].light) }, `accent-${accent}-light`),
    dark: style({ vars: assign(vars.color, accentOverrides[accent].dark) }, `accent-${accent}-dark`),
    hacker: style({ vars: assign(vars.color, accentOverrides[accent].hacker) }, `accent-${accent}-hacker`),
  };
}

/** Blue is the default accent and needs no class. */
export const accentClass = {
  cyan: accentTheme('cyan'),
  yellow: accentTheme('yellow'),
  orange: accentTheme('orange'),
  pink: accentTheme('pink'),
  purple: accentTheme('purple'),
  green: accentTheme('green'),
} as const;

export const elevatedClass = {
  light: style({ vars: assign(vars.color, elevatedOverrides.light) }, 'elevated-light'),
  dark: style({ vars: assign(vars.color, elevatedOverrides.dark) }, 'elevated-dark'),
  hacker: style({ vars: assign(vars.color, elevatedOverrides.hacker) }, 'elevated-hacker'),
} as const;
