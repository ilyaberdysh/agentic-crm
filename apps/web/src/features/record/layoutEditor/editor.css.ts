// Record page layout editor (D README §2.8; evidence D-layout-*): a WYSIWYG skeleton of the record page — header
// with "Record name", the actions row (hover outline + "✎ Edit"), dashed editable section cards, a locked Lists card,
// "+ Add section"; on the right tab pills with ⋮ menus and "+ Add tab", Highlights with "+ Add widget (n/6)" and
// widget cards; the dirty bar at the bottom.
import { scales, text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const page = style({ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' });

export const body = style({ position: 'relative', flex: 1, minHeight: 0, display: 'flex' });

export const left = style({
  flex: 'none',
  boxSizing: 'border-box',
  minWidth: 320,
  height: '100%',
  overflowY: 'auto',
  borderRight: `1px solid ${c.stroke.primary}`,
  display: 'flex',
  flexDirection: 'column',
});

export const right = style({ flex: '1 1 0', minWidth: 350, height: '100%', overflowY: 'auto' });

export const header = style({ display: 'flex', flexDirection: 'column', gap: 12, padding: 12 });

export const titleRow = style({ display: 'flex', alignItems: 'center', gap: 10, height: 32 });
export const titlePlaceholder = style({ ...text.heading.medium, color: c.content.secondary });

export const actionsWrap = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: 2,
  margin: -2,
  borderRadius: 10,
  transition: `box-shadow ${scales.duration.comfortable}ms ease`,
  selectors: {
    '&:hover, &[data-open]': { boxShadow: `0 0 0 1px ${c.stroke.accent}` },
  },
});

export const editActionsButton = style({
  position: 'absolute',
  right: 4,
  top: 2,
  opacity: 0,
  transition: `opacity ${scales.duration.comfortable}ms ease`,
  selectors: { [`${actionsWrap}:hover &, ${actionsWrap}[data-open] &`]: { opacity: 1 } },
});

export const sections = style({ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 12px 16px' });

export const sectionCard = style({
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '10px 12px 12px',
  borderRadius: 10,
  border: `1px dashed ${c.stroke.tertiary}`,
  cursor: 'pointer',
  transition: `background-color ${scales.duration.comfortable}ms ease`,
  selectors: {
    '&:hover': { backgroundColor: c.surface.primaryHover },
    '&[data-locked]': {
      border: `1px solid ${c.stroke.primary}`,
      backgroundColor: c.surface.secondary,
      cursor: 'default',
    },
  },
});

export const sectionTop = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 });

export const sectionTrash = style({
  opacity: 0,
  transition: `opacity ${scales.duration.comfortable}ms ease`,
  selectors: { [`${sectionCard}:hover &, ${sectionCard}:focus-within &`]: { opacity: 1 } },
});

export const sectionTitle = style({
  ...text.body.standard,
  fontWeight: 600,
  color: c.content.primary,
  border: 'none',
  background: 'transparent',
  padding: '0 2px',
  borderRadius: 4,
  cursor: 'text',
  textAlign: 'left',
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHover } },
});

export const sectionTitleInput = style({
  ...text.body.standard,
  fontWeight: 600,
  color: c.content.primary,
  border: 'none',
  outline: 'none',
  borderRadius: 4,
  padding: '0 2px',
  boxShadow: `0 0 0 1px ${c.stroke.accent}`,
  background: c.surface.primary,
  minWidth: 0,
  flex: 1,
});

export const chips = style({ display: 'flex', flexWrap: 'wrap', gap: 4 });

export const chip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 20,
  padding: '0 6px 0 4px',
  borderRadius: 6,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  backgroundColor: c.surface.primary,
  ...text.text12.standard,
  color: c.content.primary,
});

export const addSection = style({
  boxSizing: 'border-box',
  height: 32,
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  borderRadius: 9,
  border: `1px dashed ${c.stroke.primaryTransparent}`,
  backgroundColor: c.interactive.placeholder,
  ...text.body.standard,
  fontWeight: 500,
  color: c.content.tertiary,
  cursor: 'pointer',
  selectors: { '&:hover': { backgroundColor: c.interactive.placeholderHover, color: c.content.primary } },
});

// ---- right side ----------------------------------------------------------------------------------------------

