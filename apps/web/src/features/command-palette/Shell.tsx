// One page of the palette: optional header with back chevron and breadcrumbs, the input row,
// the sectioned result list, the preview pane and the footer with the highlighted row's gesture. Every page — Quick
// actions, Search, Note templates, Choose list… — is this shell fed with rows.
//
// Keyboard: ↑ / ↓ move the highlight (wrapping), ↩ runs the row, ⌘↩ opens a record in a new tab, Esc clears the
// query, then pops the page / closes, ⌘K opens the Actions menu of a highlighted record (else closes: store.ts).
// The mouse never moves the highlight; a click runs the row.
import { Button, Icon, IconButton, Kbd, Spinner } from '@agentic-crm/ui';
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { ShortcutCaps } from '../shortcuts/ShortcutHint';
import * as s from './palette.css';
import { claimModK, closePalette, popPage, popToPage, setHighlightKey, setQuery, usePaletteState } from './store';

export interface ShellRow {
  key: string;
  section: string;
  icon: ReactNode;
  /** Draw the icon in its own outlined 20 px tile (default) or as is (avatars, coloured tiles). */
  plainIcon?: boolean;
  title: ReactNode;
  titleText: string;
  secondary?: string | null;
  /** Chips and badges at the end of the row. */
  trailing?: ReactNode;
  /** Shortcut hint (engine string) shown as key caps at the end of the row. */
  hint?: string;
  external?: boolean;
  /** Footer primary button label while this row is highlighted. */
  gesture: string;
  busy?: boolean;
  /** Runs the row; `mode: 'new-tab'` is ⌘↩ on records. */
  run: (mode: 'primary' | 'new-tab') => void;
  /** What the row stands for (read back by the page's preview and menu). */
  data?: unknown;
}

export interface MenuItem {
  id: string;
  label: string;
  /** Engine shortcut shown as caps (`enter`, `mod+enter`, `mod+c`). */
  keys?: string;
  run: () => void;
}

export interface Crumb {
  label: string;
  icon: ReactNode;
}

export interface ShellProps {
  /** Pages above the root show a back chevron and breadcrumbs (this page last). */
  crumbs?: Crumb[];
  /** Title of a page opened without a page below it ("Search"). */
  title?: Crumb;
  placeholder: string;
  query: string;
  highlightKey: string | null;
  rows: ShellRow[];
  /** Replaces the list when there are no rows. */
  empty?: ReactNode;
  /** The preview pane for the highlighted row; omit for a single-pane page. */
  preview?: (row: ShellRow | null) => ReactNode;
  /** The Actions menu of a highlighted record row (⌘). */
  menu?: (row: ShellRow) => MenuItem[] | null;
  /** The primary button when there is no row. */
  fallbackGesture?: string;
  loading?: boolean;
  /** Shown above the rows (an inline "No note templates" line while actions remain). */
  notice?: ReactNode;
}

