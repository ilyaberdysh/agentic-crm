// Shared keyframes and floating-layer motion (motion.md §2–3).
import { keyframes, style } from '@vanilla-extract/css';
import { scales } from '../tokens/scales.gen';

const { duration, easing } = scales;

export const subtleScaleFadeDown = keyframes({
  from: { opacity: 0, transform: 'scale(0.97) translateY(-1px)' },
  to: { opacity: 1, transform: 'scale(1) translateY(0)' },
});
export const subtleScaleFadeUp = keyframes({
  from: { opacity: 0, transform: 'scale(0.97) translateY(1px)' },
  to: { opacity: 1, transform: 'scale(1) translateY(0)' },
});
export const subtleScaleFadeRight = keyframes({
  from: { opacity: 0, transform: 'scale(0.97) translateX(-1px)' },
  to: { opacity: 1, transform: 'scale(1) translateX(0)' },
});
export const subtleScaleFadeLeft = keyframes({
  from: { opacity: 0, transform: 'scale(0.97) translateX(1px)' },
  to: { opacity: 1, transform: 'scale(1) translateX(0)' },
});
export const scaleFadeOut = keyframes({
  from: { opacity: 1, transform: 'scale(1)' },
  to: { opacity: 0, transform: 'scale(0.97)' },
});
export const dialogScaleFadeIn = keyframes({
  from: { opacity: 0, scale: '0.97' },
  to: { opacity: 1, scale: '1' },
});
export const dialogScaleFadeOut = keyframes({
  from: { opacity: 1, scale: '1' },
  to: { opacity: 0, scale: '0.97' },
});
export const fadeIn = keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
export const fadeOut = keyframes({ from: { opacity: 1 }, to: { opacity: 0 } });
export const spin = keyframes({ from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } });
export const shimmer = keyframes({ to: { backgroundPositionX: '-100%' } });

/**
 * Side-aware enter/exit for react-aria overlays (Popover, Tooltip): reads `data-placement`,
 * `data-entering` and `data-exiting`. 80 ms, transform origin at the trigger anchor point.
 */
function floatingMotion(timing: string = easing.standard) {
  const enter = `${duration.fast}ms ${timing}`;
  return style({
    transformOrigin: 'var(--trigger-anchor-point)',
    willChange: 'opacity, transform',
    backfaceVisibility: 'hidden',
    selectors: {
      '&[data-entering][data-placement="bottom"]': { animation: `${subtleScaleFadeDown} ${enter}` },
      '&[data-entering][data-placement="top"]': { animation: `${subtleScaleFadeUp} ${enter}` },
      '&[data-entering][data-placement="right"]': { animation: `${subtleScaleFadeRight} ${enter}` },
      '&[data-entering][data-placement="left"]': { animation: `${subtleScaleFadeLeft} ${enter}` },
      '&[data-exiting]': {
        animation: `${scaleFadeOut} ${duration.fast}ms ${timing} forwards`,
        pointerEvents: 'none',
      },
    },
  });
}

export const popoverMotion = floatingMotion();
export const tooltipMotion = floatingMotion(easing.tooltip);
