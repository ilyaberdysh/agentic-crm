import { describe, expect, it } from 'vitest';
import { planSetValues } from '../../../data/mutations';
import { buildHistory } from '../history';
import { attr, OBJ_ID, RECORD_ID, row, WS_ID } from '../test/fixtures';
import { assignRanks, planCommit } from './plan';

let n = 0;
const ctx = {
  recordRef: { workspace: { id: WS_ID }, entityDefinitionId: OBJ_ID, entityInstanceId: RECORD_ID },
  newId: () => `new-${++n}`,
  now: () => new Date('2026-10-10T10:00:00Z'),
};

describe('planCommit — single-value attributes', () => {
  const text = attr('text');
  const current = [row(text, 'Old', { id: 'v1' })];

  it('replaces the value with a new client id', () => {
    const plan = planCommit(text, current, [{ value: 'New' }], ctx);
    expect(plan.changed).toBe(true);
    expect(plan.desired).toEqual([{ id: expect.stringMatching(/^new-/), value: 'New', sortOrder: null }]);
    expect(plan.optimistic[0]).toMatchObject({ value: 'New', activeUntil: null, entityInstanceId: RECORD_ID });
  });

  it('does nothing when the value is unchanged', () => {
    expect(planCommit(text, current, [{ value: 'Old' }], ctx).changed).toBe(false);
  });

  it('clears with an empty set, blank text or a put of null', () => {
    expect(planCommit(text, current, [], ctx)).toMatchObject({ changed: true, desired: [] });
    expect(planCommit(text, current, [{ value: '' }], ctx)).toMatchObject({ changed: true, desired: [] });
    expect(planCommit(text, current, [{ op: 'put', value: null }], ctx)).toMatchObject({ changed: true, desired: [] });
    expect(planCommit(text, current, [{ op: 'retire', id: 'v1' }], ctx)).toMatchObject({ changed: true, desired: [] });
  });

  it('treats rating 0 as clearing and writes checkbox false', () => {
    const rating = attr('rating');
    expect(planCommit(rating, [row(rating, 3, { id: 'r' })], [{ value: 0 }], ctx).desired).toEqual([]);
    const check = attr('checkbox');
    expect(planCommit(check, [row(check, true, { id: 'c' })], [{ value: false }], ctx).desired[0]?.value).toBe(false);
  });

  it('builds read forms for optimistic rows', () => {
    const domain = attr('domain');
    const plan = planCommit(domain, [], [{ value: 'https://www.Example.co.uk/x' }], ctx);
    expect(plan.optimistic[0]?.value).toEqual({ normalizedDomain: 'example.co.uk', rootDomain: 'example.co.uk' });
    const date = attr('date');
    expect(planCommit(date, [], [{ value: '2026-03-01T12:00:00Z' }], ctx).optimistic[0]?.value).toBe('2026-03-01');
  });
});

describe('planCommit — multi-value attributes', () => {
  const tags = attr('select', { isMultiselect: true });
  const a = row(tags, { selectOptionId: 'A' }, { id: 'va', sortOrder: 'h' });
  const b = row(tags, { selectOptionId: 'B' }, { id: 'vb', sortOrder: 'p' });

  it('adds with a rank after the last value and never duplicates', () => {
    const plan = planCommit(tags, [a, b], [{ op: 'put', value: { selectOptionId: 'C' } }], ctx);
    expect(plan.desired.map((d) => d.id)).toEqual(['va', 'vb', expect.stringMatching(/^new-/)]);
    expect((plan.desired[2]?.sortOrder ?? '') > 'p').toBe(true);
    expect(planCommit(tags, [a, b], [{ op: 'put', value: { selectOptionId: 'A' } }], ctx).changed).toBe(false);
  });

  it('removes and reorders', () => {
    expect(planCommit(tags, [a, b], [{ op: 'retire', id: 'va' }], ctx).desired.map((d) => d.id)).toEqual(['vb']);
    const moved = planCommit(tags, [a, b], [{ op: 'reorder', id: 'vb', sortOrder: 'c' }], ctx);
    expect(moved.desired.map((d) => d.id)).toEqual(['vb', 'va']);
    expect(moved.changed).toBe(true);
  });

  it('diffs a full set by identity: keeps matches, adds new, drops missing, ranks in order', () => {
    const plan = planCommit(
      tags,
      [a, b],
      [{ value: { selectOptionId: 'C' } }, { value: { selectOptionId: 'A' } }],
      ctx,
    );
    expect(plan.desired.map((d) => d.id)).toEqual([expect.stringMatching(/^new-/), 'va']);
    const ranks = plan.desired.map((d) => d.sortOrder ?? '');
    expect((ranks[0] ?? '') < (ranks[1] ?? '')).toBe(true);
    expect(plan.optimistic.map((r) => r.id)).toEqual(plan.desired.map((d) => d.id));
  });

  it('assigns ascending ranks while keeping valid existing ones', () => {
    expect(assignRanks([{ sortOrder: 'h' }, { sortOrder: null }, { sortOrder: 'p' }])).toEqual([
      'h',
      expect.any(String),
      'p',
    ]);
    const r = assignRanks([{ sortOrder: 'p' }, { sortOrder: 'h' }]);
    expect((r[0] ?? '') < (r[1] ?? '')).toBe(true);
    const fresh = assignRanks([{ sortOrder: null }, { sortOrder: null }, { sortOrder: null }]);
    expect([...fresh].sort()).toEqual(fresh);
  });
});

