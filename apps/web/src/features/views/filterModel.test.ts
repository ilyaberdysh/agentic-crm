import type { Predicate, PredicateLeaf } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  addCondition,
  buildFilter,
  canonicalFilter,
  countConditions,
  emptyFilterModel,
  type FilterModel,
  filterKey,
  firstIncomplete,
  hasDynamicValues,
  isPillLayout,
  moveToAdvanced,
  newCondition,
  parseFilter,
  pillLayout,
  removeNode,
  sameFilter,
  setGroupMode,
  updateCondition,
  wrapInGroup,
} from './filterModel';
import { matchLeaf, type OperatorId, operatorsFor, valueKindFor } from './operators';
import { daysDuration, presetDuration } from './relativeDates';
import { a, companyName, p, resolve } from './testFixtures';

function cond(path = p(a.budget), field: string | null, operator: OperatorId, value?: unknown) {
  return { ...newCondition(path, field, operator), value };
}

/** The single leaf a one-condition model builds. */
function leafOf(path: ReturnType<typeof p>, field: string | null, operator: OperatorId, value?: unknown): Predicate {
  const ast = buildFilter(addCondition(emptyFilterModel(), cond(path, field, operator, value)), resolve);
  expect(ast).not.toBeNull();
  return (ast as { and: Predicate[] }).and[0] as Predicate;
}

describe('building the AST from the sentence table (C1 filters-sorts-calcs §3, §6)', () => {
  it('builds a root AND of complete conditions and skips incomplete drafts', () => {
    let model = emptyFilterModel();
    model = addCondition(model, cond(p(a.budget), 'raw_value', 'greater-than', 50000));
    model = addCondition(model, newCondition(p(a.phase), 'pipeline_stage_id')); // no operator yet
    model = addCondition(model, cond(p(a.headcount), 'value', 'less-than')); // operator, no value
    expect(buildFilter(model, resolve)).toEqual({
      and: [
        {
          path: p(a.budget),
          mode: 'must',
          constraints: [{ field: 'raw_value', operator: 'gt', value: 50000, valueType: 'static' }],
        },
      ],
    });
    expect(firstIncomplete(model, resolve)?.path).toEqual(p(a.phase));
  });

  it('returns null when nothing is complete', () => {
    const model = addCondition(emptyFilterModel(), newCondition(p(a.code), 'value'));
    expect(buildFilter(model, resolve)).toBeNull();
  });

  it('encodes text, presence, checkbox and rating sentences', () => {
    expect(leafOf(p(a.code), 'value', 'not-contains', 'SEED')).toEqual({
      path: p(a.code),
      mode: 'must-not',
      constraints: [{ field: 'value', operator: 'contains', value: 'SEED', valueType: 'static' }],
    });
    expect(leafOf(p(a.code), 'value', 'empty')).toEqual({ path: p(a.code), mode: 'must-not', constraints: [] });
    expect(leafOf(p(a.code), 'value', 'not-empty')).toEqual({ path: p(a.code), mode: 'must', constraints: [] });
    expect(leafOf(p(a.strategic), 'value', 'false')).toEqual({
      path: p(a.strategic),
      mode: 'must-not',
      constraints: [{ field: 'value', operator: 'eq', value: true, valueType: 'static' }],
    });
    // Rating 0 counts as empty (acceptance 4).
    expect(leafOf(p(a.health), 'value', 'empty')).toEqual({
      path: p(a.health),
      mode: 'must-not',
      constraints: [{ field: 'value', operator: 'gt', value: 0, valueType: 'static' }],
    });
    expect(leafOf(p(a.health), 'value', 'not-empty')).toEqual({
      path: p(a.health),
      mode: 'must',
      constraints: [{ field: 'value', operator: 'gte', value: 1, valueType: 'static' }],
    });
  });

  it('serialises relative dates and current-member as dynamic values', () => {
    const before = cond(p(a.startDate), 'value', 'less-than', { kind: 'relative', duration: daysDuration(30, 'ago') });
    const owner = cond(p(a.owner), 'referenced_actor_id', 'contains', { kind: 'current-member' });
    const ast = buildFilter(addCondition(addCondition(emptyFilterModel(), before), owner), resolve) as {
      and: Predicate[];
    };
    expect(ast.and[0]).toEqual({
      path: p(a.startDate),
      mode: 'must',
      constraints: [{ field: 'value', operator: 'lt', value: '-P30D', valueType: 'dynamic' }],
    });
    expect(ast.and[1]).toEqual({
      path: p(a.owner),
      mode: 'must',
      constraints: [{ field: 'referenced_actor_id', operator: 'eq', value: 'current-member', valueType: 'dynamic' }],
    });
    expect(hasDynamicValues(ast)).toBe(true);
  });

  it('exact days on timestamps are static dates (the server compares by local day)', () => {
    expect(leafOf(p(a.kickoff), 'value', 'equals', { kind: 'exact', date: '2026-03-01' })).toEqual({
      path: p(a.kickoff),
      mode: 'must',
      constraints: [{ field: 'value', operator: 'eq', value: '2026-03-01', valueType: 'static' }],
    });
  });

  it('keeps the sub-field of location presence conditions', () => {
    expect(leafOf(p(a.office), 'country_code', 'empty')).toEqual({
      path: p(a.office),
      mode: 'must',
      constraints: [{ field: 'country_code', operator: 'empty' }],
    });
  });

  it('builds status "was" as a history leaf, with an optional entered-before date', () => {
    const value = { stageId: 'stage-build', date: { kind: 'relative', duration: presetDuration('one-week-ago') } };
    expect(leafOf(p(a.phase), 'pipeline_stage_id', 'was', value)).toEqual({
      path: p(a.phase),
      mode: 'must',
      history: true,
      constraints: [
        { field: 'pipeline_stage_id', operator: 'eq', value: 'stage-build', valueType: 'static' },
        { field: 'active_from', operator: 'lt', value: '-P7D', valueType: 'dynamic' },
      ],
    });
    expect(leafOf(p(a.phase), 'pipeline_stage_id', 'was-not', { stageId: 's', date: null })).toEqual({
      path: p(a.phase),
      mode: 'must-not',
      history: true,
      constraints: [{ field: 'pipeline_stage_id', operator: 'eq', value: 's', valueType: 'static' }],
    });
  });

  it('encodes path filters with the full path', () => {
    expect(leafOf(p(a.client, companyName), 'value', 'contains', 'Acme')).toMatchObject({
      path: p(a.client, companyName),
    });
  });
});

