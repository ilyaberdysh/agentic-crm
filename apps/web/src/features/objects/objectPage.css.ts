// Object page frame (C1 README §2.1; layout.md §3–4): page header 48 + 1, view bar 48 + 1 (padding 0 12, gap 12
// between groups, 8 inside), sort/filter bar 48 + 1, then the table filling the rest.
import { vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const page = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: c.surface.primary,
});

const bar = style({
  flex: 'none',
  boxSizing: 'border-box',
  height: 49,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '0 12px',
  borderBottom: `1px solid ${c.stroke.primary}`,
});

export const viewBar = bar;

export const filterBar = style([bar, { overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none' }]);

export const group = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });

export const headerActions = style({ display: 'flex', alignItems: 'center', gap: 8 });

export const headerGroup = style({ display: 'flex', alignItems: 'center', gap: 4 });

export const divider = style({ width: 1, height: 16, backgroundColor: c.stroke.secondary });

export const placeholderBody = style({
  flex: 1,
  minHeight: 0,
  display: 'grid',
  placeItems: 'center',
  padding: 24,
});

export const toolbarSkeleton = style({ display: 'flex', alignItems: 'center', gap: 8 });

/** Filter bar + table beside the view-level comments panel (E README §2.8 "Object/list views"). */
export const contentRow = style({ flex: 1, minHeight: 0, display: 'flex' });
export const contentColumn = style({ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' });
