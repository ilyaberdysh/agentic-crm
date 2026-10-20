// Floating windows and overlays; dialogs use a 160 ms scale transition.
// Note modal 968 × 670 at 14.6 vh (top 138 at 945), radius 16, translucent 3 px frame + e3; floating panel 456 × 556
// at the bottom right next to the dock; dock bubbles 32 px; record overlay full viewport.
import { derivedVars, scales, text, transitionColors, vars } from '@agentic-crm/ui/styles';
import { keyframes, style } from '@vanilla-extract/css';

const c = vars.color;

const scaleIn = keyframes({
  from: { opacity: 0, transform: 'scale(0.97)' },
  to: { opacity: 1, transform: 'scale(1)' },
});
const slideUp = keyframes({
  from: { opacity: 0, transform: 'translateY(8px) scale(0.98)' },
  to: { opacity: 1, transform: 'none' },
});
const fade = keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });

export const Z = {
  record: 900,
  floating: 950,
  dock: 960,
  modal: 9990,
} as const;

// ---- note window: modal --------------------------------------------------------------------------------------------

export const modalOverlay = style({
  position: 'fixed',
  inset: 0,
  zIndex: Z.modal,
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'flex-start',
  padding: 'min(138px, 14.6vh) 16px 16px',
  boxSizing: 'border-box',
  outline: 'none',
});

export const frame = style({
  boxSizing: 'border-box',
  display: 'flex',
  width: 968,
  maxWidth: '100%',
  height: 670,
  maxHeight: 'calc(100vh - min(138px, 14.6vh) - 16px)',
  padding: 3,
  borderRadius: 16,
  backgroundColor: derivedVars.dialogFrame,
  backdropFilter: 'blur(15px)',
  WebkitBackdropFilter: 'blur(15px)',
  boxShadow: vars.elevation.e3,
  outline: 'none',
  animation: `${scaleIn} 160ms ease`,
});

/** Dimmed page behind the modal (composer, email and meeting dialogs: surface.overlay). */
export const modalOverlayDim = style({ backgroundColor: c.surface.overlay });

/** Composer / meeting / email dialogs: 14 vh from the top; the frame wraps the content, which sets its own size. */
export const modalOverlayFit = style({ padding: '14vh 16px 16px' });

export const frameFit = style({
  width: 'auto',
  height: 'auto',
  maxHeight: 'calc(100vh - 14vh - 16px)',
});

export const panel = style({
  boxSizing: 'border-box',
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  borderRadius: 13,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${derivedVars.dialogPanelRing}`,
  color: c.content.primary,
  overflow: 'hidden',
  outline: 'none',
  ...text.body.standard,
});

// ---- note window: floating ("Pin to screen") ---------------------------------------------------------------------------

export const floating = style({
  position: 'fixed',
  zIndex: Z.floating,
  right: 66,
  bottom: 10,
  width: 456,
  height: 556,
  maxHeight: 'calc(100vh - 20px)',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: `${vars.elevation.e3}, inset 0 0 0 1px ${c.stroke.primary}`,
  color: c.content.primary,
  overflow: 'hidden',
  animation: `${slideUp} 160ms ease`,
  ...text.body.standard,
});

export const floatingAlone = style({ right: 16 });

// ---- window chrome -------------------------------------------------------------------------------------------------------

export const topBar = style({
  boxSizing: 'border-box',
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 49,
  padding: '0 10px 0 16px',
  borderBottom: `1px solid ${c.stroke.primary}`,
});

export const topBarFloating = style({ height: 41, padding: '0 8px 0 12px' });

export const topBarStart = style({ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 });

export const topBarLabel = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  color: c.content.secondary,
  ...text.body.standard,
});

export const topBarTitle = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

export const controls = style({ display: 'flex', alignItems: 'center', gap: 2, flex: 'none' });

// ---- dock ------------------------------------------------------------------------------------------------------------

export const dock = style({
  position: 'fixed',
  zIndex: Z.dock,
  right: 14,
  bottom: 15,
  display: 'flex',
  flexDirection: 'column-reverse',
  gap: 8,
  pointerEvents: 'none',
});

export const bubbleWrap = style({ position: 'relative', pointerEvents: 'auto', animation: `${fade} 140ms ease` });

export const bubble = style({
  position: 'relative',
  boxSizing: 'border-box',
  width: 32,
  height: 32,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 'none',
  borderRadius: 999,
  backgroundColor: c.surface.primary,
  boxShadow: vars.elevation.e2,
  color: c.content.primary,
  cursor: 'pointer',
  outline: 'none',
  transition: transitionColors,
  selectors: {
    '&[data-hovered]': { backgroundColor: c.surface.primaryHover },
    '&[data-focus-visible]': { boxShadow: `${vars.elevation.e2}, 0 0 0 2px ${c.stroke.accent}` },
    '&[data-active]': { boxShadow: `${vars.elevation.e2}, inset 0 0 0 1px ${c.stroke.accent}` },
    // The pinned composer's bubble is filled with the accent colour (F composer, composer-pinned.png).
    '[data-kind="composer"] &[data-active]': {
      backgroundColor: c.surface.accent,
      color: c.content.onAccent,
      boxShadow: vars.elevation.e2,
    },
  },
});

export const bubbleBadge = style({
  position: 'absolute',
  right: -2,
  bottom: -2,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 14,
  height: 14,
  borderRadius: 4,
  backgroundColor: c.surface.primary,
  boxShadow: `0 0 0 1px ${c.stroke.primary}`,
  color: c.content.secondary,
  overflow: 'hidden',
});

export const bubbleClose = style({
  position: 'absolute',
  top: -6,
  right: -6,
  width: 16,
  height: 16,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 'none',
  borderRadius: 999,
  backgroundColor: c.surface.primary,
  boxShadow: vars.elevation.e1,
  color: c.content.secondary,
  cursor: 'pointer',
  opacity: 0,
  transition: `opacity ${scales.duration.comfortable}ms ease`,
  selectors: {
    [`${bubbleWrap}:hover &, &[data-focus-visible]`]: { opacity: 1 },
    '&[data-hovered]': { color: c.content.primary },
  },
});

// ---- record overlay ---------------------------------------------------------------------------------------------------

export const recordOverlay = style({
  position: 'fixed',
  inset: 0,
  zIndex: Z.record,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: c.surface.primary,
  color: c.content.primary,
  outline: 'none',
  animation: `${fade} 140ms ease`,
  ...text.body.standard,
});

export const recordNav = style({ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 });

export const recordNavText = style({
  ...text.body.standard,
  color: c.content.secondary,
  marginLeft: 8,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

export const recordFallbackBody = style({
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

// ---- side panel (comments 320 px) ------------------------------------------------------------------------------------

export const sidePanel = style({
  boxSizing: 'border-box',
  flex: 'none',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  height: '100%',
  borderLeft: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
  animation: `${fade} 140ms ease`,
});
