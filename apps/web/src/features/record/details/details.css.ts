// Details panel: header 97 px (padding 12, gap 12, 1 px rule),
// sections with a 20 px toggle (12/16 secondary), rows 32 px on a 126 px label column (16 px icon + 6 gap + 12/16
// label) and an Editable value cell (radius 9, hover black 2 %), "View all values" ghost link.
import { scales, text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style } from '@vanilla-extract/css';

const c = vars.color;

// ---- header ---------------------------------------------------------------------------------------------------

export const header = style({
  flex: 'none',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 12,
  borderBottom: `1px solid ${c.stroke.primary}`,
});

export const titleRow = style({ display: 'flex', alignItems: 'center', gap: 4, height: 32, minWidth: 0 });

export const avatar = style({ flex: 'none', marginRight: 4 });

export const titleButton = style({
  flex: '0 1 auto',
  minWidth: 0,
  height: 32,
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0 6px',
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  ...text.heading.medium,
  color: c.content.primary,
  cursor: 'pointer',
  textAlign: 'left',
  transition: `background-color ${scales.duration.comfortable}ms ease`,
  selectors: {
    '&:hover:not([data-readonly])': { backgroundColor: c.interactive.ghostHover },
    '&[data-readonly]': { cursor: 'default' },
    '&:focus-visible': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});

export const titleText = style({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

export const titleSpacer = style({ flex: 1 });

export const starOn = style({ color: c.utilities.content.yellow });

export const renameInput = style({
  flex: 1,
  minWidth: 0,
  boxSizing: 'border-box',
  height: 32,
  padding: '0 6px',
  borderRadius: 8,
  border: 'none',
  outline: 'none',
  boxShadow: `inset 0 0 0 1px ${c.stroke.accent}`,
  background: c.surface.primary,
  ...text.heading.medium,
  color: c.content.primary,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});

export const renameNames = style({ flex: 1, minWidth: 0, display: 'flex', gap: 6 });

export const actionsRow = style({ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });

/** Labelled actions share the free width of the row (the UI stretches "Compose email" when icons follow). */
export const actionGrow = style({ flex: '1 1 auto' });

export const actionsMeasure = style({
  position: 'absolute',
  left: 0,
  top: 0,
  display: 'flex',
  gap: 8,
  visibility: 'hidden',
  pointerEvents: 'none',
});

// ---- sections -----------------------------------------------------------------------------------------------

export const section = style({
  flex: 'none',
  borderBottom: `1px solid ${c.stroke.primary}`,
});

export const sectionHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '12px 12px 4px 10px',
  minHeight: 20,
});

export const sectionToggle = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 20,
  padding: '2px 6px',
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  ...text.text12.standard,
  color: c.content.secondary,
  cursor: 'pointer',
  transition: `background-color ${scales.duration.comfortable}ms ease`,
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHover },
    '&:focus-visible': { outline: `1px solid ${c.stroke.accent}` },
  },
});

export const sectionCount = style({ color: c.content.tertiary });

export const chevron = style({
  transition: `transform ${scales.duration.breezy}ms ease`,
  selectors: { '&[data-collapsed]': { transform: 'rotate(-90deg)' } },
});

export const sectionBody = style({ padding: '4px 16px 16px', display: 'flex', flexDirection: 'column', gap: 2 });

export const row = style({
  display: 'grid',
  // The label column is 30 % of the row (126 px in a 454 px panel, 101 px at 370 px; evidence D-*-overview).
  gridTemplateColumns: '30% minmax(0, 1fr)',
  columnGap: 8,
  alignItems: 'start',
  minHeight: 32,
});

export const label = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  minWidth: 0,
  ...text.text12.standard,
  color: c.content.secondary,
});

export const labelIcon = style({ flex: 'none', color: c.content.secondary });

export const labelText = style({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

export const value = style({
  position: 'relative',
  minWidth: 0,
  borderRadius: 9,
  cursor: 'pointer',
  outline: 'none',
  transition: `background-color ${scales.duration.comfortable}ms ease, box-shadow ${scales.duration.comfortable}ms ease`,
  selectors: {
    '&:hover:not([data-readonly])': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&[data-editing]': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
    '&[data-readonly]': { cursor: 'default' },
    '&:focus-visible': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
  },
});

// Values with chips (status, members, records) stay on the 32 px row grid (rows 34 px apart).
globalStyle(`${value} > [data-density="field"]`, { minHeight: 32, paddingTop: 0, paddingBottom: 0 });

export const valueSkeleton = style({ display: 'flex', alignItems: 'center', height: 32, padding: '0 10px' });

export const pending = style({
  position: 'absolute',
  right: 8,
  top: 8,
  display: 'inline-flex',
  color: c.content.tertiary,
});

export const viewAll = style({
  alignSelf: 'flex-start',
  height: 20,
  marginTop: 2,
  marginLeft: -6,
  padding: '2px 6px',
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  ...text.text12.standard,
  color: c.content.ghost,
  cursor: 'pointer',
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHover, color: c.content.primary },
    '&:focus-visible': { outline: `1px solid ${c.stroke.accent}` },
  },
});

export const notApplicable = style({ ...text.body.standard, color: c.content.tertiary, padding: '6px 10px' });

// ---- view all values ------------------------------------------------------------------------------------------

export const viewAllHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '10px 12px 10px 10px',
  borderBottom: `1px solid ${c.stroke.primary}`,
});

export const searchInput = style({
  flex: 1,
  minWidth: 0,
  height: 24,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  ...text.body.standard,
  color: c.content.primary,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});

export const viewAllBody = style({ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 2 });

export const noResults = style({ ...text.body.standard, color: c.content.tertiary, padding: '8px 0' });

// ---- lists section -------------------------------------------------------------------------------------------

export const listsEmpty = style({ ...text.body.standard, color: c.content.tertiary, padding: '4px 16px 12px' });

export const textButton = style({
  height: 20,
  padding: '2px 6px',
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  ...text.text12.standard,
  color: c.content.ghost,
  cursor: 'pointer',
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHover, color: c.content.primary } },
});

// ---- edit record modal ------------------------------------------------------------------------------------------

export const editHead = style({ display: 'flex', flexDirection: 'column', gap: 8, padding: '16px 16px 18px' });
export const editTitleRow = style({ display: 'flex', alignItems: 'center', gap: 12 });
export const editTitle = style({ ...text.heading.large, color: c.content.primary, margin: 0, minWidth: 0 });
export const editSub = style({ ...text.text12.standard, color: c.content.secondary });
export const editSubStrong = style({ fontWeight: 600, color: c.content.primary });
export const editRule = style({ height: 1, margin: '0 16px', backgroundColor: c.stroke.primary });
export const editBody = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: '16px 16px 12px',
  maxHeight: 'min(60vh, 520px)',
  overflowY: 'auto',
});
export const editField = style({ display: 'flex', flexDirection: 'column', gap: 4 });
export const editLabel = style({ ...text.text12.standard, color: c.content.tertiary, paddingLeft: 4 });
export const editBox = style({
  minWidth: 0,
  borderRadius: 9,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primaryTransparent}`,
  cursor: 'pointer',
  transition: `background-color ${scales.duration.comfortable}ms ease, box-shadow ${scales.duration.comfortable}ms ease`,
  selectors: {
    '&:hover:not([data-readonly])': { backgroundColor: c.interactive.ghostHoverSubtle },
    '&[data-editing]': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
    '&[data-readonly]': { cursor: 'default', backgroundColor: c.surface.tintSubtle },
  },
});
