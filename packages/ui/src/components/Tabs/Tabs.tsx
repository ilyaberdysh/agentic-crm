import type { CSSProperties, ReactElement, ReactNode } from 'react';
import {
  type Key,
  Tab as RACTab,
  TabList as RACTabList,
  type TabListProps as RACTabListProps,
  TabPanel as RACTabPanel,
  type TabPanelProps as RACTabPanelProps,
  type TabProps as RACTabProps,
  Tabs as RACTabs,
  type TabsProps as RACTabsProps,
  ToggleButton,
  ToggleButtonGroup,
} from 'react-aria-components';
import { Icon } from '../../icons/Icon';
import type { IconName } from '../../icons/iconMap';
import type { IconGlyph } from '../../icons/types';
import { cx } from '../../utils/cx';
import * as s from './Tabs.css';

export interface TabsProps extends Omit<RACTabsProps, 'className' | 'style'> {
  className?: string;
  style?: CSSProperties;
}

/** Tabs (react-aria): ←/→ move, Home/End, automatic activation. */
export function Tabs({ className, ...rest }: TabsProps) {
  return <RACTabs className={cx(s.tabs, className)} {...rest} />;
}

export interface TabListProps<T extends object> extends Omit<RACTabListProps<T>, 'className' | 'style'> {
  /** `default` draws the full-width rule under the tabs; `plain` has none. */
  variant?: 'default' | 'plain';
  className?: string;
  style?: CSSProperties;
}

export function TabList<T extends object>({ variant = 'default', className, ...rest }: TabListProps<T>) {
  return <RACTabList className={cx(s.list, variant === 'default' && s.listDefault, className)} {...rest} />;
}

export interface TabProps extends Omit<RACTabProps, 'className' | 'style' | 'children'> {
  children?: ReactNode;
  icon?: IconName | IconGlyph;
  /** Count after the label (tertiary, tabular). */
  count?: number | string;
  /** Draws a vertical divider before this tab. */
  divider?: boolean;
  className?: string;
}

/** 28 px tab: icon 16 + label + optional count. */
export function Tab({ children, icon, count, divider, className, ...rest }: TabProps) {
  return (
    <RACTab className={cx(s.tab, divider && s.divided, className)} {...rest}>
      {icon && <Icon icon={icon} size={16} />}
      {children}
      {count !== undefined && <span className={s.count}>{count}</span>}
      <span className={s.underline} aria-hidden="true" />
    </RACTab>
  );
}

export function TabPanel({ className, ...rest }: Omit<RACTabPanelProps, 'className'> & { className?: string }) {
  return <RACTabPanel className={cx(s.panel, className)} {...rest} />;
}

export interface SegmentedOption {
  id: Key;
  label?: ReactNode;
  icon?: IconName | IconGlyph;
  /** Required for icon-only options. */
  'aria-label'?: string;
  isDisabled?: boolean;
}

export interface SegmentedControlProps {
  options: SegmentedOption[];
  value?: Key;
  defaultValue?: Key;
  onChange?: (value: Key) => void;
  /** 28 (default) or 32. */
  size?: 28 | 32;
  isDisabled?: boolean;
  'aria-label'?: string;
  className?: string;
}

/** Single-choice segmented control on react-aria ToggleButtonGroup. */
export function SegmentedControl({
  options,
  value,
  defaultValue,
  onChange,
  size = 28,
  isDisabled,
  className,
  ...rest
}: SegmentedControlProps): ReactElement {
  return (
    <ToggleButtonGroup
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={value !== undefined ? [value] : undefined}
      defaultSelectedKeys={defaultValue !== undefined ? [defaultValue] : undefined}
      onSelectionChange={(keys) => {
        const next = [...keys][0];
        if (next !== undefined) onChange?.(next);
      }}
      isDisabled={isDisabled}
      className={cx(s.segmented, className)}
      {...rest}
    >
      {options.map((o) => {
        const iconOnly = !o.label;
        return (
          <ToggleButton
            key={o.id}
            id={o.id}
            isDisabled={o.isDisabled}
            aria-label={o['aria-label']}
            className={cx(
              s.segment,
              size === 28 ? s.segmentSize28 : s.segmentSize32,
              iconOnly && (size === 28 ? s.segmentIcon28 : s.segmentIcon32),
            )}
          >
            {o.icon && <Icon icon={o.icon} size={16} />}
            {o.label}
          </ToggleButton>
        );
      })}
    </ToggleButtonGroup>
  );
}
