// Value rendering metrics (C1, measured on, 26, 29).
import { alpha, insetRing, scales, text, vars } from '@agentic-crm/ui/styles';
import { style, styleVariants } from '@vanilla-extract/css';

const c = vars.color;
const u = c.utilities;

// ---- density roots ----------------------------------------------------------------------------------------------

/** Cell: fills the 35 px cell box (the table draws borders); scalar padding 8 12 0, single line. */
export const cell = style({
  boxSizing: 'border-box',
  position: 'relative',
  display: 'flex',
  alignItems: 'flex-start',
  width: '100%',
  height: '100%',
  minWidth: 0,
  overflow: 'hidden',
  padding: '8px 12px 0',
  ...text.body.standard,
  color: c.content.primary,
  whiteSpace: 'nowrap',
});

/** Chip cells (select, references, emails, …): padding 7 7 5, 22 px chips, 6 px apart, clipped at the edge. */
export const cellChips = style({ padding: '7px 7px 5px', gap: 6 });

/** Selected multi-value cell: every value stacked, growing over the following rows. */
export const cellExpanded = style({
  flexDirection: 'column',
  alignItems: 'flex-start',
  height: 'auto',
  minHeight: '100%',
  overflow: 'visible',
  gap: 4,
  paddingBottom: 7,
});

export const alignEnd = style({ justifyContent: 'flex-end', fontVariantNumeric: 'tabular-nums' });
export const alignCenter = style({ justifyContent: 'center' });

/** Field (record page row / form value): 32 px, padding 6 10, Body.Standard. */
export const field = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
  minHeight: 32,
  padding: '6px 10px',
  gap: 6,
  ...text.body.standard,
  color: c.content.primary,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
});

export const fieldChips = style({ paddingLeft: 6, paddingRight: 6 });

/** Chip density: inline, no padding (kanban cards, activity lines). */
export const chipRoot = style({
  display: 'inline-flex',
  alignItems: 'center',
  minWidth: 0,
  maxWidth: '100%',
  gap: 4,
  ...text.body.standard,
  color: c.content.primary,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  verticalAlign: 'middle',
});

export const truncate = style({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

export const placeholder = style({ color: c.content.tertiary });

/** Link-like values: emails, domains and phone numbers are blue and clickable. */
export const link = style({
  color: c.content.accent,
  textDecoration: 'none',
  cursor: 'pointer',
  selectors: { '&:hover': { textDecoration: 'underline', textUnderlineOffset: '0.14em' } },
});

/** Email / domain / phone chip: accent text with a hairline underline that goes on hover (Chip `link`). */
export const linkChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  height: 22,
  minWidth: 0,
  maxWidth: '100%',
  paddingInline: 4,
  borderRadius: 7,
  color: c.content.accent,
  textDecoration: 'none',
  cursor: 'pointer',
  outline: 'none',
  selectors: { '&:focus-visible': { boxShadow: insetRing(c.stroke.accent) } },
});

export const linkChipText = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textDecorationLine: 'underline',
  textDecorationColor: c.stroke.secondaryTransparent,
  textUnderlineOffset: '0.14em',
  selectors: { [`${linkChip}:hover &`]: { textDecorationColor: 'currentColor' } },
});

/** "+N" overflow counter (record page multi-values). */
export const more = style({
  flex: 'none',
  ...text.body.standard,
  color: c.content.secondary,
  fontVariantNumeric: 'tabular-nums',
});

// ---- option tags (select, multi-select) --------------------------------------------------------------------------

/** 22 px Tag: radius 7, padding 0 4, ring + text from the option hue. */
export const tag22 = style({ height: 22, borderRadius: 7, paddingInline: 4, flex: 'none' });

// ---- status ----------------------------------------------------------------------------------------------------

/** Dot (8) + title: the dot sits 8 px into the chip, 9 px before the text (cells: x+15, text x+32). */
export const status = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  height: 22,
  minWidth: 0,
  paddingLeft: 8,
  flex: 'none',
  ...text.body.standard,
  color: c.content.primary,
  whiteSpace: 'nowrap',
});

export const statusDot = style({ width: 8, height: 8, borderRadius: '50%', flex: 'none' });

export const statusDotHue = styleVariants(
  Object.fromEntries(
    ['grey', 'red', 'orange', 'yellow', 'amber', 'lime', 'green', 'cyan', 'blue', 'purple', 'lavender', 'pink'].map(
      (h) => [h, { backgroundColor: (u.surface as Record<string, string>)[h] as string }],
    ),
  ) as Record<string, { backgroundColor: string }>,
);

