import type { CSSProperties, ReactElement, ReactNode } from 'react';
import {
  Autocomplete,
  Button,
  Collection,
  Group,
  Header,
  Input,
  ListBox,
  ListBoxItem,
  type ListBoxItemProps,
  ListBoxSection,
  type ListBoxSectionProps,
  ComboBox as RACComboBox,
  type ComboBoxProps as RACComboBoxProps,
  Select as RACSelect,
  type SelectProps as RACSelectProps,
  SearchField,
  SelectValue,
  useFilter,
} from 'react-aria-components';
import { CheckCircleFilled } from '../../icons/custom';
import { Icon } from '../../icons/Icon';
import type { IconName } from '../../icons/iconMap';
import type { IconGlyph } from '../../icons/types';
import { listItem, listItemDescription, listItemLabel, menuLabel } from '../../theme/shared.css';
import { cx } from '../../utils/cx';
import { type FieldChromeProps, FieldDescription, FieldErrorMessage, FieldLabel } from '../Field/Field';
import * as fs from '../Field/Field.css';
import { renderItemIcon } from '../Menu/Menu';
import * as ms from '../Menu/Menu.css';
import { PopoverPanel } from '../Popover/Popover';
import * as s from './Select.css';

export type SelectSize = 20 | 22 | 28 | 32 | 36;

