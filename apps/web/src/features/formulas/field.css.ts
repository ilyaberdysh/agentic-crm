// "Formula" block of the attribute dialog (`EI:formula-create-dialog-filled.png`): label row with
// the right-aligned "Output <type>" chip, then "+ Create formula" or the read-only preview button (radius 10, up to
// 86 px tall with a 32 px bottom fade when it overflows).
import { insetRing, text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style } from '@vanilla-extract/css';

const c = vars.color;

export const labelRow = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 });

export const output = style({
  ...text.text12.standard,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  color: c.content.tertiary,
});

export const outputChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 20,
  padding: '0 6px',
  borderRadius: 6,
  backgroundColor: c.surface.tertiary,
  color: c.content.secondary,
});

export const createButton = style({
  boxSizing: 'border-box',
  width: '100%',
  height: 32,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  borderRadius: 9,
  border: `1px dashed ${c.stroke.primaryTransparent}`,
  backgroundColor: c.interactive.placeholder,
  color: c.content.tertiary,
  cursor: 'pointer',
  ...text.body.standard,
  selectors: { '&[data-hovered]': { backgroundColor: c.interactive.placeholderHover } },
});

export const previewButton = style({
  position: 'relative',
  boxSizing: 'border-box',
  width: '100%',
  maxHeight: 86,
  overflow: 'hidden',
  padding: 0,
  border: 'none',
  borderRadius: 10,
  textAlign: 'left',
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.secondary),
  cursor: 'pointer',
  selectors: { '&[data-hovered]': { backgroundColor: c.surface.primaryHover } },
});

export const previewEditor = style({ pointerEvents: 'none' });

globalStyle(`${previewEditor} .cm-content`, { padding: '6px 0 !important' });

export const fade = style({
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  height: 32,
  pointerEvents: 'none',
  backgroundImage: `linear-gradient(to bottom, transparent, ${c.surface.primary})`,
});
