import { style } from '@vanilla-extract/css';
import { spin } from '../../theme/motion.css';

export const spinner = style({
  display: 'block',
  flex: 'none',
  animation: `${spin} 0.9s linear infinite`,
});

export const track = style({ opacity: 0.2 });
