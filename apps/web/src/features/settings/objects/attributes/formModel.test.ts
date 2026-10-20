import type { AttributeDefinition, PipelineStage, SelectOption } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  cardinalityFlags,
  cardinalityOf,
  decodeStatic,
  decodeTargetTime,
  diffOptions,
  diffStages,
  encodeStatic,
  encodeTargetTime,
  formStateOf,
  initialFormState,
  nextColor,
  optionErrors,
  prunedDefault,
  rerank,
  toCreateInput,
  toUpdateInput,
  validateForm,
  withPickerType,
} from './formModel';
import { constraintsFor, dataTypeLabel, pickerTypeOf } from './typeCatalog';

const ED = '00000000-0000-7000-8000-000000000001';
const OTHER = '00000000-0000-7000-8000-000000000002';
const ids = {
  id: '00000000-0000-7000-8000-0000000000a1',
  entityDefinitionId: ED,
  reverseId: '00000000-0000-7000-8000-0000000000a2',
};

function attr(over: Partial<AttributeDefinition>): AttributeDefinition {
  return {
    id: '00000000-0000-7000-8000-0000000000b1',
    workspaceId: '00000000-0000-7000-8000-0000000000ff',
    entityDefinitionId: ED,
    apiSlug: 'thing',
    title: 'Thing',
    description: '',
    type: 'text',
    isMultiselect: false,
    isUnique: false,
    isRequired: false,
    isHistoric: false,
    isArchived: false,
    isSystem: false,
    systemAttributeType: null,
    isReadOnly: false,
    isHidden: false,
    config: {},
    defaultValue: null,
    relationship: null,
    interfaceAttributeId: null,
    sortOrder: 'm',
    createdBy: { type: 'system', id: null } as never,
    createdAt: '2026-10-10T00:00:00.000Z',
    ...over,
  };
}

function option(id: string, title: string, sortOrder: string, color = 'pastel_blue'): SelectOption {
  return {
    id,
    workspaceId: 'w',
    entityDefinitionId: ED,
    attributeDefinitionId: 'a',
    title,
    color,
    sortOrder,
    isArchived: false,
    createdAt: '2026-10-10T00:00:00.000Z',
  };
}

describe('relationship cardinality', () => {
  it('maps cardinalities to the two is_multiselect flags (J attribute-dialogs §6)', () => {
    expect(cardinalityFlags('one-to-one')).toEqual({ thisMulti: false, otherMulti: false });
    expect(cardinalityFlags('one-to-many')).toEqual({ thisMulti: true, otherMulti: false });
    expect(cardinalityFlags('many-to-one')).toEqual({ thisMulti: false, otherMulti: true });
    expect(cardinalityFlags('many-to-many')).toEqual({ thisMulti: true, otherMulti: true });
  });

  it('round-trips flags back to a cardinality', () => {
    for (const c of ['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many'] as const) {
      const f = cardinalityFlags(c);
      expect(cardinalityOf(f.thisMulti, f.otherMulti)).toBe(c);
    }
  });

  it('creates both sides in one input', () => {
    const s = initialFormState('relationship', OTHER);
    s.relationship = {
      targetObjectId: OTHER,
      cardinality: 'one-to-many',
      thisTitle: ' Gadgets ',
      otherTitle: 'Project',
    };
    expect(toCreateInput(s, ids)).toEqual({
      id: ids.id,
      entityDefinitionId: ED,
      type: 'entity-reference',
      title: 'Gadgets',
      description: '',
      isMultiselect: true,
      relationship: { id: ids.reverseId, entityDefinitionId: OTHER, title: 'Project', isMultiselect: false },
    });
  });

  it('requires both names and the other object', () => {
    const s = initialFormState('relationship', null);
    expect(validateForm(s)).toEqual({ thisTitle: true, otherTitle: true, targetObject: true });
  });
});

