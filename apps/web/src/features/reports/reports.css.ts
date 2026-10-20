// Styles shared by the reports screens (H README §2.2, §3.2; chart-types §2): inline-editable titles, the data-source
// chip, the "New data" pill and small layout atoms.
import { insetRing, text, vars } from '@agentic-crm/ui/styles';
import { keyframes, style } from '@vanilla-extract/css';

const c = vars.color;

// ---- inline edit (dashboard title / description, report title / description) ---------------------------------------

const inlineBase = {
  boxSizing: 'border-box',
  maxWidth: '100%',
  minWidth: 0,
  margin: 0,
  border: 0,
  borderRadius: 9,
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  textAlign: 'left',
  cursor: 'text',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

export const inlineTitle = style({
  ...inlineBase,
  ...text.heading.small,
  lineHeight: '30px',
  height: 32,
  padding: '0 7px',
  selectors: {
    '&:hover:not([data-readonly])': { backgroundColor: c.interactive.ghostHover },
    '&[data-placeholder]': { color: c.content.tertiary },
    '&[data-readonly]': { cursor: 'default' },
  },
});

export const inlineDescription = style({
  ...inlineBase,
  ...text.body.standard,
  lineHeight: '30px',
  height: 32,
  padding: '0 7px',
  color: c.content.secondary,
  selectors: {
    '&:hover:not([data-readonly])': { backgroundColor: c.interactive.ghostHover },
    '&[data-placeholder]': { color: c.content.tertiary },
    '&[data-readonly]': { cursor: 'default' },
  },
});

export const inlineInput = style({
  boxSizing: 'border-box',
  height: 32,
  padding: '0 7px',
  margin: 0,
  border: 0,
  outline: 'none',
  borderRadius: 9,
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.accent),
  color: c.content.primary,
  fontFamily: 'inherit',
  minWidth: 120,
  '::placeholder': { color: c.content.tertiary },
});

export const inlineInputTitle = style({ ...text.heading.small, lineHeight: '30px' });
export const inlineInputDescription = style({
  ...text.body.standard,
  lineHeight: '30px',
  color: c.content.secondary,
  minWidth: 280,
});

// ---- data source chip --------------------------------------------------------------------------------------------

export const sourceChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
  maxWidth: 220,
  height: 20,
  padding: '0 6px 0 3px',
  borderRadius: 6,
  backgroundColor: c.surface.secondary,
  boxShadow: insetRing(c.stroke.primaryTransparent),
  color: c.content.secondary,
  ...text.text12.standard,
  flex: 'none',
});

export const sourceChipText = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

// ---- "New data" pill -----------------------------------------------------------------------------------------------

export const newDataPill = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 24,
  padding: '0 8px 0 6px',
  borderRadius: 8,
  border: 0,
  backgroundColor: 'transparent',
  color: c.content.primary,
  ...text.text12.standard,
  cursor: 'pointer',
  flex: 'none',
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHover },
    '&[data-pressed]': { backgroundColor: c.interactive.ghostHover },
    '&[data-focus-visible]': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});

const spin = keyframes({ from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } });
export const spinning = style({
  animation: `${spin} 900ms linear infinite`,
  '@media': { '(prefers-reduced-motion: reduce)': { animation: 'none' } },
});

// ---- misc ------------------------------------------------------------------------------------------------------------

export const visuallyMuted = style({ color: c.content.secondary });
export const dashedTile = style({
  borderRadius: 12,
  border: `1px dashed ${c.stroke.secondaryTransparent}`,
});
