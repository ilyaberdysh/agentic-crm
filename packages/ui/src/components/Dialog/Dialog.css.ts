import { style, styleVariants } from '@vanilla-extract/css';
import { dialogScaleFadeIn, dialogScaleFadeOut, fadeIn, fadeOut } from '../../theme/motion.css';
import { text } from '../../theme/text';
import { derivedVars, vars } from '../../theme/vars.css';
import { scales } from '../../tokens/scales.gen';

const c = vars.color;
const { duration, zIndex } = scales;

// Standalone dialogs (⌘K, create record): 14vh from the top, no dimming unless `overlay`.
export const overlay = style({
  position: 'fixed',
  inset: 0,
  // Standalone dialog layer: overlay 9998, dialog 9999.
  zIndex: 9999,
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'flex-start',
  padding: '14vh 16px 16px',
  boxSizing: 'border-box',
  selectors: {
    '&[data-entering]': { animation: `${fadeIn} ${duration.breezy}ms ease` },
    '&[data-exiting]': { animation: `${fadeOut} ${duration.breezy}ms ease forwards` },
  },
});

export const overlayCenter = style({ alignItems: 'center', paddingTop: 16 });
export const overlayDim = style({ backgroundColor: c.surface.overlay });

// Frame: radius 16, padding 3, translucent surface + 15 px blur, e3; 160 ms scale.97 + fade.
export const frame = style({
  boxSizing: 'border-box',
  position: 'relative',
  maxWidth: '100%',
  maxHeight: 'calc(100vh - 14vh - 16px)',
  display: 'flex',
  padding: 3,
  borderRadius: 16,
  backgroundColor: derivedVars.dialogFrame,
  backdropFilter: 'blur(15px)',
  WebkitBackdropFilter: 'blur(15px)',
  boxShadow: vars.elevation.e3,
  outline: 'none',
  transformOrigin: '50% 50%',
  selectors: {
    '&[data-entering]': { animation: `${dialogScaleFadeIn} 160ms ease` },
    '&[data-exiting]': { animation: `${dialogScaleFadeOut} 160ms ease forwards` },
  },
});

export const frameCenter = style({ maxHeight: 'calc(100vh - 32px)' });

// Inner panel: radius 12, 1 px padding inside a 7 % ring, surface.primary.
export const panel = style({
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  padding: 1,
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${derivedVars.dialogPanelRing}`,
  color: c.content.primary,
  outline: 'none',
  overflow: 'hidden',
  ...text.body.standard,
});

export const size = styleVariants({
  small: { width: 440 },
  medium: { width: 720 },
  large: { width: 808 },
  palette: { width: 748 },
});

export const header = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 45,
  flex: 'none',
  // 2 px top padding: content sits 1 px below the geometric centre (measured on the create-record crop).
  padding: '2px 8px 0 12px',
  borderBottom: `1px solid ${c.stroke.primary}`,
});

export const headerTitle = style({
  ...text.body.standard,
  color: c.content.primary,
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  margin: 0,
});

export const body = style({
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: 16,
});

export const footer = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  flex: 'none',
  padding: 8,
  borderTop: `1px solid ${c.stroke.primary}`,
});

export const footerStart = style({ display: 'flex', alignItems: 'center', gap: 8, marginRight: 'auto' });

// Alert dialog: centred, 440 / 320, radius 12, e2, elevated surface,
// overlay black 25 % / 55 % fading over 140 ms, content scale-fade 140 ms.
export const alertOverlay = style({
  position: 'fixed',
  inset: 0,
  zIndex: zIndex.popoverTooltipDialog,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  boxSizing: 'border-box',
  backgroundColor: c.surface.overlay,
  selectors: {
    '&[data-entering]': { animation: `${fadeIn} ${duration.comfortable}ms ease` },
    '&[data-exiting]': { animation: `${fadeOut} ${duration.comfortable}ms ease forwards` },
  },
});

export const alert = style({
  boxSizing: 'border-box',
  width: 440,
  maxWidth: '100%',
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: vars.elevation.e2,
  color: c.content.primary,
  outline: 'none',
  overflow: 'hidden',
  selectors: {
    '&[data-entering]': { animation: `${dialogScaleFadeIn} ${duration.comfortable}ms ease` },
    '&[data-exiting]': { animation: `${dialogScaleFadeOut} ${duration.comfortable}ms ease forwards` },
  },
});

export const alertSmall = style({ width: 320 });

export const alertDialog = style({ display: 'flex', flexDirection: 'column', outline: 'none' });

export const alertBody = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '16px 16px 16px',
});

export const alertTitle = style({ ...text.heading.medium, color: c.content.primary, margin: 0 });

export const alertDescription = style({ ...text.body.standard, color: c.content.secondary, margin: 0 });
