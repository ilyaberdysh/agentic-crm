// The "+" insert button (22 px, pinned bottom-left in the note window by the host) and its popover: a
// "Search items..." field and the same items as the slash menu (note-insert-menu.png).
import { useThemeClassName } from '@agentic-crm/ui';
import { autoUpdate, FloatingPortal, flip, offset, shift, useFloating } from '@floating-ui/react';
import { Plus, Search } from 'lucide-react';
import { type KeyboardEvent, useEffect, useMemo, useState } from 'react';
import { filterInsertItems } from './insert-items.tsx';
import * as s from './menus.css.ts';
import { InsertItemRow } from './SuggestionMenu.tsx';
import type { EditorHandle } from './types.ts';

export interface InsertMenuButtonProps {
  /** The handle from `onReady`; the button is disabled until the editor is ready and editable. */
  handle: EditorHandle | null;
  className?: string;
}

export function InsertMenuButton({ handle, className }: InsertMenuButtonProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const themeClass = useThemeClassName({ surfaceMode: 'elevated' });
  const { refs, floatingStyles, elements } = useFloating({
    open,
    // Beside the button, shifted up to stay in view (note-insert-menu.png: the menu opens to the right of "+").
    placement: 'right-end',
    strategy: 'fixed',
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const items = useMemo(() => (handle ? filterInsertItems(query, handle.insertItems()) : []), [handle, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
    const onPointer = (event: PointerEvent) => {
      const node = event.target as Node | null;
      if (node && (elements.floating?.contains(node) || elements.domReference?.contains(node))) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer, true);
    return () => document.removeEventListener('pointerdown', onPointer, true);
  }, [open, elements.floating, elements.domReference]);

  useEffect(() => setIndex(0), [query]);

  const choose = (i: number) => {
    const item = items[i];
    if (!item || !handle) return;
    setOpen(false);
    handle.runInsertItem(item.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      choose(index);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      handle?.focus();
    }
  };

  const disabled = !handle || !handle.isEditable();
  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        className={`${s.insertButton} ${className ?? ''}`}
        aria-label="Insert"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-open={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        data-testid="insert-button"
      >
        <Plus size={14} strokeWidth={2} />
      </button>
      {open ? (
        <FloatingPortal>
          {/* The popover is a keyboard-first picker; focus starts in the search field. */}
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className={`${themeClass} ${s.panel} ${s.insertPanel}`}
            data-testid="insert-menu"
          >
            <div className={s.searchRow}>
              <Search size={16} strokeWidth={1.5} aria-hidden />
              <input
                autoFocus
                className={s.searchInput}
                placeholder="Search items..."
                aria-label="Search items"
                role="combobox"
                aria-expanded="true"
                aria-controls="agentic-crm-insert-items"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
              />
            </div>
            <div
              id="agentic-crm-insert-items"
              role="listbox"
              style={{ display: 'flex', flexDirection: 'column', gap: 1 }}
            >
              {items.length === 0 ? <div className={s.emptyResults}>No results found</div> : null}
              {items.map((item, i) => (
                <InsertItemRow
                  key={item.id}
                  item={item}
                  active={i === index}
                  onHover={() => setIndex(i)}
                  onSelect={() => choose(i)}
                />
              ))}
            </div>
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}
