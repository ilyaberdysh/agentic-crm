import type { AttributeDefinition, EntityDefinition } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import { SchemaIndex } from '../../views/schemaIndex';
import type { ImportColumn, MappingProperty } from '../data/contract';
import { autoMap, hasUniqueMapping, hopOf, MAPPING_MESSAGES, newProperty, validateMapping } from './mapping';
import { buildPlan, mergeValues, planShapes } from './plan';
import { EMPTY_CONFIG } from './resolve';

const LIST = '00000000-0000-7000-8000-00000000000a';
const PROJECTS = '00000000-0000-7000-8000-00000000000b';

const attr = (def: string, apiSlug: string, title: string, over: Partial<AttributeDefinition> = {}) =>
  ({
    id: `${def.slice(-1)}-${apiSlug}`,
    workspaceId: 'w',
    entityDefinitionId: def,
    apiSlug,
    title,
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
    sortOrder: `m${apiSlug}`,
    createdBy: { type: 'system', id: null },
    createdAt: '',
    ...over,
  }) as AttributeDefinition;

const listAttrs = [
  attr(LIST, 'entry_id', 'Entry ID', { isSystem: true, systemAttributeType: 'id', isUnique: true, isReadOnly: true }),
  attr(LIST, 'parent_record', 'Parent Record', {
    type: 'entity-reference',
    isSystem: true,
    isRequired: true,
    config: { entityReferenceConfiguration: { allowedEntityDefinitionIds: [PROJECTS] } },
  }),
  attr(LIST, 'stage', 'Stage', { type: 'pipeline' }),
  attr(LIST, 'deal_value', 'Deal value', { type: 'currency' }),
];
const projectAttrs = [
  attr(PROJECTS, 'record_id', 'Record ID', {
    isSystem: true,
    systemAttributeType: 'id',
    isUnique: true,
    isReadOnly: true,
  }),
  attr(PROJECTS, 'code', 'Code', { isUnique: true }),
];
const index = new SchemaIndex(
  [
    { id: LIST, entityType: 'collection-entry', singularNoun: 'Entry', pluralNoun: 'Pipeline' },
    { id: PROJECTS, entityType: 'custom-record', singularNoun: 'Project', pluralNoun: 'Projects' },
  ] as EntityDefinition[],
  new Map([
    [LIST, listAttrs],
    [PROJECTS, projectAttrs],
  ]),
);

let n = 0;
const id = () => `p${++n}`;
const columns: ImportColumn[] = ['Project code', 'Stage', 'Deal value'].map((title, i) => ({
  index: i,
  title,
  exampleValues: [],
}));

describe('list imports', () => {
  it('auto-maps list attributes, requires the parent record, then plans entries + parent records', () => {
    const mapping = autoMap(columns, index, LIST, id);
    expect(mapping.map((m) => m.columnIndex)).toEqual([1, 2]);
    expect(validateMapping({ mapping, entityDefinitionId: LIST }, index).error).toBe(MAPPING_MESSAGES.listParent);

    const parent = listAttrs[1] as AttributeDefinition;
    const code = projectAttrs[1] as AttributeDefinition;
    const full: MappingProperty[] = [
      newProperty('code', columns[0] as ImportColumn, [hopOf(parent), hopOf(code)], code, null),
      ...mapping,
    ];
    expect(validateMapping({ mapping: full, entityDefinitionId: LIST }, index).error).toBeNull();
    expect(hasUniqueMapping({ mapping: full, entityDefinitionId: LIST }, index)).toBe(true);

    const shapes = planShapes({ mapping: full, entityDefinitionId: LIST }, index);
    expect(shapes.map((s) => [s.id, s.kind, s.entityDefinitionId])).toEqual([
      ['root', 'entries', LIST],
      ['parent', 'records', PROJECTS],
    ]);
    const plan = buildPlan(index, shapes, {
      rows: [
        ['SEED-001', 'Qualified', '15000'],
        ['SEED-011', 'Lead', '5000'],
        ['', 'Lead', ''],
      ],
      valuesFor: (p, raw) => (raw ? [p.columnIndex === 0 ? raw : { raw }] : []),
      issuesFor: () => [],
      existing: new Map([['parent', new Map([['seed-001', 'rec-1']])]]),
      existingEntries: new Map([['rec-1', 'entry-1']]),
      listStrategy: 'create-or-update',
      columnTitle: (i) => columns[i]?.title ?? '',
    });
    const [entries, records] = plan.strategies;
    expect(records?.rows.map((r) => r.outcome)).toEqual(['update', 'create', 'skip']);
    expect(entries?.rows.map((r) => [r.outcome, r.entityInstanceId])).toEqual([
      ['update', 'entry-1'],
      ['create', null],
      ['skip', null],
    ]);
    // The entries table starts with the Parent Record column.
    expect(entries?.attributeIds[0]).toBe(parent.id);
    expect(plan.invalidRows).toEqual([{ row: 2, reason: 'No parent record to add to the list' }]);
  });
});

describe('mergeValues', () => {
  it('joins name parts and keeps the first value of single attributes', () => {
    const name = attr(PROJECTS, 'name', 'Name', { type: 'personal-name' });
    expect(mergeValues(name, [[{ firstName: 'Ada' }], [{ lastName: 'Lovelace' }]])).toEqual([
      { firstName: 'Ada', lastName: 'Lovelace', fullName: 'Ada Lovelace' },
    ]);
    expect(mergeValues(attr(PROJECTS, 'x', 'X'), [['a'], ['b']])).toEqual(['a']);
    expect(
      mergeValues(attr(PROJECTS, 't', 'T', { type: 'select', isMultiselect: true }), [
        [1, 2],
        [2, 3],
      ]),
    ).toEqual([1, 2, 3]);
    expect(EMPTY_CONFIG.dateFormat).toBeNull();
  });
});
