// Record Emails tab (F README §2.2; D README §2.9): 52 px header row, 86 px thread rows (32 px sender avatar, subject
// 14/600, grey 12 px participants and snippet lines), the Filters and Manage access popovers.
import { scales, text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const tab = style({ display: 'flex', flexDirection: 'column', minWidth: 0 });

export const header = style({
  boxSizing: 'border-box',
  height: 52,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '12px 20px',
});

export const title = style({
  ...text.heading.small,
  fontWeight: 500,
  color: c.content.primary,
  margin: 0,
  whiteSpace: 'nowrap',
});

export const headerActions = style({ display: 'flex', alignItems: 'center', gap: 8 });

export const filtersButton = style({ position: 'relative' });

export const filtersDot = style({
  position: 'absolute',
  top: 3,
  right: 3,
  width: 8,
  height: 8,
  borderRadius: '50%',
  backgroundColor: c.content.accent,
  boxShadow: `0 0 0 2px ${c.surface.primary}`,
});

// ---- rows ----------------------------------------------------------------------------------------------------------

export const rows = style({ display: 'flex', flexDirection: 'column' });

export const row = style({
  boxSizing: 'border-box',
  position: 'relative',
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  width: '100%',
  height: 86,
  padding: '14px 20px 0',
  borderBottom: `1px solid ${c.stroke.primary}`,
  textAlign: 'left',
  color: c.content.primary,
  cursor: 'pointer',
  outline: 'none',
  transition: `background-color ${scales.duration.comfortable}ms ease`,
  selectors: {
    '&:hover': { backgroundColor: c.surface.primaryHover },
    '&:focus-visible': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
  },
});

export const avatarCol = style({ flex: 'none', width: 32, height: 32 });

export const body = style({ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 });

export const line = style({ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, height: 20 });

export const subject = style({
  flex: 1,
  minWidth: 0,
  ...text.body.standard,
  fontWeight: 600,
  color: c.content.primary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  selectors: { '&[data-private]': { fontWeight: 400, fontStyle: 'italic', color: c.content.tertiary } },
});

export const meta = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  ...text.text12.standard,
  color: c.content.secondary,
  whiteSpace: 'nowrap',
});

export const via = style({ display: 'inline-flex', alignItems: 'center', gap: 4 });

export const participants = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
  height: 16,
  ...text.text12.standard,
  fontWeight: 400,
  color: c.content.secondary,
});

export const participantNames = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const more = style({ flex: 'none', color: c.content.tertiary });

export const snippet = style({
  height: 20,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  ...text.body.standard,
  fontWeight: 400,
  color: c.content.secondary,
});

export const snippetText = style({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

export const attach = style({ flex: 'none', color: c.content.tertiary });

export const requestChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 20,
  padding: '0 6px',
  borderRadius: 7,
  border: 'none',
  backgroundColor: c.surface.tint,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primaryTransparent}`,
  ...text.text12.standard,
  color: c.content.secondary,
  cursor: 'pointer',
  selectors: { '&:hover': { backgroundColor: c.surface.tintStrong, color: c.content.primary } },
});

export const skeletonRow = style({
  boxSizing: 'border-box',
  display: 'flex',
  gap: 12,
  height: 86,
  padding: '14px 20px 0',
  borderBottom: `1px solid ${c.stroke.primary}`,
});
export const skeletonBody = style({ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 2 });

export const empty = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  padding: '96px 20px 40px',
});
export const emptyTitle = style({ ...text.body.standard, fontWeight: 600, color: c.content.primary, marginTop: 40 });
export const emptyText = style({ ...text.body.standard, color: c.content.secondary, maxWidth: 420 });
export const loadingRow = style({ display: 'flex', justifyContent: 'center', padding: 16 });

// ---- popovers: Filters and Manage access ---------------------------------------------------------------------------

export const filterPanel = style({ boxSizing: 'border-box', width: 260, display: 'flex', flexDirection: 'column' });
export const filterHead = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 8px 4px 12px',
  ...text.body.standard,
  fontWeight: 500,
  color: c.content.primary,
});
export const filterItem = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '6px 12px 8px',
  ...text.body.standard,
  color: c.content.primary,
});

export const accessPanel = style({
  boxSizing: 'border-box',
  width: 340,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 12,
});
export const accessTitle = style({ ...text.body.standard, fontWeight: 600, color: c.content.primary });
export const accessSection = style({
  ...text.text12.standard,
  fontWeight: 500,
  color: c.content.secondary,
});
export const accessRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 32,
  minWidth: 0,
  ...text.body.standard,
  color: c.content.primary,
});
export const accessName = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const accessLevel = style({ flex: 'none', ...text.text12.standard, color: c.content.secondary });
export const accessHint = style({ ...text.text12.standard, fontWeight: 400, color: c.content.secondary });

export const userSearch = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  boxSizing: 'border-box',
  height: 28,
  padding: '0 8px',
  borderRadius: 8,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
  color: c.content.tertiary,
  selectors: { '&:focus-within': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` } },
});
export const userSearchInput = style({
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: c.content.primary,
  ...text.body.standard,
  fontWeight: 400,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});
export const userList = style({
  display: 'flex',
  flexDirection: 'column',
  maxHeight: 148,
  overflowY: 'auto',
  padding: 4,
  borderRadius: 8,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
});
export const userOption = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 32,
  padding: '0 8px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  textAlign: 'left',
  ...text.body.standard,
  color: c.content.primary,
  cursor: 'pointer',
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHover } },
});
export const userOptionEmail = style({ ...text.text12.standard, fontWeight: 400, color: c.content.tertiary });
export const pickedChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 22,
  padding: '0 4px 0 6px',
  borderRadius: 7,
  backgroundColor: c.surface.tint,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primaryTransparent}`,
  ...text.body.standard,
});
export const linkField = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
});
export const linkInput = style({
  flex: 1,
  minWidth: 0,
  boxSizing: 'border-box',
  height: 28,
  padding: '0 8px',
  borderRadius: 8,
  border: 'none',
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  backgroundColor: c.surface.secondary,
  color: c.content.secondary,
  ...text.text12.standard,
  fontWeight: 400,
  textOverflow: 'ellipsis',
});
