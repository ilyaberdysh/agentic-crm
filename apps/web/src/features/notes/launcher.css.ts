// "View all templates" picker (evidence E/note-template-picker.png): 364 px popover, search row, template rows, and
// a dark preview card to the left of the hovered row.
import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const picker = style({ outline: 'none' });

export const pickerBody = style({ position: 'relative', display: 'flex', flexDirection: 'column' });

export const searchRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 36,
  padding: '0 12px',
  borderBottom: `1px solid ${c.stroke.primary}`,
});

export const searchIcon = style({ color: c.content.secondary, flex: 'none' });

export const searchInput = style({
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});

export const list = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  padding: 4,
  maxHeight: 280,
  overflowY: 'auto',
});

export const item = style({ width: '100%', margin: 0, padding: '0 8px', height: 32, color: c.content.primary });

export const itemLabel = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

export const empty = style({ ...text.body.standard, color: c.content.tertiary, padding: '6px 8px' });

export const preview = style({
  position: 'absolute',
  right: 'calc(100% + 8px)',
  top: 0,
  width: 312,
  boxSizing: 'border-box',
  padding: 4,
  borderRadius: 12,
  backgroundColor: c.surface.floating,
  boxShadow: vars.elevation.e2,
});

export const previewPaper = style({
  boxSizing: 'border-box',
  height: 136,
  padding: '8px 10px',
  overflow: 'hidden',
  borderRadius: 8,
  backgroundColor: c.surface.primary,
});

export const previewCaption = style({
  ...text.text12.standard,
  color: c.content.floatingPrimary,
  textAlign: 'center',
  padding: '6px 4px 2px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
