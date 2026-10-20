// Plain helpers for style authoring (.css.ts files may only export serialisable values).

/** `box-shadow` hairline drawn inside the box: takes no layout space (tokens.md §7). */
export const insetRing = (color: string) => `inset 0 0 0 1px ${color}`;

/** `color` at `pct` % alpha via color-mix (keeps theme variables live). */
export const alpha = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;
