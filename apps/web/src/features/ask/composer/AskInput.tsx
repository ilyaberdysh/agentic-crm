// The composer's text box (ask-agentic §2): a transparent textarea over a mirror that paints the tokens; "@" opens a
// typeahead of Objects, Users and Records, "/" one of the member's prompts (↑ / ↓ move, Enter or Tab insert, Esc closes);
// Enter sends, Shift+Enter breaks the line; Backspace at the end of a token removes it whole.
import { Avatar, PopoverPanel } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { useObjects } from '../../../data/objects';
import { api, inWorkspace } from '../../../data/trpc';
import { RecordAvatar, recordKind } from '../../attributes/ui/primitives';
import { useWorkspace } from '../../shell/workspaceContext';
import { promptTitle, usePrompts } from '../data';
import { PromptTile } from '../prompts/PromptTile';
import * as s from './composer.css';
import {
  type ActiveQuery,
  type AskTokenTarget,
  activeQuery,
  applyTextEdit,
  type ComposerText,
  fuzzyMatch,
  insertToken,
  removeToken,
  segments,
  tokenEndingAt,
  tokenStartingAt,
} from './model';

interface Option {
  key: string;
  group: 'Objects' | 'Users' | 'Records' | 'Prompts';
  target: AskTokenTarget;
  icon: ReactNode;
  secondary?: string | null;
  trailing?: ReactNode;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The options of the typeahead for the "@" / "/" being typed (empty while its answers are older than the query). */
function useOptions(active: ActiveQuery | null): Option[] {
  const { workspace } = useWorkspace();
  const ws = useMemo(() => ({ id: workspace.id, slug: workspace.slug }), [workspace.id, workspace.slug]);
  const objects = useObjects(workspace).data;
  const q = useDebounced(active?.query ?? '', 80);
  const mention = active?.trigger === '@';
  const prompt = active?.trigger === '/';
  const members = useQuery({
    queryKey: ['ws', ws.id, 'ask-mention', 'members', q],
    queryFn: () => api.search.members.query({ query: q, limit: 5 }, inWorkspace(ws)),
    enabled: mention,
    staleTime: 15_000,
  });
  const records = useQuery({
    queryKey: ['ws', ws.id, 'ask-mention', 'records', q],
    queryFn: () => api.search.records.query({ query: q, limit: 5 }, inWorkspace(ws)),
    enabled: mention,
    staleTime: 15_000,
  });
  const prompts = usePrompts({ scope: 'mine' }, prompt);
  if (!active || q !== active.query) return [];
  const out: Option[] = [];
  if (mention) {
    const needle = q.trim().toLowerCase();
    for (const o of (objects ?? []).filter(
      (o) =>
        needle !== '' && (o.pluralNoun.toLowerCase().includes(needle) || o.singularNoun.toLowerCase().includes(needle)),
    )) {
      out.push({
        key: `o:${o.id}`,
        group: 'Objects',
        target: { kind: 'object', entityDefinitionId: o.id, label: o.pluralNoun },
        icon: <RecordAvatar kind={recordKind(o)} size={20} />,
      });
    }
    for (const m of members.data?.hits ?? []) {
      const label = `${m.firstName} ${m.lastName}`.trim() || m.emailAddress;
      out.push({
        key: `m:${m.id}`,
        group: 'Users',
        target: { kind: 'member', memberId: m.id, label },
        icon: <Avatar name={label} seed={m.id} size={20} kind="member" />,
        secondary: m.emailAddress,
      });
    }
    for (const r of records.data?.hits ?? []) {
      const object = objects?.find((o) => o.id === r.entityDefinitionId);
      out.push({
        key: `r:${r.entityInstanceId}`,
        group: 'Records',
        target: {
          kind: 'record',
          entityDefinitionId: r.entityDefinitionId,
          entityInstanceId: r.entityInstanceId,
          label: r.title ?? 'Untitled record',
        },
        icon: <RecordAvatar kind={recordKind(object)} size={20} />,
        secondary: r.subtitle,
        trailing: object ? <RecordAvatar kind={recordKind(object)} size={16} /> : undefined,
      });
    }
  } else {
    for (const p of (prompts.data?.prompts ?? []).filter((p) => fuzzyMatch(q, promptTitle(p)))) {
      out.push({
        key: `p:${p.id}`,
        group: 'Prompts',
        target: { kind: 'prompt', promptId: p.id, label: promptTitle(p) },
        icon: <PromptTile iconId={p.iconId} color={p.iconColor} size={20} />,
      });
    }
  }
  return out;
}

export interface AskInputProps {
  value: ComposerText;
  onChange: (value: ComposerText) => void;
  onSubmit: () => void;
  placeholder: string;
  autoFocus?: boolean;
  disabled?: boolean;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  'aria-label'?: string;
  /** Anchor of the typeahead (the whole composer card). */
  anchorRef: RefObject<HTMLElement | null>;
}

export function AskInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  autoFocus,
  disabled,
  inputRef,
  anchorRef,
  'aria-label': ariaLabel,
}: AskInputProps) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const area = inputRef ?? ownRef;
  const [caret, setCaret] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const pendingCaret = useRef<number | null>(null);

  const query = activeQuery(value, caret);
  const open = query !== null && dismissedAt !== query.start;
  const options = useOptions(open ? query : null);

  useEffect(() => setActiveIndex(0), [query?.query, query?.trigger]);

  useEffect(() => {
    if (pendingCaret.current === null || !area.current) return;
    const at = pendingCaret.current;
    pendingCaret.current = null;
    area.current.setSelectionRange(at, at);
    setCaret(at);
  });

  const pick = (option: Option) => {
    if (!query) return;
    const out = insertToken(value, query.start, caret, option.target);
    pendingCaret.current = out.caret;
    onChange(out.value);
  };

  const syncCaret = () => setCaret(area.current?.selectionStart ?? 0);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && options.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) =>
          e.key === 'ArrowDown' ? (i + 1) % options.length : (i - 1 + options.length) % options.length,
        );
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        const option = options[activeIndex];
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
      const t = tokenEndingAt(value, el.selectionStart);
      if (t) {
        e.preventDefault();
        pendingCaret.current = t.start;
        onChange(removeToken(value, t));
        return;
      }
    }
    if (collapsed && e.key === 'Delete') {
      const t = tokenStartingAt(value, el.selectionStart);
      if (t) {
        e.preventDefault();
        pendingCaret.current = t.start;
        onChange(removeToken(value, t));
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !(e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit();
    }
  };

  const groups = ['Objects', 'Users', 'Records', 'Prompts'] as const;
  let index = -1;
  const rows = groups.map((group) => {
    const inGroup = options.filter((o) => o.group === group);
    if (inGroup.length === 0) return null;
    return (
      <div key={group} role="group" aria-label={group}>
        <div className={s.menuLabel}>{group}</div>
        {inGroup.map((o) => {
          index += 1;
          const i = index;
          return (
            <div
              key={o.key}
              role="option"
              aria-selected={i === activeIndex}
              className={s.option}
              data-active={i === activeIndex || undefined}
              data-testid="ask-option"
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
            >
              {o.icon}
              <span className={s.optionLabel}>{o.target.label}</span>
              {o.secondary && <span className={s.optionSecondary}>{o.secondary}</span>}
              {o.trailing && <span className={s.optionTrailing}>{o.trailing}</span>}
            </div>
          );
        })}
      </div>
    );
  });

  return (
    <div className={s.inputWrap}>
      <div className={s.mirror} aria-hidden="true">
        {segments(value).map((seg, i) =>
          seg.token ? (
            <span key={i} className={seg.token.kind === 'prompt' ? s.tokenPrompt : s.tokenMention}>
              {seg.text}
            </span>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
        {'​'}
      </div>
      <textarea
        ref={area}
        className={s.input}
        rows={1}
        value={value.text}
        placeholder={placeholder}
        aria-label={ariaLabel ?? 'Message'}
        data-testid="ask-input"
        autoFocus={autoFocus}
        disabled={disabled}
        onChange={(e) => {
          setDismissedAt(null);
          onChange(applyTextEdit(value, e.target.value));
          setCaret(e.target.selectionStart);
        }}
        onSelect={syncCaret}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onKeyDown={onKeyDown}
      />
      {open && (
        <PopoverPanel
          triggerRef={anchorRef as RefObject<HTMLElement>}
          isOpen
          isNonModal
          onOpenChange={(o) => {
            if (!o) setDismissedAt(query?.start ?? null);
          }}
          placement="bottom start"
          offset={6}
          width={320}
        >
          <div
            className={s.menu}
            role="listbox"
            aria-label={query?.trigger === '/' ? 'Prompts' : 'Mentions'}
            data-testid="ask-typeahead"
          >
            {options.length === 0 && (
              <div className={s.empty}>{query?.trigger === '/' ? 'No prompts found' : 'No results'}</div>
            )}
            {rows}
          </div>
        </PopoverPanel>
      )}
    </div>
  );
}
