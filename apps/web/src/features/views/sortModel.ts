// Sorts (C1 filters-sorts-calcs §7, README §3.2): the draft is a plain `Sort[]` (contracts), saved as a full array.
import type { Path, Sort, ViewSort } from '@agentic-crm/contracts';

/** "+ Add sort" stops at five sorts (§7). */
export const MAX_SORTS = 5;

export function samePath(a: Path, b: Path): boolean {
  return (
    a.length === b.length &&
    a.every(
      (h, i) =>
        h.attributeDefinitionId === b[i]?.attributeDefinitionId && h.entityDefinitionId === b[i]?.entityDefinitionId,
    )
  );
}

export function pathKey(path: Path): string {
  return path.map((h) => `${h.entityDefinitionId}:${h.attributeDefinitionId}`).join('/');
}

/** Saved view sorts → draft sorts (ids and ranks are server-side). */
export function toSorts(sorts: readonly (Sort | ViewSort)[]): Sort[] {
  return sorts.map((s) => ({
    path: s.path.map((h) => ({
      entityDefinitionId: h.entityDefinitionId,
      attributeDefinitionId: h.attributeDefinitionId,
    })),
    ...(s.field ? { field: s.field } : {}),
    direction: s.direction,
  }));
}

export function sortsKey(sorts: readonly (Sort | ViewSort)[] | undefined): string {
  return JSON.stringify((sorts ?? []).map((s) => [pathKey(s.path), s.field ?? null, s.direction]));
}

export function sameSorts(a: readonly (Sort | ViewSort)[] | undefined, b: readonly (Sort | ViewSort)[] | undefined) {
  return sortsKey(a) === sortsKey(b);
}

/** The direction this column is sorted in, if any sort targets its path. */
export function sortDirectionOf(sorts: readonly Sort[], path: Path): 'asc' | 'desc' | null {
  return sorts.find((s) => samePath(s.path, path))?.direction ?? null;
}

/**
 * Column header "Sort ascending / descending" (C1 §3.2 item 1): flips the direction of an existing sort on the same
 * column, otherwise replaces all sorts with this one.
 */
export function applyColumnSort(
  sorts: readonly Sort[],
  path: Path,
  field: string | undefined,
  direction: 'asc' | 'desc',
): Sort[] {
  if (sorts.some((s) => samePath(s.path, path))) {
    return sorts.map((s) => (samePath(s.path, path) ? { ...s, direction } : s));
  }
  return [{ path, ...(field ? { field } : {}), direction }];
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const [item] = next.splice(from, 1) as [T];
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}
