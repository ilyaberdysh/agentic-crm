import type { ComponentType, SVGProps } from 'react';

/** Anything that renders like a Lucide icon: an SVG component taking size/strokeWidth. */
export type IconGlyph = ComponentType<
  Omit<SVGProps<SVGSVGElement>, 'ref'> & { size?: number | string; strokeWidth?: number | string }
>;
