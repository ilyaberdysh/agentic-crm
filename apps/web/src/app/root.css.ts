// Root frame: the announcement banner slot (32 px bar above everything, system-ui §5) and the page below it.
import { vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

export const frame = style({
  display: 'flex',
  flexDirection: 'column',
  height: '100dvh',
  overflow: 'hidden',
  backgroundColor: vars.color.surface.primary,
});

export const page = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto',
});
