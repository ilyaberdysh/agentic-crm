import {
  type CSSProperties,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useContext,
  useRef,
} from 'react';
import {
  Autocomplete,
  Collection,
  Header,
  Input,
  Menu as RACMenu,
  MenuItem as RACMenuItem,
  type MenuItemProps as RACMenuItemProps,
  type MenuProps as RACMenuProps,
  MenuSection as RACMenuSection,
  type MenuSectionProps as RACMenuSectionProps,
  MenuTrigger as RACMenuTrigger,
  type MenuTriggerProps as RACMenuTriggerProps,
  SearchField,
  Separator,
  SubmenuTrigger,
  useFilter,
} from 'react-aria-components';
import { CheckCircleFilled } from '../../icons/custom';
import { Icon } from '../../icons/Icon';
import type { IconName } from '../../icons/iconMap';
import type { IconGlyph } from '../../icons/types';
import { listItem, listItemDescription, listItemLabel, menuLabel, menuSeparator } from '../../theme/shared.css';
import { cx } from '../../utils/cx';
import { Kbd } from '../Kbd/Kbd';
import { PopoverPanel, type PopoverPanelProps } from '../Popover/Popover';
import * as s from './Menu.css';

type MenuVariant = 'default' | 'contextual';
const MenuVariantContext = createContext<MenuVariant>('default');

export interface MenuTriggerProps extends Omit<RACMenuTriggerProps, 'children'> {
  /** [trigger, <Menu/>] */
  children: [ReactElement, ReactElement];
}

/** Opens a Menu from a pressable trigger (dropdown semantics: ↑/↓, Home/End, typeahead, Esc). */
export function MenuTrigger(props: MenuTriggerProps) {
  return <RACMenuTrigger {...props} />;
}

export interface MenuProps<T extends object>
  extends Omit<RACMenuProps<T>, 'className' | 'style'>,
    Pick<PopoverPanelProps, 'placement' | 'offset' | 'crossOffset' | 'width' | 'shouldFlip' | 'maxHeight'> {
  /** `contextual`: the dark right-click menu (floating surface, no shadow). */
  variant?: MenuVariant;
  className?: string;
  style?: CSSProperties;
  popoverClassName?: string;
}

/**
 * A menu in the shared floating chrome (radius 12, padding 4, items 32 px, gap 1). Use inside
 * MenuTrigger, or nested via Submenu. With `selectionMode` items show a trailing accent check.
 */
export function Menu<T extends object>({
  variant = 'default',
  placement,
  offset,
  crossOffset,
  width,
  shouldFlip,
  maxHeight,
  className,
  style,
  popoverClassName,
  ...rest
}: MenuProps<T>) {
  return (
    <PopoverPanel
      placement={placement}
      offset={offset}
      crossOffset={crossOffset}
      width={width}
      shouldFlip={shouldFlip}
      maxHeight={maxHeight}
      className={cx(variant === 'contextual' && s.contextual, popoverClassName)}
    >
      <MenuVariantContext.Provider value={variant}>
        <RACMenu className={cx(s.menu, className)} style={style} {...rest} />
      </MenuVariantContext.Provider>
    </PopoverPanel>
  );
}

/** A menu without its own popover, for embedding in custom panels. */
export function MenuList<T extends object>({ className, ...rest }: RACMenuProps<T> & { className?: string }) {
  return <RACMenu className={cx(s.menu, className)} {...rest} />;
}

export type MenuItemVariant = 'primary' | 'danger' | 'link' | 'help';

export interface MenuItemProps<T extends object = object> extends Omit<RACMenuItemProps<T>, 'children' | 'className'> {
  children?: ReactNode;
  icon?: IconName | IconGlyph | ReactElement;
  /** Secondary line under the label (12 px secondary). */
  description?: ReactNode;
  /** Shortcut caps shown at the right, e.g. `['mod', 'c']`. */
  shortcut?: string[];
  /** Arbitrary trailing content (count, switch…). */
  trailing?: ReactNode;
  variant?: MenuItemVariant;
  className?: string;
}

export function renderItemIcon(icon: MenuItemProps['icon']): ReactNode {
  if (!icon) return null;
  if (isValidElement(icon)) return icon;
  return <Icon icon={icon as IconName | IconGlyph} size={16} className={s.itemIcon} />;
}

