// Developers → access tokens and webhooks (J workspace-admin §6; raw s73, s74).
import { insetRing, text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';
import { formDialogBody } from '../admin/admin.css';

const c = vars.color;

export const cards = style({ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 });

export const tokenCard = style({
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 12,
  borderRadius: 12,
  boxShadow: insetRing(c.stroke.primary),
  backgroundColor: c.surface.primary,
});

export const cardHeader = style({ display: 'flex', alignItems: 'center', gap: 8, minHeight: 28, paddingLeft: 3 });

export const cardTitle = style({
  ...text.body.standard,
  color: c.content.primary,
  margin: 0,
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const cardMeta = style({ ...text.text12.standard, color: c.content.secondary, margin: 0 });

export const secretRow = style({ display: 'flex', alignItems: 'center', gap: 8 });

export const secretBox = style({
  boxSizing: 'border-box',
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 32,
  padding: '0 8px 0 10px',
  borderRadius: 9,
  backgroundColor: c.surface.secondary,
  boxShadow: insetRing(c.stroke.primaryTransparent),
});

export const secretText = style({
  ...text.body.code,
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: c.content.primary,
  userSelect: 'all',
});

export const maskedText = style({ letterSpacing: '0.18em', color: c.content.primary });

// ---- scope rows (token dialog) -------------------------------------------------------------------------------------

export const scopeList = style({
  display: 'flex',
  flexDirection: 'column',
  flex: 'none',
  borderRadius: 12,
  boxShadow: insetRing(c.stroke.primary),
});

export const scopeRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '8px 12px 8px 16px',
  minHeight: 40,
  boxSizing: 'content-box',
  selectors: { '& + &': { borderTop: `1px solid ${c.stroke.primary}` } },
});

export const scopeText = style({ display: 'flex', flexDirection: 'column', minWidth: 0 });

export const scopeTitle = style({ ...text.body.standard, color: c.content.primary });

export const scopeDescription = style({ ...text.text12.standard, color: c.content.secondary });

export const dialogBody = formDialogBody;

/** New webhook: the body keeps room for the event list the picker fills (Attio: 190 px between rules). */
export const webhookBody = style([formDialogBody, { minHeight: 190 }]);

export const dialogError = style({ ...text.text12.standard, color: c.content.critical, margin: 0 });

// ---- webhooks --------------------------------------------------------------------------------------------------

export const hookUrl = style({
  ...text.body.standard,
  color: c.content.primary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
});

export const hookHeader = style({ display: 'flex', alignItems: 'center', gap: 8, minHeight: 28, minWidth: 0 });

export const statusPill = style({
  display: 'inline-flex',
  alignItems: 'center',
  height: 20,
  padding: '0 6px',
  borderRadius: 6,
  ...text.text12.standard,
  flex: 'none',
});

export const statusActive = style({
  backgroundColor: c.surface.success,
  color: c.content.onSuccessSubtle,
});

export const statusDegraded = style({
  backgroundColor: c.surface.warning,
  color: c.content.onWarningSubtle,
});

export const statusInactive = style({ backgroundColor: c.surface.tint, color: c.content.secondary });

export const eventChips = style({ display: 'flex', flexWrap: 'wrap', gap: 4 });

export const eventList = style({
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 12,
  boxShadow: insetRing(c.stroke.primary),
});

export const eventRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 36,
  padding: '0 8px 0 12px',
  ...text.body.standard,
  color: c.content.primary,
  selectors: { '& + &': { boxShadow: `inset 0 1px 0 ${c.stroke.primary}` } },
});

export const eventName = style({ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' });

export const eventNote = style({
  ...text.text12.standard,
  color: c.content.tertiary,
  padding: '0 12px 8px 36px',
  margin: 0,
});

export const eventPickerLabel = style({
  display: 'block',
  ...text.text12.standard,
  color: c.content.secondary,
  paddingLeft: 4,
  marginBottom: 6,
});

// ---- deliveries ----------------------------------------------------------------------------------------------------

export const deliveriesGrid = style({
  gridTemplateColumns: '150px minmax(0, 1fr) 110px 72px 72px',
  paddingInline: '15px 12px',
  columnGap: 8,
});

export const payload = style({
  ...text.body.code,
  margin: 0,
  padding: 12,
  maxHeight: 220,
  overflow: 'auto',
  borderRadius: 9,
  backgroundColor: c.surface.secondary,
  boxShadow: insetRing(c.stroke.primary),
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  color: c.content.primary,
});

export const deliveryDetail = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '8px 16px 16px',
  boxShadow: `inset 0 1px 0 ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
});

export const pickerTrigger = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  width: '100%',
  height: 32,
  padding: '0 8px 0 10px',
  border: 'none',
  borderRadius: 9,
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.primaryTransparent),
  ...text.body.standard,
  color: c.content.tertiary,
  textAlign: 'left',
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&[data-hovered]': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&[data-focus-visible], &[aria-expanded="true"]': { boxShadow: insetRing(c.stroke.accent) },
  },
});

export const pickerPlaceholder = style({ flex: 1 });

export const testBadge = style({
  display: 'inline-flex',
  alignItems: 'center',
  height: 16,
  padding: '0 4px',
  borderRadius: 4,
  backgroundColor: c.surface.tint,
  color: c.content.secondary,
  ...text.text11.small,
});
