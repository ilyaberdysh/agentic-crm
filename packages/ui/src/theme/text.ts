// Text styles are plain objects so any `.css.ts` file can spread them, plus the named
// text-colour variants. Sizes are px; line heights are px strings.
import { scales } from '../tokens/scales.gen';
import { vars } from './vars.css';

const { textStyles } = scales;

export interface TextRule {
  fontSize: number;
  lineHeight: string;
  fontWeight: number;
  letterSpacing: string;
}

function rule(s: { fontSize: number; lineHeight: number; fontWeight: number; letterSpacing: string }): TextRule {
  return {
    fontSize: s.fontSize,
    lineHeight: `${s.lineHeight}px`,
    fontWeight: s.fontWeight,
    letterSpacing: s.letterSpacing,
  };
}

export const text = {
  heading: {
    extraLarge: rule(textStyles.heading.extraLarge),
    large: rule(textStyles.heading.large),
    standard: rule(textStyles.heading.standard),
    medium: rule(textStyles.heading.medium),
    small: rule(textStyles.heading.small),
    extraSmall: rule(textStyles.heading.extraSmall),
  },
  body: {
    large: rule(textStyles.body.large),
    standard: rule(textStyles.body.standard),
    small: rule(textStyles.body.small),
    strong: rule(textStyles.body.strong),
    link: rule(textStyles.body.link),
    interactive: rule(textStyles.body.interactive),
    preview: rule(textStyles.body.preview),
    code: rule(textStyles.body.code),
  },
  text12: {
    standard: rule(textStyles.text12.standard),
    link: rule(textStyles.text12.link),
    preview: rule(textStyles.text12.preview),
  },
  text11: {
    standard: rule(textStyles.text11.standard),
    link: rule(textStyles.text11.link),
    small: rule(textStyles.text11.small),
  },
} as const;

/** Named text colours (the `variant` names for Text and Icon). */
export const textColor = {
  primary: vars.color.content.primary,
  secondary: vars.color.content.secondary,
  tertiary: vars.color.content.tertiary,
  placeholder: vars.color.content.tertiary,
  accent: vars.color.content.accent,
  negative: vars.color.content.critical,
  positive: vars.color.content.success,
  warning: vars.color.content.warning,
  info: vars.color.content.info,
  inverse: vars.color.content.inverse,
  ghost: vars.color.content.ghost,
  'on-accent': vars.color.content.onAccent,
  'on-info-subtle': vars.color.content.onInfoSubtle,
  'primary-on-contextual': vars.color.content.floatingPrimary,
  'secondary-on-contextual': vars.color.content.floatingSecondary,
  'tertiary-on-contextual': vars.color.content.floatingTertiary,
} as const;

export type TextColor = keyof typeof textColor;

/** Resolves a named text colour, or passes any CSS colour through. */
export function resolveTextColor(color: TextColor | (string & {}) | undefined): string | undefined {
  if (color === undefined) return undefined;
  return color in textColor ? textColor[color as TextColor] : color;
}
