// Record page Lists section (raw C2 s47-record-after, s48-*): 16 px side padding, one hairline card per entry
// (radius 12, padding 12 14 8), header = 18 px emoji + list name (medium) and the "added" time at the right, which
// hover replaces with Comment and ⋮; attribute rows reuse the details panel rows.
import { text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style } from '@vanilla-extract/css';

const c = vars.color;

export const count = style({ color: 'inherit', marginLeft: -1 });

export const headerActions = style({ display: 'inline-flex', alignItems: 'center', gap: 2 });

export const switchRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  width: '100%',
});

export const cards = style({ padding: '4px 12px 14px', display: 'flex', flexDirection: 'column', gap: 8 });

export const card = style({
  borderRadius: 12,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  backgroundColor: c.surface.secondary,
  padding: '10px 12px 8px',
});

export const cardHeader = style({ display: 'flex', alignItems: 'center', gap: 8, height: 24, position: 'relative' });

export const cardTitle = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  flex: 1,
  color: c.content.primary,
  textDecoration: 'none',
  ...text.body.standard,
  fontWeight: 500,
});

export const cardTitleText = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

export const cardTime = style({
  flex: 'none',
  ...text.text12.standard,
  color: c.content.tertiary,
  selectors: {
    [`${card}:hover &, &[data-hidden]`]: { visibility: 'hidden' },
  },
});

export const cardActions = style({
  position: 'absolute',
  right: 0,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  opacity: 0,
  selectors: {
    [`${card}:hover &, ${card}:focus-within &, &[data-open]`]: { opacity: 1 },
  },
});

export const cardBody = style({ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 6 });

export const showMore = style({ marginTop: 6 });

globalStyle(`${cardBody}[data-hide-names] [data-testid="attribute-row"]`, { gridTemplateColumns: 'minmax(0, 1fr)' });
globalStyle(`${cardBody}[data-hide-names] [data-testid="attribute-row"] > :first-child`, { display: 'none' });
