// Canvas (measured styles; evidence G/G-trigger-config.png, G-connect-drag.png, G-run-viewer-false-path.png):
// dotted grid (r 0.5, 14 % black), 200 × 70 block cards (radius 14, layered hairline shadow, 14/500 title, 12/500 grey
// description), the "Trigger" tab behind the card's top-left, outcome handles (10 px circles; True / False labels in
// monospace), the blue "+" square, edges #B1B1B7 1 px with rounded corners, run status tags, the dashed placeholder.
import { alpha, insetRing, text, transitionColors, vars } from '@agentic-crm/ui/styles';
import { globalStyle, keyframes, style } from '@vanilla-extract/css';

const c = vars.color;
const blue = '#266df0';
const green = '#02ad6e';

export const flow = style({
  position: 'absolute',
  inset: 0,
  backgroundColor: c.surface.secondary,
  vars: {
    '--xy-edge-stroke-default': '#b1b1b7',
    '--xy-connectionline-stroke-default': blue,
    '--xy-selection-background-color-default': alpha(blue, 6),
    '--xy-selection-border-default': `1px solid ${alpha(blue, 40)}`,
  },
});

globalStyle(`${flow} .react-flow__node`, { cursor: 'pointer' });
globalStyle(`${flow} .react-flow__pane.draggable`, { cursor: 'grab' });
globalStyle(`${flow} .react-flow__pane.dragging`, { cursor: 'grabbing' });
globalStyle(`${flow} .react-flow__edge-path`, { strokeLinecap: 'round' });
globalStyle(`${flow} .react-flow__connection-path`, { strokeWidth: 1.25 });
globalStyle(`${flow} .react-flow__attribution`, { display: 'none' });
// The UI reset caps svg at max-width 100 %: the edges layer is a 0 × 0 box, so its svg would collapse and not paint.
globalStyle(`${flow} .react-flow__edges svg, ${flow} .react-flow__connectionline`, { maxWidth: 'none' });
globalStyle(`${flow} .react-flow__handle`, {
  minWidth: 0,
  minHeight: 0,
  border: 'none',
  background: 'transparent',
  borderRadius: '50%',
});

// ---- block card ------------------------------------------------------------------------------------------------------

export const node = style({ position: 'relative', width: 200 });

export const card = style({
  boxSizing: 'border-box',
  position: 'relative',
  width: 200,
  borderRadius: 14,
  backgroundColor: c.surface.primary,
  boxShadow: `0 0 2px ${alpha('#1c2840', 18)}, 0 1px 3px ${alpha('#000000', 4)}`,
  padding: '10px 10px 0 12px',
  transition: transitionColors,
  selectors: {
    '&[data-selected]': { boxShadow: `0 0 0 1px ${blue}, 0 1px 3px ${alpha('#000000', 4)}` },
    '&[data-highlight]': { outline: `1px dashed ${blue}`, outlineOffset: 3 },
    '&[data-drop-target]': {
      outline: `1px dashed ${blue}`,
      outlineOffset: 3,
      backgroundColor: c.surface.secondary,
    },
    '&[data-run-selected]': { boxShadow: `0 0 0 1px ${blue}`, backgroundColor: c.surface.secondary },
  },
});

export const cardHead = style({ display: 'flex', alignItems: 'center', gap: 8, height: 24, minWidth: 0 });

