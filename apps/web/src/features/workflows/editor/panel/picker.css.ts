// Variable picker and chips:
// G-update-record-config.png): "Accessible blocks" rows with output counts, greyed "no data" outcomes, a breadcrumb
// header with a back chevron, attribute rows with type icons, disabled / ⚠ incompatible rows; blue inline chips
// "{ Record action › … › Headcount }".
import { alpha, insetRing, text, transitionColors, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;
const blue = '#266df0';

export const picker = style({ display: 'flex', flexDirection: 'column', width: 330, maxHeight: 560, outline: 'none' });

export const pickerHead = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 30,
  padding: '2px 8px 4px',
  ...text.text12.standard,
  color: c.content.secondary,
  borderBottom: `1px solid ${c.stroke.primary}`,
  marginBottom: 4,
});

export const crumb = style({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

export const list = style({ overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1 });

export const item = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  minHeight: 32,
  padding: '0 8px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  fontFamily: 'inherit',
  ...text.body.standard,
  color: c.content.primary,
  textAlign: 'left',
  cursor: 'pointer',
  outline: 'none',
  transition: transitionColors,
  selectors: {
    '&:hover:not([data-disabled]), &:focus-visible, &[data-active]': { backgroundColor: c.interactive.ghostHover },
    '&[data-disabled]': { color: c.content.tertiary, cursor: 'default' },
    '&[data-nodata]': { boxShadow: insetRing(alpha(blue, 50)), color: c.content.tertiary },
  },
});

export const indented = style({ paddingLeft: 22 });

export const itemLabel = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const itemOutcome = style({ color: c.content.tertiary, marginLeft: 4 });
export const itemIcon = style({ color: c.content.secondary, flex: 'none' });
export const itemCount = style({
  ...text.text12.standard,
  color: c.content.secondary,
  fontVariantNumeric: 'tabular-nums',
});
export const noData = style({
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
  color: c.content.tertiary,
});
export const warn = style({ color: c.content.secondary, display: 'inline-flex' });
export const empty = style({ padding: '10px 8px 12px', ...text.body.standard, color: c.content.tertiary });

// ---- chip ------------------------------------------------------------------------------------------------------------------

export const chip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  maxWidth: '100%',
  padding: '0 3px',
  margin: '0 1px',
  borderRadius: 4,
  backgroundColor: alpha(blue, 10),
  color: blue,
  ...text.body.standard,
  whiteSpace: 'nowrap',
  verticalAlign: 'baseline',
  cursor: 'pointer',
  userSelect: 'none',
  selectors: {
    '&[data-broken]': { backgroundColor: alpha('#cf8300', 14), color: '#874d00' },
    '&[data-readonly]': { cursor: 'default' },
  },
});

export const chipSep = style({ color: alpha(blue, 70), fontSize: 11 });
export const chipBrace = style({ color: alpha(blue, 80) });

// ---- rich text input ---------------------------------------------------------------------------------------------------------

export const editor = style({
  boxSizing: 'border-box',
  width: '100%',
  minHeight: 38,
  padding: '8px 12px',
  borderRadius: 8,
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.secondary),
  ...text.body.standard,
  lineHeight: '22px',
  color: c.content.primary,
  outline: 'none',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  cursor: 'text',
  selectors: {
    '&:focus': { boxShadow: insetRing(c.stroke.accent) },
    '&[data-invalid]': { boxShadow: insetRing(alpha('#eb3b3b', 60)) },
    '&[data-empty]::before': { content: 'attr(data-placeholder)', color: c.content.tertiary, pointerEvents: 'none' },
    '&[data-readonly]': { backgroundColor: c.surface.secondary, cursor: 'default' },
  },
});

export const multiline = style({ minHeight: 76 });

// ---- chip popover (data sources, fallback) --------------------------------------------------------------------------------

export const sources = style({ display: 'flex', flexDirection: 'column', gap: 8, padding: 8, width: 320 });
export const sourceRow = style({ display: 'flex', alignItems: 'center', gap: 6 });
export const sourceLabel = style({ ...text.text12.standard, color: c.content.secondary });
