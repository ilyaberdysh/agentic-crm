// Record state pages: centred 270 px column, 140 px
// illustration, title Heading.Medium, description Body secondary centred, primary 32 px button.
import { text as type, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const page = style({
  flex: 1,
  minHeight: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  backgroundColor: c.surface.primary,
});

export const column = style({
  width: 270,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  gap: 8,
  marginTop: -40,
});

export const illustration = style({ marginBottom: 32 });
export const dashed = style({ stroke: c.content.tertiary });
export const accent = style({ stroke: c.content.accent, fill: c.surface.primary });

export const title = style({ ...type.heading.medium, color: c.content.primary, margin: 0 });

export const text = style({
  ...type.body.standard,
  color: c.content.secondary,
  margin: '0 0 8px',
});

export const learnMore = style({ ...type.body.standard, color: c.content.secondary });
