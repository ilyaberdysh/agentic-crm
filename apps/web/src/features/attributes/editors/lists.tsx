// Value-list editors for emails, domains and phone numbers (C1 cells.md §2; evidence/C1/32, 33): the current values
// (drag handle to reorder, remove on hover) and an "Add …" row. Invalid input raises the spec's error toast and
// writes nothing. Also the full location form (record pages, D §3.2).

import { rankBetween } from '@agentic-crm/contracts';
import { FilterableMenu, Icon, MenuItem, MenuTrigger, TextInput, toast } from '@agentic-crm/ui';
import { type KeyboardEvent, useMemo, useRef, useState } from 'react';
import { Button as RACButton } from 'react-aria-components';
import { countryName } from '../format/formatValue';
import { getFormatSettings } from '../format/locale';
import type { AttributeValue, CommitVia, EditorProps } from '../types';
import * as ui from '../ui/ui.css';
import { CALLING_CODES, normalizeDomain, normalizeEmail, normalizePhone } from '../values/normalize';
import { currentValues, read } from '../values/shapes';
import * as s from './editors.css';
import { EditorPopover } from './shell';
import { useWorkingValues } from './working';

type ListKind = 'email' | 'domain' | 'phone';

/** Six-dot drag handle (2 × 3 dots, 6 × 10 px). */
function DragDots() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      {[3, 6, 9].map((y) =>
        [4.5, 7.5].map((x) => <circle key={`${x}:${y}`} cx={x} cy={y - 0.5} r="1" fill="currentColor" />),
      )}
    </svg>
  );
}

const COPY: Record<ListKind, { add: string; invalid: string }> = {
  email: { add: 'Add email...', invalid: 'You have entered an invalid email address' },
  domain: { add: 'Add domain...', invalid: 'You have entered an invalid domain' },
  phone: { add: 'Add phone number...', invalid: 'Invalid phone number' },
};

function textOf(kind: ListKind, v: AttributeValue): string {
  if (kind === 'email') return read.email(v.value)?.originalEmailAddress ?? '';
  if (kind === 'domain') return read.domain(v.value)?.normalizedDomain ?? '';
  return read.phone(v.value)?.originalPhoneNumber ?? '';
}

/** Default phone country: the locale's region (ru-RU → RU), else US. */
export function defaultCountry(): string {
  try {
    const region = new Intl.Locale(getFormatSettings().locale).maximize().region;
    return region && CALLING_CODES[region] ? region : 'US';
  } catch {
    return 'US';
  }
}

/** Masked placeholder per country (evidence/C1/33 shows RU "+7 _ (___) ___-__-__"). */
export function phonePlaceholder(country: string): string {
  const masks: Record<string, string> = {
    RU: '+7 _ (___) ___-__-__',
    KZ: '+7 _ (___) ___-__-__',
    US: '+1 (___) ___-____',
    CA: '+1 (___) ___-____',
    GB: '+44 ____ ______',
    DE: '+49 ___ ________',
    FR: '+33 _ __ __ __ __',
  };
  return masks[country] ?? `+${CALLING_CODES[country] ?? ''} ___ ___ ____`;
}

