// Recipients (F composer §2.4): the To / Cc / Bcc fields with chips and a free-text input, the suggestion popover
// (people from the record search, plus bare addresses) and the mass-sending recipients panel. The draft stores the
// address and, when it belongs to a person, the record (variables merge from it).
import { Icon, PopoverPanel } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { api, inWorkspace } from '../../data/trpc';
import { RecordAvatar } from '../attributes/ui/primitives';
import { useWs } from '../mailboxes/data';
import * as s from './composer.css';
import { addRecipients, looksLikeEmail, parseAddresses, type RecipientLike, recipientLabel } from './model';

function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}

export interface Suggestion extends RecipientLike {
  key: string;
  /** A person record (name + address) or a bare typed address. */
  kind: 'person' | 'address';
}

/** People matching `query` (one row per person with an email address) and the typed address when it is one. */
export function useRecipientSuggestions(query: string, exclude: readonly RecipientLike[]): Suggestion[] {
  const ws = useWs();
  const debounced = useDebounced(query.trim(), 120);
  const hits = useQuery({
    queryKey: ['ws', ws.id, 'search', 'recipients', debounced],
    queryFn: () =>
      api.search.records.query({ query: debounced, entityDefinitionIds: ['people'], limit: 8 }, inWorkspace(ws)),
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });
  return useMemo(() => {
    const taken = new Set(exclude.map((r) => r.emailAddress.toLowerCase()));
    const rows: Suggestion[] = [];
    // Results of an earlier query (still loading the new one) are not shown for the text now typed.
    const current = !hits.isPlaceholderData && debounced === query.trim();
    for (const hit of current ? (hits.data?.hits ?? []) : []) {
      const matched = hit.matchedField === 'email' ? hit.matchedValue : null;
      const address = hit.emailAddresses.find((a) => a === matched) ?? hit.emailAddresses[0];
      if (!address || taken.has(address.toLowerCase())) continue;
      rows.push({
        key: `p:${hit.entityInstanceId}:${address}`,
        kind: 'person',
        emailAddress: address,
        name: hit.title,
        record: { entityDefinitionId: hit.entityDefinitionId, entityInstanceId: hit.entityInstanceId },
      });
    }
    const typed = query.trim();
    if (looksLikeEmail(typed) && !taken.has(typed.toLowerCase()) && !rows.some((r) => r.emailAddress === typed)) {
      rows.push({ key: `a:${typed}`, kind: 'address', emailAddress: typed.toLowerCase(), name: null, record: null });
    }
    return rows;
  }, [hits.data, hits.isPlaceholderData, debounced, exclude, query]);
}

function SuggestionRow({
  row,
  active,
  id,
  onPick,
  onHover,
}: {
  row: Suggestion;
  active: boolean;
  id: string;
  onPick: () => void;
  onHover: () => void;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      className={s.suggestionRow}
      data-active={active || undefined}
      data-testid="recipient-suggestion"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      onMouseEnter={onHover}
    >
      <RecordAvatar kind={row.kind === 'person' ? 'person' : 'person'} size={16} />
      <span className={s.suggestionName}>{row.name ?? row.emailAddress}</span>
      {row.name && <span className={s.suggestionAddress}>{row.emailAddress}</span>}
    </div>
  );
}

/** The suggestion popover under an input; the input keeps the focus (arrow keys are handled by the caller). */
function SuggestionPopover({
  triggerRef,
  rows,
  active,
  listId,
  onPick,
  onHover,
  hint,
}: {
  triggerRef: React.RefObject<HTMLElement | null>;
  rows: Suggestion[];
  active: number;
  listId: string;
  onPick: (row: Suggestion) => void;
  onHover: (index: number) => void;
  hint: ReactNode;
}) {
  return (
    <PopoverPanel
      triggerRef={triggerRef}
      isOpen
      isNonModal
      placement="bottom start"
      width={294}
      padding={4}
      offset={4}
      shouldCloseOnInteractOutside={() => false}
    >
      <div
        id={listId}
        role="listbox"
        aria-label="Recipients"
        className={s.suggestionList}
        data-testid="recipient-suggestions"
      >
        {rows.length === 0 ? (
          <div className={s.suggestionHint}>{hint}</div>
        ) : (
          rows.map((row, i) => (
            <SuggestionRow
              key={row.key}
              id={`${listId}-${i}`}
              row={row}
              active={i === active}
              onPick={() => onPick(row)}
              onHover={() => onHover(i)}
            />
          ))
        )}
      </div>
    </PopoverPanel>
  );
}

