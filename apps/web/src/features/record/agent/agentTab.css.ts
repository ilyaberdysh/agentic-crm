import { text, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const page = style({
  boxSizing: 'border-box',
  display: 'grid',
  gap: 12,
  width: '100%',
  maxWidth: 760,
  padding: '20px 24px 32px',
  margin: '0 auto',
});

export const header = style({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 });
export const eyebrow = style({ ...text.text12.standard, fontWeight: 500, color: c.content.secondary, marginBottom: 4 });
export const title = style({ ...text.heading.small, color: c.content.primary, margin: 0, maxWidth: 560 });
export const status = style({
  ...text.text12.standard,
  fontWeight: 500,
  flex: 'none',
  borderRadius: 6,
  padding: '4px 7px',
  color: c.content.secondary,
  background: c.surface.tint,
  selectors: { '&[data-status="proposed"]': { color: c.content.accent, background: c.surface.accentSubtle } },
});

export const card = style({
  display: 'grid',
  gap: 8,
  padding: 14,
  border: `1px solid ${c.stroke.primary}`,
  borderRadius: 10,
  background: c.surface.primary,
});
export const decision = style({
  display: 'grid',
  gap: 8,
  padding: 14,
  border: `1px solid ${c.stroke.accent}`,
  borderRadius: 10,
  background: c.surface.accentSubtle,
});
export const queue = style({
  display: 'grid',
  gap: 7,
  padding: '4px 2px',
});
export const receipt = style({
  display: 'grid',
  gap: 7,
  padding: 14,
  borderRadius: 10,
  background: c.surface.secondary,
});
export const sectionHeading = style({
  ...text.text12.standard,
  fontWeight: 500,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  color: c.content.secondary,
});
export const task = style({ ...text.body.strong, color: c.content.primary });
export const body = style({ ...text.body.standard, color: c.content.primary, margin: 0 });
export const muted = style({ ...text.text12.standard, color: c.content.secondary });
export const quote = style({
  ...text.body.standard,
  color: c.content.primary,
  margin: 0,
  paddingLeft: 10,
  borderLeft: `2px solid ${c.stroke.secondary}`,
});
export const evidenceBand = style({
  ...text.text12.standard,
  fontWeight: 500,
  borderRadius: 5,
  padding: '2px 6px',
  color: c.content.secondary,
  background: c.surface.tint,
});
export const evidenceList = style({ display: 'grid', gap: 10 });
export const evidenceItem = style({ display: 'grid', gap: 6 });
export const evidenceMeta = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 });
export const peopleGroup = style({ display: 'grid', gap: 4 });
export const peopleList = style({ display: 'grid', gap: 4, padding: 0, margin: 0, listStyle: 'none' });
export const nextEvent = style({
  ...text.text12.standard,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  color: c.content.secondary,
});
export const actions = style({ display: 'flex', gap: 8, marginTop: 2 });

export const empty = style({
  boxSizing: 'border-box',
  display: 'grid',
  justifyItems: 'center',
  alignContent: 'center',
  gap: 8,
  minHeight: 260,
  maxWidth: 360,
  padding: 24,
  margin: '0 auto',
  textAlign: 'center',
  color: c.content.secondary,
});
export const emptyTitle = style({ ...text.body.strong, color: c.content.primary });

export const skeleton = style({
  height: 72,
  borderRadius: 10,
  background: c.surface.secondary,
  selectors: { '&:first-child': { height: 86 } },
});
