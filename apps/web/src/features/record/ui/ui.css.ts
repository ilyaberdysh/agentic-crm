// Small shared pieces of the record page: the empty-state illustration and the "Choose list" dialog.
import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

// ---- empty illustration (our own drawing: dotted tile, corner marks, framed glyph) --------------------------------

export const illustration = style({ position: 'relative', width: 136, height: 136, flex: 'none' });

export const illustrationDots = style({
  position: 'absolute',
  inset: 0,
  backgroundImage: `radial-gradient(${c.stroke.secondary} 0.8px, transparent 0.9px)`,
  backgroundSize: '6px 6px',
  maskImage: 'radial-gradient(circle at center, #000 45%, transparent 75%)',
});

export const illustrationCorner = style({
  position: 'absolute',
  width: 7,
  height: 7,
  selectors: {
    '&::before, &::after': { content: '""', position: 'absolute', backgroundColor: c.stroke.tertiary },
    '&::before': { left: 3, top: 0, width: 1, height: 7 },
    '&::after': { top: 3, left: 0, width: 7, height: 1 },
  },
});

export const illustrationFrame = style({
  position: 'absolute',
  left: 20,
  top: 20,
  width: 96,
  height: 96,
  boxSizing: 'border-box',
  borderRadius: 22,
  display: 'grid',
  placeItems: 'center',
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 2px ${c.stroke.secondary}, 0 0 0 4px ${c.surface.tertiary}`,
  color: c.content.tertiary,
});

// ---- choose list dialog -----------------------------------------------------------------------------------------

export const listSearch = style({
  width: '100%',
  boxSizing: 'border-box',
  height: 44,
  padding: '0 4px',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  ...text.body.large,
  color: c.content.primary,
  borderBottom: `1px solid ${c.stroke.primary}`,
  marginBottom: 12,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});

export const listGroupLabel = style({ ...text.text12.standard, color: c.content.secondary, padding: '4px 4px 6px' });
export const listEmpty = style({ ...text.body.standard, color: c.content.tertiary, padding: '6px 8px' });
export const listOption = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  height: 36,
  padding: '0 8px',
  borderRadius: 12,
  border: 'none',
  background: 'transparent',
  ...text.body.standard,
  color: c.content.primary,
  cursor: 'pointer',
  selectors: { '&:hover': { backgroundColor: c.surface.primaryHover } },
});
export const listHint = style({ ...text.text12.standard, color: c.content.secondary });
