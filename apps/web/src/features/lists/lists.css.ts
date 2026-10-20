// Styles of the lists feature (C2 README §2; evidence/C2/*, J/list-configuration-parent-object.png; layout.md,
// components.md). Picker dialogs ("Choose record", "Choose list", Duplicates) share one command-palette frame:
// 808 px outer frame, 45 px header, 52 px search row (16 px text), 36 px rows with 1 px gaps, 45 px footer with the
// "↑ ↓ Navigate" hint and the primary action.
import { text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style } from '@vanilla-extract/css';

const c = vars.color;

export const emoji = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  lineHeight: 1,
  fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
  userSelect: 'none',
});

// ---- picker dialogs -------------------------------------------------------------------------------------------

export const picker = style({ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 });

export const pickerHeader = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 45,
  flex: 'none',
  padding: '2px 8px 0 12px',
  borderBottom: `1px solid ${c.stroke.primary}`,
});

export const crumbs = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  ...text.body.standard,
  color: c.content.primary,
  margin: 0,
});

export const crumbMuted = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  color: c.content.secondary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

export const crumbSmall = style({ ...text.text12.standard, fontSize: 13 });

export const crumbSep = style({ color: c.stroke.tertiary, flex: 'none' });

export const crumbChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 20,
  padding: '0 5px',
  borderRadius: 6,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primaryTransparent}`,
  color: c.content.primary,
  ...text.text12.standard,
  fontSize: 13,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

export const searchRow = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  height: 52,
  padding: '0 16px',
  borderBottom: `1px solid ${c.stroke.primary}`,
});

export const searchInput = style({
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: c.content.primary,
  fontFamily: 'inherit',
  fontSize: 16,
  lineHeight: '24px',
  fontWeight: 400,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});

export const pickerList = style({
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '6px 8px 8px',
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
});

export const pickerLabel = style({
  ...text.text12.standard,
  color: c.content.secondary,
  padding: '8px 2px 5px',
  selectors: { '&[data-later]': { paddingTop: 10 } },
});

/** Title-case section labels ("Duplicates", "Actions", "Lists") sit with more air than the uppercase ones. */
export const pickerLabelTitle = style({
  paddingLeft: 8,
  paddingBottom: 9,
  selectors: { '&[data-later]': { paddingTop: 17 } },
});

export const stageValue = style({ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 4 });

export const pickerLabelUpper = style({
  fontSize: 11,
  lineHeight: '16px',
  textTransform: 'uppercase',
  fontWeight: 500,
});

export const pickerRow = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 36,
  padding: '0 6px',
  borderRadius: 8,
  color: c.content.primary,
  cursor: 'pointer',
  ...text.body.standard,
  selectors: {
    '&[data-active]': { backgroundColor: c.surface.tertiary },
  },
});

export const rowTile = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  flex: 'none',
  borderRadius: 6,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primaryTransparent}`,
  backgroundColor: c.surface.primary,
  color: c.content.secondary,
});

export const rowTitle = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });

export const rowMuted = style({
  color: c.content.secondary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
});

export const rowTrailing = style({ marginLeft: 'auto', flex: 'none', display: 'inline-flex', alignItems: 'center' });

