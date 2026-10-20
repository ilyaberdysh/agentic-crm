import { describe, expect, it } from 'vitest';
import { type Favorite, type FavoritesList, favoriteTree } from './data';
import { flatten, resolveDrop } from './dnd';

const fav = (id: string, sortOrder: string, directoryId: string | null = null): Favorite => ({
  id,
  favoriteType: 'note',
  entityDefinitionId: null,
  targetId: `t-${id}`,
  directoryId,
  sortOrder,
  createdAt: '2026-10-09T00:00:00Z',
  target: { state: 'ok', label: id, secondaryLabel: null },
});

const list: FavoritesList = {
  directories: [{ id: 'F', title: 'Folder', sortOrder: 'm', createdAt: '2026-10-09T00:00:00Z' }],
  favorites: [fav('a', 'g'), fav('b', 't'), fav('c', 'h', 'F'), fav('d', 'p', 'F')],
};

describe('favorites tree', () => {
  it('orders folders and favorites by rank at the top level', () => {
    const tree = favoriteTree(list);
    expect(tree.top.map((t) => (t.kind === 'directory' ? t.directory.id : t.favorite.id))).toEqual(['a', 'F', 'b']);
    expect(tree.children.get('F')?.map((f) => f.id)).toEqual(['c', 'd']);
  });

  it('flattens open folders only', () => {
    const tree = favoriteTree(list);
    expect(flatten(tree, () => true).map((r) => r.id)).toEqual(['a', 'F', 'c', 'd', 'b']);
    expect(flatten(tree, () => false).map((r) => r.id)).toEqual(['a', 'F', 'b']);
  });
});

describe('resolveDrop', () => {
  const tree = favoriteTree(list);
  const rows = flatten(tree, () => true);
  const row = (id: string) => rows.find((r) => r.id === id) as (typeof rows)[number];

  it('moves a top-level favorite into a folder (appended)', () => {
    const out = resolveDrop(tree, rows, row('a'), { kind: 'folder', directoryId: 'F' });
    expect(out?.parentId).toBe('F');
    expect(out && out.sortOrder > 'p').toBe(true);
  });

  it('a line before a child joins that folder between its neighbours', () => {
    const out = resolveDrop(tree, rows, row('b'), { kind: 'line', index: rows.indexOf(row('d')) });
    expect(out?.parentId).toBe('F');
    expect(out && out.sortOrder > 'h' && out.sortOrder < 'p').toBe(true);
  });

  it('a child dragged before a top-level row leaves its folder', () => {
    const out = resolveDrop(tree, rows, row('c'), { kind: 'line', index: rows.indexOf(row('b')) });
    expect(out?.parentId).toBeNull();
    expect(out && out.sortOrder > 'm' && out.sortOrder < 't').toBe(true);
  });

  it('the end of the list is the top level', () => {
    const out = resolveDrop(tree, rows, row('a'), { kind: 'line', index: rows.length });
    expect(out?.parentId).toBeNull();
    expect(out && out.sortOrder > 't').toBe(true);
  });

  it('folders stay at the top level and drops in place are no-ops', () => {
    expect(resolveDrop(tree, rows, row('F'), { kind: 'line', index: rows.indexOf(row('d')) })).toBeNull();
    expect(resolveDrop(tree, rows, row('F'), { kind: 'folder', directoryId: 'F' })).toBeNull();
    expect(resolveDrop(tree, rows, row('a'), { kind: 'line', index: rows.indexOf(row('F')) })).toBeNull();
    expect(resolveDrop(tree, rows, row('a'), { kind: 'line', index: 0 })).toBeNull();
    const moved = resolveDrop(tree, rows, row('F'), { kind: 'line', index: 0 });
    expect(moved?.parentId).toBeNull();
    expect(moved && moved.sortOrder < 'g').toBe(true);
  });
});