export function PaletteShell(props: ShellProps) {
  const { rows, query, highlightKey, placeholder, crumbs, title, preview, menu, empty, loading, notice } = props;
  const state = usePaletteState();
  const depth = state.stack.length;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);

  const highlighted = useMemo(() => {
    const byKey = highlightKey ? rows.findIndex((r) => r.key === highlightKey) : -1;
    return byKey >= 0 ? byKey : rows.length > 0 ? 0 : -1;
  }, [rows, highlightKey]);
  const current = highlighted >= 0 ? (rows[highlighted] ?? null) : null;
  const items = useMemo(() => (current && menu ? menu(current) : null), [current, menu]);

  // The input takes focus whenever the page changes, a new open starts or the Actions menu closes.
  useEffect(() => {
    inputRef.current?.focus();
  }, [state.nonce, depth]);

  useEffect(() => {
    listRef.current?.querySelector('[data-highlighted]')?.scrollIntoView({ block: 'nearest' });
  }, [current?.key]);

  // ⌘K: the Actions menu of a highlighted record (toggles it); otherwise the store closes the modal.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => {
    claimModK(() => {
      if (!itemsRef.current || itemsRef.current.length === 0) return false;
      setMenuOpen((open) => !open);
      setMenuIndex(0);
      return true;
    });
    return () => claimModK(null);
  }, []);

  // A different row (or none) closes the menu.
  useEffect(() => {
    setMenuOpen(false);
  }, [current?.key]);

  const move = (delta: number) => {
    if (rows.length === 0) return;
    const next = (Math.max(highlighted, 0) + delta + rows.length) % rows.length;
    setHighlightKey((rows[next] as ShellRow).key);
  };

  const closeMenu = () => {
    setMenuOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    const mod = e.metaKey || e.ctrlKey;
    if (menuOpen && items) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setMenuIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const wanted = mod ? 'mod+enter' : undefined;
        const item = wanted ? items.find((it) => it.keys === wanted) : items[menuIndex];
        closeMenu();
        item?.run();
      } else if (mod && e.key.toLowerCase() === 'c') {
        const item = items.find((it) => it.keys === 'mod+c');
        if (item) {
          e.preventDefault();
          closeMenu();
          item.run();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Enter':
        e.preventDefault();
        if (current && !current.busy) current.run(mod && menu ? 'new-tab' : 'primary');
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        if (query) setQuery('');
        else popPage();
        break;
    }
  };

  const sections = useMemo(() => {
    const out: { section: string; rows: ShellRow[] }[] = [];
    for (const row of rows) {
      const last = out[out.length - 1];
      if (last && last.section === row.section) last.rows.push(row);
      else out.push({ section: row.section, rows: [row] });
    }
    return out;
  }, [rows]);

  const gesture = current?.gesture ?? props.fallbackGesture;
  const header = crumbs ?? (title ? [title] : null);

  return (
    <div className={s.body} onKeyDown={onKeyDown} data-testid="palette" data-page-depth={depth}>
      {header && (
        <div className={s.header}>
          {crumbs && depth > 1 && <IconButton icon="chevronLeft" aria-label="Go back" size={28} onPress={popPage} />}
          <nav className={s.crumbs} aria-label="Breadcrumb">
            {header.map((crumb, i) => {
              const last = i === header.length - 1;
              return (
                <span key={crumb.label} style={{ display: 'contents' }}>
                  {i > 0 && <span className={s.crumbSlash}>/</span>}
                  <button
                    type="button"
                    className={s.crumb}
                    data-current={last || undefined}
                    onClick={() => !last && popToPage(i)}
                    tabIndex={last ? -1 : 0}
                  >
                    <span className={s.crumbIcon}>{crumb.icon}</span>
                    {crumb.label}
                  </button>
                </span>
              );
            })}
          </nav>
          <IconButton icon="close" aria-label="Close" size={28} onPress={closePalette} />
        </div>
      )}
      <div className={`${s.inputRow} ${header ? s.inputRowPushed : ''}`}>
        <input
          ref={inputRef}
          className={s.input}
          role="combobox"
          aria-expanded
          aria-controls="palette-list"
          aria-activedescendant={current ? `palette-row-${current.key}` : undefined}
          aria-label={placeholder}
          placeholder={placeholder}
          value={query}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="palette-input"
        />
        {loading && <Spinner size={16} className={s.spinner} />}
      </div>
      <div className={s.panes}>
        <div className={`${s.listPane} ${preview ? '' : s.listPaneSingle}`}>
          {rows.length === 0 && empty ? (
            empty
          ) : (
            <div className={s.list} id="palette-list" role="listbox" aria-label="Results" ref={listRef}>
              {notice}
              {sections.map(({ section, rows: sectionRows }) => (
                <div key={section} role="group" aria-label={section} style={{ display: 'contents' }}>
                  <h3 className={s.sectionHeader}>{section}</h3>
                  {sectionRows.map((row) => (
                    <RowView key={row.key} row={row} highlighted={row.key === current?.key} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        {preview && <div className={s.preview}>{preview(current)}</div>}
      </div>
      <div className={s.footer}>
        <span className={s.hint}>
          <span className={s.hintCaps}>
            <span className={s.hintCap}>
              <Icon icon="arrowUp" size={12} />
            </span>
            <span className={s.hintCap}>
              <Icon icon="arrowDown" size={12} />
            </span>
          </span>
          Navigate
        </span>
        <span className={s.footerActions}>
          {items && items.length > 0 && (
            <span className={s.menuAnchor}>
              <Button
                variant="secondary"
                size={28}
                onPress={() => {
                  setMenuOpen((open) => !open);
                  setMenuIndex(0);
                }}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                data-testid="palette-actions-button"
              >
                Actions
                <Kbd keys={['mod', 'k']} size={16} />
              </Button>
              {menuOpen && (
                <div className={s.menu} role="menu" aria-label="Record actions" data-testid="palette-actions-menu">
                  {items.map((item, i) => (
                    <div
                      key={item.id}
                      role="menuitem"
                      tabIndex={-1}
                      className={s.menuItem}
                      data-highlighted={i === menuIndex || undefined}
                      onClick={() => {
                        closeMenu();
                        item.run();
                      }}
                    >
                      {item.label}
                      {item.keys && <ShortcutCaps shortcut={item.keys} size={18} />}
                    </div>
                  ))}
                </div>
              )}
            </span>
          )}
          {gesture && (
            <Button
              variant="primary"
              size={28}
              isDisabled={!current && !props.fallbackGesture}
              onPress={() => current?.run('primary')}
              data-testid="palette-primary"
            >
              {gesture}
              <Kbd keys={['enter']} size={16} variant="on-accent" />
            </Button>
          )}
        </span>
      </div>
    </div>
  );
}

function RowView({ row, highlighted }: { row: ShellRow; highlighted: boolean }) {
  return (
    <div
      id={`palette-row-${row.key}`}
      role="option"
      aria-selected={highlighted}
      className={s.option}
      data-highlighted={highlighted || undefined}
      data-row-key={row.key}
      onClick={() => !row.busy && row.run('primary')}
    >
      <span className={`${s.optionIcon} ${row.plainIcon ? s.optionIconPlain : ''}`}>{row.icon}</span>
      <span className={s.optionTitle}>{row.title}</span>
      {row.external && <Icon icon="arrowUpRight" size={12} className={s.external} />}
      {row.secondary !== undefined && row.secondary !== null ? (
        <span className={s.optionSecondary}>{row.secondary}</span>
      ) : (
        <span className={s.optionSpacer} />
      )}
      {(row.trailing || row.hint || row.busy) && (
        <span className={s.optionTrailing}>
          {row.busy && <Spinner size={16} />}
          {row.trailing}
          {row.hint && <ShortcutCaps shortcut={row.hint} size={16} />}
        </span>
      )}
    </div>
  );
}
