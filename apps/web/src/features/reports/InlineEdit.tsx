// Inline-editable text (H README §3.2): a button that becomes an input on click; Enter or blur commits, Escape
// cancels. Empty values show the placeholder (dashboard "Enter dashboard title...", report "Enter report title...").
import { useEffect, useRef, useState } from 'react';
import * as s from './reports.css';

export interface InlineEditProps {
  value: string;
  /** Shown (muted) when the value is empty; also the input's placeholder. */
  placeholder: string;
  /** Text shown for an empty committed value when it differs from the placeholder ("Untitled Dashboard"). */
  emptyLabel?: string;
  variant: 'title' | 'description';
  readOnly?: boolean;
  maxLength?: number;
  onCommit: (value: string) => void;
  'data-testid'?: string;
  'aria-label'?: string;
  /** Start in editing mode (a new dashboard's title). */
  autoEdit?: boolean;
}

export function InlineEdit({
  value,
  placeholder,
  emptyLabel,
  variant,
  readOnly,
  maxLength,
  onCommit,
  autoEdit,
  'data-testid': testId,
  'aria-label': ariaLabel,
}: InlineEditProps) {
  const [editing, setEditing] = useState(Boolean(autoEdit) && !readOnly);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const next = draft.trim();
    if (next !== value.trim()) onCommit(next);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`${s.inlineInput} ${variant === 'title' ? s.inlineInputTitle : s.inlineInputDescription}`}
        value={draft}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-label={ariaLabel ?? placeholder}
        data-testid={testId ? `${testId}-input` : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            cancelled.current = true;
            setDraft(value);
            e.currentTarget.blur();
          }
        }}
        size={Math.max(10, Math.min(60, draft.length + 2))}
      />
    );
  }
  const empty = value.trim() === '';
  if (readOnly && empty && variant === 'description') return null;
  return (
    <button
      type="button"
      className={variant === 'title' ? s.inlineTitle : s.inlineDescription}
      data-placeholder={empty && !emptyLabel ? '' : undefined}
      data-readonly={readOnly ? '' : undefined}
      data-testid={testId}
      aria-label={ariaLabel}
      onClick={() => !readOnly && setEditing(true)}
      tabIndex={readOnly ? -1 : 0}
    >
      {empty ? (emptyLabel ?? placeholder) : value}
    </button>
  );
}