export const cardTitle = style({
  ...text.body.standard,
  fontWeight: 500,
  color: c.content.primary,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const cardDescription = style({
  ...text.text12.standard,
  fontWeight: 500,
  color: c.content.secondary,
  margin: '6px 0 0',
  height: 20,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  selectors: { '&[data-empty]': { color: c.content.tertiary, fontWeight: 400 } },
});

export const warning = style({
  position: 'absolute',
  right: 12,
  bottom: 10,
  color: c.content.critical,
  display: 'flex',
});

export const outcomes = style({ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginTop: 4 });

export const outcomeRow = style({
  position: 'relative',
  height: 22,
  display: 'flex',
  alignItems: 'center',
  paddingRight: 14,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
  color: c.content.secondary,
});

export const triggerTag = style({
  boxSizing: 'border-box',
  position: 'absolute',
  left: 0,
  top: -23,
  height: 30,
  width: 72,
  paddingTop: 4,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  gap: 3,
  borderRadius: '10px 10px 0 0',
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(alpha(blue, 10)),
  color: blue,
  fontSize: 12,
  lineHeight: '16px',
  fontWeight: 500,
  zIndex: -1,
  selectors: { '&[data-selected]': { backgroundColor: blue, color: '#ffffff', boxShadow: 'none' } },
});

// ---- handles -----------------------------------------------------------------------------------------------------------

export const handleDot = style({
  boxSizing: 'border-box',
  width: 10,
  height: 10,
  borderRadius: '50%',
  border: `1px solid #b1b1b7`,
  backgroundColor: c.surface.primary,
  pointerEvents: 'none',
  selectors: {
    '&[data-active]': { borderColor: blue },
    '&[data-connected]': {
      borderColor: blue,
      backgroundColor: c.surface.primary,
      boxShadow: `inset 0 0 0 2px ${c.surface.primary}, inset 0 0 0 5px ${blue}`,
    },
    '&[data-taken]': {
      borderColor: green,
      boxShadow: `inset 0 0 0 2px ${c.surface.primary}, inset 0 0 0 5px ${green}`,
    },
    '&[data-not-taken]': { borderColor: '#d0d0d4', boxShadow: 'none' },
    '&[data-run-idle]': { borderColor: green, boxShadow: 'none' },
  },
});

/** The 24 px hit area of a source handle (centre on the card edge). */
export const sourceHandle = style({
  width: 24,
  height: 24,
  display: 'flex !important' as 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'crosshair',
});

globalStyle(`${flow} .react-flow__handle${sourceHandle}`, { width: 24, height: 24, right: -12 });

/** Invisible target handle covering the whole card while a connection is being dragged (drop anywhere). */
export const targetHandle = style({ opacity: 0 });

export const addNext = style({
  position: 'absolute',
  width: 18,
  height: 18,
  border: 'none',
  borderRadius: 5,
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: blue,
  color: '#ffffff',
  cursor: 'pointer',
  zIndex: 2,
  selectors: { '&:hover': { backgroundColor: '#215bc4' } },
});

// ---- run status tag ----------------------------------------------------------------------------------------------------

export const runTag = style({
  position: 'absolute',
  right: 8,
  top: -26,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 20,
  padding: '0 6px',
  borderRadius: 6,
  ...text.text12.standard,
  whiteSpace: 'nowrap',
});

export const runTagCompleted = style({ backgroundColor: c.surface.success, color: c.content.onSuccessSubtle });
export const runTagFailed = style({ backgroundColor: c.surface.critical, color: c.content.onCriticalSubtle });
export const runTagRunning = style({ backgroundColor: c.surface.tertiary, color: c.content.secondary });

// ---- placeholder ("Select next step") ----------------------------------------------------------------------------------

const pulse = keyframes({ '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.6 } });

export const placeholder = style({
  boxSizing: 'border-box',
  width: 200,
  height: 70,
  borderRadius: 14,
  border: `1px dashed ${blue}`,
  boxShadow: `0 0 0 3px ${alpha(blue, 15)}`,
  backgroundColor: c.surface.primary,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: c.content.tertiary,
  animation: `${pulse} 1.6s ease-in-out infinite`,
});

// ---- toolbar -------------------------------------------------------------------------------------------------------------

export const toolbar = style({
  position: 'absolute',
  bottom: 12,
  transform: 'translateX(-50%)',
  zIndex: 5,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  height: 44,
  padding: '0 6px',
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: `0 0 0 1px ${alpha('#000000', 6)}, 0 2px 4px ${alpha('#000000', 6)}, 0 8px 16px ${alpha('#000000', 4)}`,
});

export const toolbarDivider = style({ width: 1, height: 20, backgroundColor: c.stroke.primary, margin: '0 4px' });

export const zoomButton = style({ minWidth: 92 });

export const modeOn = style({});

globalStyle(`${modeOn}`, { backgroundColor: `${blue} !important`, color: '#ffffff !important' });

// ---- banner ---------------------------------------------------------------------------------------------------------------

export const banner = style({
  position: 'absolute',
  top: 10,
  left: 12,
  zIndex: 5,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 46,
  padding: '0 8px 0 16px',
  borderRadius: 12,
  backgroundColor: c.surface.info,
  boxShadow: insetRing(c.stroke.info),
  color: c.content.onInfoSubtle,
  ...text.body.standard,
  fontWeight: 500,
});

export const bannerOld = style({
  backgroundColor: c.surface.warning,
  boxShadow: insetRing(c.stroke.warning),
  color: c.content.onWarningSubtle,
});

export const bannerText = style({ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 });

// ---- run toolbar (top-left chip) -----------------------------------------------------------------------------------------

export const runChip = style({
  position: 'absolute',
  top: 10,
  left: 12,
  zIndex: 5,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 40,
  padding: '0 6px 0 12px',
  borderRadius: 10,
  backgroundColor: c.surface.primary,
  boxShadow: `0 0 0 1px ${alpha('#000000', 6)}, 0 1px 3px ${alpha('#000000', 4)}`,
  ...text.body.standard,
  color: c.content.primary,
});

export const runChipDivider = style({ width: 1, height: 18, backgroundColor: c.stroke.primary, margin: '0 2px' });

export const retriedFrom = style({ color: c.content.secondary, textDecoration: 'none', ...text.text12.standard });
