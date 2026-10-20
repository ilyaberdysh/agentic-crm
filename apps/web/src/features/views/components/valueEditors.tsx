// Filter value editors behind ONE adapter (C1 filters-sorts-calcs §3 "Value editors", §4 relative dates).
// Record and member values use the attributes feature's pickers (C1 contract: RecordPicker, MemberPicker; B.8).
import type { AttributeDefinition, PipelineStage, SelectOption } from '@agentic-crm/contracts';
import { Icon, StatusDot, Tag } from '@agentic-crm/ui';
import { useQueries, useQuery } from '@tanstack/react-query';
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { valuesQuery } from '../../../data/records';
import { MemberPicker, RecordPicker } from '../../attributes';
import {
  useAttributeOptions,
  useAttributes,
  useDefinitions,
  useMembers,
  useSchemaIndex,
  useWorkspaceRef,
} from '../data';
import { formatNumber, memberName } from '../format';
import {
  ACTOR_TYPES,
  type ActorValue,
  LIFECYCLE_PHASES,
  type OperatorId,
  type RecordValue,
  type StatusWasValue,
  type ValueKind,
} from '../operators';
import {
  customDaysOf,
  type DateValue,
  dateValueLabel,
  daysDuration,
  presetOf,
  RELATIVE_PRESETS,
  toLocalDay,
} from '../relativeDates';
import * as s from '../views.css';

export interface ValueEditorProps {
  attribute: AttributeDefinition;
  kind: ValueKind;
  operator: OperatorId;
  value: unknown;
  /** A complete value: applies the condition and closes the editor. */
  onCommit: (value: unknown) => void;
  onCancel: () => void;
}

/** Popover width per editor (evidence C1/20, 21, 24). */
export function editorWidth(kind: ValueKind): number {
  switch (kind) {
    case 'text':
      return 240;
    case 'number':
      return 184;
    case 'date':
    case 'relative-date':
    case 'status-was':
      return 274;
    case 'lifecycle':
      return 200;
    case 'rating':
      return 176;
    default:
      return 294;
  }
}

/** The adapter: one editor per value kind. */
export function FilterValueEditor(props: ValueEditorProps) {
  switch (props.kind) {
    case 'text':
      return <TextEditor {...props} />;
    case 'number':
      return <NumberEditor {...props} />;
    case 'rating':
      return <RatingEditor {...props} />;
    case 'option':
    case 'status':
      return <OptionEditor {...props} />;
    case 'record':
      return <RecordEditor {...props} />;
    case 'actor':
      return <ActorEditor {...props} />;
    case 'actor-type':
      return (
        <SearchList
          placeholder="Search..."
          items={ACTOR_TYPES.map((t) => ({ key: t.id, label: t.label }))}
          selected={typeof props.value === 'string' ? props.value : null}
          onPick={(key) => props.onCommit(key)}
          searchable={false}
        />
      );
    case 'lifecycle':
      return (
        <SearchList
          placeholder="Search..."
          items={LIFECYCLE_PHASES.map((t) => ({ key: t.id, label: t.label }))}
          selected={typeof props.value === 'string' ? props.value : null}
          onPick={(key) => props.onCommit(key)}
          searchable={false}
        />
      );
    case 'object':
      return <ObjectEditor {...props} />;
    case 'country':
      return <CountryEditor {...props} />;
    case 'date':
    case 'relative-date':
      return <DateEditor {...props} />;
    case 'status-was':
      return <StatusWasEditor {...props} />;
    default:
      return null;
  }
}

/** Placeholder of an empty value segment. */
export function valuePlaceholder(kind: ValueKind): string {
  switch (kind) {
    case 'number':
      return 'enter number...';
    case 'status':
    case 'status-was':
      return 'Select status...';
    case 'option':
      return 'Select option...';
    case 'record':
      return 'Select record...';
    case 'actor':
      return 'Select user...';
    case 'actor-type':
      return 'Select type...';
    case 'country':
      return 'Select country';
    case 'date':
    case 'relative-date':
      return 'Select date...';
    case 'lifecycle':
      return 'Select phase...';
    case 'object':
      return 'Select list...';
    case 'rating':
      return 'Select rating...';
    default:
      return 'Enter value...';
  }
}

