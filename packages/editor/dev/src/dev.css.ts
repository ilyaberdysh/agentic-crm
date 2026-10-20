// Dev page chrome: a note window with Attio's geometry (E README §2.2: 968 px window, radius 16, 48 px top bar,
// 704 px document column 132 px from the left, 32/600 title) so parity screenshots line up with research/evidence/E.
import { text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style } from '@vanilla-extract/css';

const c = vars.color;

globalStyle('body', {
  margin: 0,
  background: c.surface.secondary,
  fontFamily: 'Inter Variable, Inter, system-ui, sans-serif',
});

export const page = style({ display: 'flex', flexWrap: 'wrap', gap: 24, padding: 24, alignItems: 'flex-start' });

export const window = style({
  position: 'relative',
  boxSizing: 'border-box',
  width: 968,
  minHeight: 670,
  borderRadius: 16,
  background: c.surface.primary,
  boxShadow: vars.elevation.e3,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
});

export const narrowWindow = style({ width: 'min(720px, calc(50vw - 36px))' });

export const topBar = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: 48,
  padding: '0 16px 0 20px',
  boxShadow: `inset 0 -1px 0 ${c.stroke.primary}`,
  color: c.content.primary,
  flex: 'none',
  ...text.body.standard,
});

export const status = style({ ...text.text12.standard, color: c.content.tertiary });

export const headerRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 12,
  height: 44,
  padding: '0 20px',
  flex: 'none',
});

export const column = style({
  boxSizing: 'border-box',
  width: '100%',
  maxWidth: 836,
  padding: '0 0 64px 132px',
  selectors: { [`${narrowWindow} &`]: { padding: '0 32px 64px 48px' } },
});

// Vertical rhythm measured on note-editor-slash-menu.png: title box at y 142, meta row 184–208, body from y 236.
export const title = style({
  margin: '50px 0 0',
  fontSize: 32,
  lineHeight: '36px',
  fontWeight: 600,
  letterSpacing: '-0.64px',
  color: c.content.primary,
});

export const meta = style({
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  height: 24,
  margin: '6px 0 28px',
  color: c.content.primary,
  ...text.body.standard,
});

export const body = style({ maxWidth: 704 });

export const editorRoot = style({ minHeight: 420, cursor: 'text' });

export const insertSlot = style({ position: 'absolute', left: 16, bottom: 16 });

export const panel = style({
  boxSizing: 'border-box',
  width: 400,
  padding: 16,
  borderRadius: 12,
  background: c.surface.primary,
  boxShadow: vars.elevation.e2,
  color: c.content.primary,
  ...text.body.standard,
});

export const field = style({
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  height: 32,
  margin: '4px 0 12px',
  padding: '0 8px',
  borderRadius: 8,
  border: `1px solid ${c.stroke.primary}`,
  font: 'inherit',
});

export const projection = style({
  boxSizing: 'border-box',
  width: 400,
  padding: 16,
  borderRadius: 12,
  background: c.surface.primary,
  boxShadow: vars.elevation.e1,
});

export const markdown = style({
  margin: '8px 0 0',
  padding: 8,
  borderRadius: 8,
  background: c.surface.tertiary,
  whiteSpace: 'pre-wrap',
  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
  fontSize: 12,
  lineHeight: '16px',
});