export function MenuItem<T extends object = object>({
  children,
  icon,
  description,
  shortcut,
  trailing,
  variant = 'primary',
  className,
  textValue,
  ...rest
}: MenuItemProps<T>) {
  const menuVariant = useContext(MenuVariantContext);
  return (
    <RACMenuItem
      textValue={textValue ?? (typeof children === 'string' ? children : undefined)}
      className={cx(
        listItem,
        s.itemVariant[variant],
        menuVariant === 'contextual' && (variant === 'danger' ? s.contextualDanger : s.contextualItem),
        className,
      )}
      {...rest}
    >
      {({ isSelected, hasSubmenu, selectionMode }) => (
        <>
          {renderItemIcon(icon)}
          {description ? (
            <span className={s.itemText}>
              <span className={listItemLabel}>{children}</span>
              <span className={listItemDescription}>{description}</span>
            </span>
          ) : (
            <span className={listItemLabel}>{children}</span>
          )}
          {(trailing || shortcut || hasSubmenu || (selectionMode !== 'none' && isSelected)) && (
            <span className={s.itemTrailing}>
              {trailing}
              {shortcut && <Kbd keys={shortcut} size={16} />}
              {selectionMode !== 'none' && isSelected && <CheckCircleFilled size={16} className={s.check} />}
              {hasSubmenu && <Icon icon="chevronRight" size={16} className={s.submenuChevron} />}
            </span>
          )}
        </>
      )}
    </RACMenuItem>
  );
}

export interface MenuSectionProps<T extends object> extends Omit<RACMenuSectionProps<T>, 'className'> {
  /** Section label (text12 secondary). */
  title?: ReactNode;
  className?: string;
}

export function MenuSection<T extends object>({ title, children, items, className, ...rest }: MenuSectionProps<T>) {
  return (
    <RACMenuSection className={cx(s.section, className)} {...rest}>
      {title && <Header className={menuLabel}>{title}</Header>}
      {typeof children === 'function' ? <Collection items={items}>{children}</Collection> : children}
    </RACMenuSection>
  );
}

export function MenuSeparator() {
  const variant = useContext(MenuVariantContext);
  return <Separator className={cx(menuSeparator, variant === 'contextual' && s.contextualSeparator)} />;
}

export interface SubmenuProps extends Omit<MenuItemProps, 'children'> {
  label: ReactNode;
  children: ReactNode;
  menuWidth?: number;
}

/** Flyout submenu (Radix DropdownMenu.Sub semantics: → opens, ← closes; offset −4 to overlap the padding). */
export function Submenu({ label, children, menuWidth, ...item }: SubmenuProps) {
  const variant = useContext(MenuVariantContext);
  return (
    <SubmenuTrigger>
      <MenuItem {...item}>{label}</MenuItem>
      <Menu variant={variant} placement="end top" offset={-4} crossOffset={-5} width={menuWidth}>
        {children}
      </Menu>
    </SubmenuTrigger>
  );
}

export interface FilterableMenuProps<T extends object> extends MenuProps<T> {
  /** Placeholder of the filter input (default "Search..."). */
  placeholder?: string;
  /** Shown when nothing matches (default "No results found"). */
  emptyLabel?: ReactNode;
}

/** Menu with a filter input on top (PopoverMenu.FilterInput): typing filters items, ↑/↓ still navigate. */
export function FilterableMenu<T extends object>({
  placeholder = 'Search...',
  emptyLabel = 'No results found',
  variant = 'default',
  placement,
  offset,
  width,
  className,
  style,
  popoverClassName,
  ...rest
}: FilterableMenuProps<T>) {
  const { contains } = useFilter({ sensitivity: 'base' });
  return (
    <PopoverPanel placement={placement} offset={offset} width={width} className={popoverClassName}>
      <MenuVariantContext.Provider value={variant}>
        <Autocomplete filter={contains}>
          <SearchField aria-label={placeholder} autoFocus className={s.filterRow}>
            <Icon icon="search" size={16} className={s.filterIcon} />
            <Input placeholder={placeholder} className={s.filterInput} />
          </SearchField>
          <RACMenu<T>
            className={cx(s.menu, className)}
            style={style}
            renderEmptyState={() => <div className={s.empty}>{emptyLabel}</div>}
            {...rest}
          />
        </Autocomplete>
      </MenuVariantContext.Provider>
    </PopoverPanel>
  );
}

export interface ContextMenuProps<T extends object> extends Omit<RACMenuProps<T>, 'className' | 'style'> {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Viewport coordinates of the pointer that opened it. */
  x: number;
  y: number;
  width?: number;
}

/**
 * Right-click menu opened at the pointer (ContextMenu): always the dark contextual chrome, no
 * trigger element. Choosing an item closes it.
 */
export function ContextMenu<T extends object>({
  isOpen,
  onOpenChange,
  x,
  y,
  width,
  onAction,
  ...rest
}: ContextMenuProps<T>) {
  const anchor = useRef<HTMLDivElement>(null);
  return (
    <>
      <div
        ref={anchor}
        aria-hidden="true"
        style={{ position: 'fixed', left: x, top: y, width: 1, height: 1, pointerEvents: 'none' }}
      />
      <PopoverPanel
        triggerRef={anchor}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        placement="bottom start"
        offset={2}
        width={width}
        className={s.contextual}
      >
        <MenuVariantContext.Provider value="contextual">
          <RACMenu
            className={s.menu}
            autoFocus="first"
            onAction={(...args: Parameters<NonNullable<RACMenuProps<T>['onAction']>>) => {
              onAction?.(...args);
              onOpenChange(false);
            }}
            {...rest}
          />
        </MenuVariantContext.Provider>
      </PopoverPanel>
    </>
  );
}
