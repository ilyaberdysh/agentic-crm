import type { SVGProps } from 'react';
import { resolveTextColor, type TextColor } from '../theme/text';
import { cx } from '../utils/cx';
import { iconBase } from './Icon.css';
import { type IconName, iconMap } from './iconMap';
import type { IconGlyph } from './types';

/** Attio draws icons on three grids (icons.md §1): small 12, standard 16, large 18. */
export type IconOpticalSize = 'small' | 'standard' | 'large';

export function opticalSize(size: number): IconOpticalSize {
  if (size < 16) return 'small';
  if (size < 18) return 'standard';
  return 'large';
}

/**
 * Lucide draws on a 24 grid. Attio's glyphs keep a 1 px stroke at their native grid, so the
 * stroke width is chosen per optical size: 24/12 = 2 (small), 1.5 at 16 (standard), 24/18 (large).
 * A 14 px icon from the small set therefore renders slightly heavier, as Attio's scaled glyphs do.
 */
export const STROKE_BY_OPTICAL_SIZE: Record<IconOpticalSize, number> = {
  small: 2,
  standard: 1.5,
  large: 24 / 18,
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'color' | 'ref'> {
  /** A semantic name from the icon map, or any Lucide (or Lucide-compatible) component. */
  icon: IconName | IconGlyph;
  /** px. 12 / 16 (default) / 18 are the native optical sizes. */
  size?: number;
  /** Named text colour or any CSS colour. Default `currentColor`. */
  color?: TextColor | (string & {});
  /** Accessible label. Without it the icon is decorative (aria-hidden). */
  label?: string;
}

export function Icon({ icon, size = 16, color, label, className, style, ...rest }: IconProps) {
  const Glyph: IconGlyph | undefined = typeof icon === 'string' ? iconMap[icon] : icon;
  if (!Glyph) {
    console.warn(`[ui] unknown icon: ${String(icon)}`);
    return null;
  }
  const optical = opticalSize(size);
  return (
    <Glyph
      size={size}
      strokeWidth={STROKE_BY_OPTICAL_SIZE[optical]}
      className={cx(iconBase, className)}
      style={color ? { color: resolveTextColor(color), ...style } : style}
      data-optical-size={optical}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
      {...rest}
    />
  );
}
