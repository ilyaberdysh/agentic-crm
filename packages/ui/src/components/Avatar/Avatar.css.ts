import { style, styleVariants } from '@vanilla-extract/css';
import { vars } from '../../theme/vars.css';
import { hues } from '../../tokens';

const u = vars.color.utilities;

export const avatar = style({
  boxSizing: 'border-box',
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  overflow: 'hidden',
  fontWeight: 500,
  lineHeight: 1,
  letterSpacing: 0,
  userSelect: 'none',
  verticalAlign: 'middle',
  // Hairline edge in stroke.primaryTransparent over both image and fallback.
  selectors: {
    '&::after': {
      content: '""',
      position: 'absolute',
      inset: 0,
      borderRadius: 'inherit',
      boxShadow: `inset 0 0 0 1px ${vars.color.stroke.primaryTransparent}`,
      pointerEvents: 'none',
    },
  },
});

export const round = style({ borderRadius: '50%' });
export const box = style({ borderRadius: '30%' });
export const absent = style({ filter: 'grayscale(1)' });

export const image = style({ width: '100%', height: '100%', objectFit: 'cover', display: 'block' });

type HueKey = (typeof hues)[number];

function onHue(hue: HueKey): string {
  const content = u.content as Record<string, string>;
  const key = `on${hue.charAt(0).toUpperCase()}${hue.slice(1)}`;
  return content[key] ?? vars.color.content.onAccent;
}

function onHueSubtle(hue: HueKey): string {
  const content = u.content as Record<string, string>;
  return content[`on${hue.charAt(0).toUpperCase()}${hue.slice(1)}Subtle`] as string;
}

const surfaces = u.surface as Record<string, string>;

/** bold = utilities.surface.<hue> + content.on<Hue> */
export const bold = styleVariants(
  Object.fromEntries(hues.map((h) => [h, { backgroundColor: surfaces[h], color: onHue(h) }])) as Record<
    HueKey,
    { backgroundColor: string; color: string }
  >,
);

/** subtle = utilities.surface.<hue>Subtle + content.on<Hue>Subtle */
export const subtle = styleVariants(
  Object.fromEntries(
    hues.map((h) => [h, { backgroundColor: surfaces[`${h}Subtle`], color: onHueSubtle(h) }]),
  ) as Record<HueKey, { backgroundColor: string; color: string }>,
);

export const group = style({ display: 'inline-flex', alignItems: 'center' });

export const count = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  borderRadius: '50%',
  backgroundColor: u.surface.greySubtle,
  boxShadow: `inset 0 0 0 1px ${u.stroke.grey}`,
  color: u.content.onGreySubtle,
  fontSize: 8,
  fontWeight: 500,
  lineHeight: 1,
  fontVariantNumeric: 'tabular-nums',
});

// IconTile: coloured square, 30 % radius, hairline border, on-accent glyph.
export const tile = style({
  boxSizing: 'border-box',
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  borderRadius: '30%',
  color: vars.color.content.onAccent,
  selectors: {
    '&::after': {
      content: '""',
      position: 'absolute',
      inset: 0,
      borderRadius: 'inherit',
      boxShadow: `inset 0 0 0 1px ${vars.color.stroke.primaryTransparent}`,
      pointerEvents: 'none',
    },
  },
});

export const tileHue = styleVariants(
  Object.fromEntries(hues.map((h) => [h, { backgroundColor: surfaces[h] }])) as Record<
    HueKey,
    { backgroundColor: string }
  >,
);

export const tileAccent = style({ backgroundColor: vars.color.surface.accent });
