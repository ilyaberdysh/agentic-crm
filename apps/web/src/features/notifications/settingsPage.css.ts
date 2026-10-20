// Settings → Notifications (evidence/B/settings-notifications.png): bordered radius-10 blocks; the table's channel
// columns are 84 px wide with the checkboxes centred.
import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const loading = style({ display: 'flex', justifyContent: 'center', padding: 48, color: c.content.tertiary });

const bordered = {
  boxSizing: 'border-box',
  borderRadius: 10,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
} as const;

export const card = style({
  ...bordered,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '7px 14px 7px 16px',
});

export const cardText = style({ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 });

export const rowTitle = style({ ...text.body.standard, color: c.content.primary });
export const rowDescription = style({ ...text.text12.standard, fontWeight: 400, color: c.content.secondary });

export const table = style({ ...bordered, display: 'flex', flexDirection: 'column', overflow: 'hidden' });

export const tableRow = style({
  display: 'flex',
  alignItems: 'center',
  minHeight: 53,
  boxSizing: 'border-box',
  paddingRight: 8,
  selectors: { '& + &': { boxShadow: `inset 0 1px 0 ${c.stroke.primary}` } },
});

export const tableHead = style({ minHeight: 44 });

export const headLabel = style({
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 16px',
  ...text.text12.standard,
  fontSize: 13,
  color: c.content.secondary,
});

export const headChannel = style({
  flex: 'none',
  width: 84,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  ...text.body.standard,
  color: c.content.primary,
});

export const rowText = style({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  padding: '8px 16px 8px 16px',
});

export const channelCell = style({ flex: 'none', width: 84, display: 'flex', justifyContent: 'center' });
