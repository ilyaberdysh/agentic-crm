// Settings → Ask AI (ask-agentic §11): bordered setting rows (label + helper left, select right), the credits table,
// the usage stat strip with its progress bar, and the custom-context editor.
import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const group = style({ display: 'flex', flexDirection: 'column', gap: 8 });
export const card = style({
  boxSizing: 'border-box',
  borderRadius: 12,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  backgroundColor: c.surface.primary,
});
export const settingRow = style([
  card,
  {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    padding: '12px 16px',
    minHeight: 56,
  },
]);
export const settingText = style({ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 });
export const settingLabel = style({ ...text.body.standard, fontWeight: 500, color: c.content.primary });
export const settingHelp = style({ ...text.text12.standard, fontWeight: 400, color: c.content.secondary });

// ---- credits table (personal) -----------------------------------------------------------------------------------------

export const kv = style([card, { display: 'flex', flexDirection: 'column' }]);
export const kvRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  minHeight: 44,
  padding: '0 16px',
  ...text.body.standard,
  fontWeight: 400,
  color: c.content.primary,
  selectors: { '& + &': { borderTop: `1px solid ${c.stroke.primary}` } },
});
export const kvLabel = style({ display: 'inline-flex', alignItems: 'baseline', gap: 8 });
export const kvStrong = style({ fontWeight: 500 });
export const kvNote = style({ ...text.text12.standard, color: c.content.secondary, fontWeight: 400 });
export const kvValue = style({ fontVariantNumeric: 'tabular-nums' });

// ---- usage (workspace) ---------------------------------------------------------------------------------------------------

export const stats = style([
  card,
  { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16, padding: '14px 16px' },
]);
export const stat = style({ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 });
export const statLabel = style({ ...text.text12.standard, fontWeight: 400, color: c.content.secondary });
export const statValueRow = style({ display: 'flex', alignItems: 'baseline', gap: 6 });
export const statValue = style({
  fontSize: 20,
  lineHeight: '24px',
  fontWeight: 600,
  letterSpacing: '-0.4px',
  color: c.content.primary,
  fontVariantNumeric: 'tabular-nums',
});
export const statSecondary = style({ ...text.text12.standard, fontWeight: 400, color: c.content.secondary });
export const statTotal = style({ ...text.body.standard, fontWeight: 400, color: c.content.secondary });

export const poolHead = style({ display: 'flex', flexDirection: 'column', gap: 2, padding: '12px 16px 0' });
export const poolBar = style({
  margin: '12px 12px 0',
  height: 28,
  borderRadius: 8,
  backgroundColor: c.surface.tertiary,
  overflow: 'hidden',
});
export const poolFill = style({
  height: '100%',
  backgroundColor: c.interactive.primary,
  borderRadius: 8,
  transition: 'width 240ms ease',
});
export const poolFoot = style({
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  padding: '10px 16px 12px',
  ...text.body.standard,
  fontWeight: 400,
  color: c.content.secondary,
});
export const poolLimit = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  minHeight: 44,
  padding: '0 16px',
  borderTop: `1px solid ${c.stroke.primary}`,
  ...text.body.standard,
  fontWeight: 400,
  color: c.content.primary,
});
export const limitInput = style({
  boxSizing: 'border-box',
  width: 120,
  height: 28,
  padding: '0 8px',
  border: 'none',
  outline: 'none',
  borderRadius: 8,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  backgroundColor: c.surface.primary,
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  fontWeight: 400,
  textAlign: 'right',
  selectors: { '&:focus': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` } },
});

export const members = style([card, { display: 'flex', flexDirection: 'column' }]);
export const membersHead = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 160px',
  alignItems: 'center',
  gap: 12,
  minHeight: 40,
  padding: '0 16px',
  ...text.text12.standard,
  fontWeight: 400,
  color: c.content.secondary,
  borderBottom: `1px solid ${c.stroke.primary}`,
});
export const memberRow = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 160px',
  alignItems: 'center',
  gap: 12,
  minHeight: 40,
  padding: '0 16px',
  ...text.body.standard,
  fontWeight: 400,
  color: c.content.primary,
  selectors: { '& + &': { borderTop: `1px solid ${c.stroke.primary}` } },
});
export const memberName = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });
export const memberEmail = style({
  color: c.content.secondary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

// ---- custom context -------------------------------------------------------------------------------------------------------------

export const contextArea = style({
  boxSizing: 'border-box',
  width: '100%',
  minHeight: 112,
  padding: '10px 12px',
  border: 'none',
  outline: 'none',
  resize: 'vertical',
  borderRadius: 12,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  backgroundColor: c.surface.primary,
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  fontWeight: 400,
  selectors: {
    '&:focus': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
    '&::placeholder': { color: c.content.tertiary },
  },
});
export const counter = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  ...text.text12.standard,
  fontWeight: 400,
  color: c.content.secondary,
});
export const savedNote = style({ marginLeft: 'auto', color: c.content.tertiary });

// ---- prompts tab ---------------------------------------------------------------------------------------------------------------

export const promptsHead = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  paddingBottom: 16,
  borderBottom: `1px solid ${c.stroke.primary}`,
  marginBottom: 24,
});
export const promptsGrid = style({ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 });
export const promptsSection = style({ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 });
export const sectionHeading = style({ ...text.heading.small, color: c.content.primary, margin: 0 });
export const empty = style({ ...text.body.standard, fontWeight: 400, color: c.content.secondary, padding: '24px 0' });
