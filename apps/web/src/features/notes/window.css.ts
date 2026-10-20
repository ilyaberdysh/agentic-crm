// Note and template windows (E README §2.2, §2.5; evidence E/note-empty-template-launcher.png, note-floating-panel.png,
// template-editor.png): document column 704 px at 132 px (modal), title 32/600/36 −0.64, meta chips, body, launcher.
import { alpha, text, transitionColors, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const body = style({
  position: 'relative',
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
});

export const headerRow = style({
  boxSizing: 'border-box',
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  height: 42,
  padding: '0 10px 0 16px',
});

export const scroll = style({ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' });

export const column = style({
  boxSizing: 'border-box',
  width: 704,
  maxWidth: '100%',
  margin: '0 0 0 129px',
  padding: '46px 0 80px',
  display: 'flex',
  flexDirection: 'column',
});

export const columnFloating = style({ width: 'auto', margin: 0, padding: '22px 24px 64px' });

export const columnTemplate = style({ paddingTop: 50 });

export const title = style({
  boxSizing: 'border-box',
  display: 'block',
  width: '100%',
  margin: 0,
  padding: 0,
  border: 'none',
  outline: 'none',
  resize: 'none',
  overflow: 'hidden',
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  fontSize: 32,
  fontWeight: 600,
  lineHeight: '36px',
  letterSpacing: '-0.64px',
  fieldSizing: 'content',
  selectors: { '&::placeholder': { color: c.content.tertiary } },
} as Parameters<typeof style>[0]);

export const titleFloating = style({ fontSize: 28, lineHeight: '34px', letterSpacing: '-0.56px' });

export const meta = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 4,
  marginTop: 6,
  marginLeft: -4,
});

export const metaChip = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 24,
  maxWidth: 280,
  padding: '0 6px 0 4px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  cursor: 'pointer',
  textDecoration: 'none',
  outline: 'none',
  ...text.body.standard,
  transition: transitionColors,
  selectors: {
    '&:hover, &[data-hovered]': { backgroundColor: c.interactive.ghostHover },
    '&[data-focus-visible]': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
  },
});

export const metaChipMuted = style({ color: c.content.secondary });

export const chipText = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

export const editor = style({ marginTop: 30 });

export const launcher = style({ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 28 });

export const launcherLabel = style({
  ...text.text11.standard,
  color: c.content.secondary,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  margin: '0 0 6px',
});

export const launcherGroup = style({ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 20 });

export const launcherItem = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 35,
  margin: '0 0 0 -4px',
  padding: '0 8px 0 4px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: c.content.secondary,
  fontFamily: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  outline: 'none',
  width: 'fit-content',
  maxWidth: '100%',
  ...text.body.standard,
  selectors: {
    '&[data-hovered], &[data-highlighted]': { backgroundColor: c.interactive.ghostHover, color: c.content.primary },
  },
});

export const launcherIcon = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  flex: 'none',
  borderRadius: 6,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primaryTransparent}`,
  color: c.content.secondary,
});

export const insertButton = style({ position: 'absolute', left: 12, bottom: 12 });

export const footerBar = style({
  boxSizing: 'border-box',
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  height: 44,
  padding: '0 10px',
  borderTop: `1px solid ${c.stroke.primary}`,
});

export const state = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  padding: 24,
  textAlign: 'center',
});

export const stateTitle = style({ ...text.heading.small, color: c.content.primary });
export const stateText = style({ ...text.body.standard, color: c.content.secondary });

// ---- template banner (E README §2.5: peach "You are editing a template") ------------------------------------------

export const banner = style({
  boxSizing: 'border-box',
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 44,
  padding: '0 10px 0 24px',
  backgroundColor: c.utilities.surface.orangeSubtle,
  color: c.content.primary,
  ...text.body.standard,
});

export const bannerInfo = style({ color: c.content.secondary, display: 'inline-flex' });
export const bannerSpacer = style({ flex: 1 });

export const presence = style({ display: 'inline-flex', alignItems: 'center' });

export const presenceRing = style({ borderRadius: 999, boxShadow: `0 0 0 2px ${c.surface.primary}` });

export const crumbChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  color: c.content.primary,
  ...text.body.standard,
});

export const crumbIconBox = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  borderRadius: 4,
  backgroundColor: alpha('#000000', 4),
  flex: 'none',
});