describe('parsing the AST back (round trips)', () => {
  const cases: [string, OperatorId, unknown, ReturnType<typeof p>][] = [
    ['value', 'contains', 'SEED', p(a.code)],
    ['value', 'not-equals', 'SEED-001', p(a.code)],
    ['value', 'starts-with', 'SE', p(a.code)],
    ['raw_value', 'greater-than', 50000, p(a.budget)],
    ['raw_value', 'empty', undefined, p(a.budget)],
    ['value', 'true', undefined, p(a.strategic)],
    ['value', 'false', undefined, p(a.strategic)],
    ['value', 'equals', { kind: 'exact', date: '2026-03-01' }, p(a.startDate)],
    ['value', 'greater-than', { kind: 'relative', duration: presetDuration('one-month-from-now') }, p(a.startDate)],
    ['value', 'equals', { kind: 'exact', date: '2026-03-01' }, p(a.kickoff)],
    ['value', 'less-than', { kind: 'exact', date: '2026-03-01' }, p(a.kickoff)],
    ['value', 'equals', 4, p(a.health)],
    ['value', 'empty', undefined, p(a.health)],
    ['value', 'not-empty', undefined, p(a.health)],
    ['pipeline_stage_id', 'contains', 'stage-build', p(a.phase)],
    ['pipeline_stage_id', 'was', { stageId: 's', date: null }, p(a.phase)],
    [
      'pipeline_stage_id',
      'was-not',
      { stageId: 's', date: { kind: 'exact', date: '2026-01-02' }, dateOperator: 'lt' },
      p(a.phase),
    ],
    ['lifecycle_phase', 'equals', 'WON', p(a.phase)],
    ['select_option_id', 'not-contains', 'opt-1', p(a.priority)],
    ['select_option_id', 'contains', 'opt-ai', p(a.tags)],
    ['target_entity_instance_id', 'contains', { entityInstanceId: 'rec-1' }, p(a.client)],
    ['referenced_actor_id', 'contains', { kind: 'member', id: 'mem-1' }, p(a.owner)],
    ['referenced_actor_id', 'not-contains', { kind: 'current-member' }, p(a.owner)],
    ['referenced_actor_type', 'is-type', 'workflow', p(a.owner)],
    ['locality', 'ends-with', 'don', p(a.office)],
    ['region', 'not-empty', undefined, p(a.office)],
    ['country_code', 'equals', 'GB', p(a.office)],
    ['country_code', 'empty', undefined, p(a.office)],
    ['normalized_domain', 'contains', 'acme', p(a.website)],
    ['email_domain', 'equals', 'acme.com', p(a.email)],
    ['country_code', 'not-equals', 'DE', p(a.phone)],
    ['last_name', 'equals', 'Lovelace', p(a.name)],
    ['interacted_at', 'less-than', { kind: 'relative', duration: daysDuration(3, 'ago') }, p(a.interaction)],
    ['owner_membership_id', 'equals', { kind: 'member', id: 'mem-2' }, p(a.interaction)],
  ];

  it.each(cases)('%s %s %j', (field, operator, value, path) => {
    const model = addCondition(emptyFilterModel(), cond(path, field, operator, value));
    const ast = buildFilter(model, resolve);
    expect(ast).not.toBeNull();
    const parsed = parseFilter(ast, resolve);
    const back = parsed.children[0];
    expect(back).toMatchObject({ kind: 'condition', path, field, operator });
    if (value !== undefined) expect((back as { value: unknown }).value).toEqual(value);
    expect(sameFilter(buildFilter(parsed, resolve), ast)).toBe(true);
  });

  it('accepts stored filter forms: active_until noise, checkbox "true" strings, long durations', () => {
    const leaf: PredicateLeaf = {
      path: p(a.client),
      mode: 'must',
      constraints: [
        { field: 'target_entity_instance_id', operator: 'eq', value: 'rec-9' },
        { field: 'active_until', operator: 'empty', value: 'null' },
      ],
    };
    expect(matchLeaf(a.client, leaf)).toEqual({
      field: 'target_entity_instance_id',
      operator: 'contains',
      value: { entityInstanceId: 'rec-9' },
    });
    expect(
      matchLeaf(a.strategic, {
        path: p(a.strategic),
        mode: 'must',
        constraints: [{ field: 'value', operator: 'eq', value: 'true', valueType: 'static' }],
      })?.operator,
    ).toBe('true');
    expect(
      matchLeaf(a.startDate, {
        path: p(a.startDate),
        mode: 'must',
        constraints: [{ field: 'value', operator: 'lt', value: '-P0Y0M30DT0H0M0S', valueType: 'dynamic' }],
      })?.value,
    ).toEqual({ kind: 'relative', duration: '-P0Y0M30DT0H0M0S' });
  });

  it('keeps leaves it cannot display verbatim', () => {
    const odd: Predicate = {
      and: [{ path: p(a.code), mode: 'must', constraints: [{ field: 'value', operator: 'in', value: ['a', 'b'] }] }],
    };
    const model = parseFilter(odd, resolve);
    expect(model.children[0]).toMatchObject({ kind: 'condition', operator: null });
    expect(buildFilter(model, resolve)).toEqual(odd);
    const gone: Predicate = {
      path: [
        {
          entityDefinitionId: a.code.entityDefinitionId,
          attributeDefinitionId: '00000000-0000-7000-8000-00000000dead',
        },
      ],
      mode: 'must',
      constraints: [],
    };
    expect(buildFilter(parseFilter(gone, resolve), resolve)).toEqual({ and: [gone] });
  });

  it('parses a top-level OR into an OR root (rendered as one advanced pill)', () => {
    const ast: Predicate = {
      or: [
        { path: p(a.code), mode: 'must', constraints: [{ field: 'value', operator: 'eq', value: 'X' }] },
        { path: p(a.code), mode: 'must', constraints: [{ field: 'value', operator: 'eq', value: 'Y' }] },
      ],
    };
    const model = parseFilter(ast, resolve);
    expect(model.mode).toBe('or');
    expect(isPillLayout(model)).toBe(false);
    expect(pillLayout(model).advanced).toBe(model);
  });
});