describe('time in status', () => {
  it('encodes the observed ISO form and decodes it back', () => {
    expect(encodeTargetTime({ amount: '7', unit: 'days' })).toBe('P0Y0M7DT0H0M0S');
    expect(encodeTargetTime({ amount: '2', unit: 'months' })).toBe('P0Y2M0DT0H0M0S');
    expect(encodeTargetTime({ amount: '1', unit: 'years' })).toBe('P1Y0M0DT0H0M0S');
    expect(encodeTargetTime({ amount: '', unit: 'days' })).toBeNull();
    expect(encodeTargetTime({ amount: '0', unit: 'days' })).toBeNull();
    expect(decodeTargetTime('P0Y0M7DT0H0M0S')).toEqual({ amount: '7', unit: 'days' });
    expect(decodeTargetTime('P14D')).toEqual({ amount: '14', unit: 'days' });
    expect(decodeTargetTime('P2W')).toEqual({ amount: '14', unit: 'days' });
    expect(decodeTargetTime('P0Y3M0DT0H0M0S')).toEqual({ amount: '3', unit: 'months' });
    expect(decodeTargetTime(null)).toEqual({ amount: '', unit: 'days' });
  });
});

describe('type catalog', () => {
  it('shows the constraint checkboxes of the spec table', () => {
    expect(constraintsFor('text')).toEqual({ required: true, unique: true, multiple: false });
    expect(constraintsFor('select')).toEqual({ required: true, unique: false, multiple: false });
    expect(constraintsFor('multi-select')).toEqual({ required: true, unique: false, multiple: false });
    expect(constraintsFor('record')).toEqual({ required: true, unique: true, multiple: true });
    expect(constraintsFor('user')).toEqual({ required: true, unique: true, multiple: true });
    expect(constraintsFor('phone-number')).toEqual({ required: true, unique: true, multiple: true });
    expect(constraintsFor('relationship')).toEqual({ required: false, unique: false, multiple: false });
    expect(constraintsFor('formula')).toEqual({ required: false, unique: false, multiple: false });
  });

  it('labels existing attributes by picker entry', () => {
    expect(dataTypeLabel(attr({ type: 'select', isMultiselect: true }))).toBe('Multi-select');
    expect(dataTypeLabel(attr({ type: 'pipeline' }))).toBe('Status');
    expect(dataTypeLabel(attr({ type: 'actor-reference' }))).toBe('User');
    expect(dataTypeLabel(attr({ type: 'phone-number' }))).toBe('Phone Number');
    expect(
      dataTypeLabel(
        attr({
          type: 'entity-reference',
          relationship: { relatedEntityDefinitionId: OTHER, relatedAttributeDefinitionId: OTHER },
        }),
      ),
    ).toBe('Relationship');
    expect(dataTypeLabel(attr({ type: 'entity-reference' }))).toBe('Record');
    expect(dataTypeLabel(attr({ type: 'domain' }))).toBe('Domain');
    expect(pickerTypeOf(attr({ type: 'interaction' }))).toBeNull();
  });
});

