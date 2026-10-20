// Inline editors that overlay the cell / field: text (auto-growing textarea), number, currency, personal name,
// location sub-field; plus the in-place checkbox and rating "editors" and the read-only stub.
import { cx } from '@agentic-crm/ui';
import { type KeyboardEvent, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getFormatSettings } from '../format/locale';
import type { CommitVia, EditorProps, ValueInput } from '../types';
import { Stars } from '../ui/primitives';
import { parseCurrencyAmount, parseNumber, splitName } from '../values/parse';
import { currentValues, read } from '../values/shapes';
import * as s from './editors.css';
import { LocationFormEditor } from './lists';
import { EditorOverlay } from './shell';

/** Key handling shared by inline editors: Enter / Tab commit, Shift+Enter newline (multi-line only), Esc cancels. */
function commitKey(e: KeyboardEvent, multiline: boolean, commit: (via: CommitVia) => void, cancel: () => void): void {
  if (e.nativeEvent.isComposing) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    cancel();
  } else if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
    e.preventDefault();
    e.stopPropagation();
    commit('enter');
  } else if (e.key === 'Tab') {
    e.preventDefault();
    e.stopPropagation();
    commit(e.shiftKey ? 'shift-tab' : 'tab');
  }
}

/** Caret at the end, after mount. */
function useFocusEnd(ref: RefObject<HTMLInputElement | HTMLTextAreaElement | null>, select = false) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (select) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
  }, [ref, select]);
}

