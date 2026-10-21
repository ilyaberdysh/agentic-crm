// Global document styles: a small reset in its own cascade layer (so component styles
// always win), the 62.5 % root size, base text rendering and the reduced-motion rule.
import { globalLayer, globalStyle, style } from '@vanilla-extract/css';
import { scales } from '../tokens/scales.gen';
import { vars } from './vars.css';

const reset = globalLayer('ar-reset');

globalStyle('*, *::before, *::after', { '@layer': { [reset]: { boxSizing: 'border-box' } } });
globalStyle('html', {
  '@layer': {
    [reset]: {
      // 1rem = 10px; components set px sizes explicitly.
      fontSize: '62.5%',
      WebkitTextSizeAdjust: '100%',
    },
  },
});
globalStyle('body', { '@layer': { [reset]: { margin: 0 } } });
globalStyle('button, input, textarea, select', {
  '@layer': { [reset]: { font: 'inherit', color: 'inherit', letterSpacing: 'inherit' } },
});
globalStyle('h1, h2, h3, h4, h5, h6, p, figure, blockquote, dl, dd', { '@layer': { [reset]: { margin: 0 } } });
globalStyle('img, svg, video, canvas', { '@layer': { [reset]: { display: 'block', maxWidth: '100%' } } });

// Reduced motion: every CSS transition and keyframe animation is disabled.
globalStyle('*, *::before, *::after', {
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animationDuration: '0s !important',
      animationIterationCount: '1 !important',
      transitionDuration: '0s !important',
      scrollBehavior: 'auto !important' as 'auto',
    },
  },
});

/** Base text and surface for the element that carries the root theme (normally <body>). */
export const themeRoot = style({
  fontFamily: scales.fontFamily.sans,
  fontSize: 14,
  lineHeight: '20px',
  fontWeight: 500,
  letterSpacing: '-0.005em',
  color: vars.color.content.primary,
  backgroundColor: vars.color.surface.primary,
  WebkitFontSmoothing: 'antialiased',
  MozOsxFontSmoothing: 'grayscale',
  textRendering: 'optimizeLegibility',
  fontSynthesis: 'none',
});

/** Text defaults re-applied inside portalled layers so they never inherit host-page styles. */
export const layerRoot = style({
  fontFamily: scales.fontFamily.sans,
  WebkitFontSmoothing: 'antialiased',
  MozOsxFontSmoothing: 'grayscale',
  textRendering: 'optimizeLegibility',
});

/** One-tick style that suppresses colour cross-fades while the theme switches. */
export const noTransitionsCss = '*,*::before,*::after{transition:none!important}';