describe('create input', () => {
  it('drops constraints a type does not offer and sets multi-select', () => {
    const s = { ...initialFormState('multi-select'), title: 'Tags', isUnique: true, isRequired: true };
    const input = toCreateInput(s, ids);
    expect(input).toMatchObject({
      type: 'select',
      isMultiselect: true,
      isUnique: false,
      isRequired: true,
      title: 'Tags',
    });
  });

  it('sends number and currency configuration', () => {
    const n = {
      ...initialFormState('number'),
      title: 'Headcount',
      decimalPlaces: '2',
      numberGroups: 'no-groups' as const,
    };
    expect(toCreateInput(n, ids).numberConfiguration).toEqual({ defaultDecimalPlaces: 2, defaultGroups: 'no-groups' });
    const empty = { ...initialFormState('number'), title: 'Headcount' };
    expect(toCreateInput(empty, ids).numberConfiguration).toEqual({
      defaultDecimalPlaces: null,
      defaultGroups: 'default',
    });
    const c = { ...initialFormState('currency'), title: 'Budget', currencyCode: 'EUR' };
    expect(toCreateInput(c, ids).currencyConfiguration).toEqual({
      defaultCurrencyCode: 'EUR',
      defaultDisplayType: 'code',
      defaultDecimalPlaces: 'two-decimals',
      defaultGroups: 'default',
    });
  });

  it('validates decimal places 0–4', () => {
    expect(validateForm({ ...initialFormState('number'), title: 'N', decimalPlaces: '5' })).toEqual({
      decimalPlaces: 'Enter a value between 0 and 4',
    });
    expect(validateForm({ ...initialFormState('number'), title: 'N', decimalPlaces: '4' })).toEqual({});
    expect(validateForm(initialFormState('text'))).toEqual({ title: true });
  });

  it('allowed objects: none selected means any object (null)', () => {
    const s = { ...initialFormState('record'), title: 'Client', isMultiselect: true };
    expect(toCreateInput(s, ids)).toMatchObject({
      type: 'entity-reference',
      isMultiselect: true,
      entityReferenceConfiguration: { allowedEntityDefinitionIds: null },
    });
    s.allowedObjectIds = [OTHER];
    expect(toCreateInput(s, ids).entityReferenceConfiguration).toEqual({ allowedEntityDefinitionIds: [OTHER] });
  });

  it('creates options and stages inline with ranks, and a default that points at them', () => {
    const s = { ...initialFormState('select'), title: 'Priority' };
    s.options = [
      { id: 'o1', title: ' High ', color: 'pastel_red', isNew: true },
      { id: 'o2', title: 'Low', color: 'pastel_green', isNew: true },
    ];
    s.defaultValue = encodeStatic([{ selectOptionId: 'o2' }]);
    const input = toCreateInput(s, ids);
    expect(input.options?.map((o) => o.title)).toEqual(['High', 'Low']);
    const [a, b] = input.options ?? [];
    expect((a?.sortOrder ?? '') < (b?.sortOrder ?? '')).toBe(true);
    expect(input.defaultValue).toEqual({ type: 'static', identifier: '[{"selectOptionId":"o2"}]' });

    const st = { ...initialFormState('status'), title: 'Phase' };
    st.stages = [
      {
        id: 's1',
        title: 'Todo',
        color: 'block_red',
        isNew: true,
        celebrationEnabled: false,
        targetTime: { amount: '7', unit: 'days' },
      },
      {
        id: 's2',
        title: 'Done',
        color: 'block_teal',
        isNew: true,
        celebrationEnabled: true,
        targetTime: { amount: '', unit: 'days' },
      },
    ];
    expect(toCreateInput(st, ids).stages).toMatchObject([
      {
        id: 's1',
        title: 'Todo',
        lifecyclePhase: 'ACTIVE',
        targetTimeInStatus: 'P0Y0M7DT0H0M0S',
        celebrationEnabled: false,
      },
      { id: 's2', title: 'Done', lifecyclePhase: 'ACTIVE', targetTimeInStatus: null, celebrationEnabled: true },
    ]);
  });

  it('prunes a default whose option was removed', () => {
    const s = { ...initialFormState('multi-select'), title: 'Tags' };
    s.options = [{ id: 'o1', title: 'A', color: 'pastel_red', isNew: true }];
    s.defaultValue = encodeStatic([{ selectOptionId: 'o1' }, { selectOptionId: 'gone' }]);
    expect(decodeStatic(prunedDefault(s))).toEqual([{ selectOptionId: 'o1' }]);
    s.options = [];
    expect(prunedDefault(s)).toBeNull();
  });

  it('switching type keeps name and description only', () => {
    const s = { ...initialFormState('select'), title: 'X', description: 'D', isRequired: true };
    s.options = [{ id: 'o1', title: 'A', color: 'pastel_red', isNew: true }];
    const next = withPickerType(s, 'status');
    expect(next).toMatchObject({ pickerType: 'status', title: 'X', description: 'D', isRequired: false, options: [] });
  });
});

