// Value inputs of the configuration panel (block-catalog): record / entry pickers with variables, linked records,
// members, variable-only inputs ("No value selected"), numbers, dates, durations (number + unit), enums, day toggles,
// time, timezone, cron, JSON and HTTP headers. Each takes the input's config expression and answers a new one.
import type { ConfigExpr, VariableExpr } from '@agentic-crm/contracts';
import { Checkbox, Icon, IconButton, PopoverPanel, Select, SelectItem } from '@agentic-crm/ui';
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { Button as AriaButton, Dialog, DialogTrigger } from 'react-aria-components';
import { useMembers, useObjectDefinition, useRecordTitle } from '../../../../attributes/data/queries';
import { MemberPicker, RecordPicker } from '../../../../attributes/editors/pickers';
import { memberName } from '../../../../attributes/format/formatValue';
import { MemberAvatar, RecordAvatar, recordKind } from '../../../../attributes/ui/primitives';
import {
  definitionRef,
  numberOf,
  richTextSegments,
  type Segment,
  segmentsToRichText,
  stringOf,
} from '../../../model/config';
import type { InputProps } from '../Field';
import * as s from '../panel.css';
import { VariableChip } from '../VariableChip';
import { VariablePicker } from '../VariablePicker';
import { VariableText, type VariableTextHandle } from '../VariableText';

/** The picker opened by the {x} button (anchored to it), shared by single-value inputs. */
export function useVariablePopover(
  blockId: string,
  expected: InputProps['spec']['valueType'],
  onPick: (variable: VariableExpr) => void,
): { open: (anchor: Element) => void; element: ReactNode } {
  const [anchor, setAnchor] = useState<Element | null>(null);
  const ref = useRef<Element | null>(null);
  ref.current = anchor;
  return {
    open: (a) => setAnchor(a),
    element: anchor ? (
      <PopoverPanel
        triggerRef={ref as RefObject<Element>}
        isOpen
        onOpenChange={(o) => !o && setAnchor(null)}
        placement="bottom end"
        padding={4}
      >
        <Dialog aria-label="Choose a variable" style={{ outline: 'none' }}>
          <VariablePicker
            blockId={blockId}
            expected={expected}
            onPick={(v) => {
              setAnchor(null);
              onPick(v);
            }}
          />
        </Dialog>
      </PopoverPanel>
    ) : null,
  };
}

/** A variable chip in a control box (single-value inputs holding a variable). */
function ChipBox({
  blockId,
  variable,
  expected,
  readOnly,
  invalid,
  onChange,
}: {
  blockId: string;
  variable: VariableExpr;
  expected?: InputProps['spec']['valueType'];
  readOnly: boolean;
  invalid: boolean;
  onChange: (v: ConfigExpr | undefined) => void;
}) {
  return (
    <div className={s.control} data-invalid={invalid || undefined} style={{ cursor: 'default' }}>
      <span className={s.controlValue}>
        <VariableChip
          blockId={blockId}
          variable={variable}
          expected={expected}
          readOnly={readOnly}
          onChange={(v) => onChange(v)}
          onRemove={() => onChange(undefined)}
        />
      </span>
    </div>
  );
}

// ---- record / entry --------------------------------------------------------------------------------------------------------

function RecordLabel({
  entityDefinitionId,
  entityInstanceId,
}: {
  entityDefinitionId: string;
  entityInstanceId: string;
}) {
  const { title, definition } = useRecordTitle(entityDefinitionId, entityInstanceId);
  return (
    <>
      <RecordAvatar kind={recordKind(definition)} size={16} />
      <span className={s.controlValue}>{title || entityInstanceId}</span>
    </>
  );
}

