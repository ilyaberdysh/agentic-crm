// Editor shells: the inline overlay that sits over a cell / field (text-like editors) and the popover anchored to it
// (pickers, calendars, value lists), plus the searchable picker list they share.
import { cx, Icon, PopoverPanel, useThemeClassName } from '@agentic-crm/ui';
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Dialog } from 'react-aria-components';
import { createPortal } from 'react-dom';
import type { Density } from '../types';
import * as s from './editors.css';

// ---- anchor geometry -------------------------------------------------------------------------------------------------

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The anchor's viewport rect, kept current while the page scrolls or resizes. */
export function useAnchorRect(anchor: HTMLElement | null | undefined): Rect | null {
  const [rect, setRect] = useState<Rect | null>(() => (anchor ? toRect(anchor) : null));
  useLayoutEffect(() => {
    if (!anchor) return;
    const update = () => setRect(toRect(anchor));
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(anchor);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      ro?.disconnect();
    };
  }, [anchor]);
  return rect;
}

function toRect(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

// ---- inline overlay ------------------------------------------------------------------------------------------------

export interface EditorOverlayProps {
  anchor?: HTMLElement | null;
  density?: Density;
  /** Minimum overlay width (text 351, inputs 178; the anchor width when larger). */
  minWidth?: number;
  invalid?: boolean;
  children: ReactNode;
  /** Called on a pointer press outside the overlay (blur commits). */
  onOutside?: () => void;
  className?: string;
  label?: string;
}

/**
 * The cell editor surface (layout.md §4): over the anchor, 1 px higher than the cell (covers the row rule above),
 * at least `minWidth` wide, growing downward with its content. Field density: the anchor's box with an accent ring.
 * Without an anchor it renders in place.
 */
export function EditorOverlay({
  anchor,
  density = 'cell',
  minWidth = 351,
  invalid,
  children,
  onOutside,
  className,
  label,
}: EditorOverlayProps) {
  const rect = useAnchorRect(anchor);
  const theme = useThemeClassName();
  const ref = useRef<HTMLDivElement>(null);
  const outside = useRef(onOutside);
  outside.current = onOutside;

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = ref.current;
      if (el && !el.contains(e.target as Node)) outside.current?.();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  const field = density === 'field';
  const classes = cx(
    s.overlay,
    field && s.overlayField,
    invalid && s.overlayInvalid,
    !anchor && s.overlayInline,
    className,
  );
  if (!anchor) {
    return (
      <div ref={ref} className={classes} role="group" aria-label={label}>
        {children}
      </div>
    );
  }
  if (!rect) return null;
  const style: CSSProperties = field
    ? { left: rect.left, top: rect.top, width: rect.width, minHeight: rect.height }
    : {
        left: rect.left,
        top: rect.top - 1,
        width: Math.max(minWidth, rect.width),
        minHeight: rect.height + 1,
        maxWidth: `calc(100vw - ${Math.max(0, rect.left) + 8}px)`,
      };
  return createPortal(
    <div className={theme} style={{ display: 'contents' }}>
      <div ref={ref} className={classes} style={style} role="group" aria-label={label} data-attribute-editor="">
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ---- popover --------------------------------------------------------------------------------------------------------

export interface EditorPopoverProps {
  anchor?: HTMLElement | null;
  density?: Density;
  /** Fixed width (default 282, or the anchor width when wider). */
  width?: number;
  label: string;
  children: ReactNode;
  /** Outside press (not Escape: the content handles Escape itself). */
  onDismiss: () => void;
  /** Escape inside the panel. */
  onEscape: () => void;
  placement?: 'bottom start' | 'right';
  className?: string;
}

/**
 * Popover editors cover the cell they edit: the panel's top-left sits at the cell's top-left (3 px above, 1 px to
 * the left; evidence/C1/25, 28–31) and flips upward near the bottom of the window.
 */
export function EditorPopover({
  anchor,
  density = 'cell',
  width,
  label,
  children,
  onDismiss,
  onEscape,
  placement = 'bottom start',
  className,
}: EditorPopoverProps) {
  const triggerRef = useMemo(() => ({ current: anchor ?? null }), [anchor]) as RefObject<HTMLElement | null>;
  const rect = useAnchorRect(anchor);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      onEscape();
    }
  };
  const w = width ?? Math.max(282, Math.round(rect?.width ?? 0));
  const content = (
    <div onKeyDown={onKeyDown} className={s.dialog}>
      {children}
    </div>
  );
  if (!anchor) {
    return (
      <div className={cx(s.panelInline, className)} style={{ width: w }} role="dialog" aria-label={label}>
        {content}
      </div>
    );
  }
  const right = placement === 'right';
  return (
    <PopoverPanel
      triggerRef={triggerRef as RefObject<Element>}
      isOpen
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
      placement={right ? 'right' : 'bottom start'}
      offset={right ? 3 : -(Math.round(rect?.height ?? 36) + (density === 'field' ? 2 : 3))}
      crossOffset={right ? 0 : -1}
      width={w}
      padding={0}
      className={cx(s.panel, className)}
      shouldFlip
    >
      <Dialog aria-label={label} className={s.dialog}>
        {content}
      </Dialog>
    </PopoverPanel>
  );
}

// ---- picker list -----------------------------------------------------------------------------------------------------

export interface PickerItem {
  key: string;
  /** Row content (left side). */
  content: ReactNode;
  /** Trailing mark: accent check circle (single) or checkbox (multi). */
  mark?: 'check' | 'checkbox' | null;
  selected?: boolean;
  /** Draws a separator above this row. */
  separatorBefore?: boolean;
  /** Section label above this row. */
  labelBefore?: string;
  /** Standard 8 px row padding (text rows, create rows) instead of the 5 px chip-row padding. */
  padded?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  textValue?: string;
}

export interface PickerPanelProps {
  placeholder: string;
  query: string;
  onQueryChange: (query: string) => void;
  items: PickerItem[];
  emptyText?: string;
  /** Sticky footer content (e.g. a create row rendered as a PickerItem list). */
  footerItems?: PickerItem[];
  /** Keyboard: Tab / Shift+Tab (commit and move in the table). */
  onTab?: (shift: boolean) => void;
  isLoading?: boolean;
  label: string;
}

function CheckCircle() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className={s.optionCheck}>
      <circle cx="8" cy="8" r="6.5" fill="currentColor" />
      <path
        d="M5.4 8.2 7.15 9.9 10.6 6.3"
        stroke="#fff"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function OptionCheckbox({ checked }: { checked: boolean }) {
  return (
    <span className={cx(s.optionCheckbox, checked && s.optionCheckboxOn)} aria-hidden="true">
      {checked && (
        <svg width="9" height="8" viewBox="0 0 9 8" fill="none">
          <path
            d="M1.25 4.25 3.5 6.5 7.75 1.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}

/**
 * Search row + listbox with keyboard navigation (↑/↓, Home/End, Enter picks, typing filters). The caller filters
 * and orders the items; the active row follows the pointer like Attio's menus.
 */
export function PickerPanel({
  placeholder,
  query,
  onQueryChange,
  items,
  emptyText = 'No results found',
  footerItems = [],
  onTab,
  isLoading,
  label,
}: PickerPanelProps) {
  const all = useMemo(() => [...items, ...footerItems].filter((i) => !i.disabled), [items, footerItems]);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeKey = all[Math.min(active, all.length - 1)]?.key;

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!activeKey) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(activeKey)}"]`);
    if (typeof el?.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [activeKey]);

  const pick = useCallback((item: PickerItem | undefined) => item?.onSelect(), []);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((i) => (all.length ? (i + 1) % all.length : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((i) => (all.length ? (i - 1 + all.length) % all.length : 0));
        break;
      case 'Home':
        if (!query) {
          e.preventDefault();
          setActive(0);
        }
        break;
      case 'End':
        if (!query) {
          e.preventDefault();
          setActive(all.length - 1);
        }
        break;
      case 'Enter':
        e.preventDefault();
        pick(all[Math.min(active, all.length - 1)]);
        break;
      case 'Tab':
        if (onTab) {
          e.preventDefault();
          onTab(e.shiftKey);
        }
        break;
    }
  };

  const renderItem = (item: PickerItem) => {
    const isActive = item.key === activeKey;
    return (
      <div key={item.key} style={{ display: 'contents' }}>
        {item.separatorBefore && <div className={s.separator} role="separator" />}
        {item.labelBefore && <div className={s.sectionLabel}>{item.labelBefore}</div>}
        <div
          id={`${listId}-${item.key}`}
          data-key={item.key}
          role="option"
          aria-selected={item.selected ?? false}
          aria-disabled={item.disabled || undefined}
          className={cx(s.option, item.padded && s.optionPadded, isActive && s.optionActive)}
          onPointerMove={() => {
            const index = all.findIndex((x) => x.key === item.key);
            if (index !== -1 && index !== active) setActive(index);
          }}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => !item.disabled && pick(item)}
        >
          <span className={s.optionMain}>{item.content}</span>
          {item.mark && (
            <span className={s.optionTrailing}>
              {item.mark === 'check' ? (
                item.selected ? (
                  <CheckCircle />
                ) : null
              ) : (
                <OptionCheckbox checked={Boolean(item.selected)} />
              )}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className={s.searchRow}>
        <Icon icon="search" size={16} className={s.searchIcon} />
        <input
          ref={inputRef}
          className={s.searchInput}
          placeholder={placeholder}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-label={label}
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeKey ? `${listId}-${activeKey}` : undefined}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div ref={listRef} id={listId} className={s.list} role="listbox" aria-label={label}>
        {items.map(renderItem)}
        {items.length === 0 && !isLoading && footerItems.length === 0 && <div className={s.empty}>{emptyText}</div>}
      </div>
      {footerItems.length > 0 && <div className={s.footer}>{footerItems.map(renderItem)}</div>}
    </>
  );
}

/** "+ Create “Zeta”" row content. */
export function CreateRowContent({ label }: { label: string }) {
  return (
    <>
      <Icon icon="add" size={16} className={s.createIcon} style={{ marginRight: 2 }} />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </>
  );
}
