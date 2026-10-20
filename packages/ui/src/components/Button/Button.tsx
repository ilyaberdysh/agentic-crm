import { type CSSProperties, forwardRef, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Button as RACButton, type ButtonProps as RACButtonProps } from 'react-aria-components';
import { Icon } from '../../icons/Icon';
import type { IconName } from '../../icons/iconMap';
import type { IconGlyph } from '../../icons/types';
import { cx } from '../../utils/cx';
import { Kbd, type KbdSize } from '../Kbd/Kbd';
import { Spinner } from '../Spinner/Spinner';
import * as s from './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'secondary-destructive' | 'ghost' | 'destructive';
/** Sizes are named by height in px. Toolbars use 28; the default is 32. */
export type ButtonSize = 20 | 28 | 32 | 36 | '20' | '20s' | '20l' | '28' | '32' | '36';

type SizeKey = '20' | '20s' | '20l' | '28' | '32' | '36';

export type ButtonIcon = IconName | IconGlyph | ReactElement;

export interface ButtonStyleProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  fullWidth?: boolean;
}

/** Class name for anything that should look like a Button (e.g. a router link). */
export function buttonStyles({
  variant = 'primary',
  size = 32,
  iconOnly = false,
  fullWidth = false,
}: ButtonStyleProps = {}) {
  return s.button({ variant, size: String(size) as SizeKey, iconOnly, fullWidth });
}

export function buttonIconSize(size: ButtonSize): number {
  const key = String(size);
  return key === '20' || key === '20s' ? 12 : 16;
}

const KBD_SIZE: Record<SizeKey, KbdSize> = { '20': 14, '20s': 14, '20l': 14, '28': 16, '32': 18, '36': 20 };

export function renderButtonIcon(icon: ButtonIcon | undefined, size: number): ReactNode {
  if (icon === undefined) return null;
  if (isValidElement(icon)) return icon;
  return <Icon icon={icon as IconName | IconGlyph} size={size} />;
}

export interface ButtonProps extends Omit<RACButtonProps, 'children' | 'className' | 'style'>, ButtonStyleProps {
  children?: ReactNode;
  /** Leading icon: a semantic name, a Lucide component or any element (IconTile, Avatar…). */
  icon?: ButtonIcon;
  /** Trailing icon. */
  iconRight?: ButtonIcon;
  /** Trailing ChevronDown, for buttons that open menus. */
  chevron?: boolean;
  /** Count pill after the label. */
  badge?: ReactNode;
  /** Trailing key caps, e.g. `['mod', 'enter']`. */
  shortcut?: string[];
  /** Pressed/open look (the active background). */
  isActive?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * the Button: primary (default) | secondary | secondary-destructive | ghost | destructive,
 * sizes 20 / 20s / 20l / 28 / 32 (default) / 36. Built on react-aria `Button` (press, focus-visible,
 * `isPending` → spinner + aria-busy).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 32,
    iconOnly,
    fullWidth,
    icon,
    iconRight,
    chevron,
    badge,
    shortcut,
    isActive,
    isPending,
    children,
    className,
    style,
    ...rest
  },
  ref,
) {
  const sizeKey = String(size) as SizeKey;
  const iconSize = sizeKey === '20l' ? 16 : buttonIconSize(size);
  const onAccent = variant === 'primary' || variant === 'destructive';
  const onlyIcon = iconOnly ?? (children === undefined && !chevron && !badge && !shortcut);
  const leading = isPending ? <Spinner size={iconSize === 12 ? 12 : 16} /> : renderButtonIcon(icon, iconSize);
  const hasTrailing = Boolean(chevron || iconRight || shortcut);
  return (
    <RACButton
      ref={ref}
      isPending={isPending}
      className={cx(s.button({ variant, size: sizeKey, iconOnly: onlyIcon, fullWidth: Boolean(fullWidth) }), className)}
      style={style}
      data-variant={variant}
      data-size={sizeKey}
      data-active={isActive || undefined}
      data-leading={!onlyIcon && leading ? true : undefined}
      data-trailing={(!onlyIcon && hasTrailing) || undefined}
      {...rest}
    >
      {leading}
      {children !== undefined && children !== null && <span className={s.label}>{children}</span>}
      {badge !== undefined && <span className={cx(s.badge, onAccent && s.badgeOnAccent)}>{badge}</span>}
      {renderButtonIcon(iconRight, iconSize)}
      {chevron && <Icon icon="chevronDown" size={iconSize} />}
      {shortcut && <Kbd keys={shortcut} size={KBD_SIZE[sizeKey]} variant={onAccent ? 'on-accent' : 'default'} />}
    </RACButton>
  );
});

export interface ButtonGroupProps {
  children?: ReactNode;
  className?: string;
  'aria-label'?: string;
}

/** Joins buttons: inner corners squared off, borders overlapped by 1 px. */
export function ButtonGroup({ children, className, ...rest }: ButtonGroupProps) {
  return (
    <div role="group" className={cx(s.group, className)} {...rest}>
      {children}
    </div>
  );
}
