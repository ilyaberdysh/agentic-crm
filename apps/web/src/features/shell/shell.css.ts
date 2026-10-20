// App shell metrics (B README §2.1–2.2, sidebar.md §1–5, §12–13; layout.md §1–3).
import { scales, text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style, styleVariants } from '@vanilla-extract/css';

const c = vars.color;
const ease = `${scales.duration.comfortable}ms ease`;

globalStyle('html, body, #root', { height: '100%' });

// ---- frame ---------------------------------------------------------------------------------------------------

export const root = style({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
  backgroundColor: c.surface.primary,
});

export const row = style({ position: 'relative', flex: 1, minHeight: 0, display: 'flex' });

export const main = style({
  position: 'relative',
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: c.surface.primary,
});

export const content = style({ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' });

// ---- sidebar container ---------------------------------------------------------------------------------------

/** Docked: occupies its width in the layout (transition 140 ms except while dragging). */
export const dock = style({
  position: 'relative',
  flex: 'none',
  height: '100%',
  transition: `width ${ease}`,
  zIndex: scales.zIndex.sidebar,
  selectors: { '&[data-dragging]': { transition: 'none' } },
});

export const sidebar = style({
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  backgroundColor: c.surface.secondary,
  color: c.content.primary,
  overflow: 'hidden',
});

export const sidebarVariant = styleVariants({
  // A real 1 px border (not an inset shadow): rows are 258 px wide at 275, as measured on Attio.
  docked: { width: '100%', borderRight: `1px solid ${c.stroke.primary}` },
  hover: {
    position: 'absolute',
    top: 8,
    left: 8,
    bottom: 8,
    height: 'auto',
    borderRadius: 10,
    boxShadow: `inset 0 0 0 1px ${c.stroke.popoverBorder}, ${vars.elevation.e2}`,
    transition: `transform ${ease}, box-shadow ${ease}`,
    zIndex: scales.zIndex.sidebar,
    selectors: {
      '&:not([data-open])': {
        transform: 'translateX(calc(-100% - 16px))',
        boxShadow: 'none',
        transitionDelay: '0ms, 140ms',
      },
    },
  },
});

export const sidebarInner = style({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  transition: `opacity ${ease}`,
  selectors: { [`${sidebarVariant.hover}:not([data-open]) &`]: { opacity: 0 } },
});

/** Invisible 14 px strip at the left window edge that reveals the floating sidebar. */
export const hoverStrip = style({
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: 0,
  width: 14,
  zIndex: scales.zIndex.sidebar,
});

export const resizeHandle = style({
  position: 'absolute',
  top: 0,
  bottom: 0,
  right: -5,
  width: 10,
  cursor: 'col-resize',
  zIndex: scales.zIndex.sidebar + 1,
  touchAction: 'none',
  selectors: {
    '&::after': {
      content: '""',
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 4,
      width: 1,
      backgroundColor: 'transparent',
      transition: 'background-color 100ms ease',
    },
    '&:hover::after, &[data-dragging]::after': { backgroundColor: c.stroke.accent },
  },
});

// ---- header (workspace switcher + collapse) -----------------------------------------------------------------

export const header = style({
  position: 'relative',
  flex: 'none',
  height: 48,
  boxShadow: `0 1px 0 ${c.stroke.primary}`,
  transition: `height ${ease}`,
  selectors: { [`${sidebarVariant.hover} &`]: { height: 40 } },
});

export const workspaceButton = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  height: '100%',
  padding: '1px 48px 1px 12px',
  border: 'none',
  background: 'transparent',
  color: c.content.primary,
  cursor: 'pointer',
  outline: 'none',
  textAlign: 'left',
  transition: 'background-color 160ms ease, height 160ms ease',
  selectors: {
    '&[data-hovered]': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&[data-pressed], &[aria-expanded="true"]': { backgroundColor: c.surface.secondaryHover },
    '&[data-focus-visible]': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
  },
});

export const workspaceName = style({
  ...text.heading.small,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const workspaceChevron = style({ color: c.content.secondary, flex: 'none' });

export const collapseButton = style({
  position: 'absolute',
  top: '50%',
  right: 13,
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
  color: c.content.secondary,
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&[data-hovered]': { backgroundColor: c.interactive.ghostHover, color: c.content.primary },
    '&[data-focus-visible]': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});

// ---- search row ---------------------------------------------------------------------------------------------

export const searchRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 12px 11px',
  flex: 'none',
});

