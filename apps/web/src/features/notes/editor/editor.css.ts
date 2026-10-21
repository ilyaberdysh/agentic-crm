// Note body typography: body 14/500/24, −0.07 px, 12 px between paragraphs; list
// indents) for the textarea fallback and the markdown previews (cards clip it with a fade).
import { text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style, styleVariants } from '@vanilla-extract/css';

const c = vars.color;

export const preview = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  color: c.content.primary,
  ...text.body.standard,
  minWidth: 0,
});

export const previewCompact = style({ fontSize: 13, lineHeight: '20px', gap: 2 });

export const block = style({ margin: 0, minWidth: 0, overflowWrap: 'anywhere' });

export const heading = styleVariants({
  h1: { fontSize: 20, lineHeight: '28px', fontWeight: 600, letterSpacing: '-0.2px' },
  h2: { fontSize: 18, lineHeight: '26px', fontWeight: 600, letterSpacing: '-0.18px' },
  h3: { fontSize: 16, lineHeight: '24px', fontWeight: 600, letterSpacing: '-0.16px' },
});

/** Cards show headings at body size, bold (notes-page-grid.png "Goals"). */
export const headingCompact = style({ fontSize: 13, lineHeight: '20px', fontWeight: 600, letterSpacing: 0 });

export const listItem = style({ display: 'flex', gap: 8, alignItems: 'baseline' });
export const marker = style({ flex: 'none', minWidth: 14, textAlign: 'right', color: c.content.primary });

export const bold = style({ fontWeight: 600 });
export const italic = style({ fontStyle: 'italic' });
export const strike = style({ textDecoration: 'line-through', color: c.content.secondary });
export const highlight = style({ backgroundColor: c.utilities.surface.yellowSubtle, borderRadius: 2 });
export const link = style({ color: c.content.accent, textDecoration: 'none' });

export const empty = style({ color: c.content.tertiary });

globalStyle(`${preview} ul, ${preview} ol`, { margin: 0, padding: 0 });

// Card previews of the editor's own render: 13 px, headings at body size, tight blocks (notes-page-grid.png).
export const richCompact = style({ fontSize: 13, lineHeight: '20px' });
globalStyle(`${richCompact}${richCompact} > * + *`, { marginTop: 2 });
globalStyle(`${richCompact}${richCompact} :is(h1, h2, h3)`, {
  fontSize: 13,
  lineHeight: '20px',
  fontWeight: 600,
  letterSpacing: 0,
});
globalStyle(`${richCompact}${richCompact} p, ${richCompact}${richCompact} .agentic-crm-note-list-item`, {
  minHeight: 20,
});
