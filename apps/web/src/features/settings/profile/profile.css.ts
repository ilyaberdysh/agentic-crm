// Profile and workspace general pages (J workspace-admin §1–2): picture row, field grid, time preference selects.
import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const imageRow = style({ display: 'flex', alignItems: 'center', gap: 16 });

export const imageText = style({ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 });

export const imageButtons = style({ display: 'flex', alignItems: 'center', gap: 8 });

export const imageHint = style({ ...text.text12.standard, color: c.content.secondary, margin: 0 });

export const imageError = style({ ...text.text12.standard, color: c.content.critical, margin: 0 });

export const fieldLabel = style({ ...text.text12.standard, color: c.content.secondary, margin: '0 0 6px' });

export const grid = style({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' });

export const stack = style({ display: 'flex', flexDirection: 'column', gap: 24 });

export const hiddenInput = style({ display: 'none' });

export const slugRow = style({ display: 'flex', alignItems: 'flex-end', gap: 8 });

export const slugStatus = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  ...text.text12.standard,
  color: c.content.secondary,
  minHeight: 16,
});
