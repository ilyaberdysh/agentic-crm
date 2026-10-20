// Settings shell and page template (B README §2.8, layout.md §6; evidence/B/settings-appearance-*.png).
import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

// ---- left nav -------------------------------------------------------------------------------------------------

export const navHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  height: 48,
  padding: '0 12px',
  flex: 'none',
});

export const navTitle = style({ ...text.heading.small, color: c.content.primary, margin: 0 });

export const navSearch = style({ padding: '11px 12px 12px', flex: 'none' });

export const navScroll = style({
  // Overlay-style scrollbar: invisible until the area is hovered (Attio fades its scrollbars in).
  scrollbarWidth: 'thin',
  scrollbarColor: 'transparent transparent',
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '0 8px 8px',
  selectors: { '&:hover': { scrollbarColor: `${c.stroke.tertiary} transparent` } },
});

export const navGroup = style({ display: 'flex', flexDirection: 'column', gap: 1 });

export const navRule = style({ height: 1, margin: '0 8px', backgroundColor: c.stroke.primary, flex: 'none' });

// Search hit below its page (raw setsearch capture): 22 px row, text under the page label, 1 px guide line below the icon.
export const navChild = style({
  position: 'relative',
  height: 22,
  paddingLeft: 28,
  selectors: {
    '&::before': {
      content: '""',
      position: 'absolute',
      left: 14,
      top: 0,
      bottom: 0,
      width: 1,
      backgroundColor: c.stroke.primary,
    },
  },
});

export const navEmpty = style({ ...text.body.standard, color: c.content.tertiary, padding: '8px 8px' });

// ---- page template --------------------------------------------------------------------------------------------

export const page = style({
  boxSizing: 'border-box',
  maxWidth: 816,
  margin: '0 auto',
  padding: '72px 24px',
  display: 'flex',
  flexDirection: 'column',
});

export const pageTitle = style({ ...text.heading.large, color: c.content.primary, margin: 0 });

export const pageDescription = style({ ...text.body.standard, color: c.content.secondary, margin: 0 });

export const learnMore = style({
  color: c.content.secondary,
  textDecoration: 'underline',
  textDecorationColor: c.stroke.secondaryTransparent,
  textUnderlineOffset: '0.14em',
  selectors: { '&:hover': { color: c.content.primary } },
});

export const pageRule = style({ height: 1, backgroundColor: c.stroke.primary, margin: '24px 0 40px', flex: 'none' });

export const sections = style({ display: 'flex', flexDirection: 'column', gap: 40 });

export const section = style({ display: 'flex', flexDirection: 'column', gap: 16, scrollMarginTop: 24 });

export const sectionRow = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 });

export const sectionTitle = style({ ...text.heading.small, color: c.content.primary, margin: 0 });

export const sectionDescription = style({ ...text.body.standard, color: c.content.secondary, margin: 0 });

// ---- appearance -----------------------------------------------------------------------------------------------

export const themeCards = style({ display: 'flex', flexWrap: 'wrap', gap: 8 });

export const themeCard = style({
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  width: 223,
  height: 151,
  padding: 4,
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  cursor: 'pointer',
  outline: 'none',
  transition: 'box-shadow 140ms ease',
  selectors: {
    '&[data-hovered]': { boxShadow: `inset 0 0 0 1px ${c.stroke.tertiary}` },
    '&[data-selected]': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
    '&[data-focus-visible]': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});

export const themePreview = style({
  display: 'block',
  width: '100%',
  height: 113,
  borderRadius: 8,
  overflow: 'hidden',
});

export const themeLabel = style({
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  ...text.body.standard,
  color: c.content.secondary,
  selectors: { [`${themeCard}[data-selected] &`]: { color: c.content.primary } },
});
