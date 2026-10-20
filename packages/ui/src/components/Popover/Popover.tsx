import type { CSSProperties, ReactElement, ReactNode } from 'react';
import {
  Dialog,
  DialogTrigger,
  type DialogTriggerProps,
  Popover as RACPopover,
  type PopoverProps as RACPopoverProps,
} from 'react-aria-components';
import { floatingPanel } from '../../theme/shared.css';
import { useThemeClassName } from '../../theme/ThemeProvider';
import { cx } from '../../utils/cx';
import * as s from './Popover.css';

export interface PopoverPanelProps extends Omit<RACPopoverProps, 'className' | 'style' | 'children'> {
  children?: ReactNode;
  /** `'trigger'` matches the trigger width; a number sets a fixed width in px. */
  width?: 'trigger' | number;
  /** Inner padding (default 4, the menu chrome). */
  padding?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * The floating panel used by menus, selects and popovers: elevated surface, e2, radius 12,
 * padding 4, 80 ms side-aware scale/fade. Defaults: placement bottom start, offset 4, collision
 * padding 8. Re-applies the theme (elevated) because it renders in a portal.
 */
export function PopoverPanel({
  children,
  width,
  padding,
  placement = 'bottom start',
  offset = 4,
  containerPadding = 8,
  className,
  style,
  ...rest
}: PopoverPanelProps) {
  const themeClass = useThemeClassName({ surfaceMode: 'elevated' });
  const css: CSSProperties = { ...style };
  if (width === 'trigger') css.width = 'var(--trigger-width)';
  else if (typeof width === 'number') css.width = width;
  if (padding !== undefined) css.padding = padding;
  return (
    <RACPopover
      placement={placement}
      offset={offset}
      containerPadding={containerPadding}
      className={cx(themeClass, floatingPanel, className)}
      style={css}
      {...rest}
    >
      {children}
    </RACPopover>
  );
}

export interface PopoverProps
  extends Omit<PopoverPanelProps, 'children' | 'trigger'>,
    Pick<DialogTriggerProps, 'isOpen' | 'defaultOpen' | 'onOpenChange'> {
  /** A react-aria pressable trigger, typically a Button. */
  trigger: ReactElement;
  children?: ReactNode | ((opts: { close: () => void }) => ReactNode);
  /** Accessible name of the dialog when it has no heading. */
  'aria-label'?: string;
}

/** Click-triggered popover dialog. `<Popover trigger={<Button>View settings</Button>}>…</Popover>` */
export function Popover({
  trigger,
  children,
  isOpen,
  defaultOpen,
  onOpenChange,
  'aria-label': ariaLabel,
  ...panel
}: PopoverProps) {
  return (
    <DialogTrigger isOpen={isOpen} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger}
      <PopoverPanel {...panel}>
        <Dialog className={s.dialog} aria-label={ariaLabel}>
          {children}
        </Dialog>
      </PopoverPanel>
    </DialogTrigger>
  );
}
