import { describe, expect, it, vi } from 'vitest';
import { aggregationOptions, aggregationSuffix, formatCount } from './aggregations';
import { firstClipboardCell, toHtmlTable, toTsv } from './clipboard';
import type { SnapshotPage } from './data';
import { snapshotDependencies } from './data';
import { type GridShape, gridAction, type KeyInput } from './keyboard';
import { emptySelection, headerState, isSelected, selectedCount, selectionReducer, sliceZebra } from './selection';
import { SnapshotController, sameRowsExceptEdited } from './snapshot';

const ids = (n: number, prefix = 'r') =>
  Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${prefix.padEnd(4, '0')}${String(i).padStart(8, '0')}`);

function page(snapshotId: string, all: string[], start = 0, size = 1000): SnapshotPage {
  return {
    snapshotId,
    entityDefinitionId: 'def',
    total: all.length,
    ids: all.slice(start, start + size),
    start,
    accurateAt: '2026-10-10T00:00:00.000Z',
  };
}

function controllerWith(chunks: Record<string, string[]>) {
  const fetch = vi.fn(async (snapshotId: string, start: number) => page(snapshotId, chunks[snapshotId] ?? [], start));
  const expired = vi.fn();
  return { controller: new SnapshotController(fetch, expired), fetch, expired };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('SnapshotController', () => {
  it('shows the first snapshot, then loads later chunks for the visible range', async () => {
    const all = ids(1933);
    const { controller, fetch } = controllerWith({ s1: all });
    controller.offer(page('s1', all), 'p');
    expect(controller.current?.total).toBe(1933);
    expect(controller.idAt(999)).toBe(all[999]);
    expect(controller.idAt(1000)).toBeUndefined();
    controller.setVisible(990, 1030);
    await flush();
    expect(fetch).toHaveBeenCalledWith('s1', 1000);
    expect(controller.idAt(1932)).toBe(all[1932]);
  });

  it('applies new params at once and a same-params refresh once its visible chunk is loaded', async () => {
    const a = ids(1500, 'a');
    const b = ids(1500, 'b');
    const { controller } = controllerWith({ s1: a, s2: b, s3: a });
    controller.offer(page('s1', a), 'p1');
    controller.offer(page('s2', b), 'p2');
    expect(controller.current?.snapshotId).toBe('s2');
    controller.setVisible(1200, 1250);
    await flush();
    controller.offer(page('s3', a), 'p2');
    // Still s2 until chunk 1 of s3 is in.
    expect(controller.current?.snapshotId).toBe('s2');
    await flush();
    expect(controller.current?.snapshotId).toBe('s3');
    expect(controller.idAt(1200)).toBe(a[1200]);
  });

  it('freezes on a selection and reports a view change only for other params', () => {
    const a = ids(10, 'a');
    const { controller } = controllerWith({});
    controller.offer(page('s1', a), 'p1');
    controller.setSelectionHold(true);
    controller.offer(page('s2', a), 'p1');
    expect(controller.current?.snapshotId).toBe('s1');
    expect(controller.viewChanged).toBe(false);
    controller.offer(page('s3', ids(3, 'b')), 'p2');
    expect(controller.viewChanged).toBe(true);
    controller.setSelectionHold(false);
    expect(controller.current?.snapshotId).toBe('s3');
    expect(controller.viewChanged).toBe(false);
  });

  it("keeps the author's row order after own edits until resume", () => {
    const a = ids(5, 'a');
    const reordered = [a[3], a[0], a[1], a[2], a[4]] as string[];
    const { controller } = controllerWith({});
    controller.offer(page('s1', a), 'p');
    controller.noteAuthorEdit(a[3] as string);
    controller.offer(page('s2', reordered), 'p');
    expect(controller.current?.snapshotId).toBe('s1');
    controller.resume();
    expect(controller.current?.snapshotId).toBe('s2');
  });

  it('applies a refresh with rows the author did not touch even while frozen', () => {
    const a = ids(5, 'a');
    const { controller } = controllerWith({});
    controller.offer(page('s1', a), 'p');
    controller.noteAuthorEdit(a[0] as string);
    controller.offer(page('s2', [...a, ids(1, 'z')[0] as string]), 'p');
    expect(controller.current?.snapshotId).toBe('s2');
  });

  it('sameRowsExceptEdited tolerates moves of edited rows only', () => {
    const a = ids(4, 'a');
    const x = {
      snapshotId: 'x',
      paramsKey: 'p',
      total: 4,
      accurateAt: '',
      ids: a,
      loaded: new Set([0]),
      loading: new Map(),
      failed: new Set<number>(),
    };
    const y = { ...x, snapshotId: 'y', ids: [a[1], a[0], a[2], a[3]] as string[] };
    expect(sameRowsExceptEdited(x, y, new Set())).toBe(true);
    const z = { ...x, snapshotId: 'z', total: 3, ids: [a[1], a[2], a[3]] as string[] };
    expect(sameRowsExceptEdited(x, z, new Set([a[0] as string]))).toBe(true);
    expect(sameRowsExceptEdited(x, z, new Set())).toBe(false);
  });
});

describe('snapshot params', () => {
  it('depends on filter and sort attributes', () => {
    const p = {
      viewId: 'v',
      filter: {
        and: [
          { path: [{ entityDefinitionId: 'd', attributeDefinitionId: 'a1' }], mode: 'must' as const, constraints: [] },
        ],
      },
      sorts: [{ path: [{ entityDefinitionId: 'd', attributeDefinitionId: 'a2' }], direction: 'asc' as const }],
    };
    expect(snapshotDependencies(p).sort()).toEqual(['a1', 'a2']);
  });
});

describe('selection (zebra)', () => {
  it('toggles, shift-ranges from the anchor, selects all and clears', () => {
    let s = selectionReducer(emptySelection, { type: 'toggle', index: 2 });
    s = selectionReducer(s, { type: 'range', index: 5 });
    expect(s.edges).toEqual([2, 6]);
    s = selectionReducer(s, { type: 'toggle', index: 4 });
    expect(s.edges).toEqual([2, 4, 5, 6]);
    expect(selectedCount(s)).toBe(3);
    expect(isSelected(s, 4)).toBe(false);
    expect(headerState(s, 10)).toBe('some');
    s = selectionReducer(s, { type: 'all', total: 1933 });
    expect(s.edges).toEqual([0, 1933]);
    expect(headerState(s, 1933)).toBe('all');
    expect(selectionReducer(s, { type: 'clear' })).toEqual(emptySelection);
  });
});

describe('sliceZebra', () => {
  it('splits selections into consecutive slices of at most n rows', () => {
    expect(sliceZebra([0, 1205], 500)).toEqual([
      [0, 500],
      [500, 1000],
      [1000, 1205],
    ]);
    expect(sliceZebra([0, 3, 10, 12, 20, 21], 4)).toEqual([
      [0, 3, 10, 11],
      [11, 12, 20, 21],
    ]);
    expect(sliceZebra([], 500)).toEqual([]);
  });
});

describe('keyboard model', () => {
  const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({
    key: k,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...mods,
  });
  const g = (row: number, col: number): GridShape => ({
    active: { row, col },
    rows: 100,
    cols: 5,
    page: 20,
    apple: true,
  });

  it('moves, jumps and wraps', () => {
    expect(gridAction(key('ArrowDown'), g(0, 0))).toEqual({ type: 'move', to: { row: 1, col: 0 } });
    expect(gridAction(key('ArrowLeft'), g(3, -1))).toEqual({ type: 'move', to: { row: 3, col: -1 } });
    expect(gridAction(key('ArrowDown', { metaKey: true }), g(3, 2))).toEqual({ type: 'move', to: { row: 99, col: 2 } });
    expect(gridAction(key('Tab'), g(3, 4))).toEqual({ type: 'move', to: { row: 4, col: -1 } });
    expect(gridAction(key('Tab', { shiftKey: true }), g(3, -1))).toEqual({ type: 'move', to: { row: 2, col: 4 } });
    expect(gridAction(key('PageDown'), g(90, 1))).toEqual({ type: 'move', to: { row: 99, col: 1 } });
    expect(gridAction(key('End'), g(5, 0))).toEqual({ type: 'move', to: { row: 5, col: 4 } });
  });

  it('selects rows and edits', () => {
    expect(gridAction(key('ArrowDown', { shiftKey: true }), g(3, 1))).toEqual({
      type: 'select-rows',
      from: 3,
      to: 4,
      move: { row: 4, col: 1 },
    });
    expect(gridAction(key('ArrowUp', { shiftKey: true, metaKey: true }), g(3, 1))).toMatchObject({ from: 0, to: 3 });
    expect(gridAction(key(' ', { shiftKey: true }), g(3, 1))).toEqual({ type: 'toggle-row', row: 3 });
    expect(gridAction(key('a', { metaKey: true }), g(3, 1))).toEqual({ type: 'select-all' });
    expect(gridAction(key('Enter'), g(3, 1))).toEqual({ type: 'edit' });
    expect(gridAction(key('Enter', { metaKey: true }), g(3, 1))).toEqual({ type: 'open-record' });
    expect(gridAction(key('x'), g(3, 1))).toEqual({ type: 'edit', initialKey: 'x' });
    expect(gridAction(key('c', { metaKey: true }), g(3, 1))).toBeNull();
    expect(gridAction(key('Backspace'), g(3, 1))).toEqual({ type: 'clear-value' });
  });
});

describe('footer calculations', () => {
  it('offers numeric kinds for number/currency/rating, checkbox wording for checkboxes', () => {
    expect(aggregationOptions('currency').map((o) => o.value)).toContain('sum');
    expect(aggregationOptions('text').map((o) => o.value)).not.toContain('sum');
    expect(aggregationOptions('checkbox')[1]?.label).toBe('Count checked');
    expect(aggregationSuffix('number', 'mean')).toBe('avg');
  });

  it('formats the record count compactly from 10,000', () => {
    expect(formatCount(1933, 'en-US')).toBe('1,933');
    expect(formatCount(12000, 'en-US')).toBe('12K');
  });
});

describe('clipboard', () => {
  it('builds TSV and HTML and pastes the first cell', () => {
    const m = [
      ['a', 'b\tc'],
      ['1', '<2>'],
    ];
    expect(toTsv(m)).toBe('a\tb c\n1\t<2>');
    expect(toHtmlTable(m)).toContain('&lt;2&gt;');
    expect(firstClipboardCell('x\ty\nz')).toBe('x');
  });
});
