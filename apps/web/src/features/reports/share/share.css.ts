// Share popover: 420 px wide, 224 px
// tall with one member — workspace row 58 px, rule, add row 32 px, "Individual members", member rows 32 px, rule,
// "Learn more about permissions". Inner padding 12 inside the panel's 4.
import { insetRing, scales, text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;
const ease = `${scales.duration.fast}ms ease-in-out`;

// ---- level dropdown --------------------------------------------------------------------------------------------------

export const levelButton = style({ flex: 'none', color: c.content.secondary });

export const levelInherited = style({ color: c.content.tertiary });

export const levelWarning = style({ color: c.content.warning });

// ---- popover ---------------------------------------------------------------------------------------------------------

export const trigger = style({ color: c.content.secondary });

export const popover = style({ display: 'flex', flexDirection: 'column', gap: 0, width: '100%' });

export const workspaceRow = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  height: 58,
  padding: '0 12px',
  flex: 'none',
});

export const workspaceTitle = style({ ...text.body.standard, fontWeight: 500, color: c.content.primary, flex: 1 });

export const rule = style({ height: 1, backgroundColor: c.stroke.primary, margin: 0, border: 'none', flex: 'none' });

export const body = style({
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  padding: '12px 12px 10px',
  minHeight: 0,
  maxHeight: 320,
  overflowY: 'auto',
});

export const addRow = style({ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' });

export const addBox = style({
  boxSizing: 'border-box',
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  height: 32,
  paddingLeft: 8,
  paddingRight: 2,
  borderRadius: 9,
  boxShadow: insetRing(c.stroke.secondaryTransparent),
  backgroundColor: c.interactive.ghost,
  transition: `box-shadow ${ease}`,
  selectors: {
    '&:focus-within': { boxShadow: insetRing(c.stroke.accent) },
    '&[data-disabled]': { opacity: 0.4 },
  },
});

export const comboRoot = style({ flex: 1, minWidth: 0, display: 'flex' });

export const addInput = style({
  flex: 1,
  minWidth: 0,
  height: 30,
  padding: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});

export const optionList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  outline: 'none',
  overflow: 'auto',
  maxHeight: 240,
  minHeight: 0,
});

export const optionEmpty = style({ ...text.body.standard, color: c.content.tertiary, padding: '8px 8px' });

export const option = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 32,
  padding: '6px 8px',
  borderRadius: 8,
  color: c.content.primary,
  cursor: 'default',
  userSelect: 'none',
  flexShrink: 0,
  ...text.body.standard,
  selectors: { '&[data-active]': { backgroundColor: c.surface.primaryHover } },
});

export const optionName = style({
  flex: '0 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const optionSub = style({
  ...text.text12.standard,
  color: c.content.secondary,
  flex: '1 1 0',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const sectionLabel = style({
  ...text.text12.standard,
  color: c.content.secondary,
  margin: '16px 0 6px',
  flex: 'none',
});

export const grantRow = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 32,
  flex: 'none',
});

export const grantName = style({
  display: 'flex',
  alignItems: 'baseline',
  gap: 6,
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
});

export const grantPrimary = style({
  ...text.body.standard,
  color: c.content.primary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  flex: '0 1 auto',
  minWidth: 0,
});

export const grantSecondary = style({
  ...text.text12.standard,
  color: c.content.secondary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  flex: '0 1 auto',
  minWidth: 0,
});

export const teamTile = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  width: 16,
  height: 16,
  borderRadius: 5,
  backgroundColor: c.utilities.surface.greySubtle,
  color: c.content.secondary,
});

export const footer = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  padding: '0 8px',
  flex: 'none',
});

export const footerLink = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  ...text.body.standard,
  color: c.content.secondary,
  textDecoration: 'none',
  borderRadius: 6,
  padding: '0 4px',
  outline: 'none',
  selectors: {
    '&:hover': { color: c.content.primary },
    '&:focus-visible': { boxShadow: insetRing(c.stroke.accent) },
  },
});

export const note = style({ ...text.text12.standard, color: c.content.tertiary, padding: '8px 0 0' });
