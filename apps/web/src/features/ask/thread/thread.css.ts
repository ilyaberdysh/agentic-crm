// Transcript metrics (ask-agentic §4): user bubble right-aligned (max ~490 px, grey, 12 px radius), assistant column
// ~650 px, tool rows as 24 px chips, the "7 tools used ›" disclosure, the icon row and the reply suggestions.
import { text, vars } from '@agentic-crm/ui/styles';
import { keyframes, style } from '@vanilla-extract/css';

const c = vars.color;

export const turns = style({ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 });

export const userRow = style({ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 });
export const userBubble = style({
  boxSizing: 'border-box',
  maxWidth: 490,
  padding: '8px 12px',
  borderRadius: 12,
  backgroundColor: c.surface.tertiary,
  color: c.content.primary,
  ...text.body.standard,
  fontWeight: 400,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
});
export const userActions = style({
  display: 'flex',
  gap: 2,
  opacity: 0,
  transition: 'opacity 120ms ease',
  selectors: { [`${userRow}:hover &, ${userRow}:focus-within &`]: { opacity: 1 } },
});
export const promptToken = style({ color: c.content.accent });
export const mentionToken = style({ color: c.content.accent });

export const assistant = style({ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 });

const shimmer = keyframes({ from: { backgroundPosition: '200% 0' }, to: { backgroundPosition: '-200% 0' } });

/** The shimmering label of a running turn ("Thinking"). */
export const thinking = style({
  ...text.body.standard,
  fontWeight: 400,
  color: c.content.tertiary,
  backgroundImage: `linear-gradient(90deg, ${c.content.tertiary} 35%, ${c.content.primary} 50%, ${c.content.tertiary} 65%)`,
  backgroundSize: '200% 100%',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  animation: `${shimmer} 2.4s linear infinite`,
  '@media': { '(prefers-reduced-motion: reduce)': { animation: 'none', WebkitTextFillColor: 'currentColor' } },
});

export const activity = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 8,
  minWidth: 0,
});

export const toolRow = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  maxWidth: '100%',
  minHeight: 24,
  padding: '0 8px',
  borderRadius: 8,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  backgroundColor: c.surface.primary,
  ...text.text12.standard,
  fontWeight: 400,
  color: c.content.primary,
  selectors: {
    '&[data-tone="denied"]': { color: c.content.tertiary },
    '&[data-tone="failed"]': { color: c.content.critical },
  },
});
export const toolIcon = style({ flex: 'none', color: c.content.tertiary, display: 'inline-flex' });
export const toolLabel = style({
  whiteSpace: 'nowrap',
  selectors: {
    '&[data-active]': {
      animation: `${shimmer} 2s linear infinite`,
      backgroundImage: `linear-gradient(90deg, ${c.content.primary} 35%, ${c.content.tertiary} 50%, ${c.content.primary} 65%)`,
      backgroundSize: '200% 100%',
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
    },
  },
});
export const toolDetail = style({
  color: c.content.tertiary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
});
export const toolResult = style({ color: c.content.secondary, whiteSpace: 'nowrap' });
export const avatarStack = style({ display: 'inline-flex', alignItems: 'center', marginLeft: 2 });
export const avatarStackItem = style({
  marginLeft: -4,
  display: 'inline-flex',
  selectors: { '&:first-child': { marginLeft: 0 } },
});
export const muted = style({ color: c.content.secondary });

export const disclosure = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  alignSelf: 'flex-start',
  padding: '2px 0',
  border: 'none',
  background: 'transparent',
  color: c.content.secondary,
  cursor: 'pointer',
  ...text.body.standard,
  fontWeight: 400,
  selectors: { '&:hover': { color: c.content.primary } },
});
export const disclosureChevron = style({
  transition: 'transform 140ms ease',
  selectors: { [`${disclosure}[aria-expanded="true"] &`]: { transform: 'rotate(90deg)' } },
});

export const banner = style({
  ...text.body.standard,
  fontWeight: 400,
  color: c.content.secondary,
});
export const bannerCritical = style({ color: c.content.critical });

export const actions = style({ display: 'flex', alignItems: 'center', gap: 0, marginLeft: -4 });
export const actionButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: c.content.tertiary,
  cursor: 'pointer',
  selectors: {
    '&:hover, &[data-pressed]': { backgroundColor: c.interactive.ghostHover, color: c.content.primary },
    '&[data-active]': { color: c.content.accent },
    '&[data-focus-visible]': { outline: `2px solid ${c.stroke.accent}` },
  },
});

export const suggestions = style({ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 8 });
export const suggestion = style({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  minHeight: 32,
  padding: '4px 8px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: c.content.secondary,
  textAlign: 'left',
  cursor: 'pointer',
  ...text.body.standard,
  fontWeight: 400,
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHoverSubtle, color: c.content.primary } },
});

// ---- try again menu --------------------------------------------------------------------------------------------------------------

export const retryMenu = style({ display: 'flex', flexDirection: 'column', gap: 1, width: 230 });
export const retryInput = style({
  boxSizing: 'border-box',
  width: '100%',
  height: 32,
  padding: '0 8px',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  borderBottom: `1px solid ${c.stroke.primary}`,
  color: c.content.primary,
  ...text.body.standard,
  fontWeight: 400,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});
export const menuItem = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 32,
  padding: '0 8px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: c.content.primary,
  textAlign: 'left',
  cursor: 'pointer',
  width: '100%',
  ...text.body.standard,
  fontWeight: 400,
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHover },
    '&:disabled': { color: c.content.tertiary, cursor: 'default' },
  },
});
export const menuTrailing = style({
  marginLeft: 'auto',
  color: c.content.tertiary,
  ...text.text12.standard,
  fontWeight: 400,
});

// ---- scroll area -------------------------------------------------------------------------------------------------------------------

export const scrollToBottom = style({
  position: 'absolute',
  left: '50%',
  transform: 'translateX(-50%)',
  bottom: 12,
  width: 28,
  height: 28,
  borderRadius: 14,
  border: 'none',
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}, ${vars.elevation.e1}`,
  color: c.content.secondary,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  selectors: { '&:hover': { color: c.content.primary } },
});
