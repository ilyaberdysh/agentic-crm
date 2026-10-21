// Requirement rules:
// the Rules tab (header + table / empty state) and the Add / Edit rule dialog (Name, Condition "If", Requirement "Then",
// Applies to).
import { insetRing, text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

/** Rules table: Rule · Applies to · actions (x 525 / 1075 on the 768 px card). */
export const rulesGrid = style({
  gridTemplateColumns: '1fr 204px 28px',
  paddingInline: '15px 12px',
  columnGap: 8,
});

export const emptyWrap = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  padding: '56px 24px',
});

export const illustration = style({
  position: 'relative',
  width: 140,
  height: 140,
  borderRadius: 8,
  backgroundColor: c.surface.secondary,
  backgroundImage: `radial-gradient(${c.stroke.primary} 1px, transparent 1px)`,
  backgroundSize: '10px 10px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: c.stroke.tertiary,
});

export const emptyTitle = style({ ...text.body.strong, color: c.content.primary, margin: '40px 0 0' });

export const emptyDescription = style({ ...text.body.standard, color: c.content.secondary, margin: '2px 0 12px' });

export const appliesCell = style({ display: 'flex', alignItems: 'center', gap: 8, color: c.content.primary });

// ---- rule dialog -----------------------------------------------------------------------------------------------------

export const dialogBody = style({
  padding: '16px 16px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  maxHeight: 'calc(100vh - 220px)',
  overflowY: 'auto',
});

export const sectionHead = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  minHeight: 20,
});

export const label = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  ...text.text12.standard,
  color: c.content.secondary,
  paddingLeft: 4,
});

export const optional = style({ color: c.content.tertiary });

export const box = style({
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  marginTop: 6,
  padding: 6,
  borderRadius: 12,
  backgroundColor: c.surface.secondary,
  boxShadow: insetRing(c.stroke.primary),
});

export const rowLine = style({ display: 'flex', alignItems: 'center', gap: 8, minHeight: 32 });

export const prefix = style({
  flex: 'none',
  width: 52,
  paddingLeft: 8,
  ...text.body.standard,
  color: c.content.tertiary,
});

export const prefixToggle = style({ flex: 'none', width: 52 });

export const segments = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'stretch',
  flex: 1,
  minWidth: 0,
  height: 28,
  borderRadius: 8,
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.primaryTransparent),
  overflow: 'hidden',
});

export const segment = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: '100%',
  padding: '0 8px',
  border: 'none',
  background: 'transparent',
  ...text.body.standard,
  color: c.content.primary,
  cursor: 'pointer',
  outline: 'none',
  whiteSpace: 'nowrap',
  minWidth: 0,
  selectors: {
    '& + &': { boxShadow: `inset 1px 0 0 ${c.stroke.primary}` },
    '&[data-hovered]': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&[data-pressed], &[aria-expanded="true"]': { backgroundColor: c.interactive.ghostHover },
    '&[data-focus-visible]': { boxShadow: insetRing(c.stroke.accent) },
  },
});

export const segmentGrow = style({ flex: 1, justifyContent: 'flex-start' });

export const segmentMuted = style({ color: c.content.tertiary });

export const segmentText = style({ overflow: 'hidden', textOverflow: 'ellipsis' });

export const addDashed = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 24,
  padding: '0 8px',
  border: `1px dashed ${c.stroke.secondaryTransparent}`,
  borderRadius: 8,
  background: 'transparent',
  ...text.body.standard,
  color: c.content.secondary,
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&[data-hovered]': { backgroundColor: c.interactive.ghostHoverSubtle, color: c.content.primary },
    '&[data-focus-visible]': { boxShadow: insetRing(c.stroke.accent) },
    '&[data-disabled]': { opacity: 0.4, cursor: 'default' },
  },
});

export const nested = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  flex: 1,
  minWidth: 0,
  padding: 6,
  borderRadius: 10,
  backgroundColor: c.surface.tertiary,
});

export const nestedFooter = style({ display: 'flex', alignItems: 'center', gap: 4 });

export const incomplete = style({ ...text.text12.standard, color: c.content.critical, margin: '0 0 0 62px' });

export const appliesBox = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 40,
  marginTop: 6,
  padding: '0 12px',
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.primary),
  ...text.body.standard,
  color: c.content.primary,
});

export const upsell = style({ ...text.body.standard, color: c.content.secondary, padding: 12, maxWidth: 280 });

export const upsellTitle = style({ ...text.body.strong, color: c.content.primary, display: 'block', marginBottom: 4 });

export const errorLine = style({ ...text.text12.standard, color: c.content.critical, margin: 0 });

// ---- "Updates required" -----------------------------------------------------------------------------------------------

export const violationBody = style({ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 });

export const violationIntro = style({ ...text.body.standard, color: c.content.secondary, margin: 0 });

export const violationList = style({
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 12,
  boxShadow: insetRing(c.stroke.primary),
});

export const violationItem = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '8px 12px',
  selectors: { '& + &': { boxShadow: `inset 0 1px 0 ${c.stroke.primary}` } },
});

export const violationRule = style({ ...text.text12.standard, color: c.content.secondary });

export const violationMessage = style({ ...text.body.standard, color: c.content.primary });