// ---- To / Cc / Bcc -------------------------------------------------------------------------------------------------

export interface RecipientFieldProps {
  label: string;
  value: readonly RecipientLike[];
  onChange: (next: RecipientLike[]) => void;
  /** Cannot add (variables with one recipient; the extra input is disabled). */
  disabled?: boolean;
  disabledHint?: string;
  testId: string;
  autoFocus?: boolean;
  /** Called with invalid text when it cannot become an address. */
  onInvalid?: (token: string) => void;
}

export function RecipientField({
  label,
  value,
  onChange,
  disabled,
  disabledHint,
  testId,
  autoFocus,
  onInvalid,
}: RecipientFieldProps) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const rows = useRecipientSuggestions(text, value);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  useEffect(() => setActive(0), [text]);

  const pick = (r: RecipientLike) => {
    onChange(addRecipients(value, [r]));
    setText('');
    setActive(0);
  };

  /** Commits the typed text (comma, space, Enter, blur, paste): valid addresses become chips. */
  const commit = (raw: string): boolean => {
    const { valid, invalid } = parseAddresses(raw);
    if (valid.length === 0 && invalid.length === 0) return false;
    if (valid.length > 0) {
      // A known person for the address, when the suggestions already name one.
      const known = new Map(rows.filter((r) => r.kind === 'person').map((r) => [r.emailAddress.toLowerCase(), r]));
      onChange(
        addRecipients(
          value,
          valid.map((v) => known.get(v.emailAddress) ?? v),
        ),
      );
    }
    for (const token of invalid) onInvalid?.(token);
    setText(invalid.join(' '));
    return valid.length > 0;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && rows.length > 0) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % rows.length);
    } else if (e.key === 'ArrowUp' && rows.length > 0) {
      e.preventDefault();
      setActive((i) => (i - 1 + rows.length) % rows.length);
    } else if (e.key === 'Enter' || e.key === ',' || e.key === ';' || (e.key === ' ' && looksLikeEmail(text))) {
      const row = e.key === 'Enter' ? rows[active] : undefined;
      if (row && open && text.trim() !== '') {
        e.preventDefault();
        pick(row);
      } else if (text.trim() !== '' && commit(text)) {
        e.preventDefault();
      } else if (e.key === 'Enter') {
        // Nothing to add: let the dialog's own handling (⌘↵ send is not bound here) pass.
        e.stopPropagation();
      }
    } else if (e.key === 'Backspace' && text === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    } else if (e.key === 'Escape' && open && text.trim() !== '') {
      // Closes the suggestions only; with none showing Esc goes on to close the window.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key !== 'Tab' && e.key !== 'Shift' && e.key !== 'Escape') {
      setOpen(true);
    }
  };

  return (
    <div className={s.rowValue} ref={wrap} data-testid={testId} onClick={() => input.current?.focus()}>
      {value.map((r) => (
        <span key={r.emailAddress} className={s.chip} data-testid="recipient-chip" title={r.emailAddress}>
          <RecordAvatar kind="person" size={16} />
          <span className={s.chipLabel}>{recipientLabel(r)}</span>
          <button
            type="button"
            className={s.chipRemove}
            aria-label={`Remove ${recipientLabel(r)}`}
            onClick={(e) => {
              e.stopPropagation();
              onChange(value.filter((x) => x.emailAddress !== r.emailAddress));
            }}
          >
            <Icon icon="close" size={12} />
          </button>
        </span>
      ))}
      <input
        ref={input}
        className={s.recipientInput}
        aria-label={label}
        role="combobox"
        aria-expanded={open && text.trim() !== ''}
        aria-controls={listId}
        aria-activedescendant={open && rows[active] ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        value={text}
        disabled={disabled}
        title={disabled ? disabledHint : undefined}
        data-testid={`${testId}-input`}
        onChange={(e) => {
          const next = e.target.value;
          // Pasting several addresses commits them at once.
          if (/[,;\s]/.test(next) && next.trim().includes('@') && /[,;\n]|\s\S/.test(next.trim())) {
            if (commit(next)) return;
          }
          setText(next);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          if (text.trim() !== '') commit(text);
        }}
      />
      {open && text.trim() !== '' && !disabled && (
        <SuggestionPopover
          triggerRef={wrap}
          rows={rows}
          active={active}
          listId={listId}
          onPick={pick}
          onHover={setActive}
          hint="No people found. Type a full email address."
        />
      )}
    </div>
  );
}

