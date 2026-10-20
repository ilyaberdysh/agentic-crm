import { globalStyle, style, styleVariants } from '@vanilla-extract/css';
import { shimmer } from '../../theme/motion.css';
import { text } from '../../theme/text';
import { vars } from '../../theme/vars.css';

const c = vars.color;
const u = c.utilities;
const mix = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

// ---- Skeleton: content.primary at 5 % with a 3 % highlight band shimmering over 1.5 s.
export const skeleton = style({
  display: 'block',
  flex: 'none',
  backgroundColor: mix(c.content.primary, 5),
  backgroundImage: `linear-gradient(90deg, transparent 0%, ${mix(c.content.primary, 3)} 50%, transparent 100%)`,
  backgroundSize: '200% 100%',
  backgroundRepeat: 'no-repeat',
  backgroundPositionX: '100%',
  animation: `${shimmer} 1.5s ease infinite`,
});

export const skeletonShape = styleVariants({
  block: { borderRadius: 6 },
  circle: { borderRadius: '50%' },
  text: { borderRadius: 4 },
});

export const skeletonLine = style({ display: 'flex', alignItems: 'center' });

// ---- Divider: 1 px rules (primary, floating, tertiary, dashed 3/3).
export const divider = style({ flex: 'none', border: 'none', margin: 0 });
export const dividerOrientation = styleVariants({
  horizontal: { height: 1, width: '100%' },
  vertical: { width: 1, alignSelf: 'stretch' },
});
export const dividerVariant = styleVariants({
  primary: { backgroundColor: c.stroke.primary },
  floating: { backgroundColor: c.stroke.floating },
  tertiary: { backgroundColor: c.stroke.tertiary },
  dashed: {
    backgroundColor: 'transparent',
    backgroundImage: `repeating-linear-gradient(90deg, ${c.stroke.secondary} 0 3px, transparent 3px 6px)`,
  },
});
export const dashedVertical = style({
  backgroundImage: `repeating-linear-gradient(180deg, ${c.stroke.secondary} 0 3px, transparent 3px 6px)`,
});

// ---- Banner (inline alert): min-height 44, padding-inline 12, gap 24, 1 px border.
export const banner = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 24,
  minHeight: 44,
  paddingInline: 12,
  borderWidth: 1,
  borderStyle: 'solid',
  ...text.body.standard,
});

export const bannerSize = styleVariants({
  small: { paddingBlock: 8, borderRadius: 12 },
  large: { paddingBlock: 12, borderRadius: 16 },
});

export const bannerVariant = styleVariants({
  info: { backgroundColor: c.surface.info, borderColor: c.stroke.info, color: c.content.onInfoSubtle },
  warning: { backgroundColor: c.surface.warning, borderColor: c.stroke.warning, color: c.content.onWarningSubtle },
  error: { backgroundColor: c.surface.critical, borderColor: c.stroke.critical, color: c.content.onCriticalSubtle },
  neutral: { backgroundColor: u.surface.greySubtle, borderColor: u.stroke.grey, color: u.content.onGreySubtle },
});

export const bannerMain = style({ display: 'flex', alignItems: 'flex-start', gap: 8, flex: 1, minWidth: 0 });
export const bannerIcon = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  flex: 'none',
});
export const bannerText = style({ display: 'flex', flexDirection: 'column', minWidth: 0, paddingBlock: 0 });
export const bannerTitle = style({ ...text.heading.small, color: 'inherit' });
export const bannerActions = style({ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' });

// ---- Announcement bar (system-ui §5): full-width, padding 6, centred 14/20 500.
export const announcement = style({
  boxSizing: 'border-box',
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  minHeight: 32,
  padding: '6px 40px',
  ...text.body.standard,
  textAlign: 'center',
});

globalStyle(`${announcement} a, ${announcement} button:not([aria-label])`, {
  color: 'inherit',
  font: 'inherit',
  padding: 0,
  border: 'none',
  background: 'none',
  textDecoration: 'underline',
  cursor: 'pointer',
});

export const announcementScheme = styleVariants({
  accent: { backgroundColor: c.surface.accent, color: c.content.onAccent },
  red: { backgroundColor: u.surface.red, color: '#ffffff' },
  pink: { backgroundColor: u.surface.pink, color: '#ffffff' },
  orange: { backgroundColor: u.surface.orange, color: '#ffffff' },
  'orange-dark-text': { backgroundColor: u.surface.orange, color: '#000000' },
  yellow: { backgroundColor: u.surface.yellow, color: '#000000' },
});

export const announcementDismiss = style({
  position: 'absolute',
  right: 8,
  top: '50%',
  transform: 'translateY(-50%)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&[data-hovered]': { backgroundColor: 'rgba(255, 255, 255, 0.15)' },
  },
});

// ---- Empty / loading / error states.
export const state = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  padding: 24,
  textAlign: 'center',
  minWidth: 0,
});

export const stateIcon = style({ color: c.content.tertiary });
export const stateTitle = style({ ...text.heading.small, color: c.content.primary });
export const stateDescription = style({ ...text.body.standard, color: c.content.secondary, maxWidth: 360 });
export const stateActions = style({ display: 'flex', gap: 8, marginTop: 4 });

export const loading = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  ...text.body.standard,
  color: c.content.secondary,
});

export const error = style({ gap: 8 });
export const errorText = style({ ...text.body.standard, color: c.content.critical, maxWidth: 500 });

// ---- Card: surface.primary, inset 1 px stroke.primary, radius 12, 140 ms.
export const card = style({
  boxSizing: 'border-box',
  position: 'relative',
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  color: c.content.primary,
  transition: 'box-shadow 140ms ease, background-color 140ms ease',
  selectors: {
    '&:focus-within': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
  },
});

export const cardState = styleVariants({
  default: {},
  highlighted: { boxShadow: `inset 0 0 0 1px ${mix(c.stroke.accent, 60)}`, backgroundColor: c.surface.accentSubtle },
  selected: {
    boxShadow: `inset 0 0 0 1px ${c.stroke.accent}`,
    backgroundColor: `color-mix(in srgb, ${c.surface.accent} 20%, ${c.surface.primary})`,
  },
  error: { boxShadow: `inset 0 0 0 1px ${c.stroke.critical}` },
  disabled: { opacity: 0.4 },
});
