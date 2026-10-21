// The typed theme contract: every themed token becomes a stable CSS custom property,
// e.g. vars.color.surface.primaryHover → var(--ar-color-surface-primary-hover).
import { createGlobalThemeContract } from '@vanilla-extract/css';
import { colorTokens } from '../tokens/color.gen';
import { elevation } from '../tokens/theme.gen';

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export const vars = createGlobalThemeContract(
  { color: colorTokens.light, elevation: elevation.light },
  (_value, path) => `ar-${path.map(kebab).join('-')}`,
);

export type ThemeVars = typeof vars;

/**
 * Values Computed in code rather than as tokens, kept per identity: the standalone
 * dialog frame (lighten(surface.primary, 2 %) at 60 % alpha, observed live as
 * rgba(255,255,255,.6) light / rgba(28,29,31,.6) dark) and the inner panel's 7 % ring.
 */
export const derivedVars = createGlobalThemeContract(
  { dialogFrame: 'dialog-frame', dialogPanelRing: 'dialog-panel-ring' },
  (value) => `ar-derived-${value}`,
);
