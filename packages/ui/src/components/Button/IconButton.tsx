import { forwardRef, type ReactNode } from 'react';
import { Tooltip, type TooltipProps } from '../Tooltip/Tooltip';
import { Button, type ButtonIcon, type ButtonProps } from './Button';

export interface IconButtonProps
  extends Omit<ButtonProps, 'children' | 'icon' | 'iconRight' | 'chevron' | 'badge' | 'shortcut' | 'iconOnly'> {
  icon: ButtonIcon;
  /** Required: icon-only buttons need an accessible name. */
  'aria-label': string;
  /** Optional tooltip; defaults to nothing (pass `tooltip` to show the label on hover). */
  tooltip?: ReactNode;
  tooltipShortcut?: string[];
  tooltipPlacement?: TooltipProps['placement'];
}

/**
 * Square icon-only Button (28 → 28 × 28). Common app usage: ghost 28 in headers, ghost 20 in
 * dense rows. Default variant is ghost.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, tooltip, tooltipShortcut, tooltipPlacement, variant = 'ghost', size = 28, ...rest },
  ref,
) {
  const button = <Button ref={ref} icon={icon} iconOnly variant={variant} size={size} {...rest} />;
  if (!tooltip) return button;
  return (
    <Tooltip content={tooltip} shortcut={tooltipShortcut} placement={tooltipPlacement}>
      {button}
    </Tooltip>
  );
});