export function RecordInput({ block, spec, value, readOnly, invalid, onChange, registerVariableOpener }: InputProps) {
  const pop = useVariablePopover(block.id, spec.valueType, (v) => onChange(v));
  registerVariableOpener(pop.open);
  const objectId = spec.of ? definitionRef(block.config.entries[spec.of]) : null;
  const staticAllowed = spec.control === 'record' && spec.variables !== 'only';
  const [open, setOpen] = useState(false);
  if (value?.type === 'variable') {
    return (
      <>
        <ChipBox
          blockId={block.id}
          variable={value}
          expected={spec.valueType}
          readOnly={readOnly}
          invalid={invalid}
          onChange={onChange}
        />
        {pop.element}
      </>
    );
  }
  const record = value?.type === 'entity-reference' ? value : null;
  if (!staticAllowed) {
    return (
      <>
        <div className={s.control} data-invalid={invalid || undefined} data-disabled={readOnly || undefined}>
          <span className={`${s.controlValue} ${s.placeholder}`}>No value selected</span>
        </div>
        {pop.element}
      </>
    );
  }
  return (
    <>
      <DialogTrigger isOpen={open} onOpenChange={setOpen}>
        <AriaButton
          className={s.control}
          isDisabled={readOnly}
          data-invalid={invalid || undefined}
          data-testid="record-input"
        >
          {record ? (
            <RecordLabel entityDefinitionId={record.entityDefinitionId} entityInstanceId={record.entityInstanceId} />
          ) : (
            <span className={`${s.controlValue} ${s.placeholder}`}>Select a record</span>
          )}
          <Icon icon="chevronDown" size={16} className={s.chevron} />
        </AriaButton>
        <PopoverPanel placement="bottom start" width={360} padding={0}>
          <Dialog aria-label="Select a record" style={{ outline: 'none' }}>
            <RecordPicker
              entityDefinitionIds={objectId ? [objectId] : null}
              selected={record ? [record] : []}
              onSelect={(r) => {
                setOpen(false);
                onChange({
                  type: 'entity-reference',
                  entityDefinitionId: r.entityDefinitionId,
                  entityInstanceId: r.entityInstanceId,
                });
              }}
            />
          </Dialog>
        </PopoverPanel>
      </DialogTrigger>
      {pop.element}
    </>
  );
}

/** Lists of records / members: chips (static values and variables) + "Add". */
function ListBox({ children, invalid }: { children: ReactNode; invalid: boolean }) {
  return (
    <div
      className={s.control}
      data-invalid={invalid || undefined}
      style={{ flexWrap: 'wrap', padding: '6px 8px', gap: 6, cursor: 'default' }}
    >
      {children}
    </div>
  );
}

const itemsOf = (value: ConfigExpr | undefined): ConfigExpr[] =>
  value?.type === 'array' ? value.items : value && value.type !== 'null' ? [value] : [];

export function RecordsInput({ block, spec, value, readOnly, invalid, onChange, registerVariableOpener }: InputProps) {
  const items = itemsOf(value);
  const set = (next: ConfigExpr[]) => onChange(next.length ? { type: 'array', items: next } : undefined);
  const pop = useVariablePopover(block.id, spec.valueType?.kind === 'array' ? spec.valueType.of : spec.valueType, (v) =>
    set([...items, v]),
  );
  registerVariableOpener(pop.open);
  const [open, setOpen] = useState(false);
  const records = items.filter(
    (i): i is Extract<ConfigExpr, { type: 'entity-reference' }> => i.type === 'entity-reference',
  );
  return (
    <>
      <ListBox invalid={invalid}>
        {items.map((item, i) =>
          item.type === 'variable' ? (
            <VariableChip
              key={`v${i}`}
              blockId={block.id}
              variable={item}
              readOnly={readOnly}
              onChange={(v) => set(items.map((x, k) => (k === i ? v : x)))}
              onRemove={() => set(items.filter((_, k) => k !== i))}
            />
          ) : item.type === 'entity-reference' ? (
            <span key={item.entityInstanceId} className={s.row} style={{ gap: 4 }}>
              <RecordLabel entityDefinitionId={item.entityDefinitionId} entityInstanceId={item.entityInstanceId} />
              {!readOnly && (
                <IconButton
                  icon="close"
                  size={20}
                  aria-label="Remove record"
                  onPress={() => set(items.filter((_, k) => k !== i))}
                />
              )}
            </span>
          ) : null,
        )}
        {!readOnly && (
          <DialogTrigger isOpen={open} onOpenChange={setOpen}>
            <AriaButton
              className={s.subtle}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '2px 4px' }}
            >
              {items.length ? '+ Add' : 'Select records'}
            </AriaButton>
            <PopoverPanel placement="bottom start" width={360} padding={0}>
              <Dialog aria-label="Select records" style={{ outline: 'none' }}>
                <RecordPicker
                  entityDefinitionIds={null}
                  multiple
                  selected={records}
                  onSelect={(r, selected) => {
                    if (selected)
                      set(
                        items.filter(
                          (x) => !(x.type === 'entity-reference' && x.entityInstanceId === r.entityInstanceId),
                        ),
                      );
                    else
                      set([
                        ...items,
                        {
                          type: 'entity-reference',
                          entityDefinitionId: r.entityDefinitionId,
                          entityInstanceId: r.entityInstanceId,
                        },
                      ]);
                  }}
                />
              </Dialog>
            </PopoverPanel>
          </DialogTrigger>
        )}
      </ListBox>
      {pop.element}
    </>
  );
}

