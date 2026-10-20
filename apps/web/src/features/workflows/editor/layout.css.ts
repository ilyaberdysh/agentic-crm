// Workflow page chrome (README §2.2–2.3; evidence G/G-trigger-config.png, G-editor-live.png): the 49 px header with the
// "Workflows / <title>" breadcrumb (title is an inline input), star, creator avatar, Share, help, ⋮ and Ask AI; the
// 49 px tab bar Editor | Runs | Settings with the Draft / Paused label, Trigger workflow and the Live switch.
import { insetRing, scales, text, transitionColors, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style } from '@vanilla-extract/css';

const c = vars.color;
const t = `${scales.duration.comfortable}ms ease`;

export const root = style({ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' });

export const crumbs = style({ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, ...text.body.standard });

export const crumbLink = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  color: c.content.secondary,
  textDecoration: 'none',
  borderRadius: 6,
  padding: '2px 2px',
  selectors: { '&:hover': { color: c.content.primary } },
});

export const crumbSep = style({ color: c.content.tertiary, margin: '0 1px' });

export const titleInput = style({
  minWidth: 40,
  maxWidth: 480,
  height: 24,
  padding: '0 4px',
  margin: '0 -4px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  fontFamily: 'inherit',
  ...text.body.standard,
  fontWeight: 500,
  color: c.content.primary,
  outline: 'none',
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHover },
    '&:focus': { boxShadow: insetRing(c.stroke.accent), backgroundColor: c.surface.primary },
    '&::placeholder': { color: c.content.primary },
  },
});

export const titleMeasure = style({
  position: 'absolute',
  visibility: 'hidden',
  whiteSpace: 'pre',
  ...text.body.standard,
  fontWeight: 500,
});

export const headerDivider = style({ width: 1, height: 16, backgroundColor: c.stroke.secondary, margin: '0 2px' });

export const tabBar = style({
  boxSizing: 'border-box',
  flex: 'none',
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  height: 49,
  padding: '0 12px',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
  zIndex: 2,
});

export const tab = style({
  boxSizing: 'border-box',
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '4px 8px',
  borderRadius: 8,
  color: c.content.secondary,
  ...text.body.standard,
  whiteSpace: 'nowrap',
  textDecoration: 'none',
  cursor: 'pointer',
  outline: 'none',
  transition: `box-shadow ${t}, background-color ${t}, color ${t}`,
  selectors: {
    '&:hover': { color: c.content.primary, boxShadow: insetRing(c.stroke.primary) },
    '&[data-active]': {
      color: c.content.primary,
      backgroundColor: c.surface.primaryHover,
      boxShadow: insetRing(c.stroke.primary),
    },
    '&:focus-visible': { boxShadow: insetRing(c.stroke.accent) },
  },
});

export const tabUnderline = style({
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: -11,
  height: 1,
  backgroundColor: c.content.primary,
});

export const tabCount = style({
  boxSizing: 'border-box',
  minWidth: 16,
  height: 16,
  padding: '0 4px',
  borderRadius: 4,
  backgroundColor: c.surface.tint,
  color: c.content.tertiary,
  fontSize: 11,
  lineHeight: '16px',
  fontWeight: 500,
  textAlign: 'center',
  fontVariantNumeric: 'tabular-nums',
});

export const tabSpacer = style({ flex: 1 });

export const stateLabel = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  ...text.text12.standard,
  color: c.content.secondary,
  marginRight: 4,
});

export const livePill = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 8px 0 6px',
  borderRadius: 8,
  boxShadow: insetRing(c.stroke.secondary),
  ...text.body.standard,
  color: c.content.primary,
  transition: transitionColors,
  selectors: { '&[data-live]': { color: c.content.success } },
});

export const liveSwitch = style({});

globalStyle(`${liveSwitch}[data-selected] > span:first-child`, { backgroundColor: c.content.success });

export const body = style({ flex: 1, minHeight: 0, position: 'relative', display: 'flex' });

export const center = style({
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexDirection: 'column',
  gap: 6,
  color: c.content.secondary,
  ...text.body.standard,
});
