// Two-column onboarding card (K legacy-welcome): 1130 × 692, two 564 px
// halves, 1px stroke.primary border, radius 20; the right half hides below `lg`; at phone width the border goes.
import { breakpoints, text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;
const belowLg = `screen and (max-width: ${breakpoints.lg + 32}px)`;
const phone = `screen and (max-width: ${breakpoints.sm - 1}px)`;

export const cardWrap = style({
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
});

export const card = style({
  boxSizing: 'border-box',
  display: 'grid',
  gridTemplateColumns: '564px 564px',
  width: 1130,
  minHeight: 692,
  borderRadius: 20,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  overflow: 'hidden',
  '@media': {
    [belowLg]: { gridTemplateColumns: '564px', width: 566 },
    [phone]: { width: '100%', gridTemplateColumns: '1fr', boxShadow: 'none', minHeight: 0 },
  },
});

export const left = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  padding: '96px 96px',
  gap: 24,
  '@media': {
    [phone]: { padding: '24px 0' },
  },
});

export const progress = style({
  position: 'absolute',
  top: 0,
  left: 0,
  height: 2,
  backgroundColor: c.surface.accent,
  transition: 'width 300ms ease',
});

export const right = style({
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  padding: '96px 86px',
  gap: 20,
  '@media': {
    [belowLg]: { display: 'none' },
  },
});

export const heading = style({ ...text.heading.large, color: c.content.primary, margin: 0 });

export const stepTitle = style({ ...text.heading.standard, color: c.content.primary, margin: 0 });

export const paragraph = style({
  ...text.body.standard,
  color: c.content.secondary,
  maxWidth: 392,
  margin: 0,
  whiteSpace: 'pre-line',
});

export const fields = style({ display: 'flex', flexDirection: 'column', gap: 16 });

export const consent = style({
  fontSize: 10,
  lineHeight: '14px',
  fontWeight: 500,
  color: c.content.secondary,
  margin: 0,
});

export const notice = style({
  ...text.body.standard,
  color: c.content.secondary,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
});

// ---- create workspace: logo tile + live preview --------------------------------------------------------------

export const logoRow = style({ display: 'flex', alignItems: 'center', gap: 16 });

export const logoLabel = style({ display: 'flex', flexDirection: 'column', gap: 2 });

export const logoTitle = style({ ...text.body.standard, color: c.content.primary });

export const logoHint = style({ ...text.text12.standard, color: c.content.secondary });

export const handleStatus = style({
  ...text.text12.standard,
  color: c.content.secondary,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 16,
  marginTop: -8,
  paddingLeft: 4,
});

export const handleAvailable = style({ color: c.content.success });

export const handleTaken = style({ color: c.content.critical });

export const preview = style({
  alignSelf: 'stretch',
  flex: 1,
  display: 'flex',
  justifyContent: 'flex-start',
  alignItems: 'center',
  padding: '96px 0 96px 64px',
  backgroundColor: c.surface.secondary,
  '@media': {
    [belowLg]: { display: 'none' },
  },
});

export const previewFrame = style({
  width: '100%',
  height: 420,
  display: 'grid',
  gridTemplateColumns: '200px 1fr',
  borderRadius: '12px 0 0 12px',
  backgroundColor: c.surface.primary,
  boxShadow: `${vars.elevation.e1}, inset 0 0 0 1px ${c.stroke.primary}`,
  overflow: 'hidden',
});

export const previewSidebar = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '0 10px',
  backgroundColor: c.surface.secondary,
  boxShadow: `inset -1px 0 0 ${c.stroke.primary}`,
});

export const previewHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 44,
  margin: '0 -10px',
  padding: '0 10px',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
  ...text.heading.small,
  color: c.content.primary,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
});

export const previewName = style({ overflow: 'hidden', textOverflow: 'ellipsis' });

export const previewRow = style({ display: 'flex', alignItems: 'center', gap: 8, height: 20 });

export const previewBar = style({
  height: 8,
  borderRadius: 4,
  backgroundColor: c.surface.tertiaryHover,
});

export const previewMain = style({ display: 'flex', flexDirection: 'column' });

export const previewTopbar = style({ height: 44, boxShadow: `inset 0 -1px 0 ${c.stroke.primary}` });

export const previewTableRow = style({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: 16,
  alignItems: 'center',
  height: 32,
  padding: '0 16px',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
});
