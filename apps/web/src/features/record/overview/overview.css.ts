// Overview tab (b): padding 24 20, sections 32 apart; Highlights grid
// `repeat(auto-fill, minmax(max(168px, (100% − 2×8px)/3), 1fr))` gap 8, cards radius 12 ~86 px (padding 10 12,
// label 12/16 + type icon, value at the bottom, option-tinted for select / status widgets); section headers with
// count, "View all" and "+".
import { scales, text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const overview = style({ display: 'flex', flexDirection: 'column', gap: 32, padding: '24px 20px' });

export const section = style({ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 });

export const sectionHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  minHeight: 20,
  paddingLeft: 12,
});

export const sectionTitle = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  ...text.body.standard,
  fontWeight: 500,
  color: c.content.secondary,
  margin: 0,
});

export const sectionActions = style({ display: 'flex', alignItems: 'center', gap: 4 });

export const count = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 14,
  height: 14,
  padding: '0 3px',
  borderRadius: 4,
  fontSize: 10,
  lineHeight: '14px',
  fontWeight: 500,
  color: c.content.secondary,
  backgroundColor: c.surface.tint,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primaryTransparent}`,
});

export const viewAll = style({
  height: 20,
  padding: '2px 6px',
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  ...text.text12.standard,
  color: c.content.ghost,
  cursor: 'pointer',
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHover, color: c.content.primary },
    '&:focus-visible': { outline: `1px solid ${c.stroke.accent}` },
  },
});

// ---- highlights ------------------------------------------------------------------------------------------------

export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(max(168px, calc((100% - 16px) / 3)), 1fr))',
  gap: 8,
});

export const card = style({
  boxSizing: 'border-box',
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  gap: 8,
  minHeight: 86,
  minWidth: 0,
  padding: '10px 12px',
  borderRadius: 12,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
  transition: `box-shadow ${scales.duration.comfortable}ms ease`,
});

export const cardTop = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
});

export const cardLabel = style({
  ...text.text12.standard,
  color: c.content.secondary,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
});

export const cardIcon = style({ flex: 'none', color: c.content.secondary });

export const cardValue = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
  ...text.body.standard,
  fontWeight: 500,
  color: c.content.primary,
  overflow: 'hidden',
});

export const cardValueLine = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
});

export const cardEmpty = style({ ...text.body.standard, color: c.content.tertiary });

export const cardSub = style({ ...text.text12.standard, color: c.content.secondary });
export const cardSubWarning = style({ ...text.text12.standard, fontWeight: 400, color: c.content.warning });
export const cardSubCritical = style({ ...text.text12.standard, fontWeight: 400, color: c.content.critical });

export const truncate = style({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

export const stageBar = style({ display: 'flex', gap: 4, height: 4, marginTop: 8 });

/** Status widgets: the stage and its bar sit under the label instead of at the bottom (evidence D-deal-overview). */
export const statusCard = style({ justifyContent: 'flex-start', gap: 9 });
export const stageSegment = style({ flex: 1, borderRadius: 2 });

// ---- rows (activity preview, notes, tasks, emails) ---------------------------------------------------------------

export const rows = style({
  display: 'flex',
  flexDirection: 'column',
  padding: 4,
  borderRadius: 12,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
});

export const row = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minHeight: 31,
  padding: '5px 8px',
  borderRadius: 8,
  ...text.body.standard,
  color: c.content.secondary,
  minWidth: 0,
  transition: `background-color ${scales.duration.comfortable}ms ease`,
  selectors: { '&[data-interactive]:hover': { backgroundColor: c.surface.primaryHover, cursor: 'pointer' } },
});

export const rowSentence = style({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
});

export const rowTitle = style({ fontWeight: 500, color: c.content.primary, whiteSpace: 'nowrap' });
export const rowPreview = style({
  color: c.content.secondary,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const rowTime = style({
  flex: 'none',
  ...text.text12.standard,
  color: c.content.secondary,
  whiteSpace: 'nowrap',
});

export const taskCheck = style({
  flex: 'none',
  width: 16,
  height: 16,
  padding: 0,
  boxSizing: 'border-box',
  borderRadius: '50%',
  border: `1px solid ${c.stroke.secondaryTransparent}`,
  backgroundColor: c.surface.primary,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: c.content.onAccent,
  cursor: 'pointer',
  selectors: {
    '&:hover': { backgroundColor: c.interactive.secondaryHover },
    '&[data-done]': { backgroundColor: c.surface.accent, borderColor: c.stroke.accent },
  },
});

export const rowMeta = style({ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' });

export const due = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  ...text.text12.standard,
  color: c.content.warning,
  whiteSpace: 'nowrap',
  selectors: { '&[data-overdue]': { color: c.content.critical } },
});

export const skeletonRow = style({ display: 'flex', alignItems: 'center', gap: 12, height: 31, padding: '0 8px' });
