// Attribute path picker (CROSS-DOMAIN B.7): searchable list with relationship drill-downs that replace the content
// (header "‹ Search company attributes..."), sub-field drill-downs, ↑/↓ + Enter/→ to drill, ←/⌫ on an empty query to
// go back. Used by Add column, View settings "Add attribute to view", filters and sorts.
import { Icon } from '@agentic-crm/ui';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useDefinitions, useSchemaIndex } from '../data';
import {
  levelTargets,
  type PickerItem,
  type PickerLevel,
  type PickerPurpose,
  type PickerSelection,
  searchItems,
} from '../pickerModel';
import * as s from '../views.css';

/** Height of attribute picker popovers (evidence C1/05, 06: 378 px; the list scrolls). */
export const PICKER_MAX_HEIGHT = 378;

/** Search queries remembered for the session (the column picker keeps its query between openings, C1 §3.2). */
const rememberedQueries = new Map<string, string>();

export interface PathPickerProps {
  rootDefinitionId: string;
  purpose: PickerPurpose;
  onSelect: (selection: PickerSelection) => void;
  /** Placeholder of the root level (drilled levels name their object). Default "Search {object} attributes...". */
  placeholder?: string;
  /** Remembers the query under this key for the session. */
  queryMemoryKey?: string;
  /** Rows under a separator at the bottom (e.g. "Create new attribute"). */
  footer?: ReactNode;
  /** Accessible name of the list. */
  label?: string;
}

export function PathPicker({
  rootDefinitionId,
  purpose,
  onSelect,
  placeholder,
  queryMemoryKey,
  footer,
  label = 'Attributes',
}: PathPickerProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [stack, setStack] = useState<PickerLevel[]>([
    { kind: 'object', definitionId: rootDefinitionId, prefix: [], via: null },
  ]);
  const [query, setQueryState] = useState(() => (queryMemoryKey ? (rememberedQueries.get(queryMemoryKey) ?? '') : ''));
  const [active, setActive] = useState(0);
  const definitions = useDefinitions();
  const level = stack[stack.length - 1] as PickerLevel;

  const stackDefs = useMemo(() => stack.flatMap((l) => (l.kind === 'object' ? [l.definitionId] : [])), [stack]);
  const base = useSchemaIndex(rootDefinitionId, stackDefs);
  const targets = useMemo(() => levelTargets(base, level), [base, level]);
  const extra = useMemo(() => [...stackDefs, ...targets], [stackDefs, targets]);
  const index = useSchemaIndex(rootDefinitionId, extra) ?? base;

  const items = useMemo(() => (index ? searchItems(index, level, purpose, query) : []), [index, level, purpose, query]);

  const setQuery = (q: string) => {
    setQueryState(q);
    setActive(0);
    if (queryMemoryKey && stack.length === 1) rememberedQueries.set(queryMemoryKey, q);
  };

  useEffect(() => {
    // A drilled level starts at its top (the parent list may have been scrolled to the relationship).
    if (listRef.current) listRef.current.scrollTop = 0;
    inputRef.current?.focus();
  }, [stack.length]);

  useEffect(() => {
    if (active >= items.length) setActive(Math.max(0, items.length - 1));
  }, [items.length, active]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const drill = (item: PickerItem) => {
    if (!item.drill) return;
    setStack((prev) => [...prev, item.drill as PickerLevel]);
    setQueryState('');
    setActive(0);
  };

  const back = () => {
    if (stack.length <= 1) return;
    setStack((prev) => prev.slice(0, -1));
    setQueryState('');
    setActive(0);
  };

  const activate = (item: PickerItem | undefined) => {
    if (!item) return;
    if (item.drill && !item.clickSelects) drill(item);
    else if (item.select) onSelect(item.select);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (items.length === 0 ? 0 : (i - 1 + items.length) % items.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activate(items[active]);
    } else if (e.key === 'ArrowRight' && items[active]?.drill && e.currentTarget.selectionStart === query.length) {
      e.preventDefault();
      drill(items[active] as PickerItem);
    } else if ((e.key === 'ArrowLeft' || e.key === 'Backspace') && query === '' && stack.length > 1) {
      e.preventDefault();
      back();
    }
  };

  const levelPlaceholder = (() => {
    if (stack.length === 1 && placeholder) return placeholder;
    const objectLevel = [...stack].reverse().find((l) => l.kind === 'object');
    const def =
      objectLevel?.kind === 'object' ? definitions?.find((d) => d.id === objectLevel.definitionId) : undefined;
    return def ? `Search ${def.singularNoun.toLowerCase()} attributes...` : 'Search attributes...';
  })();

  return (
    <div className={s.panelColumn}>
      <div className={stack.length > 1 ? `${s.searchRow} ${s.searchRowWithBack}` : s.searchRow}>
        {stack.length > 1 && (
          <button type="button" className={s.backButton} aria-label="Back" onClick={back} tabIndex={-1}>
            <Icon icon="chevronLeft" size={16} />
          </button>
        )}
        <input
          ref={inputRef}
          className={s.searchInput}
          type="search"
          placeholder={levelPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
          aria-label={levelPlaceholder}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div ref={listRef} id={listId} role="listbox" aria-label={label} className={s.list}>
        {!index && <div className={s.empty}>Loading…</div>}
        {index && items.length === 0 && <div className={s.empty}>No results found</div>}
        {items.map((item, i) => (
          <div
            key={item.key}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            data-index={i}
            data-active={i === active || undefined}
            className={item.indent ? `${s.row} ${s.indent}` : s.row}
            onMouseMove={() => setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => activate(item)}
          >
            <Icon icon={item.icon} size={16} className={s.rowIcon} />
            <span className={s.rowLabel}>{item.label}</span>
            {item.drill && (
              <span
                className={s.rowTrailing}
                onClick={
                  item.clickSelects
                    ? (e) => {
                        e.stopPropagation();
                        drill(item);
                      }
                    : undefined
                }
                onKeyDown={() => {}}
                // Keyboard users drill with →; the chevron is a pointer affordance.
                aria-hidden
              >
                {item.count !== undefined && item.count > 0 && <span>{item.count}</span>}
                <Icon icon="chevronRight" size={16} className={s.chevron} />
              </span>
            )}
          </div>
        ))}
      </div>
      {/* The footer ("Create new attribute") belongs to the root level only (evidence C1/06). */}
      {footer && stack.length === 1 && (
        <>
          <hr className={s.separator} />
          {footer}
        </>
      )}
    </div>
  );
}

export interface PickerFooterItemProps {
  icon: Parameters<typeof Icon>[0]['icon'];
  children: ReactNode;
  onPress: () => void;
  chevron?: boolean;
}

/** A plain row for picker footers ("+ Create new attribute ›"). */
export function PickerFooterItem({ icon, children, onPress, chevron }: PickerFooterItemProps) {
  const [hover, setHover] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      className={s.row}
      data-active={hover || undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onPress}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPress();
        }
      }}
    >
      <Icon icon={icon} size={16} className={s.rowIcon} />
      <span className={s.rowLabel}>{children}</span>
      {chevron && <Icon icon="chevronRight" size={16} className={s.chevron} />}
    </div>
  );
}
