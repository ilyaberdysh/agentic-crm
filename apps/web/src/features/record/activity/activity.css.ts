// Activity feed (D README §3.8; evidence D-project-activity*): header 52 px, "Upcoming" (amber) and period headers,
// event rows on a thread line (dashed for upcoming) with 16 px actor avatars, sentence + relative time, note and
// task cards, the "{n} automation events" toggle, the attribute-change popover table and the Filters menu.
import { scales, text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style } from '@vanilla-extract/css';

const c = vars.color;

export const feed = style({ padding: '0 24px 32px 20px', display: 'flex', flexDirection: 'column' });

export const sectionTitle = style({
  ...text.body.standard,
  fontWeight: 600,
  color: c.content.primary,
  margin: 0,
  padding: '14px 0 10px',
});

export const upcomingTitle = style([sectionTitle, { color: c.content.warning }]);

export const group = style({ display: 'flex', flexDirection: 'column', marginBottom: 8 });

export const row = style({ position: 'relative', display: 'flex', gap: 9, minWidth: 0 });

/** Avatar column with the thread line running to the next row. */
export const gutter = style({
  position: 'relative',
  flex: 'none',
  width: 16,
  display: 'flex',
  justifyContent: 'center',
  paddingTop: 12,
  selectors: {
    '&::after': {
      content: '""',
      position: 'absolute',
      top: 32,
      bottom: -8,
      left: 7.5,
      width: 1,
      backgroundColor: c.stroke.primary,
    },
    '[data-last] > &::after': { display: 'none' },
    '[data-upcoming] &::after': {
      backgroundColor: 'transparent',
      backgroundImage: `linear-gradient(${c.stroke.secondary} 50%, transparent 50%)`,
      backgroundSize: '1px 6px',
    },
  },
});

export const main = style({ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' });

export const line = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minHeight: 39,
  ...text.body.standard,
  color: c.content.secondary,
});

export const sentence = style({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'nowrap',
  gap: 4,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
});

export const strong = style({ fontWeight: 500, color: c.content.primary, whiteSpace: 'nowrap' });

export const valueChip = style({ display: 'inline-flex', minWidth: 0, maxWidth: 320, overflow: 'hidden' });

export const time = style({
  flex: 'none',
  ...text.text12.standard,
  color: c.content.secondary,
  whiteSpace: 'nowrap',
  selectors: { '[data-upcoming] &': { color: c.content.warning } },
});

export const countButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  height: 22,
  padding: '0 4px',
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  ...text.body.standard,
  fontWeight: 500,
  color: c.content.primary,
  cursor: 'pointer',
  selectors: {
    '&:hover, &[data-pressed], &[aria-expanded="true"]': { backgroundColor: c.interactive.ghostHover },
    '&:focus-visible': { outline: `1px solid ${c.stroke.accent}` },
  },
});

export const actorTile = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  borderRadius: 4,
  flex: 'none',
  backgroundColor: c.utilities.surface.purple,
  color: c.content.onAccent,
  fontSize: 10,
  fontWeight: 600,
});

// ---- cards under an event ---------------------------------------------------------------------------------------

export const card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginBottom: 8,
  padding: '10px 12px',
  borderRadius: 12,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
  minWidth: 0,
  transition: `background-color ${scales.duration.comfortable}ms ease`,
  selectors: {
    '&[data-interactive]': { cursor: 'pointer' },
    '&[data-interactive]:hover': { backgroundColor: c.surface.primaryHover },
  },
});

