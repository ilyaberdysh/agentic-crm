// The attribute pickers of the report editor (builder §3.1–3.3, §7–§10; CROSS-DOMAIN B.7): the same searchable path
// picker as filters and columns (relationship drill-downs that replace the list, ← / ⌫ to go back, → to drill), limited
// to what each control accepts:
//   metric   numeric attributes (number, currency, rating) and relationships that lead to some, plus a pinned
//            "Count Records" row under "Metrics"
//   group    every attribute (group by / segment by); relationships are selectable themselves (group by record)
//   status   status and single-select attributes, also through relationships (funnel, time in stage, stage changed)
//   segment  status, select and actor-reference attributes (historical "Segment by")
import type { AttributeDefinition } from '@agentic-crm/contracts';
import { Icon } from '@agentic-crm/ui';
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useDefinitions, useSchemaIndex } from '../../views/data';
import {
  levelItems,
  levelTargets,
  type PickerItem,
  type PickerLevel,
  type PickerSelection,
  searchItems,
} from '../../views/pickerModel';
import type { SchemaIndex } from '../../views/schemaIndex';
import * as s from '../../views/views.css';
import { isNumericAttribute, isSegmentableAttribute, isStageAttribute } from '../reportModel';

export type PickerMode = 'metric' | 'group' | 'status' | 'segment';

const ACCEPT: Record<PickerMode, (a: Pick<AttributeDefinition, 'type' | 'isMultiselect'>) => boolean> = {
  metric: isNumericAttribute,
  group: () => true,
  status: isStageAttribute,
  segment: isSegmentableAttribute,
};

/** Height of the picker popovers (same as filters: 378 px). */
export const REPORT_PICKER_MAX_HEIGHT = 378;

/** Keeps the items a mode accepts; relationships stay when they are selectable themselves or lead to accepted ones. */
export function refineItems(index: SchemaIndex, items: PickerItem[], mode: PickerMode): PickerItem[] {
  const ok = ACCEPT[mode];
  const out: PickerItem[] = [];
  for (const item of items) {
    const attr = item.attribute;
    if (item.isSelf) {
      if (mode === 'group') out.push(item);
      continue;
    }
    if (item.drill?.kind === 'object') {
      const selectable = mode === 'group';
      const children = index.attributes(item.drill.definitionId) ? levelItems(index, item.drill, 'filter') : null;
      const accepted = children
        ? children.filter((c) => !c.isSelf && (c.drill?.kind === 'object' ? mode !== 'group' : ok(c.attribute)))
        : null;
      if (!selectable && accepted !== null && accepted.length === 0) continue;
      const { select, ...rest } = item;
      out.push({ ...(selectable ? item : rest), count: accepted ? accepted.length : undefined });
      void select;
      continue;
    }
    if (!ok(attr)) continue;
    if (mode === 'group' && attr.type === 'pipeline' && item.drill) {
      // Grouping by a status never offers the lifecycle phase.
      const { drill, clickSelects, ...rest } = item;
      void drill;
      void clickSelects;
      out.push(rest);
      continue;
    }
    out.push(item);
  }
  return out;
}

interface Row {
  kind: 'label' | 'pinned' | 'item';
  key: string;
  label: string;
  icon?: PickerItem['icon'];
  item?: PickerItem;
  onSelect?: () => void;
}

export interface ReportPathPickerProps {
  rootDefinitionId: string;
  mode: PickerMode;
  onSelect: (selection: PickerSelection) => void;
  /** Metric mode: the pinned "Count Records" row. */
  onSelectCount?: () => void;
  placeholder?: string;
  label?: string;
}