// ---- value display ----------------------------------------------------------------------------------------------

/** The value segment's content for a complete value. */
export function ValueLabel({
  attribute,
  kind,
  value,
}: {
  attribute: AttributeDefinition;
  kind: ValueKind;
  value: unknown;
}) {
  switch (kind) {
    case 'text':
      return <>{String(value)}</>;
    case 'number':
      return <>{typeof value === 'number' ? formatNumber(value) : String(value)}</>;
    case 'rating':
      return (
        <span style={{ display: 'inline-flex', gap: 1, color: 'var(--ar-color-utilities-content-yellow)' }}>
          {Array.from({ length: Number(value) || 0 }, (_, i) => (
            <Icon key={i} icon="attrRating" size={12} />
          ))}
        </span>
      );
    case 'option':
    case 'status':
      return <OptionLabel attribute={attribute} id={String(value)} kind={kind} />;
    case 'status-was': {
      const v = value as StatusWasValue;
      return (
        <>
          <OptionLabel attribute={attribute} id={v.stageId} kind="status" />
          {v.date && (
            <span className={s.segmentMuted}>
              {v.dateOperator === 'gt' ? ' after ' : ' before '}
              {dateValueLabel(v.date, { timestamp: true })}
            </span>
          )}
        </>
      );
    }
    case 'record':
      return <RecordLabel attribute={attribute} value={value as RecordValue} />;
    case 'actor':
      return <ActorLabel value={value as ActorValue} />;
    case 'actor-type':
      return <>{ACTOR_TYPES.find((t) => t.id === value)?.label ?? String(value)}</>;
    case 'country':
      return <>{countryName(String(value))}</>;
    case 'lifecycle':
      return <>{LIFECYCLE_PHASES.find((t) => t.id === value)?.label ?? String(value)}</>;
    case 'object':
      return <ObjectLabel id={String(value)} />;
    case 'date':
    case 'relative-date':
      return <>{dateValueLabel(value as DateValue, { timestamp: attribute.type !== 'date' })}</>;
    default:
      return null;
  }
}

function OptionLabel({
  attribute,
  id,
  kind,
}: {
  attribute: AttributeDefinition;
  id: string;
  kind: 'option' | 'status';
}) {
  const options = useAttributeOptions(attribute);
  const option = options?.find((o) => o.id === id);
  if (!option) return <>{options ? 'Unknown option' : '…'}</>;
  if (kind === 'status')
    return (
      <span className={s.dropdownValue}>
        <StatusDot color={option.color} size={8} />
        {option.title}
      </span>
    );
  return (
    <Tag color={option.color} size={20}>
      {option.title}
    </Tag>
  );
}

function ActorLabel({ value }: { value: ActorValue }) {
  const members = useMembers();
  if (value.kind === 'current-member') return <>Current user</>;
  const m = members?.find((x) => x.id === value.id);
  return <>{m ? memberName(m) : '…'}</>;
}

// ---- shared bits ----------------------------------------------------------------------------------------------

interface ListItem {
  key: string;
  label: string;
  leading?: ReactNode;
  icon?: Parameters<typeof Icon>[0]['icon'];
}

