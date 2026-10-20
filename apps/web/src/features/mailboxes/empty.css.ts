// Empty states of the mailbox tabs (evidence/F/mailbox-blocklist-empty.png, mailbox-signatures-empty.png): our own
// dotted tile with corner marks and a framed glyph (Attio's illustrations are not reused), title, description and a
// primary button, centred in the 768 px column.
import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const block = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  paddingTop: 40,
});

export const art = style({ position: 'relative', width: 136, height: 136, flex: 'none' });

export const dots = style({
  position: 'absolute',
  inset: 0,
  backgroundImage: `radial-gradient(${c.stroke.secondary} 0.8px, transparent 0.9px)`,
  backgroundSize: '6px 6px',
  maskImage: 'radial-gradient(circle at center, #000 45%, transparent 75%)',
});

export const corner = style({
  position: 'absolute',
  width: 7,
  height: 7,
  selectors: {
    '&::before, &::after': { content: '""', position: 'absolute', backgroundColor: c.stroke.tertiary },
    '&::before': { left: 3, top: 0, width: 1, height: 7 },
    '&::after': { top: 3, left: 0, width: 7, height: 1 },
  },
});

export const frame = style({
  position: 'absolute',
  left: 20,
  top: 20,
  width: 96,
  height: 96,
  boxSizing: 'border-box',
  borderRadius: 22,
  display: 'grid',
  placeItems: 'center',
  backgroundColor: c.surface.primary,
  boxShadow: `inset 0 0 0 2px ${c.stroke.secondary}, 0 0 0 4px ${c.surface.tertiary}`,
  color: c.content.tertiary,
});

export const title = style({ ...text.heading.small, color: c.content.primary, margin: '42px 0 0' });

export const description = style({ ...text.body.standard, color: c.content.secondary, margin: '4px 0 0' });

export const action = style({ marginTop: 16 });