// ---- mass sending: the recipients panel ---------------------------------------------------------------------------

export interface RecipientsPanelProps {
  recipients: readonly RecipientLike[];
  /** "Add recipients" search (disabled in the review step). */
  onAdd?: (next: RecipientLike[]) => void;
  onRemove?: (emailAddress: string) => void;
  /** Review: rows select the previewed email. */
  selected?: string | null;
  onSelect?: (emailAddress: string) => void;
  /** Review: addresses whose email has a variable without value. */
  flagged?: ReadonlySet<string>;
  disabled?: boolean;
  /** Focus "Add recipients" when the panel appears. */
  autoFocus?: boolean;
}

export function RecipientsPanel({
  recipients,
  onAdd,
  onRemove,
  selected,
  onSelect,
  flagged,
  disabled,
  autoFocus,
}: RecipientsPanelProps) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const field = useRef<HTMLDivElement>(null);
  const listId = useId();
  const rows = useRecipientSuggestions(text, recipients);
  useEffect(() => setActive(0), [text]);

  const pick = (r: RecipientLike) => {
    onAdd?.(addRecipients(recipients, [r]));
    setText('');
  };

  return (
    <aside className={s.sidePanel} aria-label="Recipients" data-testid="recipients-panel">
      <div className={s.addRecipients} ref={field} data-disabled={disabled || undefined}>
        <Icon icon="add" size={16} />
        <input
          className={s.addRecipientsInput}
          placeholder="Add recipients"
          autoFocus={autoFocus}
          aria-label="Add recipients"
          disabled={disabled}
          role="combobox"
          aria-expanded={open && text.trim() !== ''}
          aria-controls={listId}
          value={text}
          data-testid="add-recipients"
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && rows.length > 0) {
              e.preventDefault();
              setActive((i) => (i + 1) % rows.length);
            } else if (e.key === 'ArrowUp' && rows.length > 0) {
              e.preventDefault();
              setActive((i) => (i - 1 + rows.length) % rows.length);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const row = rows[active];
              if (row) pick(row);
              else {
                const { valid } = parseAddresses(text);
                if (valid.length > 0) {
                  onAdd?.(addRecipients(recipients, valid));
                  setText('');
                }
              }
            } else if (e.key === 'Escape' && open && text.trim() !== '') {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
        {open && text.trim() !== '' && !disabled && (
          <SuggestionPopover
            triggerRef={field}
            rows={rows}
            active={active}
            listId={listId}
            onPick={pick}
            onHover={setActive}
            hint="No people found. Type a full email address."
          />
        )}
      </div>
      <div className={s.recipientList} data-testid="recipient-list">
        {recipients.map((r) => (
          <div
            key={r.emailAddress}
            className={s.recipientRow}
            data-testid="recipient-row"
            data-address={r.emailAddress}
            data-selected={selected === r.emailAddress || undefined}
            data-selectable={onSelect ? true : undefined}
            onClick={() => onSelect?.(r.emailAddress)}
          >
            <RecordAvatar kind="person" size={32} />
            <span className={s.recipientText}>
              <span className={s.recipientName}>{r.name || r.emailAddress}</span>
              {r.name && <span className={s.recipientAddress}>{r.emailAddress}</span>}
            </span>
            {flagged?.has(r.emailAddress) && <span className={s.flagDot} title="A variable has no value" />}
            {onRemove && (
              <button
                type="button"
                className={s.recipientRemove}
                aria-label="Remove recipient"
                title="Remove recipient"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(r.emailAddress);
                }}
              >
                <Icon icon="close" size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
