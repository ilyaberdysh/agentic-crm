// Import attribute picker (C2 import.md §I3, §I9; evidence import-2-attribute-picker.png): "Search <object> attributes…",
// the writable attributes (Record ID first), relationships with the number of reachable attributes and a chevron that
// drills into the related object ("Client 18 ›"), names into First / Last / Full name; lists group "<Parent>
// attributes" (through Parent Record) and "List attributes". Footer "+ Create new attribute ›" opens the type list.
import type { AttributeDefinition, Path } from '@agentic-crm/contracts';
import { Icon, type IconName } from '@agentic-crm/ui';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { type PickerType, pickerEntriesFor } from '../../settings/objects/attributes/typeCatalog';
import { attributeIcon } from '../../views/operators';
import type { SchemaIndex } from '../../views/schemaIndex';
import type { NameField } from '../data/contract';
import { hopOf, isListDestination, mappableAttributes, NAME_FIELDS, parentRecordAttribute } from '../model/mapping';
import * as s from './wizard.css';

export interface PickedTarget {
  path: Path;
  field: NameField | null;
  attribute: AttributeDefinition;
}

type Level =
  | { kind: 'root' }
  | { kind: 'object'; via: AttributeDefinition; definitionId: string }
  | { kind: 'name'; prefix: Path; attribute: AttributeDefinition }
  | { kind: 'types' };

interface Item {
  key: string;
  label: string;
  icon: IconName;
  group?: string;
  count?: number;
  select?: PickedTarget;
  drill?: Level;
  type?: PickerType;
}

function itemsFor(index: SchemaIndex, destinationId: string, level: Level): Item[] {
  const destination = index.definition(destinationId);
  const attrItems = (definitionId: string, prefix: Path, group?: string, drillRelations = true): Item[] =>
    mappableAttributes(index, definitionId).map((a) => {
      const path = [...prefix, hopOf(a)];
      const base: Item = {
        key: path.map((h) => h.attributeDefinitionId).join('/'),
        label: a.title,
        icon: attributeIcon(a),
        group,
        select: { path, field: a.type === 'personal-name' ? 'full_name' : null, attribute: a },
      };
      if (a.type === 'personal-name') return { ...base, drill: { kind: 'name', prefix: path, attribute: a }, count: 3 };
      const target = index.targetOf(a);
      if (drillRelations && prefix.length === 0 && a.type === 'entity-reference' && target) {
        const count = index.attributes(target) ? mappableAttributes(index, target).length : undefined;
        return { ...base, drill: { kind: 'object', via: a, definitionId: target }, count };
      }
      return base;
    });

  switch (level.kind) {
    case 'root': {
      if (!isListDestination(destination)) return attrItems(destinationId, []);
      const parent = parentRecordAttribute(index, destinationId);
      const target = parent ? index.targetOf(parent) : null;
      const parentDef = target ? index.definition(target) : undefined;
      const out: Item[] = [];
      if (parent && target)
        out.push(
          ...attrItems(target, [hopOf(parent)], `${parentDef?.singularNoun ?? 'Parent record'} attributes`, false),
        );
      out.push(...attrItems(destinationId, [], 'List attributes', false));
      return out;
    }
    case 'object':
      return attrItems(level.definitionId, [hopOf(level.via)], undefined, false);
    case 'name':
      return NAME_FIELDS.map((f) => ({
        key: `${level.attribute.id}#${f.field}`,
        label: f.label,
        icon: 'attrPersonalName' as IconName,
        select: { path: level.prefix, field: f.field, attribute: level.attribute },
      }));
    case 'types':
      return pickerEntriesFor(isListDestination(destination) ? 'list' : 'object')
        .filter((e) => e.id !== 'formula' && e.id !== 'relationship')
        .map((e) => ({ key: `type:${e.id}`, label: e.label, icon: e.icon, type: e.id }));
  }
}

export interface AttributePickerProps {
  index: SchemaIndex;
  destinationId: string;
  onSelect: (target: PickedTarget) => void;
  onCreate: (type: PickerType) => void;
}

