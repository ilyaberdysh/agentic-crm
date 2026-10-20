// Renders the open suggestion (slash menu or mention typeahead) under the caret.
import { Avatar, useThemeClassName } from '@agentic-crm/ui';
import { autoUpdate, FloatingPortal, flip, offset, shift, useFloating } from '@floating-ui/react';
import { Building2, User } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { InsertItem } from './insert-items.tsx';
import * as s from './menus.css.ts';
import type { SuggestionSnapshot, SuggestionStore } from './suggestions.ts';
import type { MentionItem } from './types.ts';

export function InsertItemRow({
  item,
  active,
  onSelect,
  onHover,
}: {
  item: InsertItem;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  const Icon = item.icon;
  return (
    <div
      ref={ref}
      role="option"
      aria-selected={active}
      data-active={active}
      className={s.insertItem}
      onMouseDown={(e) => e.preventDefault()}
      onMouseMove={onHover}
      onClick={onSelect}
    >
      <span className={s.iconTile}>
        <Icon size={16} strokeWidth={1.5} aria-hidden />
      </span>
      <span className={s.itemText}>
        <span className={s.itemTitle}>{item.title}</span>
        <span className={s.itemDescription}>{item.description}</span>
      </span>
    </div>
  );
}

function MentionRow({
  item,
  active,
  onSelect,
  onHover,
}: {
  item: MentionItem;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  const shape = item.kind === 'member' || item.shape === 'round' ? 'person' : 'company';
  return (
    <div
      ref={ref}
      role="option"
      aria-selected={active}
      data-active={active}
      className={s.mentionOption}
      onMouseDown={(e) => e.preventDefault()}
      onMouseMove={onHover}
      onClick={onSelect}
    >
      {item.kind === 'member' || item.avatarUrl ? (
        <Avatar name={item.label} src={item.avatarUrl ?? null} kind={shape} size={16} seed={item.id} />
      ) : (
        // Records without an image get a grey placeholder glyph (Attio's EntityPlaceholderAvatar).
        <span className={s.recordGlyph} data-shape={shape === 'person' ? 'round' : 'box'} aria-hidden>
          {shape === 'person' ? <User size={10} strokeWidth={2} /> : <Building2 size={10} strokeWidth={2} />}
        </span>
      )}
      <span className={s.mentionName}>{item.label}</span>
      {item.secondary ? (
        <span className={s.mentionSecondary}>{item.secondary}</span>
      ) : (
        <span className={s.mentionSecondary} />
      )}
      {item.kind === 'record' ? (
        <span className={s.objectBadge} title={item.objectName ?? undefined} aria-hidden>
          {shape === 'person' ? <User size={12} strokeWidth={2} /> : <Building2 size={12} strokeWidth={2} />}
        </span>
      ) : null}
    </div>
  );
}

function useCaretFloating(snapshot: SuggestionSnapshot | null) {
  // Gaps under the line measured on note-editor-slash-menu.png (≈ 2 px) and note-mention-typeahead.png (≈ 6 px).
  const gap = snapshot?.kind === 'mention' ? 6 : 2;
  const floating = useFloating({
    placement: 'bottom-start',
    strategy: 'fixed',
    middleware: [offset(gap), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const { setReference } = floating.refs;
  useLayoutEffect(() => {
    const rect = snapshot?.clientRect;
    if (!rect) return;
    setReference({ getBoundingClientRect: () => rect() ?? new DOMRect() });
  }, [snapshot?.clientRect, setReference]);
  return floating;
}

export function SuggestionMenu({ store }: { store: SuggestionStore }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.get, store.get);
  const { refs, floatingStyles } = useCaretFloating(snapshot);
  const themeClass = useThemeClassName({ surfaceMode: 'elevated' });
  if (!snapshot || snapshot.items.length === 0) return null;

  if (snapshot.kind === 'slash') {
    return (
      <FloatingPortal>
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          className={`${themeClass} ${s.panel} ${s.insertPanel}`}
          role="listbox"
          aria-label="Insert block"
          data-testid="slash-menu"
        >
          {(snapshot.items as InsertItem[]).map((item, i) => (
            <InsertItemRow
              key={item.id}
              item={item}
              active={i === snapshot.index}
              onHover={() => store.setIndex(i)}
              onSelect={() => snapshot.select(item)}
            />
          ))}
        </div>
      </FloatingPortal>
    );
  }

  const items = snapshot.items as MentionItem[];
  const firstRecord = items.findIndex((i) => i.kind === 'record');
  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className={`${themeClass} ${s.panel} ${s.mentionPanel}`}
        role="listbox"
        aria-label="Mention"
        data-testid="mention-menu"
      >
        {items.map((item, i) => (
          <MentionGroup key={`${item.kind}:${item.id}`} label={labelBefore(items, i, firstRecord)}>
            <MentionRow
              item={item}
              active={i === snapshot.index}
              onHover={() => store.setIndex(i)}
              onSelect={() => snapshot.select(item)}
            />
          </MentionGroup>
        ))}
      </div>
    </FloatingPortal>
  );
}

function labelBefore(items: MentionItem[], i: number, firstRecord: number): string | null {
  if (i === 0) return items[0]?.kind === 'member' ? 'Users' : 'Records';
  return i === firstRecord ? 'Records' : null;
}

function MentionGroup({ label, children }: { label: string | null; children: React.ReactNode }) {
  return (
    <>
      {label ? (
        <div className={s.groupLabel} role="presentation">
          {label}
        </div>
      ) : null}
      {children}
    </>
  );
}
