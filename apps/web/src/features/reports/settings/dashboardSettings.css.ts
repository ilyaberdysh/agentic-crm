// Settings → Dashboards:
// 1237 × 600 crops of the main region at 1x): 768 px column, "‹ Back", title and description, tabs Reports | Permissions,
// then a 40 px-pitch table card or the Permissions sections. The page frame, back link, tabs and heading styles are
// the settings ones (features/settings/objects/objects.css); this file adds the table grids and the permission cards.
import { insetRing, text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

// ---- shared header / tabs ------------------------------------------------------------------------------------------------

export const header = style({ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 16 });

export const title = style({
  ...text.heading.large,
  color: c.content.primary,
  margin: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const tabsBlock = style({ marginTop: 44 });

export const panel = style({ paddingTop: 32, outline: 'none' });

// ---- tables ----------------------------------------------------------------------------------------------------------

/** Settings → Dashboards list: Dashboard | Reports | Created at | ⋮. */
export const listGrid = style({
  gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1.3fr) 124px 44px',
  paddingInline: '14px 0',
});

/** Dashboard Reports tab: Report | Created at | ⋮ (Created at starts at x = 368 of the 768 px card). */
export const reportsGrid = style({
  gridTemplateColumns: 'minmax(0, 1fr) 342px 58px',
  paddingInline: '14px 0',
});

export const headRow = style({ minHeight: 40 });

export const dataRow = style({
  height: 40,
  color: c.content.secondary,
  selectors: {
    '&:has(a:focus-visible)': { boxShadow: insetRing(c.stroke.accent) },
  },
});

/** The title link stretches over its row (menu and chips sit above it). */
export const rowLink = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
  color: 'inherit',
  textDecoration: 'none',
  outline: 'none',
  selectors: { '&::after': { content: '""', position: 'absolute', inset: 0 } },
});

export const linkPrimary = style({ color: c.content.primary, fontWeight: 500 });

export const small = style({ ...text.text12.standard, color: c.content.secondary, whiteSpace: 'nowrap' });

export const actions = style({
  position: 'relative',
  zIndex: 1,
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
});

export const chipsCell = style({ position: 'relative', zIndex: 1, minWidth: 0, overflow: 'hidden' });

export const stateBox = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  padding: '40px 24px',
  textAlign: 'center',
});

// ---- permissions -----------------------------------------------------------------------------------------------------

export const permissions = style({ display: 'flex', flexDirection: 'column', gap: 24 });

export const sectionTitle = style({ ...text.heading.small, color: c.content.primary, margin: 0 });

export const groupTitle = style({ ...text.body.strong, color: c.content.primary, margin: 0 });

export const sectionSub = style({ ...text.body.standard, color: c.content.secondary, margin: 0 });

/** The explanation under "Teams" / "Individual members" (12 px in the capture). */
export const groupSub = style({ ...text.text12.standard, color: c.content.secondary, margin: 0 });

/** The workspace card follows its heading block at 16 px instead of the 24 px between sections. */
export const afterHeading = style({ marginTop: -8 });

export const sectionHead = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 });

export const learn = style({
  color: c.content.secondary,
  textDecoration: 'underline',
  textDecorationColor: c.stroke.secondaryTransparent,
  textUnderlineOffset: '0.14em',
  selectors: { '&:hover': { color: c.content.primary } },
});

export const workspaceCard = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minHeight: 56,
  padding: '8px 14px 8px 8px',
  borderRadius: 12,
  backgroundColor: c.surface.secondary,
  boxShadow: insetRing(c.stroke.primary),
});

export const workspaceText = style({ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 });

export const cardTitle = style({ ...text.body.standard, fontWeight: 500, color: c.content.primary });

export const cardSub = style({ ...text.text12.standard, color: c.content.secondary });

export const group = style({ display: 'flex', flexDirection: 'column', gap: 10 });

export const groupRule = style({ height: 1, backgroundColor: c.stroke.primary, margin: '1px 0 0', border: 'none' });

export const grantCard = style({
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 12,
  boxShadow: insetRing(c.stroke.primary),
  overflow: 'hidden',
});

export const grantRow = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minHeight: 48,
  padding: '0 14px 0 12px',
  selectors: { '& + &': { borderTop: `1px solid ${c.stroke.primary}` } },
});
