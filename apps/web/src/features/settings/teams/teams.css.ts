// Teams list, team page and pickers.
import { insetRing, text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

/** Teams table columns: Team · Members · Usage · actions (x 525 / 968 / 1100 / 1253 on the 768 px card). */
export const teamsGrid = style({
  gridTemplateColumns: '1fr 132px 126px 40px',
  paddingInline: '15px 12px',
});

/** Header row of the teams table: 41 px including its rule (the objects tables use 43). */
export const teamsHeader = style({ selectors: { '&&': { minHeight: 41 } } });

/** Team members table: User · Added at · actions. */
export const teamMembersGrid = style({
  gridTemplateColumns: '1fr 160px 40px',
  paddingInline: '15px 12px',
});

/** Usage table: Item · Type. */
export const usageGrid = style({ gridTemplateColumns: '1fr 180px', paddingInline: '15px 12px' });

export const nameCell = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });

export const centerEmpty = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  padding: '48px 24px',
  gap: 4,
});

export const emptyTitle = style({ ...text.body.strong, color: c.content.primary, margin: '12px 0 0' });

export const emptyDescription = style({ ...text.body.standard, color: c.content.secondary, margin: 0 });

export const emptyActions = style({ marginTop: 12 });

// ---- icon picker ---------------------------------------------------------------------------------------------

export const iconButton = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  width: 32,
  height: 32,
  padding: 0,
  border: 'none',
  borderRadius: 9,
  background: c.interactive.ghost,
  boxShadow: insetRing(c.stroke.primaryTransparent),
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&[data-hovered]': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&[data-focus-visible], &[aria-expanded="true"]': { boxShadow: insetRing(c.stroke.accent) },
  },
});

export const iconPanel = style({ outline: 'none', display: 'flex', flexDirection: 'column', gap: 8 });

export const iconGrid = style({ display: 'grid', gridTemplateColumns: 'repeat(6, 32px)', gap: 0 });

export const iconCell = style({
  width: 32,
  height: 32,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: c.content.primary,
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&[data-hovered]': { backgroundColor: c.interactive.ghostHover },
    '&[data-focus-visible]': { boxShadow: insetRing(c.stroke.accent) },
    '&[data-selected]': { boxShadow: insetRing(c.stroke.accent) },
  },
});

export const swatchRow = style({
  display: 'flex',
  gap: 2,
  paddingTop: 8,
  boxShadow: `inset 0 1px 0 ${c.stroke.primary}`,
});

export const swatch = style({
  width: 24,
  height: 24,
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&[data-hovered]': { backgroundColor: c.interactive.ghostHover },
    '&[data-focus-visible]': { boxShadow: insetRing(c.stroke.accent) },
    '&[data-selected]': { boxShadow: insetRing(c.stroke.accent) },
  },
});

// ---- member picker dialog -----------------------------------------------------------------------------------

export const pickerSearch = style({
  display: 'flex',
  alignItems: 'center',
  height: 52,
  padding: '0 16px',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
});

export const pickerSearchInput = style({
  width: '100%',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  ...text.body.large,
  color: c.content.primary,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});

export const pickerList = style({
  boxSizing: 'border-box',
  maxHeight: 320,
  overflowY: 'auto',
  padding: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
});

export const pickerEmpty = style({ ...text.body.standard, color: c.content.tertiary, padding: '16px 8px' });

// ---- team page -----------------------------------------------------------------------------------------------

export const headerActions = style({ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 });