export function ActorsInput({ block, spec, value, readOnly, invalid, onChange, registerVariableOpener }: InputProps) {
  const members = useMembers();
  const items = itemsOf(value);
  const set = (next: ConfigExpr[]) => onChange(next.length ? { type: 'array', items: next } : undefined);
  const pop = useVariablePopover(block.id, spec.valueType?.kind === 'array' ? spec.valueType.of : spec.valueType, (v) =>
    set([...items, v]),
  );
  registerVariableOpener(pop.open);
  const [open, setOpen] = useState(false);
  const ids = items.flatMap((i) => (i.type === 'actor' ? [i.actorId] : []));
  return (
    <>
      <ListBox invalid={invalid}>
        {items.map((item, i) =>
          item.type === 'variable' ? (
            <VariableChip
              key={`v${i}`}
              blockId={block.id}
              variable={item}
              readOnly={readOnly}
              onChange={(v) => set(items.map((x, k) => (k === i ? v : x)))}
              onRemove={() => set(items.filter((_, k) => k !== i))}
            />
          ) : item.type === 'actor' ? (
            <span key={item.actorId} className={s.row} style={{ gap: 4 }}>
              <MemberAvatar member={members.find((m) => m.id === item.actorId)} size={16} />
              {memberName(members.find((m) => m.id === item.actorId)) || 'Unknown member'}
              {!readOnly && (
                <IconButton
                  icon="close"
                  size={20}
                  aria-label="Remove member"
                  onPress={() => set(items.filter((_, k) => k !== i))}
                />
              )}
            </span>
          ) : null,
        )}
        {!readOnly && (
          <DialogTrigger isOpen={open} onOpenChange={setOpen}>
            <AriaButton
              className={s.subtle}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '2px 4px' }}
              data-testid="actors-add"
            >
              {items.length ? '+ Add' : (spec.placeholder ?? 'Select actors')}
            </AriaButton>
            <PopoverPanel placement="bottom start" width={320} padding={0}>
              <Dialog aria-label="Select members" style={{ outline: 'none' }}>
                <MemberPicker
                  multiple
                  selectedIds={ids}
                  onSelect={(m, selected) => {
                    if (selected) set(items.filter((x) => !(x.type === 'actor' && x.actorId === m.id)));
                    else set([...items, { type: 'actor', actorId: m.id }]);
                  }}
                />
              </Dialog>
            </PopoverPanel>
          </DialogTrigger>
        )}
      </ListBox>
      {pop.element}
    </>
  );
}

/** Task / meeting / list inputs that only take a variable. */
export function VariableOnlyInput({
  block,
  spec,
  value,
  readOnly,
  invalid,
  onChange,
  registerVariableOpener,
}: InputProps) {
  const pop = useVariablePopover(block.id, spec.valueType, (v) => onChange(v));
  registerVariableOpener(pop.open);
  const box = useRef<HTMLButtonElement>(null);
  if (value?.type === 'variable') {
    return (
      <>
        <ChipBox
          blockId={block.id}
          variable={value}
          expected={spec.valueType}
          readOnly={readOnly}
          invalid={invalid}
          onChange={onChange}
        />
        {pop.element}
      </>
    );
  }
  return (
    <>
      <button
        ref={box}
        type="button"
        className={s.control}
        disabled={readOnly}
        data-invalid={invalid || undefined}
        onClick={() => box.current && pop.open(box.current)}
      >
        <span className={`${s.controlValue} ${s.placeholder}`}>
          {spec.valueType?.kind === 'array' && spec.valueType.of.kind === 'number'
            ? 'No number array selected'
            : 'No value selected'}
        </span>
      </button>
      {pop.element}
    </>
  );
}

// ---- scalars ----------------------------------------------------------------------------------------------------------------

function useDraft<T>(value: T, deps: unknown[]) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), deps);
  return [draft, setDraft] as const;
}