export interface SelectProps<T extends object>
  extends Omit<RACSelectProps<T>, 'children' | 'className' | 'style'>,
    FieldChromeProps {
  children: ReactNode | ((item: T) => ReactElement);
  items?: Iterable<T>;
  /** 20 | 22 | 28 | 32 (default) | 36 */
  size?: SelectSize;
  /** `default` has a hairline border; `ghost` is borderless with an outline on focus. */
  variant?: 'default' | 'ghost';
  /** Default "Select a value...". */
  placeholder?: string;
  /** Leading icon in the trigger. */
  icon?: IconName | IconGlyph;
  /** Searchable (Attio's SelectCombobox): a filter row on top of the list. */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Popover width: matches the trigger by default. */
  menuWidth?: 'trigger' | number;
  /** What the trigger shows for the selected item (default: the item's own content). */
  renderValue?: (selected: T) => ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * Select on react-aria: trigger with ChevronDown, list in the menu chrome 8 px below, trailing
 * accent check on the selected item. `searchable` adds the filter row (padding 8, hairline).
 */
export function Select<T extends object>({
  children,
  items,
  size = 32,
  variant = 'default',
  placeholder = 'Select a value...',
  icon,
  searchable,
  searchPlaceholder = 'Search...',
  menuWidth = 'trigger',
  renderValue,
  label,
  necessity,
  description,
  errorMessage,
  className,
  style,
  ...rest
}: SelectProps<T>) {
  const { contains } = useFilter({ sensitivity: 'base' });
  const iconSize = size === 20 ? 12 : 16;
  const list = (
    <ListBox<T>
      items={items}
      className={cx(s.listBox, searchable && s.searchableList)}
      renderEmptyState={() => <div className={ms.empty}>No results found</div>}
    >
      {children}
    </ListBox>
  );
  return (
    <RACSelect placeholder={placeholder} className={cx(fs.field, className)} style={style} {...rest}>
      <FieldLabel necessity={necessity}>{label}</FieldLabel>
      <Button className={cx(s.trigger, s.triggerVariant[variant], s.triggerSize[size])}>
        {icon && <Icon icon={icon} size={iconSize} className={s.chevron} />}
        <SelectValue<T> className={s.value}>
          {renderValue
            ? ({ selectedItem, isPlaceholder, defaultChildren }) =>
                isPlaceholder || !selectedItem ? defaultChildren : renderValue(selectedItem)
            : undefined}
        </SelectValue>
        <Icon icon="chevronDown" size={iconSize} className={s.chevron} />
      </Button>
      <FieldDescription>{description}</FieldDescription>
      <FieldErrorMessage>{errorMessage}</FieldErrorMessage>
      <PopoverPanel offset={8} width={menuWidth}>
        {searchable ? (
          <Autocomplete filter={contains}>
            <SearchField aria-label={searchPlaceholder} autoFocus className={ms.filterRow}>
              <Icon icon="search" size={16} className={ms.filterIcon} />
              <Input placeholder={searchPlaceholder} className={ms.filterInput} />
            </SearchField>
            {list}
          </Autocomplete>
        ) : (
          list
        )}
      </PopoverPanel>
    </RACSelect>
  );
}

export interface SelectItemProps<T extends object = object>
  extends Omit<ListBoxItemProps<T>, 'children' | 'className'> {
  children?: ReactNode;
  icon?: IconName | IconGlyph | ReactElement;
  description?: ReactNode;
  className?: string;
}

/** Option row: 32 px list item; the selected one shows CheckCircle (accent) at the right. */
export function SelectItem<T extends object = object>({
  children,
  icon,
  description,
  className,
  textValue,
  ...rest
}: SelectItemProps<T>) {
  return (
    <ListBoxItem
      textValue={textValue ?? (typeof children === 'string' ? children : undefined)}
      className={cx(listItem, className)}
      {...rest}
    >
      {({ isSelected }) => (
        <>
          {renderItemIcon(icon)}
          {description ? (
            <span className={ms.itemText}>
              <span className={listItemLabel}>{children}</span>
              <span className={listItemDescription}>{description}</span>
            </span>
          ) : (
            <span className={listItemLabel}>{children}</span>
          )}
          {isSelected && <CheckCircleFilled size={16} className={ms.check} />}
        </>
      )}
    </ListBoxItem>
  );
}

export interface SelectSectionProps<T extends object> extends Omit<ListBoxSectionProps<T>, 'className'> {
  title?: ReactNode;
}

export function SelectSection<T extends object>({ title, children, items, ...rest }: SelectSectionProps<T>) {
  return (
    <ListBoxSection className={ms.section} {...rest}>
      {title && <Header className={menuLabel}>{title}</Header>}
      {typeof children === 'function' ? <Collection items={items}>{children}</Collection> : children}
    </ListBoxSection>
  );
}

export interface ComboBoxProps<T extends object>
  extends Omit<RACComboBoxProps<T>, 'children' | 'className' | 'style'>,
    FieldChromeProps {
  children: ReactNode | ((item: T) => ReactElement);
  size?: 28 | 32 | 34;
  placeholder?: string;
  icon?: IconName | IconGlyph;
  className?: string;
  style?: CSSProperties;
}

/** Text input with a suggestion list (react-aria ComboBox), styled like TextInput. */
export function ComboBox<T extends object>({
  children,
  size = 32,
  placeholder,
  icon,
  label,
  necessity,
  description,
  errorMessage,
  className,
  style,
  ...rest
}: ComboBoxProps<T>) {
  return (
    <RACComboBox className={cx(fs.field, className)} style={style} menuTrigger="focus" {...rest}>
      {({ isInvalid, isDisabled }) => (
        <>
          <FieldLabel necessity={necessity}>{label}</FieldLabel>
          <Group
            className={cx(
              fs.control,
              fs.controlSize[size],
              icon && fs.controlLeading[size],
              fs.controlTrailing[size],
              s.comboControl,
            )}
            isInvalid={isInvalid}
            isDisabled={isDisabled}
          >
            {icon && <Icon icon={icon} size={16} className={fs.leadingIcon} />}
            <Input placeholder={placeholder} className={fs.input} />
            <Button className={s.comboButton}>
              <Icon icon="chevronDown" size={16} />
            </Button>
          </Group>
          <FieldDescription>{description}</FieldDescription>
          <FieldErrorMessage>{errorMessage}</FieldErrorMessage>
          <PopoverPanel offset={8} width="trigger">
            <ListBox<T> className={s.listBox} renderEmptyState={() => <div className={ms.empty}>No results found</div>}>
              {children}
            </ListBox>
          </PopoverPanel>
        </>
      )}
    </RACComboBox>
  );
}
