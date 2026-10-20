import { type CSSProperties, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Link, type LinkProps, Radio, RadioGroup } from 'react-aria-components';
import { Icon } from '../../icons/Icon';
import type { IconName } from '../../icons/iconMap';
import type { IconGlyph } from '../../icons/types';
import { vars } from '../../theme/vars.css';
import type { AccentColor } from '../../tokens';
import { accentColors } from '../../tokens/theme.gen';
import { cx } from '../../utils/cx';
import * as s from './Nav.css';

export interface NavItemProps extends Omit<LinkProps, 'children' | 'className' | 'style'> {
  children?: ReactNode;
  /** 16 px icon (secondary; primary when current) or an element such as an IconTile. */
  icon?: IconName | IconGlyph | ReactElement;
  /** Marks the current page (aria-current="page"). */
  isCurrent?: boolean;
  /** Right-aligned content: Badge, count, actions. */
  trailing?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** Sidebar / settings navigation row (28 px, radius 9). Renders a react-aria Link (router-aware). */
export function NavItem({ children, icon, isCurrent, trailing, className, style, ...rest }: NavItemProps) {
  return (
    <Link
      className={cx(s.item, className)}
      style={style}
      aria-current={isCurrent ? 'page' : undefined}
      data-current={isCurrent || undefined}
      {...rest}
    >
      {icon &&
        (isValidElement(icon) ? icon : <Icon icon={icon as IconName | IconGlyph} size={16} className={s.icon} />)}
      <span className={s.label}>{children}</span>
      {trailing && <span className={s.trailing}>{trailing}</span>}
    </Link>
  );
}

/** Group label above nav items (text12 secondary). */
export function NavSectionLabel({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={cx(s.sectionLabel, className)}>{children}</div>;
}

/** Vertical stack of nav items with the 1 px gap. */
export function NavList({
  children,
  className,
  'aria-label': ariaLabel,
}: {
  children?: ReactNode;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <nav aria-label={ariaLabel} className={cx(s.list, className)}>
      {children}
    </nav>
  );
}

const surfaces = vars.color.utilities.surface;
const SWATCH_COLOR: Record<AccentColor, string> = {
  blue: surfaces.blue,
  cyan: surfaces.cyan,
  yellow: surfaces.yellow,
  orange: surfaces.orange,
  pink: surfaces.pink,
  purple: surfaces.purple,
  green: surfaces.green,
};

export interface AccentPickerProps {
  value?: AccentColor;
  defaultValue?: AccentColor;
  onChange?: (accent: AccentColor) => void;
  'aria-label'?: string;
  className?: string;
}

/** The Appearance accent setting: 7 round swatches in the order (blue, cyan, yellow, orange, pink, purple, green). */
export function AccentPicker({
  value,
  defaultValue,
  onChange,
  className,
  'aria-label': ariaLabel = 'Accent color',
}: AccentPickerProps) {
  return (
    <RadioGroup
      aria-label={ariaLabel}
      orientation="horizontal"
      value={value}
      defaultValue={defaultValue}
      onChange={(v) => onChange?.(v as AccentColor)}
      className={cx(s.swatches, className)}
    >
      {accentColors.map((accent) => (
        <Radio key={accent} value={accent} aria-label={accent} className={s.swatch}>
          <span className={s.swatchFill} style={{ backgroundColor: SWATCH_COLOR[accent] }} />
        </Radio>
      ))}
    </RadioGroup>
  );
}