/** Textarea height follows its content (up to 200 px, layout.md §4). */
function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(200, el.scrollHeight)}px`;
    el.style.overflowY = el.scrollHeight > 200 ? 'auto' : 'hidden';
  }, [ref, value]);
}

// ---- text ----------------------------------------------------------------------------------------------------------

export function TextEditor({
  values,
  onCommit,
  onCancel,
  initialKey,
  anchor,
  density = 'cell',
  attribute,
  onDraftChange,
}: EditorProps) {
  const current = currentValues(values)[0];
  const initial = initialKey ?? (current ? (read.text(current.value) ?? '') : '');
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useFocusEnd(ref);
  useAutoGrow(ref, text);
  const commit = (via: CommitVia) => {
    if (done.current) return;
    done.current = true;
    onCommit(text.length > 0 ? [{ value: text }] : [], { via });
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel({ via: 'escape' });
  };
  return (
    <EditorOverlay anchor={anchor} density={density} onOutside={() => commit('blur')} label={attribute.title}>
      <textarea
        ref={ref}
        rows={1}
        className={cx(s.overlayInput, density === 'field' && s.overlayInputField)}
        value={text}
        placeholder={
          density === 'field' ? `Set ${attribute.title.charAt(0).toLowerCase()}${attribute.title.slice(1)}` : undefined
        }
        aria-label={attribute.title}
        onChange={(e) => {
          setText(e.target.value);
          onDraftChange?.(e.target.value ? [{ value: e.target.value }] : []);
        }}
        onKeyDown={(e) => commitKey(e, true, commit, cancel)}
      />
    </EditorOverlay>
  );
}

// ---- number / currency -------------------------------------------------------------------------------------------

/** Raw value for editing: no grouping, the locale's decimal separator ("120000", "1,5" in ru-RU). */
export function rawNumber(n: number): string {
  const { locale } = getFormatSettings();
  const decimal = new Intl.NumberFormat(locale).format(1.5).includes(',') ? ',' : '.';
  return String(n).replace('.', decimal);
}

function NumericEditor({ props, kind }: { props: EditorProps; kind: 'number' | 'currency' }) {
  const { values, onCommit, onCancel, initialKey, anchor, density = 'cell', attribute, onDraftChange } = props;
  const current = currentValues(values)[0];
  const amount =
    kind === 'currency'
      ? current
        ? read.currency(current.value)?.currencyValue
        : null
      : current
        ? read.number(current.value)
        : null;
  const base = amount === null || amount === undefined ? '' : rawNumber(amount);
  // Typing on a selected currency cell appends to the amount (C1 cells.md §2); numbers start over.
  const initial = initialKey !== undefined ? (kind === 'currency' ? base + initialKey : initialKey) : base;
  const [text, setText] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useFocusEnd(ref);
  const code = attribute.config.currencyConfiguration?.defaultCurrencyCode ?? 'USD';

  const commit = (via: CommitVia) => {
    if (done.current) return;
    const { locale } = getFormatSettings();
    const trimmed = text.trim();
    let next: ValueInput[];
    if (!trimmed) next = [];
    else {
      const n = kind === 'currency' ? parseCurrencyAmount(trimmed, locale) : parseNumber(trimmed, locale);
      if (n === null) {
        setInvalid(true);
        if (via === 'blur') {
          done.current = true;
          onCancel({ via: 'blur' });
        }
        return;
      }
      next = [{ value: kind === 'currency' ? { currencyValue: n, currencyCode: code } : n }];
    }
    done.current = true;
    onCommit(next, { via });
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel({ via: 'escape' });
  };
  const end = density === 'cell';
  return (
    <EditorOverlay
      anchor={anchor}
      density={density}
      minWidth={178}
      invalid={invalid}
      onOutside={() => commit('blur')}
      label={attribute.title}
    >
      <input
        ref={ref}
        inputMode="decimal"
        className={cx(s.overlayInput, density === 'field' && s.overlayInputField, end && s.overlayInputEnd)}
        value={text}
        aria-label={attribute.title}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          setText(e.target.value);
          setInvalid(false);
          const { locale } = getFormatSettings();
          const n =
            kind === 'currency' ? parseCurrencyAmount(e.target.value, locale) : parseNumber(e.target.value, locale);
          if (!e.target.value.trim()) onDraftChange?.([]);
          else if (n !== null)
            onDraftChange?.([{ value: kind === 'currency' ? { currencyValue: n, currencyCode: code } : n }]);
        }}
        onKeyDown={(e) => commitKey(e, false, commit, cancel)}
      />
      {kind === 'currency' && <span className={s.affix}>{code}</span>}
    </EditorOverlay>
  );
}

export function NumberEditor(props: EditorProps) {
  return <NumericEditor props={props} kind="number" />;
}

export function CurrencyEditor(props: EditorProps) {
  return <NumericEditor props={props} kind="currency" />;
}

// ---- personal name -----------------------------------------------------------------------------------------------

/** Cells: one textarea with the full name, split into first/last on save. Fields: First / Last inputs (D §2.2). */
export function PersonalNameEditor({
  values,
  onCommit,
  onCancel,
  initialKey,
  anchor,
  density = 'cell',
  attribute,
  onDraftChange,
}: EditorProps) {
  const current = currentValues(values)[0];
  const name = current ? read.name(current.value) : null;
  const [full, setFull] = useState(initialKey ?? name?.fullName ?? '');
  const [first, setFirst] = useState(initialKey ?? name?.firstName ?? '');
  const [last, setLast] = useState(initialKey !== undefined ? '' : (name?.lastName ?? ''));
  const fullRef = useRef<HTMLTextAreaElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const split = density === 'field';
  useFocusEnd(split ? firstRef : fullRef);
  useAutoGrow(fullRef, full);

  const commit = (via: CommitVia) => {
    if (done.current) return;
    done.current = true;
    const value = split
      ? {
          firstName: first.trim(),
          lastName: last.trim(),
          fullName: [first.trim(), last.trim()].filter(Boolean).join(' '),
        }
      : splitName(full);
    onCommit(value.fullName ? [{ value }] : [], { via });
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel({ via: 'escape' });
  };
  return (
    <EditorOverlay anchor={anchor} density={density} onOutside={() => commit('blur')} label={attribute.title}>
      {split ? (
        <div className={s.nameRow}>
          <input
            ref={firstRef}
            className={cx(s.overlayInput, s.overlayInputField)}
            placeholder="First name"
            aria-label="First name"
            value={first}
            onChange={(e) => {
              setFirst(e.target.value);
              onDraftChange?.([{ value: splitName(`${e.target.value} ${last}`) }]);
            }}
            onKeyDown={(e) => commitKey(e, false, commit, cancel)}
          />
          <input
            className={cx(s.overlayInput, s.overlayInputField)}
            placeholder="Last name"
            aria-label="Last name"
            value={last}
            onChange={(e) => {
              setLast(e.target.value);
              onDraftChange?.([{ value: splitName(`${first} ${e.target.value}`) }]);
            }}
            onKeyDown={(e) => commitKey(e, false, commit, cancel)}
          />
        </div>
      ) : (
        <textarea
          ref={fullRef}
          rows={1}
          className={s.overlayInput}
          value={full}
          aria-label={attribute.title}
          onChange={(e) => {
            setFull(e.target.value);
            onDraftChange?.(e.target.value.trim() ? [{ value: splitName(e.target.value) }] : []);
          }}
          onKeyDown={(e) => commitKey(e, false, commit, cancel)}
        />
      )}
    </EditorOverlay>
  );
}

// ---- location sub-field column -----------------------------------------------------------------------------------

const FIELD_KEYS: Record<string, string> = {
  locality: 'locality',
  region: 'region',
  postcode: 'postcode',
  country_code: 'countryCode',
  line_1: 'line1',
  line_2: 'line2',
  line_3: 'line3',
  line_4: 'line4',
};

/** A location column edits one component (City / State / Country code) as text (C1 cells.md §2). */
export function LocationFieldEditor({
  values,
  onCommit,
  onCancel,
  initialKey,
  anchor,
  density = 'cell',
  attribute,
  field,
  onDraftChange,
}: EditorProps) {
  const current = currentValues(values)[0];
  const loc = current ? read.location(current.value) : null;
  const key = FIELD_KEYS[field ?? 'locality'] ?? 'locality';
  const [text, setText] = useState(initialKey ?? (loc as Record<string, string | null> | null)?.[key] ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useFocusEnd(ref);
  useAutoGrow(ref, text);
  const commit = (via: CommitVia) => {
    if (done.current) return;
    done.current = true;
    const t = key === 'countryCode' ? text.trim().toUpperCase().slice(0, 2) : text.trim();
    const next = { ...(loc ?? {}), [key]: t || null };
    const blank = Object.values(next).every((v) => !v);
    onCommit(blank ? [] : [{ value: next }], { via });
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel({ via: 'escape' });
  };
  return (
    <EditorOverlay anchor={anchor} density={density} onOutside={() => commit('blur')} label={attribute.title}>
      <textarea
        ref={ref}
        rows={1}
        className={cx(s.overlayInput, density === 'field' && s.overlayInputField)}
        value={text}
        aria-label={attribute.title}
        onChange={(e) => {
          setText(e.target.value);
          onDraftChange?.([{ value: { ...(loc ?? {}), [key]: e.target.value || null } }]);
        }}
        onKeyDown={(e) => commitKey(e, false, commit, cancel)}
      />
    </EditorOverlay>
  );
}

/** Location: sub-field columns edit one component inline; a full location (record page, forms) opens the form. */
export function LocationEditor(props: EditorProps) {
  if (props.field) return <LocationFieldEditor {...props} />;
  if ((props.density ?? 'cell') === 'cell') return <LocationFieldEditor {...props} field="locality" />;
  return <LocationFormEditor {...props} />;
}

// ---- checkbox / rating / read-only ------------------------------------------------------------------------------

/** Enter / Space on a checkbox cell toggles it (no visible editor; false is written, not cleared). */
export function CheckboxEditor({ values, onCommit }: EditorProps) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const current = currentValues(values)[0];
    const checked = current ? read.checkbox(current.value) === true : false;
    onCommit([{ value: !checked }], { via: 'pick' });
  }, [values, onCommit]);
  return null;
}

/** Keys 0–5 set the rating (0 clears), ←/→ preview, Enter commits, Backspace clears, Esc cancels. */
export function RatingEditor({
  values,
  onCommit,
  onCancel,
  initialKey,
  anchor,
  density = 'cell',
  attribute,
}: EditorProps) {
  const current = currentValues(values)[0];
  const value = current ? (read.rating(current.value) ?? 0) : 0;
  const [preview, setPreview] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const set = (n: number, via: CommitVia) => {
    if (done.current) return;
    done.current = true;
    onCommit(n > 0 ? [{ value: n }] : [], { via });
  };
  useEffect(() => {
    if (initialKey && /^[0-5]$/.test(initialKey)) set(Number(initialKey), 'shortcut');
    else ref.current?.focus({ preventScroll: true });
  }, []);
  if (initialKey && /^[0-5]$/.test(initialKey)) return null;
  const onKeyDown = (e: KeyboardEvent) => {
    if (/^[0-5]$/.test(e.key)) set(Number(e.key), 'shortcut');
    else if (e.key === 'Backspace' || e.key === 'Delete') set(0, 'shortcut');
    else if (e.key === 'ArrowRight') setPreview((p) => Math.min(5, p + 1));
    else if (e.key === 'ArrowLeft') setPreview((p) => Math.max(0, p - 1));
    else if (e.key === 'Enter' || e.key === 'Tab')
      set(preview, e.key === 'Tab' ? (e.shiftKey ? 'shift-tab' : 'tab') : 'enter');
    else if (e.key === 'Escape') {
      done.current = true;
      onCancel({ via: 'escape' });
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <EditorOverlay
      anchor={anchor}
      density={density}
      minWidth={0}
      onOutside={() => {
        if (!done.current) {
          done.current = true;
          onCancel({ via: 'blur' });
        }
      }}
      label={attribute.title}
    >
      <div ref={ref} tabIndex={-1} className={s.ratingOverlay} onKeyDown={onKeyDown} style={{ outline: 'none' }}>
        <Stars value={preview} label={attribute.title} onChange={(n) => set(n, 'pick')} />
      </div>
    </EditorOverlay>
  );
}

/** Interaction and system attributes are read-only: opening them closes immediately. */
export function ReadonlyEditor({ onCancel }: EditorProps) {
  useEffect(() => {
    onCancel();
  }, [onCancel]);
  return null;
}
