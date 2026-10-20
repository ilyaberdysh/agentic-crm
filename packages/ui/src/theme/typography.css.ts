import { style, styleVariants } from '@vanilla-extract/css';
import { scales } from '../tokens/scales.gen';
import { text } from './text';
import { vars } from './vars.css';

const underlineBase = {
  textDecorationLine: 'underline',
  textDecorationColor: vars.color.stroke.secondaryTransparent,
  textUnderlineOffset: scales.underline.offset,
} as const;

const solid = { ...underlineBase, textDecorationStyle: 'solid' } as const;
const dashed = {
  ...underlineBase,
  textDecorationStyle: 'dashed',
  textDecorationThickness: scales.underline.dashedThickness,
} as const;

export const textVariant = styleVariants({
  'heading.extraLarge': text.heading.extraLarge,
  'heading.large': text.heading.large,
  'heading.standard': text.heading.standard,
  'heading.medium': text.heading.medium,
  'heading.small': text.heading.small,
  'heading.extraSmall': text.heading.extraSmall,
  'body.large': text.body.large,
  'body.standard': text.body.standard,
  'body.small': text.body.small,
  'body.strong': text.body.strong,
  'body.link': { ...text.body.link, ...solid },
  'body.interactive': text.body.interactive,
  'body.preview': { ...text.body.preview, ...dashed },
  'body.code': { ...text.body.code, fontFamily: scales.fontFamily.mono },
  'text12.standard': text.text12.standard,
  'text12.link': { ...text.text12.link, ...solid },
  'text12.preview': { ...text.text12.preview, ...dashed },
  'text11.standard': text.text11.standard,
  'text11.link': { ...text.text11.link, ...solid },
  'text11.small': text.text11.small,
});

export type TextVariant = keyof typeof textVariant;

export const truncate = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });
export const numeric = style({ fontVariantNumeric: 'tabular-nums' });
export const uppercase = style({ textTransform: 'uppercase', letterSpacing: '0.02em' });
export const lineClamp = style({
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  WebkitLineClamp: 'var(--ar-line-clamp)',
});
export const mono = style({ fontFamily: scales.fontFamily.mono });
