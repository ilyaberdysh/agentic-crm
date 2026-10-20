// Settings → Email and calendar (workspace): the protected and blocked contacts table and the suppression list.
import { insetRing, text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const toolbar = style({ display: 'flex', alignItems: 'center', gap: 8 });

export const table = style({
  boxSizing: 'border-box',
  width: '100%',
  borderRadius: 12,
  boxShadow: insetRing(c.stroke.primary),
  backgroundColor: c.surface.primary,
  overflow: 'hidden',
});

const columns = 'minmax(0, 1.7fr) minmax(150px, 1fr) 110px minmax(100px, 0.8fr) 40px';

export const head = style({
  display: 'grid',
  gridTemplateColumns: columns,
  alignItems: 'center',
  minHeight: 36,
  padding: '0 8px 0 12px',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
  ...text.text12.standard,
  color: c.content.secondary,
});

export const headCell = style({ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, whiteSpace: 'nowrap' });

export const headIcon = style({ color: c.content.tertiary, flex: 'none' });

export const row = style({
  display: 'grid',
  gridTemplateColumns: columns,
  alignItems: 'center',
  minHeight: 44,
  boxSizing: 'border-box',
  padding: '0 8px 0 12px',
  ...text.body.standard,
  color: c.content.primary,
  selectors: {
    '& + &': { borderTop: `1px solid ${c.stroke.primary}` },
    '&:hover': { backgroundColor: c.interactive.ghostHoverSubtle },
  },
});

export const cell = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });

export const cellText = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });

export const muted = style({ color: c.content.secondary });

export const mutedLight = style({ color: c.content.tertiary });

export const rowActions = style({ display: 'flex', justifyContent: 'flex-end' });

export const noRows = style({
  padding: '24px 16px',
  textAlign: 'center',
  ...text.body.standard,
  color: c.content.tertiary,
});

export const enforcementStatic = style({ display: 'inline-flex', alignItems: 'center', gap: 8 });

export const readOnlyBanner = style({ marginBottom: 0 });
