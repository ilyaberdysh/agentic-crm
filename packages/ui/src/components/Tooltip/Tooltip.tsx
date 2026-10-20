import type { ReactElement, ReactNode } from 'react';
import {
  Tooltip as RACTooltip,
  type TooltipProps as RACTooltipProps,
  TooltipTrigger,
  type TooltipTriggerComponentProps,
} from 'react-aria-components';
import { useThemeClassName } from '../../theme/ThemeProvider';
import { density } from '../../tokens';
import { cx } from '../../utils/cx';
import { Kbd } from '../Kbd/Kbd';
import * as s from './Tooltip.css';

export interface TooltipProps extends Omit<TooltipTriggerComponentProps, 'children'> {
  /** The trigger: a react-aria focusable element (Button, IconButton, Link…). */
  children: ReactElement;
  content: ReactNode;
  /** Shortcut hint rendered as tooltip-variant key caps, e.g. `['mod', '.']`. */
  shortcut?: string[];
  placement?: RACTooltipProps['placement'];
  /** Distance from the trigger (default 8). */
  offset?: number;
  className?: string;
}

/** Hover/focus tooltip: opens after 600 ms (provider default), closes immediately. */
export function Tooltip({
  children,
  content,
  shortcut,
  placement = 'bottom',
  offset = 8,
  delay = density.tooltipDelayMs,
  closeDelay = 0,
  className,
  ...triggerProps
}: TooltipProps) {
  const themeClass = useThemeClassName();
  return (
    <TooltipTrigger delay={delay} closeDelay={closeDelay} {...triggerProps}>
      {children}
      <RACTooltip
        placement={placement}
        offset={offset}
        containerPadding={8}
        className={cx(themeClass, s.tooltip, className)}
        data-has-shortcut={shortcut ? true : undefined}
      >
        <span className={s.label}>{content}</span>
        {shortcut && <Kbd keys={shortcut} size={20} variant="tooltip" />}
      </RACTooltip>
    </TooltipTrigger>
  );
}