// ---- references (record chips, members) -------------------------------------------------------------------------

/** Record chip: 16 px avatar, 6 px gap, underlined title (link chip, underline goes on hover). */
export const recordChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 22,
  minWidth: 0,
  maxWidth: '100%',
  paddingInline: 3,
  borderRadius: 7,
  flex: 'none',
  color: c.content.primary,
  ...text.body.standard,
  whiteSpace: 'nowrap',
  textDecoration: 'none',
  outline: 'none',
  cursor: 'pointer',
  transition: `background-color ${scales.duration.breezy}ms ease`,
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHover },
    '&:focus-visible': { boxShadow: insetRing(c.stroke.accent) },
  },
});

export const recordChipTitle = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  textDecorationLine: 'underline',
  textDecorationColor: c.stroke.secondaryTransparent,
  textUnderlineOffset: '0.14em',
  selectors: { [`${recordChip}:hover &`]: { textDecorationColor: 'transparent' } },
});

export const memberChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 22,
  paddingInline: 3,
  minWidth: 0,
  maxWidth: '100%',
  flex: 'none',
  whiteSpace: 'nowrap',
});

/** Entity placeholder avatar (person round / company box): faint surface, hairline, grey glyph. */
export const placeholderAvatar = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  backgroundColor: c.surface.tertiary,
  boxShadow: insetRing(c.stroke.primaryTransparent),
  color: u.content.grey,
});

export const placeholderRound = style({ borderRadius: '50%' });
export const placeholderBox = style({ borderRadius: '30%' });

/** Actor avatars for non-member actors (API tokens, workflows): a purple box with an initial ("C" Claude REA API). */
export const actorTile = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  borderRadius: 4,
  backgroundColor: u.surface.purple,
  color: c.content.onAccent,
  fontWeight: 500,
});

// ---- rating ----------------------------------------------------------------------------------------------------

export const stars = style({ display: 'inline-flex', alignItems: 'center', gap: 2, flex: 'none' });

export const star = style({
  display: 'inline-flex',
  width: 16,
  height: 16,
  padding: 0,
  margin: 0,
  border: 'none',
  background: 'transparent',
  color: c.surface.tintStrong,
  flex: 'none',
});

export const starOn = style({ color: c.interactive.primary });
export const starPreview = style({ color: c.interactive.primaryHover });
export const starButton = style({ cursor: 'pointer', outline: 'none' });

// ---- checkbox ----------------------------------------------------------------------------------------------------

/** Checkbox cells centre a 16 px box in the 35 px row (x+41 in a 100 px column, y+9). */
export const checkboxCell = style({ alignItems: 'center', justifyContent: 'center', padding: 0 });

export const checkboxBox = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  borderRadius: 6,
  flex: 'none',
  border: `1px solid ${c.stroke.secondaryTransparent}`,
  backgroundColor: c.surface.primary,
  color: c.content.onAccent,
  transition: `background-color ${scales.duration.breezy}ms ease-in-out, border-color ${scales.duration.breezy}ms ease-in-out`,
});

export const checkboxOn = style({ backgroundColor: c.surface.accent, borderColor: c.stroke.accent });

export const checkboxButton = style({
  padding: 0,
  margin: 0,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  display: 'inline-flex',
  outline: 'none',
  borderRadius: 6,
  selectors: { '&:focus-visible': { boxShadow: `0 0 0 2px ${alpha(c.stroke.accent, 40)}` } },
});

// ---- misc --------------------------------------------------------------------------------------------------------

export const interactionLine = style({ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 });

export const pendingSpinner = style({ marginLeft: 'auto', flex: 'none', color: c.content.tertiary });

export const chipList = style({ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' });
export const chipListMeasure = style({
  position: 'absolute',
  visibility: 'hidden',
  pointerEvents: 'none',
  display: 'flex',
  gap: 6,
  whiteSpace: 'nowrap',
  left: 0,
  top: 0,
});

/**
 * Cell chips shrink to ~10 characters each before clipping (Chip `minChars`,  two emails, 00-2
 * stakeholders). Doubled class: wins over the chips' own `flex: none`.
 */
export const shrinkChip = style({
  selectors: { '&&': { flex: '0 1 auto', minWidth: 'min(100%, calc(10ch + 26px))' } },
});
