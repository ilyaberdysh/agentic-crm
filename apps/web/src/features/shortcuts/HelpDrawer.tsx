// Help drawer (system-ui): a non-modal floating panel at the right edge. "Help" view: title,
// "Search help", "Getting started" cards and the footer links (Help center, Support, Community, Shortcuts, Terms and
// privacy). "Shortcuts" view ("‹ Keyboard shortcuts"): a filter field and every registered binding by section, key
// caps on the right, the footer links pinned underneath. Article search and chat (Algolia, Intercom) are deferred
//: the footer links say so instead of leading nowhere.
import { Icon, IconButton, type IconName, SearchField, toast, useThemeClassName } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { canonicalShortcut, useRegisteredShortcuts } from '../../lib/shortcuts';
import { openQuickActions } from '../command-palette/store';
import { useWorkspace } from '../shell/workspaceContext';
import { type CatalogEntry, entryForKeys, SHORTCUT_CATALOG, SHORTCUT_SECTIONS, useAction } from './catalog';
import * as s from './help.css';
import { closeHelpDrawer, type HelpView, openHelpDrawer, setHelpView, useHelpState } from './helpStore';
import { ShortcutCaps } from './ShortcutHint';

/** One row of the Shortcuts view. */
export interface ShortcutRow {
  key: string;
  section: string;
  description: string;
  keys: string;
}

/** Catalog entries in order, then bindings registered without a catalog entry under "Other". */
export function shortcutRows(registered: { shortcut: string; meta: { description?: string } }[]): ShortcutRow[] {
  const rows: ShortcutRow[] = SHORTCUT_CATALOG.map((e: CatalogEntry) => ({
    key: e.id,
    section: e.section,
    description: e.description,
    keys: e.keys,
  }));
  const listed = new Set(SHORTCUT_CATALOG.map((e) => canonicalShortcut(e.keys)));
  for (const r of registered) {
    if (listed.has(r.shortcut)) continue;
    rows.push({
      key: `other:${r.shortcut}`,
      section: 'Other',
      description: r.meta.description ?? entryForKeys(r.shortcut)?.description ?? 'Shortcut',
      keys: r.shortcut,
    });
  }
  return rows;
}

const SECTION_ORDER: string[] = [...SHORTCUT_SECTIONS, 'Other'];

export function groupShortcuts(rows: ShortcutRow[], query: string): { section: string; rows: ShortcutRow[] }[] {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) => r.description.toLowerCase().includes(q) || r.keys.toLowerCase().includes(q))
    : rows;
  return SECTION_ORDER.map((section) => ({ section, rows: filtered.filter((r) => r.section === section) })).filter(
    (g) => g.rows.length > 0,
  );
}

function FooterLink({ icon, children, onPress }: { icon: IconName; children: ReactNode; onPress: () => void }) {
  return (
    <AriaButton className={s.footerLink} onPress={onPress}>
      <Icon icon={icon} size={16} className={s.footerIcon} />
      {children}
    </AriaButton>
  );
}

function notConfigured(what: string): void {
  toast({ title: `${what} isn't set up for this workspace yet` });
}

function Footer({ shortcutsLink }: { shortcutsLink: boolean }) {
  return (
    <div className={s.footer}>
      <FooterLink icon="help" onPress={() => notConfigured('The help center')}>
        Help center
      </FooterLink>
      <FooterLink icon="compose" onPress={() => notConfigured('Support chat')}>
        Support
      </FooterLink>
      <FooterLink icon="people" onPress={() => notConfigured('The community')}>
        Community
      </FooterLink>
      {shortcutsLink && (
        <FooterLink icon="command" onPress={() => setHelpView('shortcuts')}>
          Shortcuts
        </FooterLink>
      )}
      <FooterLink icon="lock" onPress={() => notConfigured('The terms page')}>
        Terms and privacy
      </FooterLink>
    </div>
  );
}

interface Card {
  id: string;
  icon: IconName;
  title: string;
  body: string;
  run: () => void;
}

