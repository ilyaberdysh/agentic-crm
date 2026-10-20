// Annotation states of formula and AI values in table cells (36 px) and record fields (32 px rows), the label
// markers (fx / sparkle), the hover "Run AI autofill" action, the AI autofill card of the attribute dialog and the
// "Recalculate values" dialog (`EI:ai-attribute-*.png`).
import { insetRing, text, vars } from '@agentic-crm/ui/styles';
import { keyframes, style } from '@vanilla-extract/css';

const c = vars.color;

// ---- value states -----------------------------------------------------------------------------------------------------

export const cellState = style({
  ...text.body.standard,
  boxSizing: 'border-box',
  height: '100%',
  minHeight: 36,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '0 12px',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
});

export const fieldState = style({
  ...text.body.standard,
  boxSizing: 'border-box',
  minHeight: 32,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '0 10px',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
});

export const muted = style({ color: c.content.tertiary, overflow: 'hidden', textOverflow: 'ellipsis' });

export const negative = style({ color: c.content.critical, overflow: 'hidden', textOverflow: 'ellipsis' });

const pulse = keyframes({ '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.45 } });

export const thinking = style([muted, { animation: `${pulse} 1.6s ease-in-out infinite` }]);

export const warnIcon = style({ color: c.content.warning, flex: 'none' });

export const withMarker = style({ position: 'relative', display: 'flex', alignItems: 'center', minWidth: 0 });

export const outdatedDot = style({
  position: 'absolute',
  right: 6,
  top: '50%',
  marginTop: -3,
  width: 6,
  height: 6,
  borderRadius: 999,
  backgroundColor: c.content.warning,
  border: 'none',
  padding: 0,
});

export const valueGrow = style({ flex: 1, minWidth: 0 });

// ---- label markers and hover actions ---------------------------------------------------------------------------------

export const marker = style({ color: c.content.tertiary, flex: 'none', marginLeft: 4 });

export const hoverActions = style({
  position: 'absolute',
  right: 4,
  top: 4,
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  opacity: 0,
  transition: 'opacity 80ms ease',
  selectors: {
    '*:hover > &, *:focus-within > &': { opacity: 1 },
  },
});

// ---- attribute dialog card ------------------------------------------------------------------------------------------------

export const card = style({
  borderRadius: 10,
  boxShadow: insetRing(c.stroke.primary),
  display: 'flex',
  flexDirection: 'column',
});

export const cardHeader = style({
  ...text.body.standard,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 38,
  padding: '0 10px',
  color: c.content.primary,
});

export const cardIcon = style({ color: c.content.secondary });

export const cardBody = style({
  borderTop: `1px solid ${c.stroke.primary}`,
  padding: '12px 12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
});

export const field = style({ display: 'flex', flexDirection: 'column', gap: 4 });

export const label = style({ ...text.text12.standard, color: c.content.tertiary, paddingLeft: 4 });

export const typeButton = style({
  ...text.body.standard,
  boxSizing: 'border-box',
  width: '100%',
  height: 34,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '0 10px',
  border: 'none',
  borderRadius: 8,
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.secondary),
  color: c.content.primary,
  cursor: 'pointer',
  textAlign: 'left',
  selectors: { '&[data-disabled]': { cursor: 'default', color: c.content.tertiary } },
});

export const typeLabel = style({ flex: 1, minWidth: 0 });

export const promptBox = style({
  borderRadius: 8,
  boxShadow: insetRing(c.stroke.secondary),
  backgroundColor: c.surface.primary,
  display: 'flex',
  flexDirection: 'column',
  selectors: {
    '&:focus-within': { boxShadow: `${insetRing(c.stroke.accentMedium)}, 0 0 0 3px ${c.stroke.accentSubtle}` },
  },
});

export const promptEditor = style({ minHeight: 56, maxHeight: 160, overflow: 'auto' });

export const promptFooter = style({
  display: 'flex',
  alignItems: 'center',
  padding: '4px 6px',
  borderTop: `1px solid ${c.stroke.primary}`,
});

export const helper = style({ ...text.text12.standard, color: c.content.tertiary, paddingLeft: 4 });

export const error = style({ ...text.text12.standard, color: c.content.critical, paddingLeft: 4 });

export const switchRow = style({
  ...text.body.standard,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  color: c.content.primary,
});

export const notice = style({ ...text.text12.standard, color: c.content.secondary, padding: '0 10px 10px' });

// ---- "Recalculate values" ----------------------------------------------------------------------------------------------------

export const dialogBody = style({ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 4 });

export const dialogTitle = style({ ...text.heading.small, color: c.content.primary, margin: 0 });

export const dialogText = style({ ...text.body.standard, color: c.content.secondary, margin: '0 0 12px' });

export const creditsRow = style({
  ...text.body.standard,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 40,
  padding: '0 12px',
  borderRadius: 8,
  boxShadow: insetRing(c.stroke.primary),
  color: c.content.primary,
});

export const creditsWarning = style({ ...text.text12.standard, color: c.content.critical, marginTop: 6 });

export const dialogFooter = style({
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  padding: 8,
  borderTop: `1px solid ${c.stroke.primary}`,
});
