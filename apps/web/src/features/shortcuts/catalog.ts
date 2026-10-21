// The shortcut catalog lists each binding with its section, description and keys.
// Features bind through `useAction(id, handler)` (keys come from here, so a tooltip, the help drawer and the binding
// can never disagree) or through `useShortcut(keys, …)`; the source-scan test (catalog.test.ts) keeps literal
// bindings and this list in step. Keys use the engine's names: `mod` (⌘ / Ctrl), `shift`, `alt`, `up`, `down`,
// `left`, `right`, `enter`, `tab`, `space`; a space separates the steps of a sequence (`g h` = G, then).
import { canonicalShortcut, useShortcut } from '../../lib/shortcuts';

export const SHORTCUT_SECTIONS = ['General', 'Record page', 'Table view', 'Views', 'Dialogs', 'Help'] as const;
export type ShortcutSection = (typeof SHORTCUT_SECTIONS)[number];

export interface CatalogEntry {
  id: string;
  section: ShortcutSection;
  description: string;
  /** Engine shortcut string. */
  keys: string;
  /** Listed in the help view but handled by the focused component (table cells, menus), not a global binding. */
  contextual?: boolean;
}

const g = (id: string, description: string, keys: string, contextual?: boolean): CatalogEntry => ({
  id,
  section: 'General',
  description,
  keys,
  contextual,
});
const t = (id: string, description: string, keys: string): CatalogEntry => ({
  id,
  section: 'Table view',
  description,
  keys,
  contextual: true,
});

/** Entries follow the order shown in the shortcut help view. */
export const SHORTCUT_CATALOG: readonly CatalogEntry[] = [
  g('quick-actions', 'Open quick actions', 'mod+k'),
  g('search', 'Open search', '/'),
  g('new-note', 'Create a new note', 'n'),
  g('new-entry', 'Create a new entry', 'e'),
  g('new-task', 'Create a new task', 't'),
  g('new-email', 'Create a new email', 'c'),
  g('go-home', 'Go to home page', 'g h'),
  g('go-tasks', 'Go to tasks page', 'g t'),
  g('go-notes', 'Go to all notes page', 'g n'),
  g('go-people', 'Go to all people page', 'g p'),
  g('go-companies', 'Go to all companies page', 'g c'),
  g('go-emails', 'Go to email drafts page', 'g e'),
  g('go-reports', 'Go to reports page', 'g d'),
  g('toggle-sidebar', 'Toggle sidebar', 'mod+.'),
  g('ask-ai', 'Open Ask AI', 'mod+j'),
  g('navigate-up', 'Navigate up', 'up', true),
  g('navigate-down', 'Navigate down', 'down', true),

  { id: 'next-tab', section: 'Record page', description: 'Go to next tab', keys: 'alt+right' },
  { id: 'previous-tab', section: 'Record page', description: 'Go to previous tab', keys: 'alt+left' },

  t('cell-up', 'Navigate to the cell above', 'up'),
  t('cell-right', 'Navigate to the cell to the right', 'right'),
  t('cell-down', 'Navigate to the cell below', 'down'),
  t('cell-left', 'Navigate to the cell to the left', 'left'),
  t('jump-bottom', 'Jump to bottom', 'mod+down'),
  t('jump-top', 'Jump to top', 'mod+up'),
  t('toggle-row', 'Select/deselect current row', 'shift+space'),
  t('select-rows-up', 'Group select rows up', 'shift+up'),
  t('select-rows-down', 'Group select rows down', 'shift+down'),
  t('select-to-top', 'Group select to top', 'mod+shift+up'),
  t('select-to-bottom', 'Group select to bottom', 'mod+shift+down'),
  t('open-record', 'Open record page for current entry', 'mod+enter'),
  t('select-all', 'Select/deselect all rows', 'mod+a'),
  t('next-cell', 'Go to next cell', 'tab'),
  t('previous-cell', 'Go to previous cell', 'shift+tab'),
  t('edit-cell', 'Edit cell/go to next cell', 'enter'),

  { id: 'view-switcher', section: 'Views', description: 'Open the view switcher', keys: 'v' },
  { id: 'view-settings', section: 'Views', description: 'Open view settings', keys: 'y' },

  { id: 'dialog-save', section: 'Dialogs', description: 'Save and close a dialog', keys: 'mod+enter' },

  { id: 'help', section: 'Help', description: 'Open help drawer', keys: '?' },
];

const byId = new Map(SHORTCUT_CATALOG.map((e) => [e.id, e]));

export function catalogEntry(id: string): CatalogEntry {
  const entry = byId.get(id);
  if (!entry) throw new Error(`unknown shortcut id "${id}"`);
  return entry;
}

/** Keys of a catalog id (`go-home` → `g h`). */
export function keysOf(id: string): string {
  return catalogEntry(id).keys;
}

/** The first catalog entry with these keys (descriptions for bindings made with a literal key string). */
export function entryForKeys(keys: string): CatalogEntry | undefined {
  const canonical = canonicalShortcut(keys);
  return SHORTCUT_CATALOG.find((e) => canonicalShortcut(e.keys) === canonical);
}

/** Binds the catalog action `id` while the component is mounted (keys from the catalog; `null` handler = unbound). */
export function useAction(id: string, handler: (event: KeyboardEvent) => void, enabled = true): void {
  const entry = catalogEntry(id);
  useShortcut(enabled ? entry.keys : null, handler, { id });
}