/** Searchable single-choice list (option, status, record, actor, country pickers). */
function SearchList({
  placeholder,
  items,
  selected,
  onPick,
  query: controlledQuery,
  onQueryChange,
  searchable = true,
  filterLocally = true,
  emptyLabel = 'No results found',
  loading,
}: {
  placeholder: string;
  items: ListItem[];
  selected: string | null;
  onPick: (key: string) => void;
  query?: string;
  onQueryChange?: (q: string) => void;
  searchable?: boolean;
  filterLocally?: boolean;
  emptyLabel?: string;
  loading?: boolean;
}) {
  const [ownQuery, setOwnQuery] = useState('');
  const query = controlledQuery ?? ownQuery;
  const setQuery = onQueryChange ?? setOwnQuery;
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return filterLocally && q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
  }, [items, query, filterLocally]);
  useEffect(() => {
    if (active >= visible.length) setActive(0);
  }, [visible.length, active]);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (visible.length ? (i + 1) % visible.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (visible.length ? (i - 1 + visible.length) % visible.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = visible[active];
      if (item) onPick(item.key);
    }
  };
  return (
    <div className={s.valuePanel} onKeyDown={searchable ? undefined : onKeyDown}>
      {searchable && (
        <div className={s.searchRow}>
          <Icon icon="search" size={16} className={s.searchIcon} />
          <input
            className={s.searchInput}
            type="search"
            placeholder={placeholder}
            aria-label={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            autoFocus
          />
        </div>
      )}
      <div ref={listRef} className={s.list} role="listbox" aria-label={placeholder} style={{ maxHeight: 320 }}>
        {loading && visible.length === 0 && <div className={s.empty}>Loading…</div>}
        {!loading && visible.length === 0 && <div className={s.empty}>{emptyLabel}</div>}
        {visible.map((item, i) => (
          <div
            key={item.key}
            role="option"
            aria-selected={item.key === selected}
            tabIndex={-1}
            data-active={i === active || undefined}
            className={s.row}
            onMouseMove={() => setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(item.key)}
            onKeyDown={() => {}}
          >
            {item.leading}
            {item.icon && <Icon icon={item.icon} size={16} className={s.rowIcon} />}
            <span className={s.rowLabel}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Commits the latest draft when the editor unmounts (popover closed by clicking outside). */
function useCommitOnClose(draft: string, initial: string, commit: (v: string) => void) {
  const latest = useRef({ draft, initial, commit, done: false });
  latest.current.draft = draft;
  latest.current.commit = commit;
  useEffect(
    () => () => {
      const l = latest.current;
      if (!l.done && l.draft !== l.initial && l.draft.trim() !== '') l.commit(l.draft);
    },
    [],
  );
  return () => {
    latest.current.done = true;
  };
}

// ---- editors --------------------------------------------------------------------------------------------------

function TextEditor({ value, onCommit, onCancel }: ValueEditorProps) {
  const initial = typeof value === 'string' ? value : '';
  const [text, setText] = useState(initial);
  const markDone = useCommitOnClose(text, initial, onCommit);
  return (
    <div style={{ padding: 4 }}>
      <input
        className={s.inlineInput}
        placeholder="Enter value..."
        aria-label="Value"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.length > 0) {
            e.preventDefault();
            markDone();
            onCommit(text);
          } else if (e.key === 'Escape') {
            markDone();
            onCancel();
          }
        }}
        autoFocus
      />
    </div>
  );
}

function parseNumber(text: string): number | null {
  const normalized = text.replace(/\s| | /g, '').replace(',', '.');
  if (normalized === '' || normalized === '-') return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function NumberEditor({ value, onCommit, onCancel }: ValueEditorProps) {
  const initial = typeof value === 'number' ? String(value) : '';
  const [text, setText] = useState(initial);
  const markDone = useCommitOnClose(text, initial, (t) => {
    const n = parseNumber(t);
    if (n !== null) onCommit(n);
  });
  const step = (delta: number) => setText(String((parseNumber(text) ?? 0) + delta));
  return (
    <div style={{ padding: 4 }}>
      <div className={s.numberWrap}>
        <input
          className={s.inlineInput}
          placeholder="enter number..."
          aria-label="Number"
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const n = parseNumber(text);
              if (n === null) return;
              e.preventDefault();
              markDone();
              onCommit(n);
            } else if (e.key === 'Escape') {
              markDone();
              onCancel();
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              step(1);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              step(-1);
            }
          }}
          autoFocus
        />
        <span className={s.spin} aria-hidden>
          <button
            type="button"
            tabIndex={-1}
            className={s.spinButton}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => step(1)}
          >
            <Icon icon="chevronUp" size={10} />
          </button>
          <button
            type="button"
            tabIndex={-1}
            className={s.spinButton}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => step(-1)}
          >
            <Icon icon="chevronDown" size={10} />
          </button>
        </span>
      </div>
    </div>
  );
}

