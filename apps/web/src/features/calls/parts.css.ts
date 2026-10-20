// Small shared pieces of the calls UI: the call icon tile, speaker chips, participant stacks, the person hover card.
import { alpha, text, transitionColors, vars } from '@agentic-crm/ui/styles';
import { style, styleVariants } from '@vanilla-extract/css';

const c = vars.color;

const HUES = ['blue', 'green', 'orange', 'pink', 'purple', 'red', 'yellow', 'cyan'] as const;

/** The call icon (I calls §2.4): a rounded square (30 %) in a hue hashed from the recording id, with a camera glyph. */
export const callIcon = style({
  boxSizing: 'border-box',
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '30%',
});

export const callIconHue = styleVariants(
  Object.fromEntries(
    HUES.map((hue) => [hue, { backgroundColor: alpha(c.utilities.surface[hue], 16), color: c.utilities.surface[hue] }]),
  ) as Record<(typeof HUES)[number], { backgroundColor: string; color: string }>,
);

export const callIconNeutral = style({ backgroundColor: c.surface.tint, color: c.content.secondary });

// ---- speaker chip ---------------------------------------------------------------------------------------------------

export const speaker = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  maxWidth: '100%',
  color: 'inherit',
  textDecoration: 'none',
  ...text.body.standard,
});

export const speakerName = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
});

export const speakerLink = style({
  cursor: 'pointer',
  selectors: { '&:hover': { textDecoration: 'underline' } },
});

/** Person record speakers: a 16 px person glyph tile instead of an avatar (evidence call-page-transcript.png). */
export const personGlyph = style({
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  borderRadius: 8,
  backgroundColor: c.surface.tint,
  color: c.content.secondary,
});

// ---- hover card --------------------------------------------------------------------------------------------------------

export const hoverCard = style({ display: 'flex', flexDirection: 'column', gap: 12, padding: 12, minWidth: 0 });
export const hoverHead = style({ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 });
export const hoverTexts = style({ display: 'flex', flexDirection: 'column', minWidth: 0 });
export const hoverTitle = style({
  ...text.body.standard,
  fontWeight: 600,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const hoverSub = style({
  ...text.text12.standard,
  color: c.content.secondary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const hoverOpen = style({
  ...text.body.standard,
  color: c.content.accent,
  textDecoration: 'none',
  transition: transitionColors,
  selectors: { '&:hover': { textDecoration: 'underline' } },
});

// ---- participants ----------------------------------------------------------------------------------------------------------

export const stack = style({ display: 'inline-flex', alignItems: 'center', flex: 'none' });