export const objectChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 20,
  padding: '0 6px',
  borderRadius: 6,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primaryTransparent}`,
  color: c.content.secondary,
  ...text.text12.standard,
});

export const countBadge = style({
  ...text.text12.standard,
  color: c.content.secondary,
  minWidth: 16,
  height: 18,
  padding: '0 5px',
  borderRadius: 6,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: c.surface.tertiary,
});

export const pickerEmpty = style({ ...text.body.standard, color: c.content.tertiary, padding: '8px 6px' });

export const pickerFooter = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  height: 45,
  boxSizing: 'border-box',
  padding: '0 8px',
  borderTop: `1px solid ${c.stroke.primary}`,
});

export const navHint = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  ...text.text12.standard,
  color: c.content.secondary,
  paddingLeft: 4,
});

// ---- forms (create list, add to list, edit entry) --------------------------------------------------------------

export const formBody = style({
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '16px 16px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
});

export const fieldLabel = style({ ...text.text12.standard, color: c.content.secondary, paddingLeft: 4 });

export const field = style({ display: 'flex', flexDirection: 'column', gap: 6 });

export const nameRow = style({ display: 'flex', alignItems: 'flex-end', gap: 8 });

export const iconButton = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 34,
  height: 34,
  flex: 'none',
  borderRadius: 8,
  border: 'none',
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondaryTransparent}`,
  cursor: 'pointer',
  selectors: {
    '&:hover, &[data-hovered]': { backgroundColor: c.surface.secondaryHover },
    '&[data-focus-visible]': { outline: `2px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});

export const errorText = style({ ...text.text12.standard, color: c.content.critical, paddingLeft: 4 });

export const entryHead = style({ padding: '12px 16px 6px', display: 'flex', flexDirection: 'column', gap: 6 });
export const entryTitleRow = style({ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 });
export const entryTitle = style({
  ...text.heading.standard,
  margin: 0,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const entrySub = style({ ...text.text12.standard, fontSize: 13, color: c.content.secondary });
export const entrySubStrong = style({ color: c.content.primary, fontWeight: 500 });

// ---- duplicate entries alert -------------------------------------------------------------------------------------

export const dupBox = style({
  marginTop: 11,
  borderRadius: 10,
  backgroundColor: c.surface.tertiary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  padding: '0 12px',
});

export const dupHead = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 40,
  ...text.body.strong,
  color: c.content.primary,
  borderBottom: `1px solid ${c.stroke.secondary}`,
});

export const dupCheck = style({ display: 'flex', alignItems: 'center', height: 40, color: c.content.secondary });

globalStyle(`${dupCheck} label`, { color: c.content.secondary });

// ---- list page header (C2 §2.2: emoji button + name button, inline rename) ------------------------------------

export const titleGroup = style({ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 });

export const headerEmoji = style({
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  flex: 'none',
  border: 'none',
  padding: 0,
  borderRadius: 6,
  background: 'none',
  cursor: 'pointer',
  selectors: {
    '&[data-hovered], &[data-pressed]': { backgroundColor: c.interactive.ghostHover },
    '&[data-focus-visible]': { outline: `2px solid ${c.stroke.accent}`, outlineOffset: 0 },
  },
});

export const nameButton = style({
  boxSizing: 'border-box',
  display: 'inline-block',
  height: 24,
  minWidth: 0,
  maxWidth: 480,
  padding: '0 2px',
  border: 'none',
  borderRadius: 6,
  background: 'none',
  color: c.content.primary,
  ...text.body.standard,
  lineHeight: '24px',
  fontWeight: 500,
  cursor: 'text',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  selectors: {
    '&[data-hovered]': { backgroundColor: c.interactive.ghostHover },
    '&[data-focus-visible]': { outline: `2px solid ${c.stroke.accent}`, outlineOffset: 0 },
  },
});

export const nameInput = style({
  boxSizing: 'border-box',
  height: 24,
  width: 280,
  padding: '0 4px',
  border: 'none',
  borderRadius: 6,
  outline: 'none',
  background: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.accent}`,
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  fontWeight: 500,
});

// ---- empty list table (evidence/C2/list-empty-table.png) -------------------------------------------------------

export const emptyList = style({
  pointerEvents: 'auto',
  height: '100%',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  boxSizing: 'border-box',
  padding: '167px 16px 20px',
});

export const emptyTitle = style({ ...text.heading.medium, color: c.content.primary, margin: '22px 0 7px' });

export const emptyText = style({
  ...text.body.standard,
  color: c.content.secondary,
  maxWidth: 270,
  textAlign: 'center',
  margin: 0,
});

export const emptyActions = style({ display: 'flex', gap: 8, marginTop: 14 });

