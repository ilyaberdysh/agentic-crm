import type { ViewColumn } from '@agentic-crm/contracts';
import { describe, expect, it, vi } from 'vitest';
import { applyColumnOps, patchColumnFormat, rankForMove, rankForPosition, readColumnFormat } from './columns';
import { ViewDraftStore } from './draftStore';
import { addCondition, emptyFilterModel, newCondition } from './filterModel';
import { applyColumnSort, MAX_SORTS, moveItem, sameSorts, sortDirectionOf, toSorts } from './sortModel';
import { a, p } from './testFixtures';

const VIEW = 'view-1';

describe('ViewDraftStore (C1 README §3.1: drafts survive navigation, not "discard")', () => {
  it('keeps filter and sort drafts per view until discarded, notifying subscribers', () => {
    const store = new ViewDraftStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(VIEW, listener);
    const model = addCondition(emptyFilterModel(), newCondition(p(a.code), 'value', 'contains'));
    store.setFilterModel(VIEW, model, null);
    store.setSorts(VIEW, [{ path: p(a.budget), field: 'raw_value', direction: 'desc' }]);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.get(VIEW).filter).toEqual({ kind: 'model', model, ast: null });
    expect(store.draftedViewIds()).toEqual([VIEW]);
    // another view is untouched
    expect(store.get('view-2')).toEqual({ columnOps: [] });

    // the state object is stable between reads (useSyncExternalStore requirement)
    expect(store.get(VIEW)).toBe(store.get(VIEW));

    store.discard(VIEW);
    expect(store.get(VIEW).filter).toBeUndefined();
    expect(store.get(VIEW).sorts).toBeUndefined();
    expect(store.draftedViewIds()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    store.setSorts(VIEW, []);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('discard keeps in-flight column operations', () => {
    const store = new ViewDraftStore();
    store.setSorts(VIEW, []);
    store.addColumnOp(VIEW, { id: 'op1', kind: 'remove', columnId: 'c1' });
    store.discard(VIEW);
    expect(store.get(VIEW).columnOps).toHaveLength(1);
    store.removeColumnOp(VIEW, 'op1');
    expect(store.get(VIEW)).toEqual({ columnOps: [] });
  });

  it('clearSaved drops only what was saved; a newer edit stays a draft; restore puts drafts back', () => {
    const store = new ViewDraftStore();
    store.setFilterAst(VIEW, null);
    store.setSorts(VIEW, []);
    const saved = { filter: store.get(VIEW).filter, sorts: store.get(VIEW).sorts };
    store.setSorts(VIEW, [{ path: p(a.code), direction: 'asc' }]); // edited while saving
    store.clearSaved(VIEW, saved);
    expect(store.get(VIEW).filter).toBeUndefined();
    expect(store.get(VIEW).sorts).toHaveLength(1);
    store.restore(VIEW, saved);
    expect(store.get(VIEW).filter).toEqual({ kind: 'ast', ast: null });
    expect(store.get(VIEW).sorts).toHaveLength(1); // a newer draft wins over the restored one
  });
});

describe('sorts', () => {
  it('header sort replaces all sorts, or flips an existing sort on the same column', () => {
    const sorts = [
      { path: p(a.budget), field: 'raw_value', direction: 'desc' as const },
      { path: p(a.phase), field: 'stage_sort_order', direction: 'asc' as const },
    ];
    expect(applyColumnSort(sorts, p(a.phase), 'stage_sort_order', 'desc')).toEqual([
      sorts[0],
      { ...sorts[1], direction: 'desc' },
    ]);
    expect(applyColumnSort(sorts, p(a.code), 'value', 'asc')).toEqual([
      { path: p(a.code), field: 'value', direction: 'asc' },
    ]);
    expect(sortDirectionOf(sorts, p(a.budget))).toBe('desc');
    expect(sortDirectionOf(sorts, p(a.code))).toBeNull();
    expect(MAX_SORTS).toBe(5);
  });

  it('compares saved view sorts and drafts by path, field and direction only', () => {
    const saved = [{ id: 'x', sortOrder: 'h', path: p(a.budget), field: 'raw_value', direction: 'desc' as const }];
    expect(sameSorts(saved, toSorts(saved))).toBe(true);
    expect(sameSorts(saved, [])).toBe(false);
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });
});

function col(id: string, sortOrder: string, extra: Partial<ViewColumn> = {}): ViewColumn {
  return {
    id,
    sortOrder,
    path: p(a.code),
    field: null,
    title: null,
    tableColumnWidth: null,
    tableColumnAggregationType: null,
    displayConfiguration: {},
    ...extra,
  };
}

describe('columns (saved immediately; optimistic ops on top of the server view)', () => {
  const columns = [col('c', 'm'), col('a', 'c'), col('b', 'h')];

  it('applies pending add / update / remove in order and sorts by rank', () => {
    const out = applyColumnOps(columns, [
      { id: '1', kind: 'add', column: col('d', 'z') },
      { id: '2', kind: 'update', columnId: 'a', patch: { title: 'Renamed', sortOrder: 'x' } },
      { id: '3', kind: 'remove', columnId: 'b' },
    ]);
    expect(out.map((c) => c.id)).toEqual(['c', 'a', 'd']);
    expect(out[1]?.title).toBe('Renamed');
  });

  it('computes ranks for inserts and moves between neighbours', () => {
    const end = rankForPosition(columns) as string;
    expect(end > 'm').toBe(true);
    const left = rankForPosition(columns, { leftOf: 'b' }) as string;
    expect(left > 'c' && left < 'h').toBe(true);
    const right = rankForPosition(columns, { rightOf: 'b' }) as string;
    expect(right > 'h' && right < 'm').toBe(true);
    const first = rankForMove(columns, 'c', { index: 0 }) as string;
    expect(first < 'c').toBe(true);
    const afterA = rankForMove(columns, 'c', { after: 'a' }) as string;
    expect(afterA > 'c' && afterA < 'h').toBe(true);
    expect(rankForMove(columns, 'a', { index: 0 })).toBeUndefined(); // already first
  });

  it('reads and patches formatting overrides, ignoring bad values', () => {
    const cfg = patchColumnFormat({ other: 1 }, 'currency', { displayType: 'code' });
    expect(cfg).toEqual({ other: 1, currency: { displayType: 'code' } });
    expect(readColumnFormat(cfg).currency).toEqual({ displayType: 'code', groups: null, decimalPlaces: null });
    expect(readColumnFormat({ datetime: { displayType: 'weird' }, number: { decimalPlaces: 7 } })).toEqual({
      number: { groups: null, decimalPlaces: null },
    });
  });
});
