// Prompts library (ask-agentic §2.3, §11.2): the "Browse prompts" modal (search + categories on the left, a 3-column
// card grid), the curated detail view, the Create / Edit prompt editor and the cards of Settings → Prompts.
import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

// ---- cards --------------------------------------------------------------------------------------------------------------------------

export const card = style({
  boxSizing: 'border-box',
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minHeight: 105,
  padding: 12,
  borderRadius: 12,
  border: 'none',
  textAlign: 'left',
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  color: c.content.primary,
  cursor: 'pointer',
  transition: 'background-color 120ms ease',
  selectors: {
    '&:hover': { backgroundColor: c.surface.primaryHover },
    '&:focus-visible': { outline: `2px solid ${c.stroke.accent}` },
  },
});
export const cardTitle = style({ ...text.body.standard, fontWeight: 500, color: c.content.primary, margin: 0 });
export const cardSummary = style({
  ...text.text12.standard,
  fontWeight: 400,
  color: c.content.secondary,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  flex: 1,
});
export const cardFooter = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  ...text.text12.standard,
  fontWeight: 400,
  color: c.content.secondary,
});
export const cardMeta = style({ display: 'inline-flex', alignItems: 'center', gap: 4 });
export const cardActions = style({
  position: 'absolute',
  top: 8,
  right: 8,
  opacity: 0,
  transition: 'opacity 120ms ease',
  selectors: { [`${card}:hover &, ${card}:focus-within &, &[data-open]`]: { opacity: 1 } },
});
export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 12,
  '@media': { '(max-width: 900px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } },
});

// ---- gallery ------------------------------------------------------------------------------------------------------------------------

export const modalHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 48,
  padding: '0 12px 0 16px',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
  flex: 'none',
  ...text.body.standard,
  color: c.content.primary,
});
export const crumb = style({
  color: c.content.secondary,
  border: 'none',
  background: 'transparent',
  padding: 0,
  cursor: 'pointer',
  font: 'inherit',
});
export const crumbSep = style({ color: c.content.tertiary });
export const crumbCurrent = style({ display: 'inline-flex', alignItems: 'center', gap: 6, color: c.content.primary });
export const modalBody = style({ flex: 1, minHeight: 0, overflowY: 'auto', padding: '56px 72px 40px' });
export const pageTitle = style({ ...text.heading.large, margin: 0, color: c.content.primary });
export const pageSubtitle = style({
  ...text.body.standard,
  fontWeight: 400,
  color: c.content.secondary,
  margin: '4px 0 0',
});
export const titleRow = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 16,
  justifyContent: 'space-between',
  marginBottom: 24,
});
export const layout = style({
  display: 'grid',
  gridTemplateColumns: '232px minmax(0, 1fr)',
  gap: 44,
  alignItems: 'start',
});
export const filters = style({ display: 'flex', flexDirection: 'column', gap: 8 });
export const filterRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 32,
  padding: '0 8px',
  color: c.content.primary,
  ...text.body.standard,
  fontWeight: 400,
});
export const filterLabel = style({ flex: 1 });
export const emptyResults = style({
  ...text.body.standard,
  fontWeight: 400,
  color: c.content.secondary,
  padding: '24px 0',
});

// ---- detail -------------------------------------------------------------------------------------------------------------------------

export const detailHead = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  paddingBottom: 24,
  marginBottom: 24,
  borderBottom: `1px solid ${c.stroke.primary}`,
});
export const detailTitle = style({ ...text.heading.large, margin: 0, color: c.content.primary });
export const detailSummary = style({ ...text.body.standard, fontWeight: 400, color: c.content.secondary, margin: 0 });
export const detailLayout = style({ display: 'grid', gridTemplateColumns: '248px minmax(0, 1fr)', gap: 44 });
export const metaLabel = style({
  ...text.text12.standard,
  fontWeight: 400,
  color: c.content.secondary,
  margin: '0 0 6px',
});
export const metaList = style({ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 24 });
export const metaItem = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  ...text.body.standard,
  fontWeight: 400,
  color: c.content.primary,
});
export const guidance = style({
  ...text.body.standard,
  fontWeight: 400,
  color: c.content.primary,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  margin: 0,
  fontFamily: 'inherit',
  maxWidth: 560,
});

// ---- editor -------------------------------------------------------------------------------------------------------------------------

export const editor = style({ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, flex: 1, minHeight: 0 });
export const editorTitleRow = style({ display: 'flex', alignItems: 'center', gap: 8 });
export const iconButton = style({
  width: 32,
  height: 32,
  flex: 'none',
  border: 'none',
  borderRadius: 8,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  backgroundColor: c.surface.primary,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHover } },
});
export const titleInput = style({
  flex: 1,
  height: 32,
  padding: '0 10px',
  border: 'none',
  outline: 'none',
  borderRadius: 8,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  backgroundColor: c.surface.primary,
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  fontWeight: 400,
  selectors: {
    '&:focus': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
    '&::placeholder': { color: c.content.tertiary },
  },
});
export const bodyInput = style({
  boxSizing: 'border-box',
  flex: 1,
  minHeight: 280,
  width: '100%',
  padding: '10px 10px',
  border: 'none',
  outline: 'none',
  resize: 'none',
  borderRadius: 8,
  boxShadow: `inset 0 0 0 1px ${c.stroke.secondary}`,
  backgroundColor: c.surface.secondary,
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  fontWeight: 400,
  selectors: {
    '&:focus': { boxShadow: `inset 0 0 0 1px ${c.stroke.accent}` },
    '&::placeholder': { color: c.content.tertiary },
  },
});
export const generateInput = style({
  boxSizing: 'border-box',
  width: '100%',
  height: 168,
  padding: '10px 10px',
  border: 'none',
  outline: 'none',
  resize: 'none',
  borderRadius: 8,
  boxShadow: `inset 0 0 0 1px ${c.stroke.accent}`,
  backgroundColor: c.surface.primary,
  color: c.content.primary,
  fontFamily: 'inherit',
  ...text.body.standard,
  fontWeight: 400,
  selectors: { '&::placeholder': { color: c.content.tertiary } },
});
export const enhancing = style({
  ...text.body.standard,
  color: c.content.secondary,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 0',
});

export const picker = style({ display: 'flex', flexDirection: 'column', gap: 8, width: 310, padding: 8 });
export const pickerGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(9, 1fr)',
  gap: 2,
  maxHeight: 180,
  overflowY: 'auto',
});
export const pickerCell = style({
  width: 28,
  height: 28,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: c.content.secondary,
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHover },
    '&[data-selected]': { backgroundColor: c.interactive.selected, color: c.content.accent },
  },
});
export const swatches = style({ display: 'flex', gap: 6, flexWrap: 'wrap' });
export const swatch = style({
  width: 20,
  height: 20,
  borderRadius: 10,
  border: 'none',
  cursor: 'pointer',
  selectors: { '&[data-selected]': { boxShadow: `0 0 0 2px ${c.surface.primary}, 0 0 0 4px ${c.stroke.accent}` } },
});

// ---- share --------------------------------------------------------------------------------------------------------------------------

export const share = style({ display: 'flex', flexDirection: 'column', gap: 12, width: 380, padding: 12 });
export const shareRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  ...text.body.standard,
  fontWeight: 400,
  color: c.content.primary,
});
export const shareName = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const shareLabel = style({ ...text.text12.standard, fontWeight: 400, color: c.content.secondary });
export const sharePicker = style({ display: 'flex', gap: 8, alignItems: 'center' });
export const shareResults = style({ display: 'flex', flexDirection: 'column', maxHeight: 160, overflowY: 'auto' });