export function ReportPathPicker({
  rootDefinitionId,
  mode,
  onSelect,
  onSelectCount,
  placeholder = 'Search attributes...',
  label = 'Attributes',
}: ReportPathPickerProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [stack, setStack] = useState<PickerLevel[]>([
    { kind: 'object', definitionId: rootDefinitionId, prefix: [], via: null },
  ]);
  const [query, setQueryState] = useState('');
  const [active, setActive] = useState(0);
  const definitions = useDefinitions();
  const level = stack[stack.length - 1] as PickerLevel;
  const stackDefs = useMemo(() => stack.flatMap((l) => (l.kind === 'object' ? [l.definitionId] : [])), [stack]);
  const base = useSchemaIndex(rootDefinitionId, stackDefs);
  const targets = useMemo(() => levelTargets(base, level), [base, level]);
  const extra = useMemo(() => [...stackDefs, ...targets], [stackDefs, targets]);
  const index = useSchemaIndex(rootDefinitionId, extra) ?? base;
  const root = stack.length === 1;
  const rootDef = definitions?.find((d) => d.id === rootDefinitionId);

  const items = useMemo(
    () => (index ? refineItems(index, searchItems(index, level, 'filter', query), mode) : []),
    [index, level, query, mode],
  );
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const pinned = mode === 'metric' && root && onSelectCount && 'count records'.includes(query.trim().toLowerCase());
    if (pinned) {
      out.push({ kind: 'label', key: 'l-metrics', label: 'Metrics' });
      out.push({ kind: 'pinned', key: 'count', label: 'Count Records', icon: 'attrNumber', onSelect: onSelectCount });
    }
    if (mode === 'metric' && root && items.length > 0) {
      out.push({ kind: 'label', key: 'l-attrs', label: `${rootDef?.singularNoun ?? 'Record'} attributes` });
    }
    for (const item of items) out.push({ kind: 'item', key: item.key, label: item.label, icon: item.icon, item });
    return out;
  }, [mode, root, onSelectCount, query, items, rootDef?.singularNoun]);
  const selectable = useMemo(() => rows.filter((r) => r.kind !== 'label'), [rows]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
    inputRef.current?.focus();
  }, [stack.length]);
  useEffect(() => {
    if (active >= selectable.length) setActive(Math.max(0, selectable.length - 1));
  }, [selectable.length, active]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const setQuery = (q: string) => {
    setQueryState(q);
    setActive(0);
  };
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
  const activate = (row: Row | undefined) => {
    if (!row) return;
    if (row.kind === 'pinned') return row.onSelect?.();
    const item = row.item;
    if (!item) return;
    if (item.drill && !item.clickSelects && !item.select) drill(item);
    else if (item.drill && !item.clickSelects) drill(item);
    else if (item.select) onSelect(item.select);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const current = selectable[active];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (selectable.length === 0 ? 0 : (i + 1) % selectable.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (selectable.length === 0 ? 0 : (i - 1 + selectable.length) % selectable.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activate(current);
    } else if (e.key === 'ArrowRight' && current?.item?.drill && e.currentTarget.selectionStart === query.length) {
      e.preventDefault();
      drill(current.item);
    } else if ((e.key === 'ArrowLeft' || e.key === 'Backspace') && query === '' && stack.length > 1) {
      e.preventDefault();
      back();
    }
  };

  const levelPlaceholder = (() => {
    if (root) return placeholder;
    const objectLevel = [...stack].reverse().find((l) => l.kind === 'object');
    const def =
      objectLevel?.kind === 'object' ? definitions?.find((d) => d.id === objectLevel.definitionId) : undefined;
    return def ? `Search ${def.singularNoun.toLowerCase()} attributes...` : placeholder;
  })();

  let selectableIndex = -1;
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
          aria-activedescendant={selectable[active] ? `${listId}-${active}` : undefined}
          aria-label={levelPlaceholder}
          autoComplete="off"
          spellCheck={false}
          data-testid="report-picker-search"
        />
      </div>
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={label}
        className={s.list}
        data-testid="report-picker-list"
      >
        {!index && <div className={s.empty}>Loading…</div>}
        {index && selectable.length === 0 && (
          <div className={s.empty}>
            {mode === 'metric'
              ? 'No numeric attributes found'
              : mode === 'status'
                ? 'No discrete attributes found'
                : 'No results found'}
          </div>
        )}
        {rows.map((row) => {
          if (row.kind === 'label') {
            return (
              <div key={row.key} className={s.sectionLabel}>
                {row.label}
              </div>
            );
          }
          selectableIndex += 1;
          const i = selectableIndex;
          const item = row.item;
          return (
            <div
              key={row.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              data-index={i}
              data-active={i === active || undefined}
              data-testid="report-picker-row"
              data-label={row.label}
              className={item?.indent ? `${s.row} ${s.indent}` : s.row}
              onMouseMove={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => activate(row)}
            >
              {row.icon && <Icon icon={row.icon} size={16} className={s.rowIcon} />}
              <span className={s.rowLabel}>{row.label}</span>
              {item?.drill && (
                <span
                  className={s.rowTrailing}
                  onClick={
                    item.clickSelects || item.select
                      ? (e) => {
                          e.stopPropagation();
                          drill(item);
                        }
                      : undefined
                  }
                  onKeyDown={() => {}}
                  aria-hidden
                >
                  {item.count !== undefined && item.count > 0 && <span>{item.count}</span>}
                  <Icon icon="chevronRight" size={16} className={s.chevron} />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
