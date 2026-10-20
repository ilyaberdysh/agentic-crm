// The help drawer lists every registered binding (BACKLOG 5 acceptance 3). This scans the source for the bindings made
// with literal keys (`useShortcut('e', …)`) and catalog ids (`useAction('go-home', …)`) and checks that each one has a
// catalog entry, so adding a shortcut without describing it fails here.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalShortcut } from '../../lib/shortcuts';
import { entryForKeys, SHORTCUT_CATALOG, SHORTCUT_SECTIONS } from './catalog';

const SRC = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Page-local bindings that are not part of the app-wide help list, with why. */
const UNLISTED: Record<string, string> = {
  // The merge dialog confirms with ↩ only while it is open; the workspace picker focuses its search with ⌘F; the report
  // viewer / editor overlay closes with Esc and steps through the dashboard's reports with J / K.
  enter: 'merge dialog confirmation',
  'mod+f': 'workspace picker search',
  esc: 'report overlay close',
  j: 'report overlay next report',
  k: 'report overlay previous report',
};

describe('shortcut catalog', () => {
  const files = sourceFiles(SRC).filter((f) => !f.endsWith('lib/shortcuts.ts') && !f.endsWith('catalog.ts'));
  const literals: { keys: string; file: string }[] = [];
  const actions: { id: string; file: string }[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/useShortcut\(\s*(?:[a-z]+ \? )?'([^']+)'/g)) {
      literals.push({ keys: m[1] as string, file: file.slice(SRC.length) });
    }
    for (const m of text.matchAll(/useAction\(\s*'([^']+)'/g)) {
      actions.push({ id: m[1] as string, file: file.slice(SRC.length) });
    }
  }

  it('finds the bindings (the scan is not vacuous)', () => {
    expect(literals.length).toBeGreaterThan(5);
    expect(actions.length).toBeGreaterThan(10);
  });

  it('every useAction id exists in the catalog', () => {
    const ids = new Set(SHORTCUT_CATALOG.map((e) => e.id));
    for (const { id, file } of actions) expect(ids.has(id), `${id} used in ${file}`).toBe(true);
  });

  it('every literal binding has a catalog entry (or is listed as page-local)', () => {
    for (const { keys, file } of literals) {
      const listed = entryForKeys(keys) !== undefined || canonicalShortcut(keys) in UNLISTED;
      expect(listed, `useShortcut('${keys}') in ${file} has no catalog entry`).toBe(true);
    }
  });

  it('ids are unique and every entry sits in a known section', () => {
    const ids = SHORTCUT_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of SHORTCUT_CATALOG) expect(SHORTCUT_SECTIONS).toContain(e.section);
  });

  it('the global entries are the shortcuts.md §2 list (plus g d)', () => {
    const general = SHORTCUT_CATALOG.filter((e) => e.section === 'General' && !e.contextual).map((e) => e.keys);
    expect(general).toEqual(
      expect.arrayContaining([
        'mod+k',
        '/',
        'n',
        'e',
        't',
        'c',
        'g h',
        'g t',
        'g n',
        'g p',
        'g c',
        'g e',
        'g d',
        'mod+.',
      ]),
    );
  });
});
