// Drag and drop of the sidebar Favorites (B sidebar §6): rows flatten to what is visible (folders, the children of open
// folders); a drop is either a line before a row (it joins that row's container), the end of the list, or "into" a
// folder (appended). Folders only live at the top level. The result is the new parent and a rank between the new
// neighbours (only the moved item is written, X-01).
import { rankBetween } from '@agentic-crm/contracts';
import type { FavoriteTree } from './data';

export interface FlatRow {
  kind: 'directory' | 'favorite';
  id: string;
  /** Folder of a child favorite; null at the top level. */
  parentId: string | null;
  sortOrder: string;
}

export type DropTarget = { kind: 'line'; index: number } | { kind: 'folder'; directoryId: string };

/** Visible rows in display order. */
export function flatten(tree: FavoriteTree, isOpen: (directoryId: string) => boolean): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const item of tree.top) {
    if (item.kind === 'directory') {
      const d = item.directory;
      rows.push({ kind: 'directory', id: d.id, parentId: null, sortOrder: d.sortOrder });
      if (isOpen(d.id)) {
        for (const f of tree.children.get(d.id) ?? []) {
          rows.push({ kind: 'favorite', id: f.id, parentId: d.id, sortOrder: f.sortOrder });
        }
      }
    } else {
      rows.push({ kind: 'favorite', id: item.favorite.id, parentId: null, sortOrder: item.favorite.sortOrder });
    }
  }
  return rows;
}

function containerItems(tree: FavoriteTree, parentId: string | null): { id: string; sortOrder: string }[] {
  if (parentId === null) {
    return tree.top.map((t) =>
      t.kind === 'directory'
        ? { id: t.directory.id, sortOrder: t.directory.sortOrder }
        : { id: t.favorite.id, sortOrder: t.favorite.sortOrder },
    );
  }
  return (tree.children.get(parentId) ?? []).map((f) => ({ id: f.id, sortOrder: f.sortOrder }));
}

export interface DropResult {
  parentId: string | null;
  sortOrder: string;
}

/** Where `dragged` lands for `target`, or null when the drop changes nothing or is not allowed. */
export function resolveDrop(
  tree: FavoriteTree,
  rows: FlatRow[],
  dragged: FlatRow,
  target: DropTarget,
): DropResult | null {
  let parentId: string | null;
  let beforeId: string | null; // insert before this item of the container (null = at the end)
  if (target.kind === 'folder') {
    if (dragged.kind === 'directory') return null;
    parentId = target.directoryId;
    beforeId = null;
  } else {
    const at = rows[target.index];
    if (!at) {
      parentId = null;
      beforeId = null;
    } else if (at.kind === 'favorite' && at.parentId !== null) {
      if (dragged.kind === 'directory') return null;
      parentId = at.parentId;
      beforeId = at.id;
    } else {
      parentId = null;
      beforeId = at.id;
    }
  }
  if (beforeId === dragged.id) return null;
  const items = containerItems(tree, parentId).filter((i) => i.id !== dragged.id);
  const index = beforeId === null ? items.length : items.findIndex((i) => i.id === beforeId);
  if (index < 0) return null;
  const before = items[index - 1]?.sortOrder ?? null;
  const after = items[index]?.sortOrder ?? null;
  // Dropping where it already is (same container, same neighbours) is a no-op.
  if (parentId === dragged.parentId) {
    const original = containerItems(tree, parentId);
    const pos = original.findIndex((i) => i.id === dragged.id);
    if ((original[pos - 1]?.sortOrder ?? null) === before && (original[pos + 1]?.sortOrder ?? null) === after)
      return null;
  }
  return { parentId, sortOrder: rankBetween(before, after) };
}
