import type { CSSProperties, ReactNode } from 'react';
import { Button as RACButton, type ButtonProps as RACButtonProps } from 'react-aria-components';
import { Icon } from '../../icons/Icon';
import type { IconName } from '../../icons/iconMap';
import type { IconGlyph } from '../../icons/types';
import { type ColorInput, toHue } from '../../utils/colors';
import { cx } from '../../utils/cx';
import * as s from './Badge.css';

export type BadgeVariant = 'primary' | 'secondary' | 'tertiary' | 'warning' | 'danger' | 'ghost';

export interface BadgeProps {
  children?: ReactNode;
  variant?: BadgeVariant;
  /** 14 | 16 (default) | 20 */
  size?: 14 | 16 | 20;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
}

/** Count / status pill (sidebar "Tasks 2" is a primary 16). */
export function Badge({ children, variant = 'primary', size = 16, className, ...rest }: BadgeProps) {
  return (
    <span className={cx(s.badge, s.badgeSize[size], s.badgeVariant[variant], className)} {...rest}>
      {children}
    </span>
  );
}

export interface TagProps {
  children?: ReactNode;
  /** A hue (`blue`), a select-option colour (`pastel_teal`) or a status colour (`block_red`). Default grey. */
  color?: ColorInput;
  /** 20 (default, text12) or 22 (Body.Standard). */
  size?: 20 | 22;
  icon?: IconName | IconGlyph;
  /** Shows the remove button. */
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
  style?: CSSProperties;
}

/** Coloured label for select / multi-select values. */
export function Tag({
  children,
  color = 'grey',
  size = 20,
  icon,
  onRemove,
  removeLabel = 'Remove',
  className,
  style,
}: TagProps) {
  const iconSize = size === 20 ? 12 : 16;
  return (
    <span className={cx(s.tag, s.tagSize[size], s.tagHue[toHue(color)], className)} style={style}>
      {icon && <Icon icon={icon} size={iconSize} />}
      <span className={s.tagText}>{children}</span>
      {onRemove && (
        <RACButton
          className={s.tagRemove}
          aria-label={removeLabel}
          onPress={onRemove}
          style={{ width: iconSize, height: iconSize }}
        >
          <Icon icon="close" size={iconSize} />
        </RACButton>
      )}
    </span>
  );
}

export interface StatusDotProps {
  color?: ColorInput;
  /** 6 | 8 (default) | 10 | 14 */
  size?: 6 | 8 | 10 | 14;
  className?: string;
  'aria-label'?: string;
}

export function StatusDot({ color = 'grey', size = 8, className, ...rest }: StatusDotProps) {
  return (
    <span
      className={cx(s.dot, s.dotHue[toHue(color)], className)}
      style={{ width: size, height: size }}
      role={rest['aria-label'] ? 'img' : undefined}
      aria-hidden={rest['aria-label'] ? undefined : true}
      {...rest}
    />
  );
}

export interface StatusProps {
  children?: ReactNode;
  /** Pipeline stage colour (`block_*`) or a hue. */
  color?: ColorInput;
  className?: string;
}

/** Status value as shown in cells: 8 px coloured dot + stage title. */
export function Status({ children, color = 'grey', className }: StatusProps) {
  return (
    <span className={cx(s.status, className)}>
      <StatusDot color={color} size={8} />
      <span className={s.tagText}>{children}</span>
    </span>
  );
}

export type ChipVariant =
  | 'primary'
  | 'secondary'
  | 'link'
  | 'preview'
  | 'external-link'
  | 'error'
  | 'stroke-primary'
  | 'stroke-secondary';

export interface ChipProps extends Omit<RACButtonProps, 'children' | 'className' | 'style'> {
  children?: ReactNode;
  variant?: ChipVariant;
  /** 20 (default) or 22. */
  size?: 20 | 22;
  /** Leading icon or element (avatar, logo, dot). */
  icon?: IconName | IconGlyph;
  leading?: ReactNode;
  /** Makes the chip a button (hover background, focus ring). */
  onPress?: RACButtonProps['onPress'];
  /** Hover-revealed suffix action (e.g. remove). Only for non-pressable chips (no `onPress`). */
  suffix?: { icon: IconName | IconGlyph; label: string; onPress: () => void };
  className?: string;
  style?: CSSProperties;
}

/** Neutral inline chip for references and filter values (radius 7, transparent until hovered). */
export function Chip({
  children,
  variant = 'primary',
  size = 20,
  icon,
  leading,
  onPress,
  suffix,
  className,
  style,
  ...rest
}: ChipProps) {
  const iconSize = size === 20 ? 12 : 16;
  const textClass = cx(
    s.chipText,
    (variant === 'link' || variant === 'external-link') && s.chipTextLink,
    variant === 'preview' && s.chipTextPreview,
  );
  const inner = (
    <>
      {leading}
      {icon && <Icon icon={icon} size={iconSize} />}
      <span className={textClass}>{children}</span>
      {variant === 'external-link' && <Icon icon="arrowUpRight" size={iconSize} />}
      {suffix && !onPress && (
        <RACButton
          className={s.chipSuffix}
          aria-label={suffix.label}
          onPress={suffix.onPress}
          style={{ width: size === 20 ? 16 : 20, height: size === 20 ? 16 : 20, borderRadius: size === 20 ? 4 : 6 }}
        >
          <Icon icon={suffix.icon} size={iconSize} />
        </RACButton>
      )}
    </>
  );
  const classes = cx(s.chip, s.chipSize[size], s.chipVariant[variant], className);
  if (onPress) {
    return (
      <RACButton className={classes} style={style} onPress={onPress} data-interactive {...rest}>
        {inner}
      </RACButton>
    );
  }
  return (
    <span className={classes} style={style}>
      {inner}
    </span>
  );
}
