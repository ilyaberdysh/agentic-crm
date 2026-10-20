// A few glyphs Lucide lacks, drawn for this project on a 16 px grid (not derived from Attio).
import type { SVGProps } from 'react';

type GlyphProps = Omit<SVGProps<SVGSVGElement>, 'ref'> & { size?: number | string; strokeWidth?: number | string };

/** Solid circle in `currentColor` with a knocked-out check: the "selected" mark in menus and selects. */
export function CheckCircleFilled({ size = 16, strokeWidth: _sw, ...rest }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" {...rest}>
      <circle cx="8" cy="8" r="6.5" fill="currentColor" />
      <path
        d="M5.4 8.2 7.15 9.9 10.6 6.3"
        stroke="var(--ar-check-color, #fff)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Small filled dot, for status indicators drawn at icon size. */
export function DotFilled({ size = 16, strokeWidth: _sw, ...rest }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...rest}>
      <circle cx="8" cy="8" r="3" fill="currentColor" />
    </svg>
  );
}