export const cardRow = style({ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, minHeight: 20 });
export const cardTitle = style({
  ...text.body.standard,
  fontWeight: 500,
  color: c.content.primary,
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const cardPreview = style({
  ...text.text12.standard,
  color: c.content.tertiary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const cardMeta = style({ display: 'flex', alignItems: 'center', gap: 10, flex: 'none', minWidth: 0 });

export const taskCheck = style({
  flex: 'none',
  width: 16,
  height: 16,
  boxSizing: 'border-box',
  borderRadius: '50%',
  border: `1px solid ${c.stroke.secondaryTransparent}`,
  backgroundColor: c.surface.primary,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: c.content.onAccent,
  selectors: { '&[data-done]': { backgroundColor: c.surface.accent, borderColor: c.stroke.accent } },
});

export const due = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  ...text.text12.standard,
  color: c.content.warning,
  whiteSpace: 'nowrap',
  selectors: { '&[data-overdue]': { color: c.content.critical } },
});

// ---- automation group ----------------------------------------------------------------------------------------

export const groupToggle = style({
  alignSelf: 'flex-start',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  margin: '4px 0 10px -2px',
  padding: '0 8px 0 6px',
  borderRadius: 8,
  border: 'none',
  backgroundColor: c.surface.tint,
  ...text.body.standard,
  fontWeight: 500,
  color: c.content.primary,
  cursor: 'pointer',
  transition: `background-color ${scales.duration.comfortable}ms ease`,
  selectors: {
    '&:hover': { backgroundColor: c.surface.tintStrong },
    '&:focus-visible': { outline: `1px solid ${c.stroke.accent}` },
  },
});

export const groupChevron = style({
  transition: `transform ${scales.duration.breezy}ms ease`,
  transform: 'rotate(-90deg)',
  selectors: { '&[data-open]': { transform: 'none' } },
});

export const showMore = style({
  alignSelf: 'flex-start',
  height: 24,
  margin: '0 0 8px 25px',
  padding: '0 6px',
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  ...text.text12.standard,
  color: c.content.secondary,
  cursor: 'pointer',
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHover, color: c.content.primary } },
});

export const loadingRow = style({ display: 'flex', justifyContent: 'center', padding: 12, color: c.content.tertiary });

export const empty = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  padding: '64px 20px',
  textAlign: 'center',
});
export const emptyTitle = style({ ...text.body.standard, fontWeight: 600, color: c.content.primary });
export const emptyText = style({ ...text.body.standard, color: c.content.secondary });

// ---- header ------------------------------------------------------------------------------------------------------

export const filtersButton = style({ position: 'relative' });
export const filtersDot = style({
  position: 'absolute',
  top: -2,
  right: -2,
  width: 8,
  height: 8,
  borderRadius: '50%',
  backgroundColor: c.surface.accent,
  boxShadow: `0 0 0 2px ${c.surface.primary}`,
  pointerEvents: 'none',
});
export const headerDivider = style({ width: 1, height: 16, backgroundColor: c.stroke.secondary });

export const filtersPanel = style({ width: 240, padding: 4, display: 'flex', flexDirection: 'column', gap: 1 });
export const filtersHeading = style({ ...text.text12.standard, color: c.content.secondary, padding: '4px 8px 2px' });
export const filterItem = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  padding: '6px 8px',
  borderRadius: 8,
  ...text.body.standard,
  color: c.content.primary,
  cursor: 'pointer',
  selectors: { '&:hover': { backgroundColor: c.surface.primaryHover } },
});
export const filterLabel = style({ flex: 1 });
// The switch track renders first; show it at the end of the row.
globalStyle(`${filterItem} > span[aria-hidden="true"]`, { order: 3 });

// ---- "changed n attributes" popover --------------------------------------------------------------------------

export const changesTable = style({ width: 460, display: 'flex', flexDirection: 'column' });
export const changesHead = style({
  display: 'grid',
  gridTemplateColumns: '140px 1fr',
  gap: 8,
  padding: '8px 12px',
  borderBottom: `1px solid ${c.stroke.primary}`,
  ...text.text12.standard,
  color: c.content.secondary,
});
export const changesRow = style({
  display: 'grid',
  gridTemplateColumns: '140px 1fr',
  gap: 8,
  alignItems: 'center',
  minHeight: 36,
  padding: '0 12px',
  ...text.body.standard,
  color: c.content.primary,
  selectors: { '& + &': { borderTop: `1px solid ${c.stroke.primary}` } },
});
export const changesAttr = style({ display: 'flex', alignItems: 'center', gap: 6, color: c.content.secondary });