describe('planSetValues — the server calls of a values.set write', () => {
  const current = [
    { id: 'va', sortOrder: 'h' },
    { id: 'vb', sortOrder: 'p' },
  ];

  it('multi: retires known values that are gone, puts new ones, reorders moved ones', () => {
    const ops = planSetValues(current, {
      isMultiselect: true,
      known: ['va', 'vb'],
      desired: [
        { id: 'vb', value: null, sortOrder: 'c' },
        { id: 'vc', value: { selectOptionId: 'C' }, sortOrder: 't' },
      ],
    });
    expect(ops).toEqual([
      { op: 'retire', id: 'va' },
      { op: 'reorder', id: 'vb', sortOrder: 'c' },
      { op: 'put', id: 'vc', value: { selectOptionId: 'C' }, sortOrder: 't' },
    ]);
  });

  it('keeps values someone else added meanwhile (not in `known`)', () => {
    const ops = planSetValues([...current, { id: 'vx', sortOrder: 'z' }], {
      isMultiselect: true,
      known: ['va', 'vb'],
      desired: [{ id: 'va', value: null, sortOrder: 'h' }],
    });
    expect(ops).toEqual([{ op: 'retire', id: 'vb' }]);
  });

  it('single: a put replaces (no separate retire); an empty set retires', () => {
    expect(
      planSetValues([{ id: 'v1', sortOrder: null }], {
        isMultiselect: false,
        known: ['v1'],
        desired: [{ id: 'v2', value: 'New', sortOrder: null }],
      }),
    ).toEqual([{ op: 'put', id: 'v2', value: 'New', sortOrder: null }]);
    expect(
      planSetValues([{ id: 'v1', sortOrder: null }], { isMultiselect: false, known: ['v1'], desired: [] }),
    ).toEqual([{ op: 'retire', id: 'v1' }]);
    expect(
      planSetValues([{ id: 'v1', sortOrder: null }], {
        isMultiselect: false,
        known: ['v1'],
        desired: [{ id: 'v1', value: 'Same', sortOrder: null }],
      }),
    ).toEqual([]);
  });
});

describe('buildHistory', () => {
  const text = attr('text');
  it('lists updates newest first with resulting values; a lone retire is "Cleared"', () => {
    const rows = [
      row(text, 'v3', { id: 'c', activeFrom: '2026-10-09T14:06:00Z', activeUntil: '2026-10-09T15:00:00Z' }),
      row(text, 'v2', { id: 'b', activeFrom: '2026-10-09T14:05:00Z', activeUntil: '2026-10-09T14:06:00Z' }),
      row(text, 'v1', { id: 'a', activeFrom: '2026-10-09T13:32:00Z', activeUntil: '2026-10-09T14:05:00Z' }),
    ];
    const events = buildHistory(text, rows);
    expect(events.map((e) => e.kind)).toEqual(['cleared', 'updated', 'updated', 'updated']);
    expect(events[0]?.isLatest).toBe(true);
    expect(events[1]?.resulting.map((r) => r.value)).toEqual(['v3']);
    expect(events[3]?.value?.value).toBe('v1');
  });

  it('multi-value: added / removed events', () => {
    const tags = attr('select', { isMultiselect: true });
    const rows = [
      row(tags, { selectOptionId: 'B' }, { id: 'b', activeFrom: '2026-10-09T14:00:00Z' }),
      row(
        tags,
        { selectOptionId: 'A' },
        { id: 'a', activeFrom: '2026-10-09T13:00:00Z', activeUntil: '2026-10-09T15:00:00Z' },
      ),
    ];
    const events = buildHistory(tags, rows);
    expect(events.map((e) => e.kind)).toEqual(['removed', 'added', 'added']);
    expect(events[1]?.resulting.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });
});
