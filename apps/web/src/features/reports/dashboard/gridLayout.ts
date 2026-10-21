// Dashboard grid layout operations: cells in rank order are packed into rows of 12 columns (min 4,
// the last cell of a row stretches); a drop beside a cell re-splits that row evenly, a drop between rows makes a new
// full-width row, a resize moves whole columns between two neighbours. Pure functions over `{id, sortOrder, width}`;
// the result is the full layout the `setLayout` mutation (`cells/shuffle`) takes.
import {
  clampCellWidth,
  DASHBOARD_COLUMNS,
  evenRowWidths,
  MIN_CELL_WIDTH,
  packDashboardRows,
  rankBetween,
} from '@agentic-crm/contracts';

/** A rank between two cells' ranks (jittered, so two tabs reordering at once rarely collide). */
export function rankForCell(before: string | null, after: string | null): string {
  try {
    return rankBetween(before, after, { jitter: true });
  } catch {
    return rankBetween(null, null, { jitter: true });
  }
}

export interface GridCell {
  id: string;
  sortOrder: string;
  width: number;
}

export interface LayoutEntry {
  cellId: string;
  sortOrder: string;
  width: number;
}

export type DropTarget =
  /** Beside a cell ("inter-report"): a 3 px bar on that side of the cell. */
  | { kind: 'beside'; cellId: string; side: 'before' | 'after' }
  /** Between rows ("inter-row"): `index` = the row the new row goes before (rows.length = at the end). */
  | { kind: 'row'; index: number };

const byRank = (a: GridCell, b: GridCell) =>
  a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : a.id < b.id ? -1 : 1;

export interface PackedRow {
  cells: { cell: GridCell; renderWidth: number }[];
}

/** Rows of the dashboard with the width each cell renders at. */
export function rowsOf<T extends GridCell>(
  cells: readonly T[],
  singleColumn = false,
): { cell: T; renderWidth: number }[][] {
  const sorted = [...cells].sort(byRank);
  if (singleColumn) return sorted.map((cell) => [{ cell, renderWidth: DASHBOARD_COLUMNS }]);
  return packDashboardRows(sorted);
}

/** The most cells a row can hold. */
export const MAX_CELLS_PER_ROW = Math.floor(DASHBOARD_COLUMNS / MIN_CELL_WIDTH);

interface Working {
  id: string;
  width: number;
}

function sumTo12(row: Working[]): Working[] {
  if (row.length === 0) return row;
  const total = row.reduce((s, c) => s + c.width, 0);
  const last = row[row.length - 1] as Working;
  return [...row.slice(0, -1), { ...last, width: last.width + DASHBOARD_COLUMNS - total }];
}

/** Spreads `freed` columns over the remaining cells of a row (the dragged cell left it). */
function absorb(row: Working[], freed: number): Working[] {
  const n = row.length;
  const each = Math.floor(freed / n);
  let rest = freed - each * n;
  return row.map((c) => {
    const extra = each + (rest > 0 ? 1 : 0);
    if (rest > 0) rest -= 1;
    return { ...c, width: clampCellWidth(c.width + extra) };
  });
}

/** Whether `movedId` may be dropped on `target` (the row cannot take another cell, or the drop changes nothing). */
export function canDrop(cells: readonly GridCell[], movedId: string, target: DropTarget): boolean {
  return moveCell(cells, movedId, target) !== null;
}

/**
 * The layout after dropping `movedId` on `target`, or null when the drop is not allowed or changes nothing. Only the
 * dragged cell gets a new rank; widths change for the rows involved.
 */
