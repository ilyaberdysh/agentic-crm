import { type CSSProperties, type HTMLAttributes, type ReactNode, useMemo } from 'react';
import { Button as RACButton, Separator } from 'react-aria-components';
import { Icon } from '../../icons/Icon';
import type { IconName } from '../../icons/iconMap';
import type { IconGlyph } from '../../icons/types';
import { cx } from '../../utils/cx';
import { Spinner } from '../Spinner/Spinner';
import * as s from './Feedback.css';

// ---------------------------------------------------------------- Skeleton

export interface SkeletonProps {
  /** `block` (radius 6), `circle`, or `text` (bar of `fontSize` height inside a `lineHeight` box). */
  shape?: 'block' | 'circle' | 'text';
  width?: number | string;
  height?: number | string;
  /** For `text`: font size (bar height) and line height. Default 14 / 20. */
  fontSize?: number;
  lineHeight?: number;
  className?: string;
  style?: CSSProperties;
}

/** Loading placeholder with a 1.5 s shimmer. Text bars default to a random 40–60 px width. */
export function Skeleton({
  shape = 'block',
  width,
  height,
  fontSize = 14,
  lineHeight = 20,
  className,
  style,
}: SkeletonProps) {
  const randomWidth = useMemo(() => 40 + Math.round(Math.random() * 20), []);
  if (shape === 'text') {
    return (
      <span className={cx(s.skeletonLine, className)} style={{ height: lineHeight, ...style }} aria-hidden="true">
        <span
          className={cx(s.skeleton, s.skeletonShape.text)}
          style={{ width: width ?? randomWidth, height: fontSize }}
        />
      </span>
    );
  }
  return (
    <span
      className={cx(s.skeleton, s.skeletonShape[shape], className)}
      style={{ width: width ?? 16, height: height ?? width ?? 16, ...style }}
      aria-hidden="true"
    />
  );
}

// ---------------------------------------------------------------- Divider

export interface DividerProps {
  orientation?: 'horizontal' | 'vertical';
  variant?: 'primary' | 'floating' | 'tertiary' | 'dashed';
  className?: string;
  style?: CSSProperties;
}

export function Divider({ orientation = 'horizontal', variant = 'primary', className, style }: DividerProps) {
  return (
    <Separator
      orientation={orientation}
      className={cx(
        s.divider,
        s.dividerOrientation[orientation],
        s.dividerVariant[variant],
        variant === 'dashed' && orientation === 'vertical' && s.dashedVertical,
        className,
      )}
      style={style}
    />
  );
}

// ---------------------------------------------------------------- Banner

export type BannerVariant = 'info' | 'warning' | 'error' | 'neutral';

const BANNER_ICON: Record<BannerVariant, IconName> = {
  info: 'info',
  warning: 'warning',
  error: 'warning',
  neutral: 'info',
};

export interface BannerProps {
  variant?: BannerVariant;
  size?: 'small' | 'large';
  title?: ReactNode;
  children?: ReactNode;
  /** Override or hide (`null`) the icon. */
  icon?: IconName | IconGlyph | null;
  actions?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** Inline alert box: info / warning / error / neutral, small (radius 12) or large (16). */
export function Banner({
  variant = 'neutral',
  size = 'small',
  title,
  children,
  icon,
  actions,
  className,
  style,
}: BannerProps) {
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cx(s.banner, s.bannerSize[size], s.bannerVariant[variant], className)}
      style={style}
    >
      <div className={s.bannerMain}>
        {icon !== null && (
          <span className={s.bannerIcon}>
            <Icon icon={icon ?? BANNER_ICON[variant]} size={16} />
          </span>
        )}
        <div className={s.bannerText}>
          {title && <div className={s.bannerTitle}>{title}</div>}
          {children && <div>{children}</div>}
        </div>
      </div>
      {actions && <div className={s.bannerActions}>{actions}</div>}
    </div>
  );
}

export type AnnouncementScheme = 'accent' | 'red' | 'pink' | 'orange' | 'orange-dark-text' | 'yellow';

export interface AnnouncementBannerProps {
  scheme?: AnnouncementScheme;
  children?: ReactNode;
  icon?: IconName | IconGlyph;
  onDismiss?: () => void;
  className?: string;
}

/** Full-width bar above the UI (offline, out-of-date, system banners). */
export function AnnouncementBanner({
  scheme = 'accent',
  children,
  icon,
  onDismiss,
  className,
}: AnnouncementBannerProps) {
  return (
    <div role="status" className={cx(s.announcement, s.announcementScheme[scheme], className)}>
      {icon && <Icon icon={icon} size={16} />}
      <span>{children}</span>
      {onDismiss && (
        <RACButton className={s.announcementDismiss} aria-label="Dismiss" onPress={onDismiss}>
          <Icon icon="close" size={18} />
        </RACButton>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Empty, loading, error

export interface EmptyStateProps {
  icon?: IconName | IconGlyph;
  /** Icon size (default 24). */
  iconSize?: number;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function EmptyState({ icon, iconSize = 24, title, description, actions, className, style }: EmptyStateProps) {
  return (
    <div className={cx(s.state, className)} style={style}>
      {icon && <Icon icon={icon} size={iconSize} className={s.stateIcon} />}
      {title && <div className={s.stateTitle}>{title}</div>}
      {description && <div className={s.stateDescription}>{description}</div>}
      {actions && <div className={s.stateActions}>{actions}</div>}
    </div>
  );
}

/** Spinner 16 + "Loading...". */
export function LoadingState({ label = 'Loading...', className }: { label?: ReactNode; className?: string }) {
  return (
    <div className={cx(s.loading, className)} role="status">
      <Spinner size={16} />
      {label}
    </div>
  );
}

export interface ErrorStateProps {
  message?: ReactNode;
  /** WarningTriangle size (34 for page-level errors, 12 for inline widget errors). */
  iconSize?: number;
  actions?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** Red WarningTriangle + critical text (default "Something went wrong"). */
export function ErrorState({
  message = 'Something went wrong',
  iconSize = 34,
  actions,
  className,
  style,
}: ErrorStateProps) {
  return (
    <div className={cx(s.state, s.error, className)} style={style} role="alert">
      <Icon icon="warning" size={iconSize} color="negative" />
      <div className={s.errorText}>{message}</div>
      {actions && <div className={s.stateActions}>{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Card

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  state?: 'default' | 'highlighted' | 'selected' | 'error' | 'disabled';
}

/** Bordered container (record highlights, settings cards): radius 12, inset stroke.primary. */
export function Card({ state = 'default', className, ...rest }: CardProps) {
  return <div className={cx(s.card, s.cardState[state], className)} {...rest} />;
}
