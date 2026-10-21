// Text input with @mentions (reduced configurations: the task title "task-input" and the comment
// composer). A transparent textarea over a mirror that paints mention tokens in the accent colour; typing "@" opens
// a typeahead of members ("Users") and records ("Records"); ↑ / ↓ / Enter / Tab pick, Esc closes; Backspace at the
// end of a token removes it whole.
import { Avatar, PopoverPanel } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useObjects } from '../../../data/objects';
import { api, inWorkspace } from '../../../data/trpc';
import { RecordAvatar, recordKind } from '../../attributes/ui/primitives';
import { useWorkspace } from '../../shell/workspaceContext';
import * as s from './mentions.css';
import {
  activeQuery,
  applyTextEdit,
  insertMention,
  type MentionTarget,
  type MentionText,
  mentionEndingAt,
  mentionStartingAt,
  removeMention,
  segments,
} from './model';

export interface MentionInputProps {
  value: MentionText;
  onChange: (value: MentionText) => void;
  placeholder?: string;
  /** Enter calls onSubmit (Shift+Enter inserts a newline when `multiline`). */
  onSubmit?: () => void;
  multiline?: boolean;
  autoFocus?: boolean;
  /** Which mentions the typeahead offers. */
  kinds?: ('member' | 'record')[];
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  'aria-label'?: string;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  className?: string;
  'data-testid'?: string;
}