export function moveCell(cells: readonly GridCell[], movedId: string, target: DropTarget): LayoutEntry[] | null {
  const byId = new Map(cells.map((c) => [c.id, c]));
  const moved = byId.get(movedId);
  if (!moved) return null;
  const rows: Working[][] = rowsOf(cells).map((row) => row.map((x) => ({ id: x.cell.id, width: x.renderWidth })));
  const srcIndex = rows.findIndex((r) => r.some((c) => c.id === movedId));
  const original = rows.map((r) => r.map((c) => c.id).join(','));

  let next: Working[][];
  if (target.kind === 'beside') {
    if (target.cellId === movedId) return null;
    const tgtIndex = rows.findIndex((r) => r.some((c) => c.id === target.cellId));
    if (tgtIndex < 0) return null;
    if (tgtIndex === srcIndex) {
      // Same row: only the order changes; every cell keeps its width.
      const full = rows[srcIndex] as Working[];
      const movedWidth = full.find((c) => c.id === movedId)?.width as number;
      const row = full.filter((c) => c.id !== movedId);
      const at = row.findIndex((c) => c.id === target.cellId) + (target.side === 'after' ? 1 : 0);
      const order = [...row.slice(0, at), { id: movedId, width: movedWidth }, ...row.slice(at)];
      next = rows.map((r, i) => (i === srcIndex ? order : r));
    } else {
      const targetRow = rows[tgtIndex] as Working[];
      // The row cannot take another cell ((n + 1) × 4 > 12).
      if ((targetRow.length + 1) * MIN_CELL_WIDTH > DASHBOARD_COLUMNS) return null;
      const srcRow = (rows[srcIndex] as Working[]).filter((c) => c.id !== movedId);
      const freed = (rows[srcIndex] as Working[]).find((c) => c.id === movedId)?.width ?? 0;
      const at = targetRow.findIndex((c) => c.id === target.cellId) + (target.side === 'after' ? 1 : 0);
      const ids = [...targetRow.slice(0, at).map((c) => c.id), movedId, ...targetRow.slice(at).map((c) => c.id)];
      const widths = evenRowWidths(ids.length);
      const grown = ids.map((id, k) => ({ id, width: widths[k] as number }));
      next = rows.flatMap((r, i): Working[][] => {
        if (i === tgtIndex) return [grown];
        if (i === srcIndex) return srcRow.length > 0 ? [sumTo12(absorb(srcRow, freed))] : [];
        return [r];
      });
    }
  } else {
    const srcRow = (rows[srcIndex] as Working[]).filter((c) => c.id !== movedId);
    const freed = (rows[srcIndex] as Working[]).find((c) => c.id === movedId)?.width ?? 0;
    // Dropping a lone cell next to its own row changes nothing.
    if (srcRow.length === 0 && (target.index === srcIndex || target.index === srcIndex + 1)) return null;
    const out: Working[][] = [];
    rows.forEach((r, i) => {
      if (i === target.index) out.push([{ id: movedId, width: DASHBOARD_COLUMNS }]);
      if (i === srcIndex) {
        if (srcRow.length > 0) out.push(sumTo12(absorb(srcRow, freed)));
      } else out.push(r);
    });
    if (target.index >= rows.length) out.push([{ id: movedId, width: DASHBOARD_COLUMNS }]);
    next = out;
  }

  const flat = next.flat();
  const unchanged =
    next.map((r) => r.map((c) => c.id).join(',')).join('|') === original.join('|') &&
    next.every((r, i) => r.every((c, k) => c.width === (rows[i]?.[k]?.width ?? -1)));
  if (unchanged) return null;

  // Rank: only the dragged cell moves, between its new neighbours.
  const at = flat.findIndex((c) => c.id === movedId);
  const prev = at > 0 ? byId.get((flat[at - 1] as Working).id) : undefined;
  const after = at < flat.length - 1 ? byId.get((flat[at + 1] as Working).id) : undefined;
  const rank = rankForCell(prev?.sortOrder ?? null, after?.sortOrder ?? null);

  // Rows that did not change keep their stored widths; the others get the computed ones.
  const widthOf = new Map<string, number>();
  const originalRows = rowsOf(cells);
  next.forEach((r) => {
    const sameRow = originalRows.find((o) => o.map((x) => x.cell.id).join(',') === r.map((c) => c.id).join(','));
    for (const c of r) {
      const old = sameRow?.find((x) => x.cell.id === c.id);
      widthOf.set(c.id, sameRow && old && old.renderWidth === c.width ? old.cell.width : c.width);
    }
  });
  return flat.map((c) => ({
    cellId: c.id,
    sortOrder: c.id === movedId ? rank : (byId.get(c.id) as GridCell).sortOrder,
    width: widthOf.get(c.id) as number,
  }));
}

/**
 * Resize: the boundary on the left of `cellId` moves by `deltaColumns` (positive = right), taking columns from one
 * neighbour and giving them to the other, never below 4. Null when nothing changes (or the cell is first in its row).
 */
export function resizeCell(cells: readonly GridCell[], cellId: string, deltaColumns: number): LayoutEntry[] | null {
  const rows = rowsOf(cells);
  const row = rows.find((r) => r.some((x) => x.cell.id === cellId));
  if (!row) return null;
  const i = row.findIndex((x) => x.cell.id === cellId);
  if (i <= 0) return null;
  const left = row[i - 1] as { cell: GridCell; renderWidth: number };
  const right = row[i] as { cell: GridCell; renderWidth: number };
  const total = left.renderWidth + right.renderWidth;
  const newLeft = Math.min(
    total - MIN_CELL_WIDTH,
    Math.max(MIN_CELL_WIDTH, left.renderWidth + Math.round(deltaColumns)),
  );
  if (newLeft === left.renderWidth) return null;
  const widths = new Map<string, number>();
  for (const x of row) widths.set(x.cell.id, x.renderWidth);
  widths.set(left.cell.id, newLeft);
  widths.set(right.cell.id, total - newLeft);
  return [...cells]
    .sort(byRank)
    .map((c) => ({ cellId: c.id, sortOrder: c.sortOrder, width: widths.get(c.id) ?? c.width }));
}

/** Entries that differ from the cells they were computed from. */
export function changedEntries(cells: readonly GridCell[], layout: LayoutEntry[]): LayoutEntry[] {
  const byId = new Map(cells.map((c) => [c.id, c]));
  return layout.filter((l) => {
    const c = byId.get(l.cellId);
    return !c || c.sortOrder !== l.sortOrder || c.width !== l.width;
  });
}