export function NumberInput({ block, spec, value, readOnly, invalid, onChange, registerVariableOpener }: InputProps) {
  const pop = useVariablePopover(block.id, spec.valueType, (v) => onChange(v));
  registerVariableOpener(pop.open);
  const current = numberOf(value);
  const [draft, setDraft] = useDraft(current === null ? '' : String(current), [current]);
  if (value?.type === 'variable') {
    return (
      <>
        <ChipBox
          blockId={block.id}
          variable={value}
          expected={spec.valueType}
          readOnly={readOnly}
          invalid={invalid}
          onChange={onChange}
        />
        {pop.element}
      </>
    );
  }
  const commit = () => {
    const t = draft.trim();
    if (t === '') onChange(undefined);
    else if (!Number.isNaN(Number(t))) onChange({ type: 'number', value: Number(t) });
  };
  return (
    <>
      <input
        className={s.input}
        inputMode="decimal"
        value={draft}
        readOnly={readOnly}
        placeholder={spec.placeholder ?? 'Enter a number'}
        aria-label={spec.label}
        data-invalid={invalid || undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      {pop.element}
    </>
  );
}

export function BooleanInput({ spec, value, readOnly, onChange }: InputProps) {
  const on = value?.type === 'boolean' ? value.value : false;
  return (
    <Checkbox isSelected={on} isDisabled={readOnly} onChange={(v) => onChange({ type: 'boolean', value: v })}>
      {spec.label}
    </Checkbox>
  );
}

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function TimestampInput({
  block,
  spec,
  value,
  readOnly,
  invalid,
  onChange,
  registerVariableOpener,
}: InputProps) {
  const pop = useVariablePopover(block.id, spec.valueType, (v) => onChange(v));
  registerVariableOpener(pop.open);
  if (value?.type === 'variable') {
    return (
      <>
        <ChipBox
          blockId={block.id}
          variable={value}
          expected={spec.valueType}
          readOnly={readOnly}
          invalid={invalid}
          onChange={onChange}
        />
        {pop.element}
      </>
    );
  }
  const iso = value?.type === 'timestamp' ? value.value : null;
  return (
    <>
      <input
        className={s.input}
        type="datetime-local"
        aria-label={spec.label}
        readOnly={readOnly}
        data-invalid={invalid || undefined}
        value={iso ? toLocalInput(iso) : ''}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v ? { type: 'timestamp', value: new Date(v).toISOString() } : undefined);
        }}
      />
      {pop.element}
    </>
  );
}