export function AttributePicker({ index, destinationId, onSelect, onCreate }: AttributePickerProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [stack, setStack] = useState<Level[]>([{ kind: 'root' }]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const level = stack[stack.length - 1] as Level;
  const destination = index.definition(destinationId);

  const items = useMemo(() => {
    const all = itemsFor(index, destinationId, level);
    const q = query.trim().toLowerCase();
    return q ? all.filter((i) => i.label.toLowerCase().includes(q)) : all;
  }, [index, destinationId, level, query]);

  useEffect(() => {
    inputRef.current?.focus();
    setActive(0);
  }, [stack.length]);

  const drill = (to: Level) => {
    setStack((st) => [...st, to]);
    setQuery('');
  };
  const back = () => {
    if (stack.length > 1) {
      setStack((st) => st.slice(0, -1));
      setQuery('');
    }
  };
  const activate = (item: Item | undefined) => {
    if (!item) return;
    if (item.type) return onCreate(item.type);
    if (item.select) return onSelect(item.select);
    if (item.drill) drill(item.drill);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activate(items[active]);
    } else if (e.key === 'ArrowRight' && items[active]?.drill) {
      e.preventDefault();
      drill(items[active]?.drill as Level);
    } else if ((e.key === 'ArrowLeft' || e.key === 'Backspace') && !query && stack.length > 1) {
      e.preventDefault();
      back();
    }
  };

  const placeholder = (() => {
    if (level.kind === 'types') return 'Search attribute types...';
    if (level.kind === 'object')
      return `Search ${(index.definition(level.definitionId)?.singularNoun ?? 'record').toLowerCase()} attributes...`;
    if (level.kind === 'name') return `Search ${level.attribute.title.toLowerCase()} fields...`;
    return `Search ${(destination?.singularNoun ?? 'record').toLowerCase()} attributes...`;
  })();

  let lastGroup: string | undefined;
  const rows: ReactNode[] = [];
  items.forEach((item, i) => {
    if (item.group && item.group !== lastGroup) {
      lastGroup = item.group;
      rows.push(
        <div key={`group:${item.group}`} className={s.pickerGroup}>
          {item.group}
        </div>,
      );
    }
    rows.push(
      <div
        key={item.key}
        id={`${listId}-${i}`}
        role="option"
        aria-selected={i === active}
        data-active={i === active || undefined}
        className={s.pickerRow}
        onMouseMove={() => setActive(i)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => activate(item)}
      >
        <Icon icon={item.icon} size={16} className={s.pickerRowIcon} />
        <span className={s.pickerRowLabel}>{item.label}</span>
        {item.drill && (
          <span
            className={s.pickerTrailing}
            onClick={(e) => {
              e.stopPropagation();
              drill(item.drill as Level);
            }}
            onKeyDown={() => {}}
            aria-hidden
          >
            {item.count !== undefined && item.count > 0 && <span>{item.count}</span>}
            <Icon icon="chevronRight" size={16} />
          </span>
        )}
      </div>,
    );
  });

  return (
    <div className={s.picker} data-testid="import-attribute-picker">
      <div className={s.pickerSearch}>
        {stack.length > 1 && (
          <button type="button" aria-label="Back" className={s.chipClear} onClick={back} tabIndex={-1}>
            <Icon icon="chevronLeft" size={16} />
          </button>
        )}
        <input
          ref={inputRef}
          className={s.pickerInput}
          placeholder={placeholder}
          aria-label={placeholder}
          value={query}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div id={listId} role="listbox" aria-label="Attributes" className={s.pickerList}>
        {rows.length === 0 ? <div className={s.pickerEmpty}>No results found</div> : rows}
      </div>
      {stack.length === 1 && (
        <>
          <hr className={s.pickerSeparator} />
          <div
            role="button"
            tabIndex={0}
            className={s.pickerRow}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => drill({ kind: 'types' })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                drill({ kind: 'types' });
              }
            }}
          >
            <Icon icon="add" size={16} className={s.pickerRowIcon} />
            <span className={s.pickerRowLabel}>Create new attribute</span>
            <Icon icon="chevronRight" size={16} className={s.pickerRowIcon} />
          </div>
        </>
      )}
    </div>
  );
}