describe('model edits', () => {
  it('converts a pill into the advanced group (placed first) and back to pills when cleared', () => {
    let model = emptyFilterModel();
    const budget = cond(p(a.budget), 'raw_value', 'greater-than', 50000);
    const phase = cond(p(a.phase), 'pipeline_stage_id', 'contains', 'stage-build');
    model = addCondition(addCondition(model, budget), phase);
    const moved = moveToAdvanced(model, phase.id);
    model = moved.model;
    const layout = pillLayout(model);
    expect(layout.advanced?.id).toBe(moved.groupId);
    expect(model.children[0]?.id).toBe(moved.groupId);
    expect(layout.pills.map((c) => c.id)).toEqual([budget.id]);
    expect(countConditions(layout.advanced as FilterModel)).toBe(1);

    // a second conversion joins the existing group
    const tags = cond(p(a.tags), 'select_option_id', 'contains', 'opt-ai');
    model = addCondition(model, tags);
    model = moveToAdvanced(model, tags.id).model;
    model = setGroupMode(model, moved.groupId, 'or');
    expect(buildFilter(model, resolve)).toEqual({
      and: [
        {
          or: [
            {
              path: p(a.phase),
              mode: 'must',
              constraints: [{ field: 'pipeline_stage_id', operator: 'eq', value: 'stage-build', valueType: 'static' }],
            },
            {
              path: p(a.tags),
              mode: 'must',
              constraints: [{ field: 'select_option_id', operator: 'eq', value: 'opt-ai', valueType: 'static' }],
            },
          ],
        },
        {
          path: p(a.budget),
          mode: 'must',
          constraints: [{ field: 'raw_value', operator: 'gt', value: 50000, valueType: 'static' }],
        },
      ],
    });

    // nested group, then deleting its only condition removes the group
    model = wrapInGroup(model, tags.id);
    expect(countConditions(model)).toBe(3);
    model = removeNode(model, tags.id);
    model = removeNode(model, phase.id);
    expect(pillLayout(model).advanced).toBeNull();
    expect(countConditions(model)).toBe(1);
  });

  it('changing the attribute of a condition resets it to incomplete', () => {
    const c = cond(p(a.budget), 'raw_value', 'greater-than', 5);
    let model = addCondition(emptyFilterModel(), c);
    model = updateCondition(model, c.id, { path: p(a.code), field: 'value', operator: null, value: undefined });
    expect(buildFilter(model, resolve)).toBeNull();
  });
});

