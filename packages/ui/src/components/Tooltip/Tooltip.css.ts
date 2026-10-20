import { style } from '@vanilla-extract/css';
import { tooltipMotion } from '../../theme/motion.css';
import { text } from '../../theme/text';
import { vars } from '../../theme/vars.css';

// Tooltip content: floating surface #101112 in every theme, text12 in
// content.floatingPrimary, padding 6 8, radius 8, e1 of the current identity (the dark theme's
// e1 adds the #212224 inner ring; the light one has none — verified on the evidence crops).
export const tooltip = style([
  tooltipMotion,
  {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    maxWidth: 320,
    padding: '6px 8px',
    borderRadius: 8,
    backgroundColor: vars.color.surface.floating,
    color: vars.color.content.floatingPrimary,
    boxShadow: vars.elevation.e1,
    ...text.text12.standard,
    overflowWrap: 'break-word',
    pointerEvents: 'none',
    selectors: {
      // Shortcut caps are 20 px; keep the tooltip 28 px tall (live: "Collapse sidebar ⌘." 166 × 28).
      '&[data-has-shortcut]': { paddingTop: 4, paddingBottom: 4 },
    },
  },
]);

export const label = style({ minWidth: 0 });
