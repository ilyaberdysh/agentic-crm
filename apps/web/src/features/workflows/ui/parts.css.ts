// Shared workflow pieces: tinted icon tiles (workflow and block), status chips (Live /
// Paused / Draft / Archived), credit pills, run status icons and the "Trigger" tag.
import { text, vars } from '@agentic-crm/ui/styles';
import { style, styleVariants } from '@vanilla-extract/css';

const c = vars.color;

/** Light tinted square with a coloured glyph; the hue comes in as `--tile-hue`. */
export const tile = style({
  boxSizing: 'border-box',
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 6,
  color: 'var(--tile-hue)',
  backgroundColor: 'color-mix(in srgb, var(--tile-hue) 12%, transparent)',
  boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--tile-hue) 14%, transparent)',
});

export const tileSize = styleVariants({
  16: { width: 16, height: 16, borderRadius: 4 },
  20: { width: 20, height: 20, borderRadius: 5 },
  24: { width: 24, height: 24, borderRadius: 6 },
  28: { width: 28, height: 28, borderRadius: 7 },
  32: { width: 32, height: 32, borderRadius: 8 },
});

export const status = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 20,
  padding: '0 6px 0 4px',
  borderRadius: 6,
  whiteSpace: 'nowrap',
  ...text.text12.standard,
});

export const statusVariant = styleVariants({
  live: { color: c.content.onSuccessSubtle, backgroundColor: c.surface.success },
  paused: { color: c.content.secondary, backgroundColor: 'transparent' },
  pausedPill: { color: c.content.secondary, backgroundColor: c.surface.tertiary },
  draft: { color: c.content.secondary, padding: 0 },
  archived: { color: c.content.secondary, backgroundColor: c.surface.tertiary, padding: '0 6px' },
});

export const liveDot = style({
  width: 6,
  height: 6,
  borderRadius: 3,
  backgroundColor: c.content.success,
  margin: '0 1px 0 2px',
});

export const pauseGlyph = style({ color: c.content.tertiary });

export const credit = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  height: 20,
  padding: '0 5px 0 4px',
  borderRadius: 6,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  backgroundColor: c.surface.primary,
  color: c.content.primary,
  ...text.text12.standard,
  fontVariantNumeric: 'tabular-nums',
});

export const creditIcon = style({ color: c.content.secondary });

export const runIcon = styleVariants({
  completed: { color: c.content.success },
  failed: { color: c.content.critical },
  executing: { color: c.content.tertiary },
  queued: { color: c.content.tertiary },
  canceled: { color: c.content.tertiary },
});

export const filledCircle = style({ flex: 'none', display: 'block' });

export const subtle = style({ color: c.content.tertiary });