function HelpView({ autoFocusKey }: { autoFocusKey: number }) {
  const navigate = useNavigate();
  const { href } = useWorkspace();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // The search field takes focus on every open (autofocus with the accent ring, system-ui).
    inputRef.current?.focus();
  }, [autoFocusKey]);
  const cards: Card[] = [
    {
      id: 'quick-actions',
      icon: 'command',
      title: 'Quick actions',
      body: 'Press ⌘K to jump anywhere, create records and run commands',
      run: () => {
        closeHelpDrawer();
        openQuickActions();
      },
    },
    {
      id: 'shortcuts',
      icon: 'command',
      title: 'Keyboard shortcuts',
      body: 'Learn every shortcut, from G then H to creating a task with T',
      run: () => setHelpView('shortcuts'),
    },
    {
      id: 'import',
      icon: 'import',
      title: 'Importing your data',
      body: 'Bring over data from your previous solution with the CSV importer',
      run: () => void navigate({ href: href('settings/data/import-history') }),
    },
  ];
  const q = query.trim().toLowerCase();
  const shown = q ? cards.filter((c) => `${c.title} ${c.body}`.toLowerCase().includes(q)) : cards;
  return (
    <>
      <div className={s.header}>
        <h2 className={s.title}>Help</h2>
        <IconButton icon="close" aria-label="Close help drawer" size={28} onPress={closeHelpDrawer} />
      </div>
      <div className={s.searchWrap}>
        <SearchField
          ref={inputRef}
          aria-label="Search help"
          placeholder="Search help"
          size={34}
          value={query}
          onChange={setQuery}
          autoFocus
        />
      </div>
      <div className={s.scroll}>
        <h3 className={s.cardsTitle}>{q ? 'Results' : 'Getting started'}</h3>
        {shown.length === 0 ? (
          <div className={s.empty}>No results for "{query.trim()}". Try something else!</div>
        ) : (
          shown.map((card) => (
            <AriaButton key={card.id} className={s.card} onPress={card.run}>
              <span className={s.cardIcon}>
                <Icon icon={card.icon} size={20} />
              </span>
              <span className={s.cardText}>
                <span className={s.cardTitle}>{card.title}</span>
                <span className={s.cardBody}>{card.body}</span>
              </span>
            </AriaButton>
          ))
        )}
      </div>
      <Footer shortcutsLink />
    </>
  );
}

function ShortcutsView() {
  const [query, setQuery] = useState('');
  const registered = useRegisteredShortcuts();
  const groups = useMemo(() => groupShortcuts(shortcutRows(registered), query), [registered, query]);
  return (
    <>
      <div className={s.header}>
        <IconButton icon="chevronLeft" aria-label="Go back" size={28} onPress={() => setHelpView('help')} />
        <h2 className={s.title}>Keyboard shortcuts</h2>
        <IconButton icon="close" aria-label="Close help drawer" size={28} onPress={closeHelpDrawer} />
      </div>
      <div className={s.searchWrap}>
        <SearchField
          aria-label="Search shortcuts"
          placeholder="Search..."
          size={34}
          value={query}
          onChange={setQuery}
        />
      </div>
      <div className={s.scroll} data-testid="shortcuts-list">
        {groups.length === 0 && <div className={s.empty}>No shortcuts found</div>}
        {groups.map((group) => (
          <section key={group.section} className={s.section} aria-label={group.section}>
            <h3 className={s.sectionTitle}>{group.section}</h3>
            {group.rows.map((row) => (
              <div key={row.key} className={s.row} data-testid="shortcut-row" data-keys={row.keys}>
                <span className={s.rowLabel}>{row.description}</span>
                <ShortcutCaps shortcut={row.keys} />
              </div>
            ))}
          </section>
        ))}
      </div>
      <Footer shortcutsLink={false} />
    </>
  );
}

/** Mounted once per workspace layout. */
export function HelpDrawerHost() {
  const state = useHelpState();
  const themeClass = useThemeClassName({ surfaceMode: 'elevated' });
  useAction('help', () => openHelpDrawer());
  // The Help buttons of pages we do not own (the list page header) carry aria-label "Help": one delegated listener
  // opens the drawer for them (HelpButton and the record header open it directly).
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest('button[aria-label="Help"]');
      if (button && !button.closest('[data-help-drawer]')) openHelpDrawer();
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
  if (!state.open) return null;
  return <HelpPanel view={state.view} nonce={state.nonce} className={themeClass} />;
}

function HelpPanel({ view, nonce, className }: { view: HelpView; nonce: number; className: string }) {
  return (
    <aside
      className={`${className} ${s.drawer}`}
      aria-label={view === 'help' ? 'Help' : 'Keyboard shortcuts'}
      data-help-drawer={view}
      data-testid="help-drawer"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          closeHelpDrawer();
        }
      }}
    >
      {view === 'help' ? <HelpView autoFocusKey={nonce} /> : <ShortcutsView />}
    </aside>
  );
}
