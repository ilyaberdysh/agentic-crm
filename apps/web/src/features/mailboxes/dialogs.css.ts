// Dialogs of the email settings: the token list dialog (blocklist, protected contacts, suppression), Add person and
// the connect-test-account dialog.
import { insetRing, text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const body = style({ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 });

export const hint = style({ ...text.text12.standard, color: c.content.tertiary, margin: 0 });

export const problems = style({ display: 'flex', flexDirection: 'column', gap: 6 });

export const invalidRow = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  ...text.text12.standard,
  color: c.content.critical,
});

export const invalidChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  height: 20,
  padding: '0 6px',
  borderRadius: 6,
  backgroundColor: c.surface.critical,
  color: c.content.onCriticalSubtle,
  boxShadow: insetRing(c.stroke.critical),
  ...text.text12.standard,
});

export const duplicateRow = style({ ...text.text12.standard, color: c.content.warning, margin: 0 });

export const memberOption = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });

export const memberOptionText = style({ display: 'flex', flexDirection: 'column', minWidth: 0 });

export const memberEmail = style({ ...text.text12.standard, color: c.content.tertiary });
