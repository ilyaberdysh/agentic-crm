// New-record dialog and edit-history popover styles.
import { insetRing, text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const tabs = style({ padding: '7px 12px 0', flex: 'none' });

export const body = style({ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 16 });

export const sectionTitle = style({
  ...text.heading.extraSmall,
  color: c.content.primary,
  margin: 0,
  padding: '0 4px',
});

export const fieldBlock = style({ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 });

export const label = style({
  ...text.text12.standard,
  color: c.content.tertiary,
  paddingLeft: 4,
  display: 'flex',
  gap: 4,
  cursor: 'default',
});

/** Picker-backed field: looks like TextInput 32 (ring black 6 %, radius 9, hover black 2 %, focus accent). */
export const box = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  minHeight: 32,
  width: '100%',
  padding: 0,
  margin: 0,
  border: 'none',
  borderRadius: 9,
  background: c.interactive.ghost,
  boxShadow: insetRing(c.stroke.primaryTransparent),
  color: c.content.primary,
  textAlign: 'left',
  font: 'inherit',
  cursor: 'pointer',
  outline: 'none',
  overflow: 'hidden',
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&:focus-visible, &[data-open]': { boxShadow: insetRing(c.stroke.accent) },
    '&[data-invalid]': { boxShadow: insetRing(c.stroke.critical) },
  },
});

export const boxStatic = style({ cursor: 'default', paddingLeft: 8 });

export const nameRow = style({ display: 'flex', gap: 8 });

export const error = style({ ...text.text11.standard, color: c.content.critical, paddingLeft: 4 });

export const templates = style({
  ...text.body.standard,
  color: c.content.tertiary,
  padding: '40px 16px',
  textAlign: 'center',
});

export const footerStart = style({ display: 'flex', alignItems: 'center', gap: 16 });

// ---- edit history -----------------------------------------------------------------------------------------------------

export const history = style({ display: 'flex', flexDirection: 'column', maxHeight: 420 });

export const historyTitle = style({
  ...text.body.standard,
  color: c.content.primary,
  padding: '12px 12px 4px',
  flex: 'none',
});

/** Entries 56 px, no gap; text column at x 38, hover card from x 28 to 308. */
export const historyList = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  padding: '4px 12px 10px 28px',
  overflowY: 'auto',
});

export const historyEntry = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '7px 8px 7px 10px',
  borderRadius: 8,
  cursor: 'default',
  selectors: { '&:hover, &[data-active]': { backgroundColor: c.surface.primaryHover } },
});

/** Timeline at x 17: 7 px hollow dots, an 11 px ring on the newest entry, a 1 px rule between them. */
export const historyDot = style({
  position: 'absolute',
  left: -14.5,
  top: 13.5,
  width: 7,
  height: 7,
  borderRadius: '50%',
  boxSizing: 'border-box',
  border: `1px solid ${c.stroke.tertiary}`,
  backgroundColor: c.surface.primary,
});

export const historyDotCurrent = style({
  width: 11,
  height: 11,
  left: -16.5,
  top: 11.5,
  boxShadow: `inset 0 0 0 2px ${c.surface.primary}, inset 0 0 0 7px ${c.stroke.tertiary}`,
});

export const historyLine = style({
  position: 'absolute',
  left: -11.5,
  top: 17,
  bottom: -17,
  width: 1,
  backgroundColor: c.stroke.secondary,
});

/** Compact actor in the meta line: 20 px row, avatar 2 px left of the text column, 4 px gap. */
export const historyActor = style({
  selectors: { '&&': { height: 20, paddingInline: 0, marginLeft: -2, gap: 4 } },
});

export const historyMeta = style({
  display: 'flex',
  alignItems: 'center',
  height: 20,
  gap: 5,
  minWidth: 0,
  ...text.text12.standard,
  color: c.content.primary,
  whiteSpace: 'nowrap',
});

export const historyTime = style({ color: c.content.tertiary, flex: 'none' });

export const historyValue = style({
  ...text.body.standard,
  color: c.content.primary,
  overflowWrap: 'anywhere',
});

export const historyLabel = style({ color: c.content.tertiary });

export const historyEmpty = style({ ...text.text12.standard, color: c.content.secondary, padding: '8px 12px 14px' });

export const resulting = style({ display: 'flex', flexDirection: 'column', gap: 11, padding: '14px 15px 16px' });
export const resultingLabel = style({ ...text.text12.standard, color: c.content.primary });
export const resultingValue = style({ ...text.body.standard, color: c.content.primary, overflowWrap: 'anywhere' });
