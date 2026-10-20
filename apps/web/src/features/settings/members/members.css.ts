// Members table, invite dialog and member detail.
import { insetRing, text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';
import { dialogBody } from '../admin/admin.css';

const c = vars.color;

/** Members table columns: User · Role · Teams · actions. */
export const membersGrid = style({
  gridTemplateColumns: 'minmax(0, 1fr) 128px minmax(0, 200px) 40px',
  paddingInline: '15px 12px',
  columnGap: 8,
});

/** Read-only members page (no actions column). */
export const readOnlyGrid = style({
  gridTemplateColumns: 'minmax(0, 1fr) 128px minmax(0, 220px)',
  paddingInline: '15px 12px',
  columnGap: 8,
});

export const userCell = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });

export const userName = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
  flexShrink: 1,
});

export const userEmail = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
  color: c.content.tertiary,
  flexShrink: 2,
});

export const you = style({ color: c.content.tertiary, flex: 'none' });

export const roleChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  height: 20,
  padding: '0 6px',
  borderRadius: 6,
  backgroundColor: c.surface.tint,
  color: c.content.secondary,
  ...text.text12.standard,
});

export const roleAdmin = style({
  backgroundColor: c.utilities.surface.purple,
  color: c.utilities.content.onPurpleSubtle,
});

export const roleSuspended = style({
  backgroundColor: c.surface.critical,
  color: c.content.onCriticalSubtle,
});

export const pendingAvatar = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  borderRadius: '50%',
  backgroundColor: c.surface.tint,
  color: c.content.tertiary,
  ...text.text11.small,
  flex: 'none',
});

// ---- invite dialog -------------------------------------------------------------------------------------------

export const fieldLabel = style({
  display: 'block',
  ...text.text12.standard,
  color: c.content.tertiary,
  paddingLeft: 4,
  marginBottom: 4,
});

/** Invite dialog body: 12 px between fields (the invite modal is tighter than the settings dialogs). */
export const inviteBody = style([dialogBody, { gap: 12, padding: '14px 16px 24px' }]);

export const optionalHint = style({ color: c.content.tertiary, marginLeft: 4 });

export const emailBox = style({
  boxSizing: 'border-box',
  display: 'flex',
  flexWrap: 'wrap',
  alignContent: 'flex-start',
  alignItems: 'flex-start',
  gap: 4,
  minHeight: 100,
  padding: '6px 10px',
  borderRadius: 9,
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.primaryTransparent),
  cursor: 'text',
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&:focus-within': { boxShadow: insetRing(c.stroke.accent), backgroundColor: c.surface.primary },
    '&[data-invalid]': { boxShadow: insetRing(c.stroke.critical) },
  },
});

export const emailChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  height: 24,
  padding: '0 4px 0 8px',
  borderRadius: 6,
  backgroundColor: c.surface.tint,
  color: c.content.primary,
  ...text.body.standard,
  selectors: { '&[data-invalid]': { backgroundColor: c.surface.critical, color: c.content.onCriticalSubtle } },
});

export const chipRemove = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  padding: 0,
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&[data-hovered]': { backgroundColor: c.interactive.ghostHover },
    '&[data-focus-visible]': { boxShadow: insetRing(c.stroke.accent) },
  },
});

export const emailInput = style({
  flex: 1,
  minWidth: 160,
  height: 24,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  ...text.body.standard,
  color: c.content.primary,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});

export const roleOption = style({ ...text.body.standard, color: c.content.primary });

export const roleDetail = style({ color: c.content.secondary });

export const teamTrigger = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  width: '100%',
  minHeight: 34,
  padding: '4px 8px 4px 10px',
  border: 'none',
  borderRadius: 9,
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.primaryTransparent),
  ...text.body.standard,
  color: c.content.primary,
  textAlign: 'left',
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&[data-hovered]': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&[data-focus-visible], &[aria-expanded="true"]': { boxShadow: insetRing(c.stroke.accent) },
  },
});

export const teamPlaceholder = style({ flex: 1, color: c.content.tertiary });

export const teamChips = style({ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1, minWidth: 0 });

export const teamPanel = style({ outline: 'none', display: 'flex', flexDirection: 'column' });

export const teamSearch = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 36,
  padding: '0 8px',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
  color: c.content.tertiary,
});

export const teamSearchInput = style({
  flex: 1,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  ...text.body.standard,
  color: c.content.primary,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});

export const teamList = style({
  maxHeight: 240,
  overflowY: 'auto',
  padding: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
});

export const errorLine = style({ ...text.text12.standard, color: c.content.critical, margin: '6px 0 0 4px' });

// ---- member detail -------------------------------------------------------------------------------------------

export const detailHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginTop: 16,
  paddingBottom: 24,
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
});

export const detailNameRow = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });

export const detailEmail = style({ ...text.body.standard, color: c.content.secondary, margin: 0 });

export const detailSections = style({ display: 'flex', flexDirection: 'column', gap: 40, paddingTop: 24 });

export const upsell = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 24,
  padding: 16,
  borderRadius: 16,
  backgroundColor: c.surface.secondary,
  boxShadow: insetRing(c.stroke.primary),
});
