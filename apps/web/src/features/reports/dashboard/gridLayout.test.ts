import { describe, expect, it } from 'vitest';
import { canDrop, changedEntries, type GridCell, moveCell, resizeCell, rowsOf } from './gridLayout';

const cell = (id: string, sortOrder: string, width: number): GridCell => ({ id, sortOrder, width });

/** Rows as "id:width" strings after applying a layout. */
function rowsAfter(cells: GridCell[], layout: { cellId: string; sortOrder: string; width: number }[] | null) {
  const byId = new Map(layout?.map((l) => [l.cellId, l]) ?? []);
  const next = cells.map((c) => ({
    ...c,
    ...(byId.get(c.id)
      ? { sortOrder: byId.get(c.id)?.sortOrder as string, width: byId.get(c.id)?.width as number }
      : {}),
  }));
  return rowsOf(next).map((r) => r.map((x) => `${x.cell.id}:${x.renderWidth}`).join(' '));
}

describe('rowsOf', () => {
  it('packs greedily and stretches the last cell of every row', () => {
    const cells = [cell('a', '1', 4), cell('b', '2', 4), cell('c', '3', 9), cell('d', '4', 4)];
    expect(rowsAfter(cells, null)).toEqual(['a:4 b:8', 'c:12', 'd:12']);
  });
  it('renders one column when narrow', () => {
    const cells = [cell('a', '1', 4), cell('b', '2', 4)];
    expect(rowsOf(cells, true).map((r) => r[0]?.renderWidth)).toEqual([12, 12]);
  });
});

describe('moveCell', () => {
  const three = [cell('a', '1', 12), cell('b', '2', 12), cell('c', '3', 12)];

  it('drops beside a cell of another row and re-splits that row evenly', () => {
    const layout = moveCell(three, 'c', { kind: 'beside', cellId: 'a', side: 'after' });
    expect(rowsAfter(three, layout)).toEqual(['a:6 c:6', 'b:12']);
  });

  it('puts a third cell into a row with two', () => {
    const cells = [cell('a', '1', 6), cell('b', '2', 6), cell('c', '3', 12)];
    const layout = moveCell(cells, 'c', { kind: 'beside', cellId: 'a', side: 'before' });
    expect(rowsAfter(cells, layout)).toEqual(['c:4 a:4 b:4']);
  });

  it('refuses a row that cannot take another cell and a no-op', () => {
    const cells = [cell('a', '1', 4), cell('b', '2', 4), cell('c', '3', 4), cell('d', '4', 12)];
    expect(canDrop(cells, 'd', { kind: 'beside', cellId: 'a', side: 'after' })).toBe(false);
    expect(canDrop(three, 'b', { kind: 'beside', cellId: 'a', side: 'after' })).toBe(true);
    expect(canDrop(three, 'b', { kind: 'row', index: 1 })).toBe(false);
    expect(canDrop(three, 'b', { kind: 'row', index: 2 })).toBe(false);
    expect(canDrop(three, 'b', { kind: 'beside', cellId: 'b', side: 'after' })).toBe(false);
  });

  it('spreads the freed width over the source row', () => {
    const cells = [cell('a', '1', 4), cell('b', '2', 4), cell('c', '3', 4), cell('d', '4', 12)];
    const layout = moveCell(cells, 'a', { kind: 'beside', cellId: 'd', side: 'after' });
    expect(rowsAfter(cells, layout)).toEqual(['b:6 c:6', 'd:6 a:6']);
  });

  it('reorders inside a row without changing widths', () => {
    const cells = [cell('a', '1', 4), cell('b', '2', 8)];
    const layout = moveCell(cells, 'a', { kind: 'beside', cellId: 'b', side: 'after' });
    expect(rowsAfter(cells, layout)).toEqual(['b:8 a:4']);
  });

  it('creates a new full-width row between rows', () => {
    const cells = [cell('a', '1', 6), cell('b', '2', 6), cell('c', '3', 12)];
    const layout = moveCell(cells, 'b', { kind: 'row', index: 1 });
    expect(rowsAfter(cells, layout)).toEqual(['a:12', 'b:12', 'c:12']);
    const end = moveCell(cells, 'a', { kind: 'row', index: 2 });
    expect(rowsAfter(cells, end)).toEqual(['b:12', 'c:12', 'a:12']);
  });

  it('only gives the dragged cell a new rank, between its new neighbours', () => {
    const layout = moveCell(three, 'c', { kind: 'row', index: 0 }) ?? [];
    const rank = (id: string) => layout.find((l) => l.cellId === id)?.sortOrder as string;
    expect(rank('a')).toBe('1');
    expect(rank('b')).toBe('2');
    expect(rank('c') < '1').toBe(true);
  });
});

describe('resizeCell', () => {
  const cells = [cell('a', '1', 6), cell('b', '2', 6)];
  it('moves columns across the boundary', () => {
    expect(rowsAfter(cells, resizeCell(cells, 'b', -2))).toEqual(['a:4 b:8']);
    expect(rowsAfter(cells, resizeCell(cells, 'b', 1))).toEqual(['a:7 b:5']);
  });
  it('never goes below 4 columns and ignores the first cell', () => {
    expect(rowsAfter(cells, resizeCell(cells, 'b', -5))).toEqual(['a:4 b:8']);
    expect(rowsAfter(cells, resizeCell(cells, 'b', 9))).toEqual(['a:8 b:4']);
    expect(resizeCell(cells, 'a', 2)).toBeNull();
    expect(resizeCell([cell('a', '1', 4), cell('b', '2', 8)], 'b', -3)).toBeNull();
  });
  it('uses the stretched width of a last cell', () => {
    const stretched = [cell('a', '1', 4), cell('b', '2', 4)];
    expect(rowsAfter(stretched, resizeCell(stretched, 'b', 2))).toEqual(['a:6 b:6']);
  });
});

describe('changedEntries', () => {
  it('lists the entries that differ', () => {
    const cells = [cell('a', '1', 6), cell('b', '2', 6)];
    expect(changedEntries(cells, resizeCell(cells, 'b', -1) ?? []).map((e) => e.cellId)).toEqual(['a', 'b']);
  });
});
