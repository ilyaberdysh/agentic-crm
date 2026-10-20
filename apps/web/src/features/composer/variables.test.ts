import type { AttributeDefinition } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import { choiceOf, drillOf, fallbackExample, menuAttributes, relatedDefinitionOf, subFieldsOf } from './variables';

const attr = (patch: Partial<AttributeDefinition>): AttributeDefinition =>
  ({
    id: 'a1',
    entityDefinitionId: 'people',
    title: 'Name',
    type: 'personal-name',
    isArchived: false,
    isHidden: false,
    systemAttributeType: null,
    relationship: null,
    config: {},
    ...patch,
  }) as AttributeDefinition;

describe('variable menu model', () => {
  it('lists the sub-fields of names, emails and locations', () => {
    expect(subFieldsOf({ type: 'personal-name' }).map((f) => f.title)).toEqual(['First', 'Last', 'Full']);
    expect(subFieldsOf({ type: 'text' })).toEqual([]);
  });

  it('drills into sub-fields and into relationships up to two hops', () => {
    expect(drillOf(attr({}), 0)).toMatchObject({ kind: 'fields' });
    const company = attr({
      type: 'entity-reference',
      relationship: { relatedEntityDefinitionId: 'companies', relatedAttributeDefinitionId: 'x' },
    });
    expect(drillOf(company, 0)).toEqual({ kind: 'relation', definitionId: 'companies' });
    expect(drillOf(company, 2)).toBeNull();
    expect(drillOf(attr({ type: 'text' }), 0)).toBeNull();
  });

  it('takes the related object from a single allowed object when there is no relationship', () => {
    const record = attr({
      type: 'entity-reference',
      config: { entityReferenceConfiguration: { allowedEntityDefinitionIds: ['deals'] } },
    });
    expect(relatedDefinitionOf(record)).toBe('deals');
    const any = attr({
      type: 'entity-reference',
      config: { entityReferenceConfiguration: { allowedEntityDefinitionIds: null } },
    });
    expect(relatedDefinitionOf(any)).toBeNull();
  });

  it('hides archived, hidden and list-entries attributes', () => {
    const list = [
      attr({ id: '1' }),
      attr({ id: '2', isArchived: true }),
      attr({ id: '3', isHidden: true }),
      attr({ id: '4', systemAttributeType: 'list-entries' }),
    ];
    expect(menuAttributes(list).map((a) => a.id)).toEqual(['1']);
  });

  it('labels a choice like the chip', () => {
    const name = attr({});
    const first = subFieldsOf(name)[0] ?? null;
    expect(choiceOf([], name, first)).toEqual({
      path: [{ entityDefinitionId: 'people', attributeDefinitionId: 'a1' }],
      field: 'first_name',
      label: 'Name › First',
    });
    const company = attr({ id: 'c', title: 'Company', type: 'entity-reference' });
    const companyName = attr({ id: 'n', entityDefinitionId: 'companies', title: 'Name', type: 'text' });
    expect(
      choiceOf(
        [{ step: { entityDefinitionId: 'people', attributeDefinitionId: 'c' }, title: company.title }],
        companyName,
        null,
      ),
    ).toMatchObject({
      label: 'Company › Name',
      field: null,
      path: [
        { entityDefinitionId: 'people', attributeDefinitionId: 'c' },
        { entityDefinitionId: 'companies', attributeDefinitionId: 'n' },
      ],
    });
  });

  it('suggests a type-appropriate fallback example', () => {
    expect(fallbackExample(attr({}), 'first_name')).toBe('John');
    expect(fallbackExample(attr({ type: 'email-address', title: 'Email' }), null)).toBe('john@example.com');
  });
});
