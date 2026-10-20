// Style-authoring surface for apps' `.css.ts` files (`@agentic-crm/ui/styles`): theme variables, text styles and
// small helpers, without React components or side-effect imports (fonts), so vanilla-extract can evaluate it.
export { alpha, insetRing } from './theme/helpers';
export { focusRing, transitionColors } from './theme/shared.css';
export { type TextColor, type TextRule, text, textColor } from './theme/text';
export { derivedVars, type ThemeVars, vars } from './theme/vars.css';
export * from './tokens';
