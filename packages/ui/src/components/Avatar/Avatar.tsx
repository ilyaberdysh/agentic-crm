import { type CSSProperties, isValidElement, type ReactElement, useEffect, useState } from 'react';
import { Icon } from '../../icons/Icon';
import type { IconName } from '../../icons/iconMap';
import type { IconGlyph } from '../../icons/types';
import type { Hue } from '../../tokens';
import { type ColorInput, hueForSeed, toHue } from '../../utils/colors';
import { cx } from '../../utils/cx';
import * as s from './Avatar.css';

export type AvatarSize = 12 | 16 | 18 | 20 | 22 | 24 | 26 | 28 | 32 | 34 | 40 | 44 | 56 | 64 | 72;
/** person/member → round; company/workspace/object → box (30 %). */
export type AvatarKind = 'person' | 'member' | 'company' | 'workspace' | 'object';

const FONT_SIZE: Record<AvatarSize, number> = {
  12: 6,
  16: 10,
  18: 10,
  20: 12,
  22: 14,
  24: 14,
  26: 14,
  28: 16,
  32: 20,
  34: 20,
  40: 24,
  44: 24,
  56: 30,
  64: 36,
  72: 36,
};

export interface AvatarProps {
  /** Used for the fallback initial, the alt text and (without `seed`) the colour. */
  name: string;
  src?: string | null;
  kind?: AvatarKind;
  /** Default 24. */
  size?: AvatarSize;
  /** Stable seed for the hue (e.g. the record id). Defaults to `name`. */
  seed?: string;
  /** Force a hue instead of hashing the seed. */
  color?: ColorInput;
  /** `bold` (default): saturated background, white initial. `subtle`: pastel background. */
  appearance?: 'bold' | 'subtle';
  /** `false` renders grayscale (offline member). */
  present?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Avatar with image and coloured initial fallback. */
export function Avatar({
  name,
  src,
  kind = 'person',
  size = 24,
  seed,
  color,
  appearance = 'bold',
  present = true,
  className,
  style,
}: AvatarProps) {
  const [status, setStatus] = useState<'idle' | 'loaded' | 'error'>('idle');
  useEffect(() => setStatus('idle'), [src]);
  const hue: Hue = color ? toHue(color) : hueForSeed(seed ?? name);
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  const shape = kind === 'person' || kind === 'member' ? s.round : s.box;
  const showImage = Boolean(src) && status !== 'error';
  return (
    <span
      role="img"
      aria-label={name}
      className={cx(
        s.avatar,
        shape,
        !(showImage && status === 'loaded') && (appearance === 'bold' ? s.bold[hue] : s.subtle[hue]),
        !present && s.absent,
        className,
      )}
      style={{ width: size, height: size, fontSize: FONT_SIZE[size], ...style }}
      data-kind={kind}
    >
      {!(showImage && status === 'loaded') && <span aria-hidden="true">{initial}</span>}
      {showImage && (
        <img
          src={src ?? undefined}
          alt=""
          className={s.image}
          style={status === 'loaded' ? undefined : { position: 'absolute', opacity: 0 }}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
        />
      )}
    </span>
  );
}

const OVERLAP: Partial<Record<AvatarSize, number>> = { 12: 3, 16: 4, 20: 6, 24: 7, 32: 8 };

export interface AvatarGroupProps {
  items: Array<Pick<AvatarProps, 'name' | 'src' | 'seed' | 'color' | 'kind' | 'present'> & { id?: string }>;
  size?: AvatarSize;
  /** Avatars shown before the "+N" bubble (default 3). */
  max?: number;
  className?: string;
}

/** Overlapping avatars; each is masked with a notch where the next one sits. Count bubble caps at 99. */
export function AvatarGroup({ items, size = 20, max = 3, className }: AvatarGroupProps) {
  const overlap = OVERLAP[size] ?? Math.round(size * 0.3);
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  const notch = (isLast: boolean): CSSProperties | undefined => {
    if (isLast) return undefined;
    const cx0 = size * 1.5 - overlap;
    const mask = `radial-gradient(circle at ${cx0}px 50%, transparent ${size / 2 + 1}px, #000 ${size / 2 + 1.5}px)`;
    return { maskImage: mask, WebkitMaskImage: mask };
  };
  return (
    <span className={cx(s.group, className)}>
      {shown.map((item, i) => (
        <Avatar
          key={item.id ?? `${i}:${item.name}`}
          {...item}
          size={size}
          style={{ marginLeft: i === 0 ? 0 : -overlap, ...notch(i === shown.length - 1 && rest <= 0) }}
        />
      ))}
      {rest > 0 && (
        <span className={s.count} style={{ width: size, height: size, marginLeft: -overlap }}>
          +{Math.min(rest, 99)}
        </span>
      )}
    </span>
  );
}

const TILE_ICON: Record<number, number> = { 16: 10, 20: 12, 24: 14, 28: 16, 32: 18, 40: 24, 56: 32, 72: 40 };

export interface IconTileProps {
  icon: IconName | IconGlyph | ReactElement;
  /** Tile size in px (default 16, as in the sidebar). */
  size?: 16 | 20 | 24 | 28 | 32 | 40 | 56 | 72;
  /** Hue or colour key; `accent` follows the theme accent. Default `blue`. */
  color?: ColorInput | 'accent';
  className?: string;
  'aria-label'?: string;
}

/** Coloured square with a white glyph: object and list icons (sidebar tiles are 16 × 16). */
export function IconTile({ icon, size = 16, color = 'blue', className, ...rest }: IconTileProps) {
  const iconSize = TILE_ICON[size] ?? Math.round(size * 0.6);
  // the tile glyphs are solid; a heavier Lucide stroke keeps them legible on colour.
  const glyph = isValidElement(icon) ? (
    icon
  ) : (
    <Icon icon={icon as IconName | IconGlyph} size={iconSize} strokeWidth={size <= 20 ? 2.5 : 2} />
  );
  return (
    <span
      className={cx(s.tile, color === 'accent' ? s.tileAccent : s.tileHue[toHue(color)], className)}
      style={{ width: size, height: size }}
      role={rest['aria-label'] ? 'img' : undefined}
      aria-hidden={rest['aria-label'] ? undefined : true}
      {...rest}
    >
      {glyph}
    </span>
  );
}
