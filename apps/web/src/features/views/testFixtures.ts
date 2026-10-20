// Test fixtures: a small schema (projects → companies) in the shapes the views feature reads.
import type { AttributeDefinition, AttributeType, Path } from '@agentic-crm/contracts';
import type { LeafResolver } from './filterModel';

export const PROJECTS = '00000000-0000-7000-8000-000000000001';
export const COMPANIES = '00000000-0000-7000-8000-000000000002';
export const TASKS = '00000000-0000-7000-8000-000000000003';

let n = 100;
const id = () => `00000000-0000-7000-8000-${String(n++).padStart(12, '0')}`;

export function attr(
  entityDefinitionId: string,
  title: string,
  type: AttributeType,
  extra: Partial<AttributeDefinition> = {},
): AttributeDefinition {
  return {
    id: id(),
    workspaceId: '00000000-0000-7000-8000-0000000000ff',
    entityDefinitionId,
    apiSlug: title.toLowerCase().replace(/\W+/g, '_'),
    title,
    description: '',
    type,
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
    createdBy: { type: 'system', id: null },
    createdAt: '2026-10-01T00:00:00.000000Z',
    ...extra,
  };
}

export const companyName = attr(COMPANIES, 'Name', 'text', {
  isSystem: true,
  systemAttributeType: 'name',
  sortOrder: 'b',
});
export const companyCreatedAt = attr(COMPANIES, 'Created at', 'timestamp', {
  isSystem: true,
  systemAttributeType: 'created-at',
  sortOrder: 'y',
});

export const a = {
  recordId: attr(PROJECTS, 'Record ID', 'text', { isSystem: true, systemAttributeType: 'id', sortOrder: '1' }),
  code: attr(PROJECTS, 'Code', 'text', { sortOrder: 'c' }),
  budget: attr(PROJECTS, 'Budget', 'currency', { sortOrder: 'd' }),
  headcount: attr(PROJECTS, 'Headcount', 'number', { sortOrder: 'e' }),
  strategic: attr(PROJECTS, 'Strategic', 'checkbox', { sortOrder: 'f' }),
  startDate: attr(PROJECTS, 'Start date', 'date', { sortOrder: 'g' }),
  kickoff: attr(PROJECTS, 'Kickoff at', 'timestamp', { sortOrder: 'h' }),
  health: attr(PROJECTS, 'Health', 'rating', { sortOrder: 'i' }),
  phase: attr(PROJECTS, 'Phase', 'pipeline', { sortOrder: 'j' }),
  priority: attr(PROJECTS, 'Priority', 'select', { sortOrder: 'k' }),
  tags: attr(PROJECTS, 'Tags', 'select', { isMultiselect: true, sortOrder: 'l' }),
  client: attr(PROJECTS, 'Client', 'entity-reference', {
    sortOrder: 'm',
    config: { entityReferenceConfiguration: { allowedEntityDefinitionIds: [COMPANIES] } },
  }),
  owner: attr(PROJECTS, 'Owner', 'actor-reference', { sortOrder: 'n' }),
  office: attr(PROJECTS, 'Office', 'location', { sortOrder: 'o' }),
  website: attr(PROJECTS, 'Website', 'domain', { sortOrder: 'p' }),
  email: attr(PROJECTS, 'Contact email', 'email-address', { sortOrder: 'q' }),
  phone: attr(PROJECTS, 'Contact phone', 'phone-number', { sortOrder: 'r' }),
  name: attr(PROJECTS, 'Lead', 'personal-name', { sortOrder: 's' }),
  interaction: attr(PROJECTS, 'Last interaction', 'interaction', { sortOrder: 't' }),
};

export const ALL = [...Object.values(a), companyName, companyCreatedAt];

export function p(...attrs: AttributeDefinition[]): Path {
  return attrs.map((x) => ({ entityDefinitionId: x.entityDefinitionId, attributeDefinitionId: x.id }));
}

export const resolve: LeafResolver = (path) => {
  const last = path[path.length - 1];
  return ALL.find((x) => x.id === last?.attributeDefinitionId);
};
