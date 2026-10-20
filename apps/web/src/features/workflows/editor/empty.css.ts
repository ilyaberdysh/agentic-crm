// Empty editor (README §2.2; evidence G/G-new-workflow-prompt.png): a ≈716 × 116 prompt box (radius 12), four
// ≈172 × 46 suggestion chips, "or", the dashed ≈240 × 48 "Start from scratch" button and the trigger picker popover.
import { alpha, insetRing, text, transitionColors, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;
const blue = '#266df0';

export const root = style({
  position: 'absolute',
  inset: 0,
  zIndex: 4,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
});

export const column = style({
  width: 716,
  maxWidth: 'calc(100% - 48px)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 12,
  pointerEvents: 'auto',
});

export const prompt = style({
  boxSizing: 'border-box',
  width: '100%',
  height: 116,
  display: 'flex',
  flexDirection: 'column',
  padding: '10px 8px 8px 12px',
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: `${insetRing(alpha(blue, 30))}, 0 0 0 3px ${alpha(blue, 8)}`,
});

export const promptInput = style({
  flex: 1,
  border: 'none',
  outline: 'none',
  resize: 'none',
  background: 'transparent',
  fontFamily: 'inherit',
  ...text.body.standard,
  color: c.content.primary,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});

export const promptControls = style({ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 });

export const model = style({ ...text.body.standard, color: c.content.secondary, padding: '0 6px' });

export const submit = style({
  width: 28,
  height: 28,
  border: 'none',
  borderRadius: 8,
  backgroundColor: blue,
  color: '#ffffff',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  selectors: { '&:disabled': { opacity: 0.5, cursor: 'default' } },
});

export const chips = style({ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 9, width: '100%' });

export const chip = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 46,
  padding: '0 12px',
  border: 'none',
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.primary),
  fontFamily: 'inherit',
  ...text.body.standard,
  fontWeight: 500,
  color: c.content.primary,
  cursor: 'pointer',
  transition: transitionColors,
  selectors: { '&:hover': { backgroundColor: c.surface.primaryHover } },
});

export const or = style({ ...text.text12.standard, color: c.content.secondary, margin: '10px 0' });

export const scratch = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  width: 240,
  height: 48,
  border: `1px dashed ${c.stroke.secondary}`,
  borderRadius: 12,
  backgroundColor: c.surface.secondary,
  fontFamily: 'inherit',
  ...text.body.standard,
  color: c.content.secondary,
  cursor: 'pointer',
  transition: transitionColors,
  selectors: {
    '&:hover, &[aria-expanded="true"]': { backgroundColor: c.surface.tertiary, color: c.content.primary },
    '&:disabled': { cursor: 'default', opacity: 0.6 },
  },
});

export const picker = style({ display: 'flex', flexDirection: 'column', maxHeight: 440, outline: 'none' });

export const pickerSearch = style({
  flex: 'none',
  height: 40,
  padding: '0 12px',
  border: 'none',
  borderBottom: `1px solid ${c.stroke.primary}`,
  outline: 'none',
  background: 'transparent',
  fontFamily: 'inherit',
  ...text.body.standard,
  color: c.content.primary,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});

export const pickerList = style({ overflowY: 'auto', padding: '4px 4px 6px' });

export const pickerGroup = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  paddingBottom: 4,
  borderBottom: `1px solid ${c.stroke.primary}`,
  selectors: { '&:last-child': { borderBottom: 'none' } },
});

export const pickerLabel = style({ ...text.text12.standard, color: c.content.secondary, padding: '8px 8px 4px' });
