// Workflow settings tab (evidence G/G-settings-tab.png): 720 px column 80 px below the tab bar, 16/600 section headings,
// rows with a 14/500 title and 12 px grey description, controls right-aligned, a hairline between sections.
import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const page = style({ flex: 1, minHeight: 0, overflowY: 'auto', backgroundColor: c.surface.primary });
export const column = style({ width: 720, maxWidth: 'calc(100% - 48px)', margin: '0 auto', padding: '72px 0 48px' });
export const heading = style({
  ...text.heading.small,
  fontSize: 16,
  fontWeight: 600,
  color: c.content.primary,
  margin: '0 0 18px',
});
export const row = style({ display: 'flex', alignItems: 'center', gap: 24, justifyContent: 'space-between' });
export const texts = style({ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 });
export const title = style({ ...text.body.standard, fontWeight: 500, color: c.content.primary });
export const description = style({ ...text.text12.standard, color: c.content.secondary });
export const info = style({
  display: 'inline-flex',
  marginLeft: 6,
  verticalAlign: 'middle',
  color: c.content.tertiary,
});
export const divider = style({ border: 'none', height: 1, backgroundColor: c.stroke.primary, margin: '34px 0' });