export const tabsRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '12px 24px 12px 24px',
  flexWrap: 'wrap',
});

export const tabPill = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  maxWidth: 250,
  height: 32,
  boxSizing: 'border-box',
  padding: '6px 6px 6px 8px',
  borderRadius: 8,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  ...text.body.standard,
  fontWeight: 500,
  color: c.content.primary,
  whiteSpace: 'nowrap',
  selectors: { '&[data-static]': { paddingRight: 8 } },
});

export const tabPillText = style({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' });

export const tabsDivider = style({ width: 1, height: 16, margin: '0 4px', backgroundColor: c.stroke.secondary });

export const highlights = style({ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 24px 24px' });

export const highlightsHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingLeft: 12,
  ...text.body.standard,
  fontWeight: 500,
  color: c.content.secondary,
});

export const widgetGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(max(168px, calc((100% - 16px) / 3)), 1fr))',
  gap: 8,
});

export const widget = style({
  position: 'relative',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  minHeight: 86,
  padding: '10px 12px',
  borderRadius: 12,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
});

export const widgetTop = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 });
export const widgetLabel = style({
  ...text.text12.standard,
  color: c.content.secondary,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const widgetEmpty = style({ ...text.body.standard, color: c.content.tertiary });
export const widgetIcon = style({ color: c.content.secondary });
export const widgetMenu = style({
  position: 'absolute',
  top: 6,
  right: 8,
  opacity: 0,
  transition: `opacity ${scales.duration.comfortable}ms ease`,
  selectors: { [`${widget}:hover &, ${widget}:focus-within &`]: { opacity: 1 } },
});

export const emptyWidgets = style({
  display: 'grid',
  placeItems: 'center',
  minHeight: 86,
  borderRadius: 12,
  border: `1px dashed ${c.stroke.tertiary}`,
});

// ---- dirty bar ------------------------------------------------------------------------------------------------

export const dirtyBar = style({
  position: 'absolute',
  left: '50%',
  bottom: 20,
  transform: 'translateX(-50%)',
  zIndex: 6,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 44,
  boxSizing: 'border-box',
  padding: '6px 6px 6px 14px',
  borderRadius: 14,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}, ${vars.elevation.e2}`,
  ...text.body.standard,
  color: c.content.secondary,
  whiteSpace: 'nowrap',
});

// ---- popovers / dialogs ---------------------------------------------------------------------------------------

export const actionsPanel = style({ width: 260, padding: 4, position: 'relative' });
export const panelHeading = style({ ...text.text12.standard, color: c.content.secondary, padding: '6px 8px 4px' });
export const actionItem = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 32,
  padding: '0 8px 0 4px',
  borderRadius: 8,
  ...text.body.standard,
  color: c.content.primary,
  userSelect: 'none',
  selectors: { '&[data-dragging]': { opacity: 0.4 }, '&:hover': { backgroundColor: c.surface.primaryHover } },
});
export const grip = style({ color: c.content.tertiary, cursor: 'grab', display: 'inline-flex' });
export const dropLine = style({
  position: 'absolute',
  left: 6,
  right: 6,
  height: 2,
  borderRadius: 1,
  backgroundColor: c.stroke.accent,
  pointerEvents: 'none',
});

export const dialogBody = style({ display: 'flex', flexDirection: 'column', gap: 16, padding: 16 });
export const fieldLabel = style({
  ...text.text12.standard,
  color: c.content.tertiary,
  paddingLeft: 4,
  marginBottom: 4,
});
export const attrList = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 9,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primaryTransparent}`,
});
export const attrRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 34,
  padding: '0 8px 0 6px',
  ...text.body.standard,
  color: c.content.primary,
  selectors: {
    '& + &': { borderTop: `1px solid ${c.stroke.primary}` },
    '&[data-dragging]': { opacity: 0.4 },
  },
});
export const attrAdd = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  height: 34,
  padding: '0 10px',
  border: 'none',
  borderTop: `1px solid ${c.stroke.primary}`,
  background: 'transparent',
  ...text.body.standard,
  color: c.content.secondary,
  cursor: 'pointer',
  selectors: { '&:first-child': { borderTop: 'none' }, '&:hover': { color: c.content.primary } },
});
export const spacer = style({ flex: 1 });