// Our own drawing of an empty list: a dotted 128 px tile with corner marks around a framed "card" glyph.
export const illustration = style({ position: 'relative', width: 128, height: 128, flex: 'none' });

export const illustrationDots = style({
  position: 'absolute',
  inset: 0,
  backgroundImage: `radial-gradient(${c.stroke.secondary} 0.8px, transparent 0.9px)`,
  backgroundSize: '6px 6px',
  maskImage: 'radial-gradient(circle at center, #000 45%, transparent 75%)',
});

export const illustrationCorner = style({
  position: 'absolute',
  width: 7,
  height: 7,
  selectors: {
    '&::before, &::after': { content: '""', position: 'absolute', backgroundColor: c.stroke.tertiary },
    '&::before': { left: 3, top: 0, width: 1, height: 7 },
    '&::after': { top: 3, left: 0, width: 7, height: 1 },
  },
});

export const illustrationCard = style({
  position: 'absolute',
  left: 18,
  top: 18,
  width: 92,
  height: 92,
  boxSizing: 'border-box',
  borderRadius: 18,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 2px ${c.stroke.tertiary}, 0 0 0 3px ${c.surface.tertiary}, 0 2px 6px 3px ${c.surface.tint}`,
});

export const illustrationChip = style({
  position: 'absolute',
  left: 19,
  top: 22,
  width: 16,
  height: 16,
  boxSizing: 'border-box',
  borderRadius: 5,
  boxShadow: `inset 0 0 0 2px ${c.stroke.tertiary}`,
});

export const illustrationLine = style({
  position: 'absolute',
  left: 19,
  height: 3,
  borderRadius: 2,
  backgroundColor: c.stroke.tertiary,
});

export const learnMore = style({ marginTop: 'auto', width: 308, paddingTop: 24 });

export const learnLabel = style({ ...text.text12.standard, color: c.content.secondary, marginBottom: 8 });

export const learnCard = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 74,
  padding: 8,
  boxSizing: 'border-box',
  borderRadius: 16,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  color: c.content.primary,
  ...text.body.standard,
  fontWeight: 500,
});

export const learnTile = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 56,
  height: 56,
  flex: 'none',
  borderRadius: 10,
  backgroundColor: c.surface.secondary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  color: c.content.secondary,
});

// ---- no views: "or" + Delete list (evidence/C2/list-no-views.png) ---------------------------------------------

export const orRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  margin: '8px 0',
  ...text.text12.standard,
  color: c.content.tertiary,
  selectors: {
    '&::before, &::after': {
      content: '""',
      flex: 1,
      height: 0,
      borderTop: `1px dashed ${c.stroke.secondary}`,
      margin: '0 88px',
    },
  },
});

export const deleteRow = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 46,
  width: '100%',
  padding: '0 8px',
  border: 'none',
  borderRadius: 12,
  background: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
  color: c.content.critical,
  ...text.body.standard,
  fontWeight: 500,
  cursor: 'pointer',
  selectors: { '&[data-hovered]': { backgroundColor: c.surface.secondary } },
});

export const deleteTile = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 8,
  backgroundColor: c.surface.critical,
  color: c.content.critical,
});

export const notAvailable = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: 24,
  textAlign: 'center',
});

// ---- record cell of an entry (its parent record) ---------------------------------------------------------------

export const parentLink = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  flex: 1,
  color: 'inherit',
  textDecoration: 'none',
});

// ---- settings ---------------------------------------------------------------------------------------------------

/** Settings → Lists columns: List · Created by · Entries · actions. */
export const listsGrid = style({
  gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1.4fr) 120px auto',
  paddingInline: '15px 12px',
});

export const listTile = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  borderRadius: 12,
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
});

export const headerTitleRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
});

export const accessRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '12px 16px',
  borderRadius: 12,
  boxShadow: `inset 0 0 0 1px ${c.stroke.primary}`,
});

export const accessLabel = style({ display: 'flex', alignItems: 'center', gap: 10, ...text.body.standard });
