// Condition builder: one bordered card per condition — the subject
// chip on top, then the grey "Select condition ⌄" operator pill, the value, {x} and ⋮; "+ Add condition" full width on
// a light fill; and / or between conditions; advanced groups as nested grey boxes; Switch cases.
import { insetRing, text, transitionColors, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const conditions = style({ display: 'flex', flexDirection: 'column', gap: 8 });
export const rootGroup = style({ display: 'flex', flexDirection: 'column', gap: 8 });
export const group = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 10,
  borderRadius: 10,
  backgroundColor: c.surface.secondary,
  boxShadow: insetRing(c.stroke.primary),
});
export const item = style({ display: 'flex', flexDirection: 'column', gap: 6 });
export const logicRow = style({ display: 'flex', alignItems: 'center', padding: '0 2px' });
export const logicText = style({ ...text.text12.standard, color: c.content.secondary, padding: '0 6px' });

export const leaf = style({
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 8,
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.secondary),
});

export const subject = style({
  display: 'flex',
  alignItems: 'center',
  minHeight: 36,
  padding: '0 8px',
  borderBottom: `1px solid ${c.stroke.primary}`,
});

export const predicateRow = style({ display: 'flex', alignItems: 'center', gap: 6, minHeight: 36, padding: '0 6px' });

export const operator = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 26,
  padding: '0 6px 0 8px',
  border: 'none',
  borderRadius: 6,
  backgroundColor: c.surface.tertiary,
  color: c.content.secondary,
  fontFamily: 'inherit',
  ...text.body.standard,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  transition: transitionColors,
  selectors: {
    '&:hover, &[aria-expanded="true"]': { backgroundColor: c.surface.tertiaryHover, color: c.content.primary },
  },
});

export const valueSlot = style({ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' });

export const valueInput = style({
  width: '100%',
  height: 26,
  padding: '0 6px',
  border: 'none',
  borderRadius: 6,
  outline: 'none',
  background: 'transparent',
  fontFamily: 'inherit',
  ...text.body.standard,
  color: c.content.primary,
  selectors: { '&:focus': { boxShadow: insetRing(c.stroke.accent) }, '&::placeholder': { color: c.content.tertiary } },
});

export const add = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  width: '100%',
  height: 36,
  border: 'none',
  borderRadius: 8,
  backgroundColor: c.surface.tertiary,
  color: c.content.secondary,
  fontFamily: 'inherit',
  ...text.body.standard,
  cursor: 'pointer',
  transition: transitionColors,
  selectors: { '&:hover': { backgroundColor: c.surface.tertiaryHover, color: c.content.primary } },
});

export const cases = style({ display: 'flex', flexDirection: 'column', gap: 12 });
export const caseBox = style({ display: 'flex', flexDirection: 'column', gap: 8 });
