// Files tab (D README §3.9; evidence D-company-files, D-person-files-empty): header with New folder / Upload file /
// ⋮, rows (icon, name, "(28 bytes)", date, ⋮), folders first and expandable inline, a whole-tab drop zone and a
// dark full-screen lightbox.
import { scales, text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const tab = style({ position: 'relative', minHeight: '100%', display: 'flex', flexDirection: 'column' });

export const list = style({ display: 'flex', flexDirection: 'column', padding: '4px 12px 24px' });

export const row = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 36,
  padding: '0 8px',
  borderRadius: 8,
  ...text.body.standard,
  color: c.content.primary,
  cursor: 'pointer',
  transition: `background-color ${scales.duration.comfortable}ms ease`,
  selectors: { '&:hover': { backgroundColor: c.surface.primaryHover } },
});

export const rowIcon = style({ flex: 'none', color: c.content.secondary });
export const name = style({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
export const size = style({ ...text.text12.standard, color: c.content.tertiary, whiteSpace: 'nowrap' });
export const spacer = style({ flex: 1 });
export const date = style({ ...text.text12.standard, color: c.content.secondary, whiteSpace: 'nowrap' });
export const chevron = style({
  flex: 'none',
  color: c.content.tertiary,
  transition: `transform ${scales.duration.breezy}ms ease`,
  transform: 'rotate(-90deg)',
  selectors: { '&[data-open]': { transform: 'none' } },
});

export const nameInput = style({
  flex: 1,
  minWidth: 0,
  height: 26,
  padding: '0 6px',
  borderRadius: 6,
  border: 'none',
  outline: 'none',
  boxShadow: `inset 0 0 0 1px ${c.stroke.accent}`,
  background: c.surface.primary,
  ...text.body.standard,
  color: c.content.primary,
});

export const empty = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  padding: '96px 20px 40px',
});
export const emptyTitle = style({ ...text.body.standard, fontWeight: 600, color: c.content.primary, marginTop: 40 });
export const emptyText = style({ ...text.body.standard, color: c.content.secondary });
export const emptyActions = style({ display: 'flex', gap: 6, marginTop: 16 });

export const dropOverlay = style({
  position: 'absolute',
  inset: 8,
  zIndex: 5,
  borderRadius: 12,
  border: `1px dashed ${c.stroke.accent}`,
  backgroundColor: c.interactive.selectedSubtle,
  display: 'grid',
  placeItems: 'center',
  ...text.body.standard,
  fontWeight: 500,
  color: c.content.accent,
  pointerEvents: 'none',
});

export const status = style({ ...text.text12.standard, color: c.content.secondary, padding: '0 20px 8px' });

// ---- lightbox ----------------------------------------------------------------------------------------------------

export const lightbox = style({
  position: 'fixed',
  inset: 0,
  zIndex: 100,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: 'rgba(16, 17, 18, 0.96)',
  color: '#eeeff1',
});

export const lightboxBar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 52,
  padding: '0 12px 0 20px',
  flex: 'none',
});

export const lightboxTitle = style({
  flex: 1,
  minWidth: 0,
  ...text.body.standard,
  fontWeight: 500,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const lightboxBody = style({
  flex: 1,
  minHeight: 0,
  display: 'grid',
  placeItems: 'center',
  padding: 24,
});

export const lightboxImage = style({ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8 });
export const lightboxFrame = style({
  width: '100%',
  height: '100%',
  border: 'none',
  borderRadius: 8,
  background: '#fff',
});

export const lightboxCard = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  padding: 32,
  borderRadius: 16,
  backgroundColor: 'rgba(255, 255, 255, 0.06)',
  ...text.body.standard,
});

export const lightboxMeta = style({ ...text.text12.standard, color: '#a2a4a7' });
