import type { SVGProps } from 'react';
import { resolveTextColor, type TextColor } from '../../theme/text';
import { cx } from '../../utils/cx';
import * as s from './Spinner.css';

export interface SpinnerProps extends Omit<SVGProps<SVGSVGElement>, 'color' | 'ref'> {
  /** 10–24 px. Default 16. */
  size?: number;
  /** Named text colour or CSS colour; default `currentColor`. */
  color?: TextColor | (string & {});
  /** Accessible label; default "Loading". */
  label?: string;
}

function strokeFor(size: number): number {
  if (size <= 10) return 1;
  if (size <= 12) return 1.25;
  if (size <= 16) return 1.5;
  if (size <= 20) return 2;
  return 2.5;
}

/** Indeterminate progress circle, 0.9 s linear rotation. */
export function Spinner({ size = 16, color, label = 'Loading', className, style, ...rest }: SpinnerProps) {
  const sw = strokeFor(size);
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      role="progressbar"
      aria-label={label}
      className={cx(s.spinner, className)}
      style={{ color: resolveTextColor(color), ...style }}
      {...rest}
    >
      <circle className={s.track} cx={size / 2} cy={size / 2} r={r} stroke="currentColor" strokeWidth={sw} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinecap="round"
        strokeDasharray={`${c * 0.3} ${c}`}
      />
    </svg>
  );
}