function CountrySelect({ country, onChange }: { country: string; onChange: (code: string) => void }) {
  const items = useMemo(
    () =>
      Object.keys(CALLING_CODES)
        .map((code) => ({ id: code, name: countryName(code), calling: CALLING_CODES[code] as string }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
  return (
    <MenuTrigger>
      <RACButton className={s.countryButton} aria-label="Country">
        {country}
        <Icon icon="chevronDown" size={12} className={s.countryChevron} />
      </RACButton>
      <FilterableMenu
        items={items}
        width={240}
        placeholder="Search countries..."
        onAction={(key) => onChange(String(key))}
      >
        {(item) => (
          <MenuItem id={item.id} textValue={item.name} trailing={`+${item.calling}`}>
            {item.name}
          </MenuItem>
        )}
      </FilterableMenu>
    </MenuTrigger>
  );
}

function ValueListEditor({ kind, props }: { kind: ListKind; props: EditorProps }) {
  const { attribute, onCommit, onCancel, initialKey, anchor, density = 'cell' } = props;
  const working = useWorkingValues(props);
  const current = working.shown;
  const multi = attribute.isMultiselect;
  const [text, setText] = useState(initialKey ?? '');
  const [country, setCountry] = useState(() => {
    const cc = current[0] ? read.phone(current[0].value)?.countryCode : null;
    return cc ?? defaultCountry();
  });
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const done = useRef(false);
  const close = (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };

  /** The typed value as a write form; undefined = nothing typed; null = invalid (toast raised). */
  const parsed = (): unknown => {
    const t = text.trim();
    if (!t) return undefined;
    let value: unknown;
    if (kind === 'email') value = normalizeEmail(t) ? t : null;
    else if (kind === 'domain') value = normalizeDomain(t) ? t : null;
    else {
      const typed = t.startsWith('+') ? t : `+${CALLING_CODES[country] ?? ''} ${t}`;
      const r = normalizePhone(typed, country);
      value = r.ok ? { originalPhoneNumber: typed, countryCode: country } : null;
    }
    if (value === null) toast.error({ title: COPY[kind].invalid });
    return value;
  };

  const add = (via: CommitVia): boolean => {
    const value = parsed();
    if (value === undefined) return true;
    if (value === null) return false;
    setText('');
    if (multi) working.apply([{ op: 'put', value }], via);
    else close(() => onCommit([{ value }], { via }));
    return true;
  };

  /** Close: a valid typed value is added on the way out (multi) or committed (single). */
  const finish = (via: CommitVia) => {
    const value = parsed();
    if (multi) return working.finish(via, value ? [{ op: 'put', value }] : undefined);
    if (value) return close(() => onCommit([{ value }], { via }));
    close(() => onCancel({ via }));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      add('enter');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      finish(e.shiftKey ? 'shift-tab' : 'tab');
    }
  };

  const remove = (v: AttributeValue) =>
    multi
      ? working.apply([{ op: 'retire', id: v.id }])
      : close(() => onCommit([{ op: 'retire', id: v.id }], { via: 'pick' }));

  const drop = () => {
    if (!drag || drag.from === drag.over) return setDrag(null);
    const order = [...current];
    const [moved] = order.splice(drag.from, 1);
    if (!moved) return setDrag(null);
    order.splice(drag.over, 0, moved);
    const i = order.indexOf(moved);
    const sortOrder = rankBetween(order[i - 1]?.sortOrder ?? null, order[i + 1]?.sortOrder ?? null);
    setDrag(null);
    working.apply([{ op: 'reorder', id: moved.id, sortOrder }]);
  };

  const showInput = multi || current.length === 0 || text.length > 0 || kind === 'phone';
  return (
    <EditorPopover
      anchor={anchor}
      density={density}
      label={attribute.title}
      onDismiss={() => finish('blur')}
      onEscape={() => (multi ? working.finish('escape') : close(() => onCancel({ via: 'escape' })))}
    >
      {current.length > 0 && (multi || kind !== 'phone') && (
        <div className={s.valueList} onPointerUp={drop} onPointerLeave={() => drag && setDrag(null)}>
          {current.map((v, i) => (
            <div
              key={v.id}
              className={s.valueRow}
              onPointerEnter={() => drag && setDrag({ ...drag, over: i })}
              style={
                drag?.over === i && drag.from !== i
                  ? { boxShadow: 'inset 0 2px 0 var(--ar-color-stroke-accent)' }
                  : undefined
              }
            >
              {multi && (
                <span
                  className={s.dragHandle}
                  aria-label="Drag to reorder"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setDrag({ from: i, over: i });
                  }}
                >
                  <DragDots />
                </span>
              )}
              <span className={ui.linkChipText} style={{ color: 'var(--ar-color-content-accent)', flex: 1 }}>
                {textOf(kind, v)}
              </span>
              <button type="button" className={s.rowRemove} aria-label={`Remove ${kind}`} onClick={() => remove(v)}>
                <Icon icon="close" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {showInput &&
        (kind === 'phone' ? (
          <>
            {current.length > 0 && multi && <div className={s.listSeparator} />}
            <div className={s.phoneRow}>
              <CountrySelect country={country} onChange={setCountry} />
              <span className={s.phonePrefix}>+{CALLING_CODES[country] ?? ''}</span>
              <input
                autoFocus
                className={s.searchInput}
                placeholder={phonePlaceholder(country).replace(/^\+\d+\s*/, '')}
                aria-label={attribute.title}
                inputMode="tel"
                value={text || (!multi && current[0] ? '' : text)}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
              />
            </div>
          </>
        ) : (
          <>
            {current.length > 0 && <div className={s.listSeparator} />}
            <div className={s.addRow}>
              <Icon icon="add" size={14} className={s.createIcon} />
              <input
                autoFocus
                className={s.searchInput}
                placeholder={COPY[kind].add}
                aria-label={COPY[kind].add}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
              />
            </div>
          </>
        ))}
    </EditorPopover>
  );
}

export function EmailEditor(props: EditorProps) {
  return <ValueListEditor kind="email" props={props} />;
}
export function DomainEditor(props: EditorProps) {
  return <ValueListEditor kind="domain" props={props} />;
}
export function PhoneEditor(props: EditorProps) {
  return <ValueListEditor kind="phone" props={props} />;
}

// ---- location form -------------------------------------------------------------------------------------------------

const LOCATION_FIELDS = [
  ['line1', 'Street address'],
  ['locality', 'City'],
  ['region', 'State / Province'],
  ['postcode', 'Zip / Postal Code'],
  ['countryCode', 'Country'],
] as const;

/** Full location editor (record pages): street, city, state, postcode, country; Enter or outside click saves. */
export function LocationFormEditor({ attribute, values, onCommit, onCancel, anchor, density = 'field' }: EditorProps) {
  const current = currentValues(values)[0];
  const loc = (current ? read.location(current.value) : null) ?? null;
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(LOCATION_FIELDS.map(([k]) => [k, (loc?.[k] as string | null) ?? ''])),
  );
  const done = useRef(false);
  const commit = (via: CommitVia) => {
    if (done.current) return;
    done.current = true;
    const next = {
      ...(loc ?? {}),
      ...Object.fromEntries(
        Object.entries(draft).map(([k, v]) => [
          k,
          k === 'countryCode' ? v.trim().toUpperCase().slice(0, 2) || null : v.trim() || null,
        ]),
      ),
    };
    const blank = Object.values(next).every((v) => !v);
    onCommit(blank ? [] : [{ value: next }], { via });
  };
  return (
    <EditorPopover
      anchor={anchor}
      density={density}
      width={320}
      label={attribute.title}
      onDismiss={() => commit('blur')}
      onEscape={() => {
        if (done.current) return;
        done.current = true;
        onCancel({ via: 'escape' });
      }}
    >
      <form
        className={s.form}
        onSubmit={(e) => {
          e.preventDefault();
          commit('enter');
        }}
      >
        {LOCATION_FIELDS.map(([key, label], i) => (
          <TextInput
            key={key}
            size={32}
            label={label}
            autoFocus={i === 0}
            value={draft[key] ?? ''}
            placeholder={key === 'countryCode' ? 'GB' : undefined}
            onChange={(v) => setDraft((d) => ({ ...d, [key]: v }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit('enter');
              }
            }}
          />
        ))}
        <button type="submit" hidden />
      </form>
    </EditorPopover>
  );
}