export function DurationInput({ block, spec, value, readOnly, invalid, onChange, registerVariableOpener }: InputProps) {
  const unit = value?.type === 'duration' ? value.unit : 'seconds';
  const inner = value?.type === 'duration' ? value.value : undefined;
  const set = (next: ConfigExpr | undefined, nextUnit = unit) =>
    onChange({ type: 'duration', value: next ?? { type: 'number', value: 0 }, unit: nextUnit });
  const pop = useVariablePopover(block.id, spec.valueType, (v) => set(v));
  registerVariableOpener(pop.open);
  const n = numberOf(inner);
  const [draft, setDraft] = useDraft(n === null ? '' : String(n), [n]);
  return (
    <div className={s.row}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {inner?.type === 'variable' ? (
          <ChipBox
            blockId={block.id}
            variable={inner}
            expected={spec.valueType}
            readOnly={readOnly}
            invalid={invalid}
            onChange={(v) => set(v)}
          />
        ) : (
          <input
            className={s.input}
            inputMode="decimal"
            aria-label={spec.label}
            value={draft}
            readOnly={readOnly}
            data-invalid={invalid || undefined}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => !Number.isNaN(Number(draft)) && set({ type: 'number', value: Number(draft || 0) })}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        )}
      </div>
      <Select
        aria-label="Unit"
        size={36}
        style={{ width: 130 }}
        isDisabled={readOnly}
        selectedKey={unit}
        onSelectionChange={(k) => set(inner, String(k) as typeof unit)}
      >
        {(spec.options ?? []).map((o) => (
          <SelectItem key={o.value} id={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </Select>
      {pop.element}
    </div>
  );
}

export function EnumInput({ spec, value, readOnly, invalid, onChange }: InputProps) {
  const current = stringOf(value) ?? (typeof spec.default === 'string' ? spec.default : null);
  return (
    <Select
      aria-label={spec.label}
      size={36}
      isDisabled={readOnly}
      isInvalid={invalid}
      placeholder={`Select ${spec.label.toLowerCase()}`}
      selectedKey={current}
      onSelectionChange={(k) => onChange({ type: 'string', value: String(k) })}
    >
      {(spec.options ?? []).map((o) => (
        <SelectItem key={o.value} id={o.value}>
          {o.label}
        </SelectItem>
      ))}
    </Select>
  );
}

export function EnumMultiInput({ spec, value, readOnly, onChange }: InputProps) {
  const selected = new Set(
    itemsOf(value)
      .map((i) => stringOf(i))
      .filter((v): v is string => v !== null),
  );
  return (
    <div className={s.toggles}>
      {(spec.options ?? []).map((o) => (
        <button
          key={o.value}
          type="button"
          className={s.toggle}
          aria-pressed={selected.has(o.value)}
          disabled={readOnly}
          onClick={() => {
            const next = new Set(selected);
            if (next.has(o.value)) next.delete(o.value);
            else next.add(o.value);
            const ordered = (spec.options ?? []).filter((x) => next.has(x.value));
            onChange(
              ordered.length
                ? { type: 'array', items: ordered.map((x) => ({ type: 'string', value: x.value })) }
                : undefined,
            );
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const WEEK = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

export function DaysInput({ spec, value, readOnly, onChange }: InputProps) {
  const options =
    spec.control === 'days-of-week'
      ? WEEK
      : Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: String(i + 1) }));
  const selected = new Set(itemsOf(value).flatMap((i) => (i.type === 'number' ? [i.value] : [])));
  return (
    <div className={s.toggles}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={s.toggle}
          aria-pressed={selected.has(o.value)}
          disabled={readOnly}
          onClick={() => {
            const next = new Set(selected);
            if (next.has(o.value)) next.delete(o.value);
            else next.add(o.value);
            const list = options.filter((x) => next.has(x.value));
            onChange(
              list.length ? { type: 'array', items: list.map((x) => ({ type: 'number', value: x.value })) } : undefined,
            );
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function TextLine({ spec, value, readOnly, invalid, onChange, mono }: InputProps & { mono?: boolean }) {
  const current = stringOf(value) ?? (typeof spec.default === 'string' ? spec.default : '');
  const [draft, setDraft] = useDraft(current, [current]);
  return (
    <input
      className={s.input}
      style={mono ? { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } : undefined}
      aria-label={spec.label}
      value={draft}
      readOnly={readOnly}
      placeholder={spec.placeholder}
      data-invalid={invalid || undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onChange(draft.trim() ? { type: 'string', value: draft.trim() } : undefined)}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );
}

export function TimeInput(props: InputProps) {
  return <TextLine {...props} />;
}

export function CronInput(props: InputProps) {
  return <TextLine {...props} mono />;
}

/** "(GMT+3) Europe/Moscow". */
export function timezoneLabel(zone: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value;
    const offset = !part || part === 'GMT' ? 'GMT+0' : part;
    return `(${offset}) ${zone}`;
  } catch {
    return zone;
  }
}

export function useTimezones(): { id: string; label: string }[] {
  return useMemo(() => {
    const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC'];
    const all = zones.includes('UTC') ? zones : ['UTC', ...zones];
    return all.map((z) => ({ id: z, label: timezoneLabel(z) }));
  }, []);
}

export function TimezoneSelect({
  value,
  onChange,
  isDisabled,
  width,
}: {
  value: string | null;
  onChange: (zone: string) => void;
  isDisabled?: boolean;
  width?: number;
}) {
  const zones = useTimezones();
  return (
    <Select
      aria-label="Timezone"
      size={36}
      searchable
      searchPlaceholder="Search timezones..."
      isDisabled={isDisabled}
      selectedKey={value ?? 'UTC'}
      onSelectionChange={(k) => onChange(String(k))}
      items={zones}
      style={width ? { width } : undefined}
      data-testid="timezone-select"
    >
      {(z) => (
        <SelectItem id={z.id} textValue={z.label}>
          {z.label}
        </SelectItem>
      )}
    </Select>
  );
}

export function TimezoneInput({ spec, value, readOnly, onChange }: InputProps) {
  return (
    <TimezoneSelect
      value={stringOf(value) ?? (typeof spec.default === 'string' ? spec.default : 'UTC')}
      isDisabled={readOnly}
      onChange={(z) => onChange({ type: 'string', value: z })}
    />
  );
}

export function JsonInput({ block, spec, value, readOnly, invalid, onChange, registerVariableOpener }: InputProps) {
  const pop = useVariablePopover(block.id, spec.valueType, (v) => onChange(v));
  registerVariableOpener(spec.control === 'json' ? pop.open : null);
  const text =
    value?.type === 'json'
      ? typeof value.value === 'string'
        ? value.value
        : JSON.stringify(value.value, null, 2)
      : (stringOf(value) ?? '');
  const [draft, setDraft] = useDraft(text, [text]);
  const [error, setError] = useState<string | null>(null);
  if (value?.type === 'variable') {
    return (
      <>
        <ChipBox
          blockId={block.id}
          variable={value}
          expected={spec.valueType}
          readOnly={readOnly}
          invalid={invalid}
          onChange={onChange}
        />
        {pop.element}
      </>
    );
  }
  return (
    <>
      <textarea
        className={s.textarea}
        aria-label={spec.label}
        value={draft}
        readOnly={readOnly}
        placeholder={
          spec.control === 'json-schema' ? '{ "type": "object", "properties": { … } }' : '{ "name": "Jane" }'
        }
        data-invalid={invalid || error ? true : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const t = draft.trim();
          if (!t) {
            setError(null);
            onChange(undefined);
            return;
          }
          try {
            const parsed = JSON.parse(t);
            setError(null);
            onChange(spec.control === 'json-schema' ? { type: 'string', value: t } : { type: 'json', value: parsed });
          } catch {
            setError('Invalid JSON');
          }
        }}
      />
      {error && <span className={s.fieldError}>{error}</span>}
      {pop.element}
    </>
  );
}

/** HTTP headers: rows "Header N" name + value (both with variables) and "Remove header"; "+ Add header". */
export function HeadersInput({ block, value, readOnly, onChange }: InputProps) {
  const rows = itemsOf(value).filter((i): i is Extract<ConfigExpr, { type: 'object' }> => i.type === 'object');
  const set = (next: typeof rows) => onChange(next.length ? { type: 'array', items: next } : undefined);
  const names = useRef<(VariableTextHandle | null)[]>([]);
  return (
    <div className={s.nested} style={{ backgroundColor: 'transparent', boxShadow: 'none', padding: 0 }}>
      {rows.map((row, i) => (
        <div key={i} className={s.field}>
          <div className={s.labelRow}>
            <span className={s.label}>{`Header ${i + 1}`}</span>
            {!readOnly && (
              <IconButton
                icon="delete"
                size={20}
                aria-label="Remove header"
                onPress={() => set(rows.filter((_, k) => k !== i))}
              />
            )}
          </div>
          <VariableText
            ref={(h) => {
              names.current[i] = h;
            }}
            blockId={block.id}
            value={
              row.entries.name?.type === 'rich-text' ? richSegments(row.entries.name) : textSegments(row.entries.name)
            }
            placeholder="Authorization"
            readOnly={readOnly}
            onCommit={(segs) =>
              set(rows.map((r, k) => (k === i ? { ...r, entries: { ...r.entries, name: toRich(segs) } } : r)))
            }
          />
          <VariableText
            blockId={block.id}
            value={
              row.entries.value?.type === 'rich-text'
                ? richSegments(row.entries.value)
                : textSegments(row.entries.value)
            }
            placeholder="Bearer …"
            readOnly={readOnly}
            onCommit={(segs) =>
              set(rows.map((r, k) => (k === i ? { ...r, entries: { ...r.entries, value: toRich(segs) } } : r)))
            }
          />
        </div>
      ))}
      {!readOnly && (
        <button
          type="button"
          className={s.control}
          onClick={() =>
            set([
              ...rows,
              {
                type: 'object',
                entries: { name: { type: 'string', value: '' }, value: { type: 'string', value: '' } },
              },
            ])
          }
        >
          <Icon icon="add" size={14} />
          <span className={s.controlValue}>Add header</span>
        </button>
      )}
    </div>
  );
}

const richSegments = (e: ConfigExpr) => richTextSegments(e);
const textSegments = (e: ConfigExpr | undefined): Segment[] => {
  const v = stringOf(e);
  return v ? [v] : [];
};
const toRich = (segs: Segment[]): ConfigExpr => segmentsToRichText(segs);

export function useDefinitionOf(block: InputProps['block'], key: string | undefined) {
  return useObjectDefinition(key ? definitionRef(block.config.entries[key]) : null);
}