describe('options and stages', () => {
  it('flags empty and duplicate names', () => {
    expect(
      optionErrors(
        [
          { id: 'a', title: 'Todo', color: 'x', isNew: true },
          { id: 'b', title: ' todo ', color: 'x', isNew: true },
          { id: 'c', title: '', color: 'x', isNew: true },
        ],
        'stage',
      ),
    ).toEqual({ b: 'This name is already in use', c: 'Stage name is required' });
  });

  it('assigns the first unused colour, then rotates', () => {
    expect(nextColor('option', [])).toBe('pastel_green');
    expect(nextColor('option', ['pastel_green'])).toBe('pastel_blue');
    expect(nextColor('stage', [])).toBe('block_red');
  });

  it('re-ranks only moved and new items', () => {
    const items = [
      { id: 'c', rank: 'u' },
      { id: 'a', rank: 'f' },
      { id: 'b', rank: 'm' },
    ];
    const ranks = rerank(items);
    expect([...ranks.keys()]).toEqual(['c']);
    expect((ranks.get('c') ?? '') < 'f').toBe(true);
    const withNew = rerank([
      { id: 'a', rank: 'f' },
      { id: 'n', rank: null },
      { id: 'b', rank: 'm' },
    ]);
    const n = withNew.get('n') ?? '';
    expect(n > 'f' && n < 'm').toBe(true);
  });

  it('diffs the options editor into archive / create / update writes', () => {
    const original = [option('a', 'Alpha', 'f'), option('b', 'Beta', 'm'), option('c', 'Gamma', 'u')];
    const diff = diffOptions(original, [
      { id: 'b', title: 'Beta', color: 'pastel_red', isNew: false },
      { id: 'a', title: 'Alpha 2', color: 'pastel_blue', isNew: false },
      { id: 'n', title: 'New', color: 'pastel_green', isNew: true },
    ]);
    expect(diff.archive).toEqual(['c']);
    expect(diff.create.map((c) => c.id)).toEqual(['n']);
    const byId = Object.fromEntries(diff.update.map((u) => [u.id, u]));
    expect(byId.b).toMatchObject({ color: 'pastel_red' });
    expect(byId.b?.sortOrder).toBeUndefined();
    expect(byId.a).toMatchObject({ title: 'Alpha 2' });
    expect((byId.a?.sortOrder ?? '') > 'm').toBe(true);
  });

  it('diffs stage menu settings', () => {
    const stage: PipelineStage = {
      ...option('s', 'Todo', 'f', 'block_red'),
      lifecyclePhase: 'ACTIVE',
      targetTimeInStatus: null,
      celebrationEnabled: false,
    };
    const diff = diffStages(
      [stage],
      [
        {
          id: 's',
          title: 'Todo',
          color: 'block_red',
          isNew: false,
          celebrationEnabled: true,
          targetTime: { amount: '3', unit: 'days' },
        },
      ],
    );
    expect(diff.update).toEqual([
      { id: 's', extra: { celebrationEnabled: true, targetTime: { amount: '3', unit: 'days' } } },
    ]);
  });
});

describe('edit input', () => {
  it('patches only changed fields', () => {
    const a = attr({ title: 'Code', isUnique: true });
    const s = formStateOf(a, {});
    expect(toUpdateInput(a, s)).toBeNull();
    s.title = 'Project code';
    s.isRequired = true;
    expect(toUpdateInput(a, s)).toEqual({
      entityDefinitionId: ED,
      attributeDefinitionId: a.id,
      title: 'Project code',
      isRequired: true,
    });
  });

  it('sends default_value null when the default option was deleted', () => {
    const a = attr({ type: 'select', defaultValue: encodeStatic([{ selectOptionId: 'a' }]) });
    const s = formStateOf(a, { options: [option('a', 'Alpha', 'f')] });
    s.options = [];
    expect(toUpdateInput(a, s)).toMatchObject({ defaultValue: null });
  });

  it('reads cardinality from both sides of a relationship', () => {
    const a = attr({
      type: 'entity-reference',
      isMultiselect: true,
      relationship: { relatedEntityDefinitionId: OTHER, relatedAttributeDefinitionId: 'r' },
    });
    const reverse = attr({ id: 'r', entityDefinitionId: OTHER, title: 'Project', isMultiselect: false });
    const s = formStateOf(a, { reverse });
    expect(s.relationship).toEqual({
      targetObjectId: OTHER,
      cardinality: 'one-to-many',
      thisTitle: 'Thing',
      otherTitle: 'Project',
    });
  });
});
