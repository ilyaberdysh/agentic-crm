// Admin workflow pages (evidence G/G-admin-workflows.png, G-admin-permissions.png, G-credits-usage.png): full-width
// search + Filter, a bordered table (Workflow | Created by | Status), the permissions page (Back, title + status,
// Permissions tab, Members / Teams / Individual members) and the credits usage chart.
import { insetRing, text, transitionColors, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const toolbar = style({ display: 'flex', alignItems: 'center', gap: 8 });
export const search = style({
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  padding: '0 10px',
  borderRadius: 8,
  boxShadow: insetRing(c.stroke.secondary),
  color: c.content.secondary,
});
export const searchInput = style({
  flex: 1,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  fontFamily: 'inherit',
  ...text.body.standard,
  color: c.content.primary,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});

export const table = style({
  borderRadius: 10,
  boxShadow: insetRing(c.stroke.secondary),
  overflow: 'hidden',
  marginTop: 16,
});
export const tr = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.45fr) minmax(0, 1fr) minmax(0, 0.8fr)',
  alignItems: 'center',
  minHeight: 40,
  borderTop: `1px solid ${c.stroke.primary}`,
  cursor: 'pointer',
  transition: transitionColors,
  selectors: {
    '&:first-child': { borderTop: 'none' },
    '&:hover:not([role="row"]:first-child)': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&[data-archived]': { color: c.content.tertiary },
  },
});
export const tr2 = style([tr, { gridTemplateColumns: 'minmax(0, 1fr) 120px', cursor: 'default' }]);
export const th = style({ minHeight: 38, ...text.text12.standard, color: c.content.secondary, cursor: 'default' });
export const td = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 14px',
  minWidth: 0,
  ...text.body.standard,
});
export const truncate = style({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
export const loading = style({ padding: 20, display: 'flex', justifyContent: 'center' });

export const page = style({ width: 768, maxWidth: 'calc(100% - 48px)', margin: '0 auto', padding: '72px 0 48px' });
export const back = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  ...text.body.standard,
  color: c.content.secondary,
  textDecoration: 'none',
  marginBottom: 24,
  selectors: { '&:hover': { color: c.content.primary } },
});
export const titleRow = style({ display: 'flex', alignItems: 'center', gap: 10 });
export const title = style({ ...text.heading.standard, color: c.content.primary, margin: 0 });
export const subtitle = style({ ...text.body.standard, color: c.content.secondary, margin: '4px 0 0' });
export const tabs = style({
  display: 'flex',
  gap: 4,
  margin: '40px 0 0',
  paddingBottom: 8,
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
});
export const tab = style({
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '4px 8px',
  borderRadius: 8,
  backgroundColor: c.surface.primaryHover,
  boxShadow: insetRing(c.stroke.primary),
  ...text.body.standard,
  color: c.content.primary,
  selectors: {
    '&::after': {
      content: '""',
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: -8,
      height: 1,
      backgroundColor: c.content.primary,
    },
  },
});
export const sections = style({ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 40 });
export const sectionRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  marginTop: 16,
});
export const sectionTitle = style({ ...text.body.standard, fontWeight: 600, color: c.content.primary, margin: 0 });
export const sectionText = style({ ...text.text12.standard, color: c.content.secondary, margin: '2px 0 0' });
export const card = style({
  borderRadius: 10,
  boxShadow: insetRing(c.stroke.secondary),
  backgroundColor: c.surface.secondary,
  padding: 4,
});

export const usageHead = style({ display: 'flex', flexDirection: 'column', gap: 6 });
export const usageTotal = style({ ...text.body.standard, color: c.content.secondary });
export const chart = style({
  display: 'flex',
  alignItems: 'flex-end',
  gap: 3,
  height: 160,
  padding: '12px 0',
  borderBottom: `1px solid ${c.stroke.primary}`,
});
export const bar = style({
  flex: 1,
  minHeight: 1,
  borderRadius: '3px 3px 0 0',
  backgroundColor: '#266df0',
  opacity: 0.85,
});
