// Sidebar Lists section and the "All lists" flyout: rows reuse the nav item; drag shows a
// 2 px accent drop line; the flyout is 300 px wide, docked at the sidebar's right edge, full height, e2, slide-in
// from −20 px with a fade (140 ms).
import { text, vars } from '@agentic-crm/ui/styles';
import { keyframes, style } from '@vanilla-extract/css';

const c = vars.color;

export const rows = style({ position: 'relative', display: 'flex', flexDirection: 'column', gap: 1 });

export const row = style({ selectors: { '&[data-dragging]': { opacity: 0.4 } } });

export const dropLine = style({
  position: 'absolute',
  left: 8,
  right: 8,
  height: 2,
  borderRadius: 2,
  backgroundColor: c.stroke.accent,
  pointerEvents: 'none',
});

const slideIn = keyframes({
  from: { opacity: 0, transform: 'translateX(-20px)' },
  to: { opacity: 1, transform: 'translateX(0)' },
});

export const flyout = style({
  position: 'fixed',
  top: 0,
  bottom: 0,
  width: 300,
  zIndex: 9,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: c.surface.primary,
  boxShadow: vars.elevation.e2,
  animation: `${slideIn} 140ms ease`,
});

export const flyoutHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 8px 10px 14px',
});

export const flyoutTitle = style({ ...text.body.standard, fontWeight: 500, color: c.content.primary });

export const flyoutSearch = style({ padding: '0 8px 8px' });

export const flyoutInput = style({
  boxSizing: 'border-box',
  width: '100%',
  height: 28,
  padding: '0 8px',
  border: 'none',
  borderRadius: 8,
  outline: 'none',
  background: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primaryTransparent}`,
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  selectors: {
    '&:focus': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
    '&::placeholder': { color: c.content.tertiary },
  },
});

export const flyoutList = style({
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '0 8px 8px',
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
});

export const flyoutRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 28,
  padding: '0 8px',
  border: 'none',
  borderRadius: 8,
  background: 'none',
  color: c.content.primary,
  textAlign: 'left',
  cursor: 'pointer',
  ...text.body.standard,
  selectors: { '&[data-active]': { backgroundColor: c.interactive.ghostHover } },
});

export const flyoutRowLabel = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

export const flyoutEmpty = style({ ...text.body.standard, color: c.content.tertiary, padding: '6px 8px' });