interface Option {
  key: string;
  target: MentionTarget;
  icon: ReactNode;
  secondary?: string | null;
  object?: string | null;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function useMentionOptions(query: string | null, kinds: ('member' | 'record')[]): Option[] {
  const { workspace } = useWorkspace();
  const objects = useObjects(workspace).data;
  const q = useDebounced(query ?? '', 80);
  const enabled = query !== null;
  const ws = { id: workspace.id, slug: workspace.slug };
  const members = useQuery({
    queryKey: ['ws', ws.id, 'mention-search', 'members', q],
    queryFn: () => api.search.members.query({ query: q, limit: 5 }, inWorkspace(ws)),
    enabled: enabled && kinds.includes('member'),
    staleTime: 15_000,
  });
  const records = useQuery({
    queryKey: ['ws', ws.id, 'mention-search', 'records', q],
    queryFn: () => api.search.records.query({ query: q, limit: 8 }, inWorkspace(ws)),
    enabled: enabled && kinds.includes('record'),
    staleTime: 15_000,
  });
  // Results of an older query never show (Enter would pick a stale option); both lists answer the same query.
  if (!enabled || q !== (query ?? '')) return [];
  const out: Option[] = [];
  for (const m of members.data?.hits ?? []) {
    const label = `${m.firstName} ${m.lastName}`.trim() || m.emailAddress;
    out.push({
      key: `m:${m.id}`,
      target: { kind: 'workspace-member', memberId: m.id, label },
      icon: <Avatar name={label} seed={m.id} size={20} kind="member" />,
      secondary: m.emailAddress,
    });
  }
  for (const r of records.data?.hits ?? []) {
    const object = objects?.find((o) => o.id === r.entityDefinitionId);
    out.push({
      key: `r:${r.entityInstanceId}`,
      target: {
        kind: 'record',
        entityDefinitionId: r.entityDefinitionId,
        entityInstanceId: r.entityInstanceId,
        label: r.title ?? 'Untitled record',
      },
      icon: <RecordAvatar kind={recordKind(object as Parameters<typeof recordKind>[0])} size={20} />,
      secondary: r.subtitle,
      object: object?.singularNoun ?? null,
    });
  }
  return out;
}

export function MentionInput({
  value,
  onChange,
  placeholder,
  onSubmit,
  multiline = false,
  autoFocus,
  kinds = ['member', 'record'],
  onKeyDown,
  onFocus,
  onBlur,
  inputRef,
  className,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: MentionInputProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const area = inputRef ?? ownRef;
  const [caret, setCaret] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const pendingCaret = useRef<number | null>(null);

  const query = activeQuery(value, caret);
  const open = query !== null && dismissedAt !== query.start;
  const options = useMentionOptions(open ? query.query : null, kinds);
  const members = options.filter((o) => o.target.kind === 'workspace-member');
  const records = options.filter((o) => o.target.kind === 'record');
  const ordered = [...members, ...records];

  useEffect(() => setActive(0), [query?.query]);

  useEffect(() => {
    if (pendingCaret.current === null || !area.current) return;
    const at = pendingCaret.current;
    pendingCaret.current = null;
    area.current.setSelectionRange(at, at);
    setCaret(at);
  });

  const pick = (option: Option) => {
    if (!query) return;
    const out = insertMention(value, query.start, caret, option.target);
    pendingCaret.current = out.caret;
    onChange(out.value);
  };

  const syncCaret = () => setCaret(area.current?.selectionStart ?? 0);

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && ordered.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) =>
          e.key === 'ArrowDown' ? (i + 1) % ordered.length : (i - 1 + ordered.length) % ordered.length,
        );
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const option = ordered[active];
        if (option) pick(option);
        return;
      }
    }
    if (open && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setDismissedAt(query?.start ?? null);
      return;
    }
    const el = e.currentTarget;
    const collapsed = el.selectionStart === el.selectionEnd;
    if (collapsed && e.key === 'Backspace') {
      const m = mentionEndingAt(value, el.selectionStart);
      if (m) {
        e.preventDefault();
        pendingCaret.current = m.start;
        onChange(removeMention(value, m));
        return;
      }
    }
    if (collapsed && e.key === 'Delete') {
      const m = mentionStartingAt(value, el.selectionStart);
      if (m) {
        e.preventDefault();
        pendingCaret.current = m.start;
        onChange(removeMention(value, m));
        return;
      }
    }
    if (e.key === 'Enter' && !e.nativeEvent.isComposing && (!multiline || !e.shiftKey)) {
      e.preventDefault();
      onSubmit?.();
      return;
    }
    onKeyDown?.(e);
  };

  let index = -1;
  const row = (o: Option) => {
    index += 1;
    const i = index;
    return (
      <div
        key={o.key}
        role="option"
        aria-selected={i === active}
        className={s.option}
        data-active={i === active || undefined}
        onMouseEnter={() => setActive(i)}
        onMouseDown={(e) => {
          e.preventDefault();
          pick(o);
        }}
      >
        {o.icon}
        <span className={s.optionLabel}>{o.target.label}</span>
        {o.secondary && <span className={s.optionSecondary}>{o.secondary}</span>}
        {o.object && <span className={s.optionObject}>{o.object}</span>}
      </div>
    );
  };

  return (
    <div ref={wrapRef} className={`${s.wrap} ${className ?? ''}`}>
      <div className={s.mirror} aria-hidden="true">
        {segments(value).map((seg, i) =>
          seg.mention ? (
            <span key={i} className={s.mention}>
              {seg.text}
            </span>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
        {/* keeps a trailing newline's height */}
        {'​'}
      </div>
      <textarea
        ref={area}
        className={s.input}
        rows={1}
        value={value.text}
        placeholder={placeholder}
        aria-label={ariaLabel}
        data-testid={testId}
        // Dialog inputs focus themselves on open (task dialog, composer after "Reply in thread").
        autoFocus={autoFocus}
        onChange={(e) => {
          setDismissedAt(null);
          onChange(applyTextEdit(value, multiline ? e.target.value : e.target.value.replace(/\n/g, ' ')));
          setCaret(e.target.selectionStart);
        }}
        onSelect={syncCaret}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onKeyDown={handleKey}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      {open && (
        <PopoverPanel
          triggerRef={wrapRef}
          isOpen
          isNonModal
          onOpenChange={(o) => {
            if (!o) setDismissedAt(query?.start ?? null);
          }}
          placement="bottom start"
          offset={6}
          width={320}
        >
          <div className={s.menu} role="listbox" aria-label="Mentions" data-testid="mention-menu">
            {ordered.length === 0 && <div className={s.empty}>No results</div>}
            {members.length > 0 && <div className={s.menuLabel}>Users</div>}
            {members.map(row)}
            {records.length > 0 && <div className={s.menuLabel}>Records</div>}
            {records.map(row)}
          </div>
        </PopoverPanel>
      )}
    </div>
  );
}
