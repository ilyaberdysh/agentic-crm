import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from 'react';
import { resolveTextColor, type TextColor } from '../../theme/text';
import * as t from '../../theme/typography.css';
import { cx } from '../../utils/cx';

export type { TextVariant } from '../../theme/typography.css';

export interface TextProps extends Omit<HTMLAttributes<HTMLElement>, 'color'> {
  /** Named text style. Default `body.standard` (14/20 500). */
  variant?: t.TextVariant;
  /** Named colour or any CSS colour. Body and text12/11 styles default to `secondary`, headings to `primary`. */
  color?: TextColor | (string & {});
  as?: ElementType;
  truncate?: boolean;
  /** tabular-nums */
  numeric?: boolean;
  uppercase?: boolean;
  lineClamp?: number;
  mono?: boolean;
  children?: ReactNode;
}

function defaultColor(variant: t.TextVariant): TextColor {
  if (variant.startsWith('heading.') || variant === 'body.link') return 'primary';
  if (variant === 'body.interactive') return 'accent';
  return 'secondary';
}

/** Typography primitive. `<Text variant="heading.medium">Title</Text>` */
export function Text({
  variant = 'body.standard',
  color,
  as: Component = 'span',
  truncate,
  numeric,
  uppercase,
  lineClamp,
  mono,
  className,
  style,
  ...rest
}: TextProps) {
  const css: CSSProperties = { color: resolveTextColor(color ?? defaultColor(variant)), ...style };
  if (lineClamp) (css as Record<string, unknown>)['--ar-line-clamp'] = String(lineClamp);
  return (
    <Component
      className={cx(
        t.textVariant[variant],
        truncate && t.truncate,
        numeric && t.numeric,
        uppercase && t.uppercase,
        lineClamp ? t.lineClamp : undefined,
        mono && t.mono,
        className,
      )}
      style={css}
      {...rest}
    />
  );
}

export type HeadingSize = 'extraLarge' | 'large' | 'standard' | 'medium' | 'small' | 'extraSmall';

export interface HeadingProps extends Omit<TextProps, 'variant'> {
  size?: HeadingSize;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
}

/** `<Heading size="large" level={1}>Appearance</Heading>` (default size `standard`, level 2). */
export function Heading({ size = 'standard', level = 2, as, ...rest }: HeadingProps) {
  return <Text variant={`heading.${size}`} as={as ?? (`h${level}` as ElementType)} {...rest} />;
}
