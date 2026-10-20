import type { AttributeDefinition } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  duplicateListName,
  type List,
  parentNouns,
  parentRecordAttribute,
  sortLists,
  toDuplicates,
  toList,
  toMemberships,
  writableListAttributes,
} from './data';
import { parentOf } from './entryRows';
import { bulkAddCount, duplicateEntriesSummary } from './flows';
import { iconOfEmoji, listEmoji } from './icon';
import { presentUsers } from './presence';
import { visibleLists } from './SidebarLists';
import { recencyWeight, relevanceOf, relevanceScore } from './visits';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function list(over: Partial<List> = {}): List {
  return {
    id: id(1),
    name: 'Pipeline',
    icon: null,
    apiSlug: 'pipeline',
    parentEntityDefinitionIds: [id(9)],
    sortOrder: 'h',
    workspaceAccess: 'read-write',
    myAccess: 'full-access',
    parentRecordAttributeId: null,
    createdBy: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    entryCount: 0,
    ...over,
  };
}

function attr(over: Partial<AttributeDefinition>): AttributeDefinition {
  return {
    id: id(100),
    workspaceId: id(0),
    entityDefinitionId: id(1),
    apiSlug: 'stage',
    title: 'Stage',
    description: '',
    type: 'pipeline',
    isMultiselect: false,
    isUnique: false,
    isRequired: false,
    isHistoric: true,
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
    createdBy: { type: 'system', id: null },
    createdAt: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

describe('server shapes', () => {
  const entry = (n: number, parent: number, createdAt = '2026-10-03T00:00:00.000Z') => ({
    id: id(n),
    listId: id(1),
    parentRecord: { entityDefinitionId: id(9), entityInstanceId: id(parent) },
    createdAt,
    createdBy: { type: 'system' as const, id: null },
    values: {},
  });

  it('maps lists.get / lists.list to the client list', () => {
    expect(
      toList({
        id: id(1),
        workspaceId: id(0),
        name: 'Deals',
        icon: 'emoji:rocket',
        apiSlug: 'deals_list',
        sortOrder: 'k',
        parentEntityDefinitionIds: [id(2)],
        parentRecordAttributeId: id(3),
        workspaceAccess: 'read-write',
        memberAccess: [],
        myAccess: 'full-access',
        entryCount: 4,
        createdBy: { type: 'system', id: null },
        createdAt: '2026-10-02T00:00:00.000Z',
        updatedAt: '2026-10-02T00:00:00.000Z',
      }),
    ).toEqual({
      id: id(1),
      name: 'Deals',
      icon: 'emoji:rocket',
      apiSlug: 'deals_list',
      parentEntityDefinitionIds: [id(2)],
      sortOrder: 'k',
      workspaceAccess: 'read-write',
      myAccess: 'full-access',
      parentRecordAttributeId: id(3),
      createdBy: { type: 'system', id: null },
      createdAt: '2026-10-02T00:00:00.000Z',
      entryCount: 4,
    });
  });

  it("maps entries.forRecord memberships (date added = the entry's createdAt)", () => {
    expect(
      toMemberships({
        memberships: [
          {
            listId: id(1),
            entryId: id(2),
            list: { id: id(1), name: 'Deals', icon: null, apiSlug: 'deals', sortOrder: 'k' },
            entry: entry(2, 7),
          },
        ],
      }),
    ).toEqual([{ listId: id(1), entryId: id(2), addedAt: '2026-10-03T00:00:00.000Z' }]);
  });

  it('maps duplicates to entry ids per parent record', () => {
    const parent = { entityDefinitionId: id(9), entityInstanceId: id(7) };
    const dups = toDuplicates({ duplicates: [{ parentRecord: parent, entries: [entry(2, 7), entry(3, 7)] }] });
    expect(dups.get(id(7))).toEqual([id(2), id(3)]);
    expect(toDuplicates({ duplicates: [] }).size).toBe(0);
  });

  it('finds the parent record of an entry value', () => {
    expect(parentOf([{ value: { entityDefinitionId: id(9), entityInstanceId: id(7) } }])).toEqual({
      entityDefinitionId: id(9),
      entityInstanceId: id(7),
    });
    expect(parentOf([])).toBeNull();
    expect(parentOf(undefined)).toBeNull();
  });
});

describe('duplicate list names (C2 §2.7)', () => {
  it('takes the first free "<name> (n)", case-insensitively', () => {
    expect(duplicateListName('Pipeline', ['Pipeline'])).toBe('Pipeline (2)');
    expect(duplicateListName('Pipeline', ['Pipeline', 'pipeline (2)'])).toBe('Pipeline (3)');
    expect(duplicateListName('Pipeline (2)', ['Pipeline (2)', 'Pipeline'])).toBe('Pipeline (3)');
    expect(duplicateListName('Pipeline (2)', ['Pipeline (2)'])).toBe('Pipeline');
  });
});

describe('sidebar order (B sidebar.md §8)', () => {
  const a = list({ id: id(1), name: 'Beta', sortOrder: 'k', createdAt: '2026-10-01T00:00:00.000Z' });
  const b = list({ id: id(2), name: 'alpha', sortOrder: 'c', createdAt: '2026-10-05T00:00:00.000Z' });
  const c = list({ id: id(3), name: 'Gamma', sortOrder: 't', createdAt: '2026-10-03T00:00:00.000Z' });

  it('sorts by rank, creation and name', () => {
    expect(sortLists([a, b, c], 'custom').map((l) => l.name)).toEqual(['alpha', 'Beta', 'Gamma']);
    expect(sortLists([a, b, c], 'recently-added').map((l) => l.name)).toEqual(['alpha', 'Gamma', 'Beta']);
    expect(sortLists([a, b, c], 'alphabetical').map((l) => l.name)).toEqual(['alpha', 'Beta', 'Gamma']);
  });

  it('most relevant = visits × mean recency weight', () => {
    const now = Date.parse('2026-10-14T12:00:00Z');
    expect(recencyWeight(60_000)).toBe(100);
    expect(recencyWeight(5 * 3_600_000)).toBe(80);
    expect(recencyWeight(100 * 86_400_000)).toBe(0);
    expect(relevanceScore([now - 60_000, now - 60_000], now)).toBe(200);
    const score = relevanceOf({ [id(3)]: [now - 1000, now - 2000], [id(1)]: [now - 2 * 86_400_000] }, now);
    expect(sortLists([a, b, c], 'most-relevant', score).map((l) => l.name)).toEqual(['Gamma', 'Beta', 'alpha']);
  });

  it('shows all up to 6, else 5 + "All lists"', () => {
    const six = Array.from({ length: 6 }, (_, i) => i);
    expect(visibleLists(six, false)).toEqual({ rows: six, overLimit: false });
    const seven = Array.from({ length: 7 }, (_, i) => i);
    expect(visibleLists(seven, false)).toEqual({ rows: [0, 1, 2, 3, 4], overLimit: true });
    expect(visibleLists(seven, true).rows).toHaveLength(7);
  });
});

describe('entries', () => {
  it('bulk add counts and the duplicate summary (C2 §2.5 C.3)', () => {
    expect(bulkAddCount(5, 2, false)).toBe(3);
    expect(bulkAddCount(5, 2, true)).toBe(5);
    expect(duplicateEntriesSummary(1)).toBe('1 record is already in this list');
    expect(duplicateEntriesSummary(3)).toBe('3 records are already in this list');
  });

  it('offers writable list attributes in attribute order, never the system ones', () => {
    const attrs = [
      attr({ id: id(10), apiSlug: 'parent_record', type: 'entity-reference', isSystem: true, sortOrder: 'a' }),
      attr({ id: id(11), apiSlug: 'entry_id', type: 'text', isSystem: true, sortOrder: '5' }),
      attr({ id: id(12), apiSlug: 'created_at', type: 'timestamp', isSystem: true, isReadOnly: true, sortOrder: 'z' }),
      attr({ id: id(13), apiSlug: 'value', type: 'currency', sortOrder: 'p' }),
      attr({ id: id(14), apiSlug: 'stage', sortOrder: 'n' }),
      attr({ id: id(15), apiSlug: 'old', sortOrder: 'o', isArchived: true }),
    ];
    expect(writableListAttributes(attrs).map((a) => a.apiSlug)).toEqual(['stage', 'value']);
    expect(parentRecordAttribute(attrs)?.id).toBe(id(10));
    expect(parentRecordAttribute(attrs, id(14))?.id).toBe(id(14));
  });

  it('names the parent object ("Add Company"), or "Record" for mixed lists', () => {
    const objects = [
      { id: id(9), singularNoun: 'Company', pluralNoun: 'Companies' },
      { id: id(8), singularNoun: 'Person', pluralNoun: 'People' },
    ];
    expect(parentNouns(list(), objects)).toEqual({ singular: 'Company', plural: 'Companies' });
    expect(parentNouns(list({ parentEntityDefinitionIds: [id(9), id(8)] }), objects)).toEqual({
      singular: 'Record',
      plural: 'Records',
    });
  });
});

describe('icons and presence', () => {
  it('stores emoji as emoji:<name> and renders defaults', () => {
    expect(listEmoji(null)).toBe('📋');
    expect(listEmoji('emoji:clipboard')).toBe('📋');
    expect(listEmoji('emoji:rocket')).toBe('🚀');
    expect(listEmoji('emoji:not_an_emoji')).toBe('📋');
    expect(iconOfEmoji('🚀')).toBe('emoji:rocket');
    expect(listEmoji(iconOfEmoji('🔥'))).toBe('🔥');
  });

  it('lists each present user once, self by its own name', () => {
    const members = [
      { clientId: 'a', userId: 'u1', state: { name: 'Server name' } },
      { clientId: 'b', userId: 'u2', state: { name: 'Bob' } },
      { clientId: 'c', userId: 'u2', state: { name: 'Bob' } },
    ];
    expect(presentUsers(members as never, { userId: 'u1', name: 'Ada' })).toEqual([
      { userId: 'u1', name: 'Ada' },
      { userId: 'u2', name: 'Bob' },
    ]);
  });
});