function RatingEditor({ value, onCommit }: ValueEditorProps) {
  const [hover, setHover] = useState<number | null>(null);
  const current = hover ?? (typeof value === 'number' ? value : 0);
  return (
    <div className={s.stars} role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          className={s.star}
          data-on={n <= current || undefined}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(null)}
          onClick={() => onCommit(n)}
        >
          <Icon icon="attrRating" size={16} />
        </button>
      ))}
    </div>
  );
}

function OptionEditor({ attribute, value, onCommit }: ValueEditorProps) {
  const options = useAttributeOptions(attribute);
  const items = (options ?? [])
    .filter((o) => !o.isArchived || o.id === value)
    .map((o: SelectOption | PipelineStage) => ({
      key: o.id,
      label: o.title,
      // Statuses and options both lead with their colour (evidence C1/21).
      leading: (
        <span style={{ display: 'inline-flex', width: 16, justifyContent: 'center' }}>
          <StatusDot color={o.color} size={8} />
        </span>
      ),
    }));
  return (
    <SearchList
      placeholder="Search..."
      items={items}
      selected={typeof value === 'string' ? value : null}
      onPick={onCommit}
      loading={!options}
      emptyLabel="No options found"
    />
  );
}

function ActorEditor({ value, onCommit }: ValueEditorProps) {
  const current = value as ActorValue | undefined;
  const isCurrent = current?.kind === 'current-member';
  return (
    <div className={s.valuePanel}>
      {/* The dynamic "Current user" token (C1 §4) above the member search. */}
      <button
        type="button"
        className={s.currentUserRow}
        aria-pressed={isCurrent}
        onClick={() => onCommit({ kind: 'current-member' } satisfies ActorValue)}
      >
        <Icon icon="member" size={16} />
        Current user
        {isCurrent && <Icon icon="check" size={16} className={s.currentUserCheck} />}
      </button>
      <MemberPicker
        selectedIds={current?.kind === 'member' ? [current.id] : []}
        placeholder="Select user..."
        onSelect={(member) => onCommit({ kind: 'member', id: member.id } satisfies ActorValue)}
      />
    </div>
  );
}

// ---- records -----------------------------------------------------------------------------------------------------

/** The attribute that names records of a definition (name / full name), if any. */
function useTitleAttribute(definitionId: string | null) {
  const attrs = useAttributes(definitionId);
  return useMemo(() => {
    if (!attrs) return undefined;
    return (
      attrs.find((a) => a.systemAttributeType === 'name' || (a.apiSlug === 'name' && !a.isArchived)) ??
      attrs.find((a) => a.type === 'personal-name' && !a.isArchived) ??
      null
    );
  }, [attrs]);
}

function displayText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.fullName === 'string') return v.fullName;
    if (typeof v.full_name === 'string') return v.full_name;
  }
  return '';
}

function useRecordTitles(definitionId: string | null, ids: readonly string[]) {
  const ws = useWorkspaceRef();
  const titleAttr = useTitleAttribute(definitionId);
  const results = useQueries({
    queries: ids.map((id) => ({
      ...valuesQuery({
        workspace: ws,
        entityDefinitionId: definitionId ?? '',
        entityInstanceId: id,
        attributeDefinitionId: titleAttr?.id ?? '',
      }),
      enabled: Boolean(definitionId && titleAttr),
    })),
  });
  return ids.map((id, i) => {
    const text = displayText(results[i]?.data?.values[0]?.value);
    return text || id;
  });
}

function targetOfAttribute(schema: ReturnType<typeof useSchemaIndex>, attribute: AttributeDefinition): string | null {
  return schema?.targetOf(attribute) ?? null;
}

