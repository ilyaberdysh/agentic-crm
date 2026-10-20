// A select-like trigger: optional leading icon, the value filling the width, a chevron at the right edge (sort rows,
// evidence C1/17–18). A react-aria Button, so it works as a MenuTrigger / popover trigger.
import { Icon, type IconName } from '@agentic-crm/ui';
import { forwardRef, type ReactNode } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import * as s from '../views.css';

export interface SelectButtonProps {
  icon?: IconName;
  children?: ReactNode;
  isActive?: boolean;
  onPress?: () => void;
  className?: string;
  'aria-label'?: string;
}

export const SelectButton = forwardRef<HTMLButtonElement, SelectButtonProps>(function SelectButton(
  { icon, children, isActive, onPress, className, ...rest },
  ref,
) {
  return (
    <AriaButton
      ref={ref}
      className={className ? `${s.selectButton} ${className}` : s.selectButton}
      data-active={isActive || undefined}
      onPress={onPress}
      {...rest}
    >
      {icon && <Icon icon={icon} size={16} />}
      <span className={s.selectLabel}>{children}</span>
      <Icon icon="chevronDown" size={16} className={s.chevron} />
    </AriaButton>
  );
});
