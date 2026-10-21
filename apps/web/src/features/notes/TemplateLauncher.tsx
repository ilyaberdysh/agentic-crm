// Empty-note template launcher ("Use a template"; evidence E/note-empty-template-launcher.png,
// note-template-picker.png): FAVORITE TEMPLATES (the member's favourite templates), then ACTIONS: "View all
// templates" (searchable popover, hover shows a preview on the left) and "Create new template". ↑ / ↓ / Enter work
// from the empty editor.
import { cx, Icon, PopoverPanel } from '@agentic-crm/ui';
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { Button as AriaButton, Dialog } from 'react-aria-components';
import { useFavorites } from '../favorites/data';
import { useNoteTemplates } from './data';
import { NotePreview } from './editor/NotePreview';
import * as p from './launcher.css';
import * as s from './window.css';

export type LauncherKey = 'ArrowUp' | 'ArrowDown' | 'Enter';
export type LauncherKeys = RefObject<((key: LauncherKey) => boolean) | null>;

interface Item {
  id: string;
  label: string;
  run: () => void;
}

export function TemplateLauncher({
  onPick,
  onCreate,
  keysRef,
}: {
  onPick: (templateId: string) => void;
  onCreate: () => void;
  keysRef: LauncherKeys;
}) {
  const favorites = useFavorites().data;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const viewAllRef = useRef<HTMLButtonElement>(null);
  const favoriteTemplates = useMemo(
    () =>
      (favorites?.favorites ?? [])
        .filter((f) => f.favoriteType === 'note-template' && f.target.state !== 'missing')
        .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : 1)),
    [favorites],
  );
  const items: Item[] = [
    ...favoriteTemplates.map((f) => ({
      id: `fav:${f.targetId}`,
      label: f.target.label || 'Untitled Template',
      run: () => onPick(f.targetId),
    })),
    { id: 'all', label: 'View all templates', run: () => setPickerOpen(true) },
    { id: 'create', label: 'Create new template', run: onCreate },
  ];

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const highlightRef = useRef(highlight);
  highlightRef.current = highlight;
  useEffect(() => {
    keysRef.current = (key) => {
      const list = itemsRef.current;
      if (key === 'Enter') {
        const item = list[highlightRef.current];
        if (!item) return false;
        item.run();
        return true;
      }
      setHighlight((h) => (key === 'ArrowDown' ? (h + 1) % list.length : h <= 0 ? list.length - 1 : h - 1));
      return true;
    };
    return () => {
      keysRef.current = null;
    };
  }, [keysRef]);

  const row = (item: Item, index: number, ref?: RefObject<HTMLButtonElement | null>) => (
    <AriaButton
      key={item.id}
      ref={ref}
      className={s.launcherItem}
      data-highlighted={index === highlight || undefined}
      onHoverStart={() => setHighlight(index)}
      onPress={item.run}
    >
      <span className={s.launcherIcon}>
        <Icon icon="noteTemplate" size={14} />
      </span>
      {item.label}
    </AriaButton>
  );

  return (
    <div className={s.launcher} data-testid="template-launcher">
      {favoriteTemplates.length > 0 && (
        <div className={s.launcherGroup}>
          <p className={s.launcherLabel}>Favorite templates</p>
          {items.slice(0, favoriteTemplates.length).map((item, i) => row(item, i))}
        </div>
      )}
      <div className={s.launcherGroup}>
        <p className={s.launcherLabel}>Actions</p>
        {row(items[favoriteTemplates.length] as Item, favoriteTemplates.length, viewAllRef)}
        {row(items[favoriteTemplates.length + 1] as Item, favoriteTemplates.length + 1)}
      </div>
      {pickerOpen && (
        <PopoverPanel
          triggerRef={viewAllRef}
          isOpen
          onOpenChange={setPickerOpen}
          placement="top start"
          offset={4}
          width={364}
          padding={0}
        >
          <Dialog aria-label="Templates" className={p.picker}>
            <TemplatePicker
              onPick={(id) => {
                setPickerOpen(false);
                onPick(id);
              }}
            />
          </Dialog>
        </PopoverPanel>
      )}
    </div>
  );
}

/** "Search templates..." + every template; hovering one previews it in a dark card on the left. */
export function TemplatePicker({ onPick }: { onPick: (templateId: string) => void }) {
  const [query, setQuery] = useState('');
  const [hovered, setHovered] = useState<string | null>(null);
  const templates = useNoteTemplates({ search: query.trim() || undefined }).data?.templates ?? [];
  const preview = templates.find((t) => t.id === hovered) ?? null;
  return (
    <div className={p.pickerBody}>
      <div className={p.searchRow}>
        <Icon icon="search" size={16} className={p.searchIcon} />
        <input
          className={p.searchInput}
          placeholder="Search templates..."
          aria-label="Search templates"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && templates[0]) onPick(templates[0].id);
          }}
        />
      </div>
      <div className={p.list} role="listbox" aria-label="Templates">
        {templates.length === 0 && <div className={p.empty}>No templates found</div>}
        {templates.map((t) => (
          <AriaButton
            key={t.id}
            className={cx(s.launcherItem, p.item)}
            data-highlighted={hovered === t.id || undefined}
            onHoverStart={() => setHovered(t.id)}
            onHoverEnd={() => setHovered((h) => (h === t.id ? null : h))}
            onPress={() => onPick(t.id)}
          >
            <Icon icon="noteTemplate" size={16} />
            <span className={p.itemLabel}>{t.title || 'Untitled Template'}</span>
          </AriaButton>
        ))}
      </div>
      {preview && (
        <div className={p.preview} aria-hidden="true">
          <div className={p.previewPaper}>
            <NotePreview content={preview.content} compact maxBlocks={8} emptyText={preview.title} />
          </div>
          <div className={p.previewCaption}>{preview.title || 'Untitled Template'}</div>
        </div>
      )}
    </div>
  );
}