function RecordLabel({ attribute, value }: { attribute: AttributeDefinition; value: RecordValue }) {
  const schema = useSchemaIndex(attribute.entityDefinitionId);
  const target = value.entityDefinitionId ?? targetOfAttribute(schema, attribute);
  const [title] = useRecordTitles(target, [value.entityInstanceId]);
  return <>{title}</>;
}

function RecordEditor({ attribute, value, onCommit }: ValueEditorProps) {
  const schema = useSchemaIndex(attribute.entityDefinitionId);
  const target = targetOfAttribute(schema, attribute);
  const allowed = attribute.config.entityReferenceConfiguration?.allowedEntityDefinitionIds ?? null;
  const objects = target ? [target] : allowed && allowed.length > 0 ? allowed : null;
  const current = value as RecordValue | undefined;
  return (
    <RecordPicker
      entityDefinitionIds={objects}
      selected={
        current
          ? [
              {
                entityDefinitionId: current.entityDefinitionId ?? target ?? '',
                entityInstanceId: current.entityInstanceId,
              },
            ]
          : []
      }
      placeholder="Select record..."
      onSelect={(record) =>
        onCommit({
          entityInstanceId: record.entityInstanceId,
          entityDefinitionId: record.entityDefinitionId,
        } satisfies RecordValue)
      }
    />
  );
}

// ---- objects / lists (list-membership sentences) ---------------------------------------------------------------

function ObjectEditor({ value, onCommit }: ValueEditorProps) {
  const definitions = useDefinitions();
  const items = (definitions ?? [])
    .filter((d) => !d.isArchived && d.entityType === 'collection-entry')
    .map((d) => ({ key: d.id, label: d.pluralNoun, icon: 'list' as const }));
  return (
    <SearchList
      placeholder="Select list..."
      items={items}
      selected={typeof value === 'string' ? value : null}
      onPick={onCommit}
      loading={!definitions}
      emptyLabel="No lists"
    />
  );
}

function ObjectLabel({ id }: { id: string }) {
  const definitions = useDefinitions();
  return <>{definitions?.find((d) => d.id === id)?.pluralNoun ?? '…'}</>;
}

// ---- countries ------------------------------------------------------------------------------------------------

const NOT_COUNTRIES = new Set([
  'EU',
  'EZ',
  'UN',
  'QO',
  'XA',
  'XB',
  'ZZ',
  'AA',
  'QM',
  'QN',
  'QP',
  'QQ',
  'QR',
  'QS',
  'QT',
  'QU',
  'QV',
  'QW',
  'QX',
  'QY',
  'QZ',
  'XK',
]);
let countryList: { code: string; name: string }[] | null = null;

function regionNames(): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames(undefined, { type: 'region', fallback: 'none' });
  } catch {
    return null;
  }
}

export function countryName(code: string): string {
  return regionNames()?.of(code.toUpperCase()) ?? code;
}

function countries(): { code: string; name: string }[] {
  if (countryList) return countryList;
  const names = regionNames();
  const out: { code: string; name: string }[] = [];
  const A = 'A'.charCodeAt(0);
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 26; j++) {
      const code = String.fromCharCode(A + i, A + j);
      if (NOT_COUNTRIES.has(code)) continue;
      const name = names?.of(code);
      if (name && name !== code) out.push({ code, name });
    }
  }
  countryList = out.sort((x, y) => x.name.localeCompare(y.name));
  return countryList;
}

function CountryEditor({ value, onCommit }: ValueEditorProps) {
  const items = useMemo(() => countries().map((c) => ({ key: c.code, label: c.name })), []);
  return (
    <SearchList
      placeholder="Select country"
      items={items}
      selected={typeof value === 'string' ? value : null}
      onPick={onCommit}
    />
  );
}

// ---- dates ------------------------------------------------------------------------------------------------------

type DateMode = 'menu' | 'days-ago' | 'days-from-now' | 'exact';

