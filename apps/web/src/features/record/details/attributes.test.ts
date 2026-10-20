import type { AttributeDefinition } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import { fuzzyMatches, isListedAttribute, listedAttributes, sectionAttributes } from './attributes';

const COMPANY_TITLES = [
  'Domains',
  'Name',
  'Description',
  'Team',
  'Categories',
  'Primary location',
  'Logo URL',
  'AngelList',
  'Facebook',
  'Instagram',
  'LinkedIn',
  'Twitter',
  'Twitter follower count',
  'Estimated ARR',
  'Funding raised',
  'Foundation date',
  'Employee range',
  'Associated deals',
];

function attr(title: string, sortOrder: string, extra: Partial<AttributeDefinition> = {}): AttributeDefinition {
  return {
    id: `id-${title}`,
    workspaceId: 'ws',
    entityDefinitionId: 'def',
    apiSlug: title.toLowerCase().replace(/\W+/g, '_'),
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
    sortOrder,
    createdBy: { type: 'system', id: null },
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

describe('details attributes', () => {
  it('fuzzy search keeps close titles ("inter" → Twitter, D §2.3) and substring matches', () => {
    expect(COMPANY_TITLES.filter((t) => fuzzyMatches('inter', t))).toEqual(['Twitter', 'Twitter follower count']);
    expect(COMPANY_TITLES.filter((t) => fuzzyMatches('twiter', t))).toEqual(['Twitter', 'Twitter follower count']);
    expect(COMPANY_TITLES.filter((t) => fuzzyMatches('dom', t))).toEqual(['Domains']);
    expect(fuzzyMatches('', 'Anything')).toBe(true);
    expect(fuzzyMatches('zzzz', 'Domains')).toBe(false);
  });

  it('lists non-system attributes in attribute order; sections default to the first five', () => {
    const all = [
      attr('Record ID', 'a', { systemAttributeType: 'id', isReadOnly: true }),
      attr('Name', 'c'),
      attr('Domains', 'b', { type: 'domain' }),
      attr('List entries', 'd', { systemAttributeType: 'list-entries', isHidden: true }),
      attr('Description', 'e'),
      attr('Team', 'f', { type: 'entity-reference' }),
      attr('Next interaction', 'g', { type: 'interaction' }),
      attr('Categories', 'h', { type: 'select' }),
      attr('Created at', 'i', { systemAttributeType: 'created-at' }),
      attr('Primary location', 'j', { type: 'location' }),
    ];
    expect(listedAttributes(all).map((a) => a.title)).toEqual([
      'Domains',
      'Name',
      'Description',
      'Team',
      'Categories',
      'Primary location',
    ]);
    expect(sectionAttributes(all, []).map((a) => a.title)).toEqual([
      'Domains',
      'Name',
      'Description',
      'Team',
      'Categories',
    ]);
    const configured = [{ path: [{ entityDefinitionId: 'def', attributeDefinitionId: 'id-Team' }] }];
    expect(sectionAttributes(all, configured as never).map((a) => a.title)).toEqual(['Team']);
    expect(isListedAttribute(attr('Archived', 'z', { isArchived: true }))).toBe(false);
  });
});