describe('canonical form', () => {
  it('ignores default value types, active_until and empty groups', () => {
    const saved: Predicate = {
      and: [
        {
          path: p(a.code),
          mode: 'must',
          constraints: [
            { field: 'value', operator: 'eq', value: 'X', valueType: 'static' },
            { field: 'active_until', operator: 'empty', value: 'null' },
          ],
        },
        { or: [] },
      ],
    };
    const draft: Predicate = {
      and: [{ path: p(a.code), mode: 'must', constraints: [{ field: 'value', operator: 'eq', value: 'X' }] }],
    };
    expect(filterKey(saved)).toBe(filterKey(draft));
    expect(canonicalFilter({ and: [] })).toBeNull();
    expect(sameFilter(null, { and: [] })).toBe(true);
  });
});

describe('operator menus', () => {
  it('labels multi-value attributes with contains / does not contain and dates with before / after', () => {
    expect(operatorsFor(a.tags, null).map((o) => o.label)).toEqual([
      'contains',
      'does not contain',
      'empty',
      'not empty',
    ]);
    expect(operatorsFor(a.budget, null).map((o) => o.label)).toEqual([
      'is',
      'is not',
      'less than',
      'greater than',
      'empty',
      'not empty',
    ]);
    expect(operatorsFor(a.startDate, null).map((o) => o.label)).toEqual([
      'is',
      'is not',
      'before',
      'after',
      'empty',
      'not empty',
    ]);
    expect(operatorsFor(a.strategic, null).map((o) => o.label)).toEqual(['is true', 'is false']);
    expect(operatorsFor(a.phase, null).map((o) => o.label)).toEqual([
      'is',
      'is not',
      'was',
      'was not',
      'empty',
      'not empty',
    ]);
    expect(valueKindFor(a.phase, null, 'was')).toBe('status-was');
    expect(valueKindFor(a.startDate, null, 'less-than')).toBe('relative-date');
    expect(valueKindFor(a.startDate, null, 'equals')).toBe('date');
    expect(valueKindFor(a.code, null, 'empty')).toBe('none');
  });
});