/** Relative date menu (evidence C1/24) for before/after; exact date input for is / is not. */
function DateEditor({ attribute, kind, value, onCommit, onCancel }: ValueEditorProps) {
  const timestamp = attribute.type !== 'date';
  // "is" / "is not" take an exact day; "before" / "after" the relative menu (C1 §3–4).
  const exactOnly = kind === 'date';
  return (
    <DatePicker
      timestamp={timestamp}
      exactOnly={exactOnly}
      value={(value as DateValue | undefined) ?? null}
      onCommit={onCommit}
      onCancel={onCancel}
    />
  );
}

function DatePicker({
  timestamp,
  exactOnly,
  value,
  onCommit,
  onCancel,
}: {
  timestamp: boolean;
  exactOnly: boolean;
  value: DateValue | null;
  onCommit: (v: DateValue) => void;
  onCancel: () => void;
}) {
  const initialMode: DateMode = exactOnly
    ? 'exact'
    : value?.kind === 'relative' && customDaysOf(value.duration)
      ? customDaysOf(value.duration)?.direction === 'ago'
        ? 'days-ago'
        : 'days-from-now'
      : 'menu';
  const [mode, setMode] = useState<DateMode>(initialMode);
  if (mode === 'exact') {
    return (
      <ExactDate
        value={value?.kind === 'exact' ? value.date : ''}
        onCommit={(date) => onCommit({ kind: 'exact', date })}
        onBack={exactOnly ? undefined : () => setMode('menu')}
        onCancel={onCancel}
      />
    );
  }
  if (mode === 'days-ago' || mode === 'days-from-now') {
    const direction = mode === 'days-ago' ? 'ago' : 'from-now';
    const initial = value?.kind === 'relative' ? customDaysOf(value.duration) : null;
    return (
      <DaysForm
        initial={initial?.direction === direction ? initial.days : null}
        direction={direction}
        onCommit={(days) => onCommit({ kind: 'relative', duration: daysDuration(days, direction) })}
        onBack={() => setMode('menu')}
      />
    );
  }
  const selectedPreset = value?.kind === 'relative' ? presetOf(value.duration)?.id : undefined;
  return (
    <RelativeMenu
      timestamp={timestamp}
      selected={selectedPreset}
      onPreset={(duration) => onCommit({ kind: 'relative', duration })}
      onMode={setMode}
    />
  );
}

function RelativeMenu({
  timestamp,
  selected,
  onPreset,
  onMode,
}: {
  timestamp: boolean;
  selected: string | undefined;
  onPreset: (duration: string) => void;
  onMode: (mode: DateMode) => void;
}) {
  const rows: {
    key: string;
    label: string;
    icon: 'attrDate' | 'attrTimestamp' | 'calendarAdd';
    run: () => void;
    chevron?: boolean;
  }[] = [
    ...RELATIVE_PRESETS.map((p) => ({
      key: p.id,
      label: (timestamp && p.timestampLabel) || p.label,
      icon: 'attrDate' as const,
      run: () => onPreset(p.duration),
    })),
  ];
  const [active, setActive] = useState(0);
  const all = [
    ...rows,
    { key: 'days-ago', label: 'Number of days ago...', icon: 'attrTimestamp' as const, run: () => onMode('days-ago') },
    {
      key: 'days-from-now',
      label: 'Number of days from now...',
      icon: 'attrTimestamp' as const,
      run: () => onMode('days-from-now'),
    },
    { key: 'exact', label: 'Exact date', icon: 'attrDate' as const, run: () => onMode('exact'), chevron: true },
  ];
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div
      ref={ref}
      className={s.list}
      role="menu"
      aria-label="Select date"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActive((i) => (i + 1) % all.length);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActive((i) => (i - 1 + all.length) % all.length);
        } else if (e.key === 'Enter' || (e.key === 'ArrowRight' && all[active]?.chevron)) {
          e.preventDefault();
          all[active]?.run();
        }
      }}
    >
      {all.map((row, i) => (
        <div key={row.key} style={{ display: 'contents' }}>
          {(row.key === 'days-ago' || row.key === 'exact') && <hr className={s.separator} />}
          <div
            role="menuitemradio"
            aria-checked={row.key === selected}
            tabIndex={-1}
            className={s.row}
            data-active={i === active || undefined}
            onMouseMove={() => setActive(i)}
            onClick={row.run}
            onKeyDown={() => {}}
          >
            <Icon icon={row.icon} size={16} className={s.rowIcon} />
            <span className={s.rowLabel}>{row.label}</span>
            {row.chevron && <Icon icon="chevronRight" size={16} className={s.chevron} />}
          </div>
        </div>
      ))}
    </div>
  );
}