export const searchButton = style({
  boxSizing: 'border-box',
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '4px 4px 4px 6px',
  border: 'none',
  borderRadius: 8,
  backgroundColor: c.surface.primary,
  boxShadow: vars.elevation.e1,
  color: c.content.primary,
  ...text.body.standard,
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&[data-hovered], &[data-pressed]': { backgroundColor: c.surface.primaryHover },
    '&[data-focus-visible]': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});

export const searchIcon = style({ color: c.content.secondary, flex: 'none' });

export const searchLabel = style({ flex: 1, textAlign: 'left', color: c.content.secondary });

// ---- scroll area, groups, sections --------------------------------------------------------------------------

export const scroll = style({
  // Overlay-style scrollbar: invisible until the area is hovered (Attio fades its scrollbars in).
  scrollbarWidth: 'thin',
  scrollbarColor: 'transparent transparent',
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: '0 8px 8px',
  selectors: { '&:hover': { scrollbarColor: `${c.stroke.tertiary} transparent` } },
});

export const navGroup = style({ display: 'flex', flexDirection: 'column', gap: 1 });

export const navItemCompact = style({ width: '100%' });

export const sectionHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '4px 4px 4px 8px',
  borderRadius: 6,
  transition: 'background-color 160ms ease',
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHoverSubtle } },
});

export const sectionToggle = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flex: 1,
  minWidth: 0,
  height: 20,
  padding: 0,
  border: 'none',
  background: 'transparent',
  ...text.text12.standard,
  color: c.content.secondary,
  cursor: 'pointer',
  outline: 'none',
  textAlign: 'left',
  selectors: {
    '&[data-focus-visible]': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 2, borderRadius: 4 },
  },
});

export const sectionChevron = style({
  flex: 'none',
  transition: 'transform 200ms ease',
  selectors: { '[data-collapsed] &': { transform: 'rotate(-90deg)' } },
});

export const sectionActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  opacity: 0,
  transition: 'opacity 120ms ease',
  selectors: {
    [`${sectionHeader}:hover &, ${sectionHeader}:focus-within &, &[data-open]`]: { opacity: 1 },
  },
});

export const sectionAction = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: c.content.secondary,
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&[data-hovered], &[data-focus-visible], &[aria-expanded="true"]': {
      backgroundColor: c.interactive.ghostHover,
      color: c.content.primary,
    },
  },
});

export const sectionBody = style({ display: 'flex', flexDirection: 'column', gap: 1, paddingTop: 1 });

/** Collapsible section body: height 0 ↔ content, scale .98 ↔ 1, opacity (sidebar.md §5). */
export const collapsible = style({
  display: 'grid',
  gridTemplateRows: '1fr',
  transition: `grid-template-rows ${ease}, opacity ${ease}, transform ${ease}`,
  selectors: {
    '&[data-collapsed]': { gridTemplateRows: '0fr', opacity: 0, transform: 'scale(0.98)' },
  },
});

export const collapsibleInner = style({ minHeight: 0, overflow: 'hidden' });

export const rowSkeleton = style({ display: 'flex', alignItems: 'center', gap: 8, height: 28, padding: '0 8px' });

export const ghostRow = style({ color: c.content.secondary });

// ---- footer ---------------------------------------------------------------------------------------------------

export const footer = style({
  flex: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '6px 8px',
  boxShadow: `inset 0 1px 0 ${c.stroke.primary}`,
});

// ---- page header ----------------------------------------------------------------------------------------------

export const pageHeader = style({
  boxSizing: 'border-box',
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 49,
  padding: '10px 12px 11px',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
});

export const pageHeaderLeft = style({ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 });

export const pageHeaderRight = style({ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' });

export const crumbIcon = style({ color: c.content.secondary });

// ---- placeholder pages ----------------------------------------------------------------------------------------

export const placeholder = style({
  minHeight: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
});

export const placeholderTitle = style({ ...text.heading.small, color: c.content.primary });

// ---- boot skeleton --------------------------------------------------------------------------------------------

export const bootCenter = style({
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: c.surface.primary,
  color: c.content.tertiary,
});

export const contentCenter = style({
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: c.content.tertiary,
});