function DaysForm({
  initial,
  direction,
  onCommit,
  onBack,
}: {
  initial: number | null;
  direction: 'ago' | 'from-now';
  onCommit: (days: number) => void;
  onBack: () => void;
}) {
  const [text, setText] = useState(initial !== null ? String(initial) : '');
  const days = Number.parseInt(text, 10);
  return (
    <div className={s.daysForm}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button type="button" className={s.backButton} aria-label="Back" onClick={onBack}>
          <Icon icon="chevronLeft" size={16} />
        </button>
        <span className={s.daysLabel}>{direction === 'ago' ? 'Number of days ago' : 'Number of days from now'}</span>
      </div>
      <input
        className={s.inlineInput}
        placeholder="Days"
        aria-label="Days"
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/\D/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && Number.isFinite(days)) {
            e.preventDefault();
            onCommit(days);
          }
        }}
        autoFocus
      />
    </div>
  );
}

function ExactDate({
  value,
  onCommit,
  onBack,
  onCancel,
}: {
  value: string;
  onCommit: (date: string) => void;
  onBack?: () => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(value || toLocalDay(new Date()));
  return (
    <div className={s.daysForm}>
      {onBack && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button type="button" className={s.backButton} aria-label="Back" onClick={onBack}>
            <Icon icon="chevronLeft" size={16} />
          </button>
          <span className={s.daysLabel}>Exact date</span>
        </div>
      )}
      <input
        className={s.inlineInput}
        type="date"
        aria-label="Date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
            e.preventDefault();
            onCommit(date);
          } else if (e.key === 'Escape') onCancel();
        }}
        autoFocus
      />
      <button
        type="button"
        className={s.row}
        style={{
          justifyContent: 'center',
          border: 'none',
          background: 'var(--ar-color-interactive-primary)',
          color: 'var(--ar-color-content-on-accent)',
        }}
        onClick={() => /^\d{4}-\d{2}-\d{2}$/.test(date) && onCommit(date)}
      >
        Apply
      </button>
    </div>
  );
}

// ---- status "was" ----------------------------------------------------------------------------------------------

function StatusWasEditor({ attribute, value, onCommit, onCancel }: ValueEditorProps) {
  const current = (value as StatusWasValue | undefined) ?? null;
  const [stageId, setStageId] = useState<string | null>(current?.stageId ?? null);
  if (!stageId) {
    return (
      <OptionEditor
        attribute={attribute}
        kind="status"
        operator="contains"
        value={current?.stageId}
        onCommit={(id) => setStageId(String(id))}
        onCancel={onCancel}
      />
    );
  }
  // Optional: when the record entered that status ("was … before {date}", history leaf with active_from lt).
  return (
    <div className={s.valuePanel}>
      <div
        role="button"
        tabIndex={0}
        className={s.row}
        onClick={() => onCommit({ stageId, date: null } satisfies StatusWasValue)}
        onKeyDown={(e) => e.key === 'Enter' && onCommit({ stageId, date: null } satisfies StatusWasValue)}
      >
        <Icon icon="clock" size={16} className={s.rowIcon} />
        <span className={s.rowLabel}>At any time</span>
      </div>
      <hr className={s.separator} />
      <div className={s.sectionLabel}>Entered before</div>
      <DatePicker
        timestamp
        exactOnly={false}
        value={current?.date ?? null}
        onCommit={(date) => onCommit({ stageId, date, dateOperator: 'lt' } satisfies StatusWasValue)}
        onCancel={onCancel}
      />
    </div>
  );
}
