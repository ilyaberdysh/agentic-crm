// Dev-gallery fixtures: the research seed (the data behind the curated evidence/C1 screenshots) as attribute
// definitions, options, members, records and value rows, seeded into an isolated QueryClient so every View and
// Editor renders without a server.
import type { EntityDefinition } from '@agentic-crm/contracts';
import { QueryClient } from '@tanstack/react-query';
import { keys } from '../../../data/keys';
import type { AttributeEnv } from '../data/env';
import type { RecordSearchHit } from '../data/server';
import type { AttributeDefinition, AttributeType, AttributeValue, Member, PipelineStage, SelectOption } from '../types';

export const GALLERY_WS = { id: '0a11e7f0-0000-4000-8000-000000000001', slug: 'gallery' };
const ws = GALLERY_WS.id;
const NOW = '2026-10-09T13:31:00.000000Z';

/** Readable fake uuids: `uid('p', 3)` → '00000000-0000-4000-8000-0000000p0003'-like but valid hex. */
function uid(kind: number, n: number): string {
  return `${kind.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

// ---- objects ------------------------------------------------------------------------------------------------------

function object(
  id: string,
  apiSlug: string,
  singular: string,
  plural: string,
  entityType: EntityDefinition['entityType'],
  epithetAttr: string | null,
  standardObjectType: EntityDefinition['standardObjectType'] = null,
): EntityDefinition {
  return {
    id,
    workspaceId: ws,
    entityType,
    standardObjectType,
    entitySubType: null,
    apiSlug,
    singularNoun: singular,
    pluralNoun: plural,
    icon: null,
    imagePath: null,
    epithetPath: epithetAttr ? [{ entityDefinitionId: id, attributeDefinitionId: epithetAttr }] : null,
    interfaceIds: [],
    sortOrder: 'm',
    isArchived: false,
    isSystem: false,
    createdBy: { type: 'system', id: null },
    createdAt: NOW,
  };
}

export const OBJ = { projects: uid(1, 1), people: uid(1, 2), companies: uid(1, 3), deals: uid(1, 4) };

let attrSeq = 0;
function attribute(
  entityDefinitionId: string,
  apiSlug: string,
  title: string,
  type: AttributeType,
  patch: Partial<AttributeDefinition> = {},
): AttributeDefinition {
  attrSeq += 1;
  return {
    id: uid(2, attrSeq),
    workspaceId: ws,
    entityDefinitionId,
    apiSlug,
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
    sortOrder: attrSeq.toString(36).padStart(3, '0'),
    createdBy: { type: 'system', id: null },
    createdAt: NOW,
    ...patch,
  };
}

const eur = {
  currencyConfiguration: {
    defaultCurrencyCode: 'EUR' as const,
    defaultDisplayType: 'symbol' as const,
    defaultDecimalPlaces: 'two-decimals' as const,
    defaultGroups: 'default' as const,
  },
};
const usd = { currencyConfiguration: { ...eur.currencyConfiguration, defaultCurrencyCode: 'USD' as const } };

export const A = {
  // people
  personName: attribute(OBJ.people, 'name', 'Name', 'personal-name', { isSystem: true }),
  personEmails: attribute(OBJ.people, 'email_addresses', 'Email addresses', 'email-address', {
    isMultiselect: true,
    isSystem: true,
  }),
  personPhones: attribute(OBJ.people, 'phone_numbers', 'Phone numbers', 'phone-number', {
    isMultiselect: true,
    isSystem: true,
  }),
  personCompany: attribute(OBJ.people, 'company', 'Company', 'entity-reference', {
    config: { entityReferenceConfiguration: { allowedEntityDefinitionIds: [OBJ.companies] } },
  }),
  personJob: attribute(OBJ.people, 'job_title', 'Job title', 'text'),
  personLast: attribute(OBJ.people, 'last_interaction', 'Last interaction', 'interaction', {
    isSystem: true,
    isReadOnly: true,
  }),
  // companies
  companyDomains: attribute(OBJ.companies, 'domains', 'Domains', 'domain', { isMultiselect: true, isSystem: true }),
  companyName: attribute(OBJ.companies, 'name', 'Name', 'text', { isSystem: true }),
  companyDescription: attribute(OBJ.companies, 'description', 'Description', 'text', { isSystem: true }),
  companyTeam: attribute(OBJ.companies, 'team', 'Team', 'entity-reference', {
    isMultiselect: true,
    config: { entityReferenceConfiguration: { allowedEntityDefinitionIds: [OBJ.people] } },
  }),
  companyCategories: attribute(OBJ.companies, 'categories', 'Categories', 'select', { isMultiselect: true }),
  // projects (the research seed's custom object)
  code: attribute(OBJ.projects, 'code', 'Code', 'text', { isUnique: true }),
  summary: attribute(OBJ.projects, 'summary', 'Summary', 'text'),
  budget: attribute(OBJ.projects, 'budget', 'Budget', 'currency', { config: eur, isHistoric: true }),
  headcount: attribute(OBJ.projects, 'headcount', 'Headcount', 'number'),
  strategic: attribute(OBJ.projects, 'strategic', 'Strategic', 'checkbox'),
  startDate: attribute(OBJ.projects, 'start_date', 'Start date', 'date'),
  kickoff: attribute(OBJ.projects, 'kickoff_at', 'Kickoff at', 'timestamp'),
  phase: attribute(OBJ.projects, 'phase', 'Phase', 'pipeline', { isHistoric: true }),
  tags: attribute(OBJ.projects, 'tags', 'Tags', 'select', { isMultiselect: true }),
  health: attribute(OBJ.projects, 'health', 'Health', 'rating'),
  stakeholders: attribute(OBJ.projects, 'stakeholders', 'Stakeholders', 'entity-reference', {
    isMultiselect: true,
    config: { entityReferenceConfiguration: { allowedEntityDefinitionIds: [OBJ.people] } },
  }),
  owner: attribute(OBJ.projects, 'owner', 'Owner', 'actor-reference'),
  createdAt: attribute(OBJ.projects, 'created_at', 'Created at', 'timestamp', {
    isSystem: true,
    isReadOnly: true,
    systemAttributeType: 'created-at',
  }),
  priority: attribute(OBJ.projects, 'priority', 'Priority', 'select'),
  createdBy: attribute(OBJ.projects, 'created_by', 'Created by', 'actor-reference', {
    isSystem: true,
    isReadOnly: true,
    systemAttributeType: 'created-by',
  }),
  recordId: attribute(OBJ.projects, 'record_id', 'Record ID', 'text', {
    isSystem: true,
    isReadOnly: true,
    systemAttributeType: 'id',
  }),
  office: attribute(OBJ.projects, 'office', 'Office', 'location'),
  client: attribute(OBJ.projects, 'client', 'Client', 'entity-reference', {
    config: { entityReferenceConfiguration: { allowedEntityDefinitionIds: [OBJ.companies] } },
  }),
  website: attribute(OBJ.projects, 'website', 'Website', 'domain', { isMultiselect: true }),
  contactEmail: attribute(OBJ.projects, 'contact_email', 'Contact email', 'email-address', { isMultiselect: true }),
  contactPhone: attribute(OBJ.projects, 'contact_phone', 'Contact phone', 'phone-number'),
  // deals
  dealStage: attribute(OBJ.deals, 'stage', 'Deal stage', 'pipeline', { isRequired: true }),
  dealOwner: attribute(OBJ.deals, 'owner', 'Deal owner', 'actor-reference', { isRequired: true }),
  dealValue: attribute(OBJ.deals, 'value', 'Deal value', 'currency', { config: usd }),
  dealCreatedBy: attribute(OBJ.deals, 'created_by', 'Created by', 'actor-reference', {
    isSystem: true,
    isReadOnly: true,
  }),
};

export const OBJECTS: EntityDefinition[] = [
  object(OBJ.projects, 'projects', '[seed] Project', '[seed] Projects', 'custom-record', null),
  object(OBJ.people, 'people', 'Person', 'People', 'person-record', A.personName.id),
  object(OBJ.companies, 'companies', 'Company', 'Companies', 'company-record', A.companyName.id),
  object(OBJ.deals, 'deals', 'Deal', 'Deals', 'standard-object', null, 'deal'),
];

// ---- options, stages, members ----------------------------------------------------------------------------------------

let optionSeq = 0;
function options(attr: AttributeDefinition, titles: string[], color = 'pastel_grey'): SelectOption[] {
  return titles.map((title, i) => ({
    id: uid(3, ++optionSeq),
    workspaceId: ws,
    entityDefinitionId: attr.entityDefinitionId,
    attributeDefinitionId: attr.id,
    title,
    color,
    sortOrder: String.fromCharCode(98 + i),
    isArchived: false,
    createdAt: NOW,
  }));
}

function stages(attr: AttributeDefinition, list: Array<[string, string]>): PipelineStage[] {
  return options(
    attr,
    list.map(([t]) => t),
  ).map((o, i) => ({
    ...o,
    color: list[i]?.[1] ?? 'block_grey',
    lifecyclePhase: 'ACTIVE',
    targetTimeInStatus: null,
    celebrationEnabled: false,
  }));
}

export const OPTIONS = {
  tags: options(A.tags, ['AI', 'CRM', 'Data', 'Mobile', 'Infra']),
  priority: options(A.priority, ['Low', 'Medium', 'High', 'Critical']),
  categories: options(A.companyCategories, ['B2B', 'Robotics', 'SaaS'], 'pastel_blue'),
};
export const STAGES = {
  phase: stages(A.phase, [
    ['Discovery', 'block_light-green'],
    ['Build', 'block_blue'],
    ['Review', 'block_magenta'],
    ['Done', 'block_grey'],
  ]),
  deal: stages(A.dealStage, [
    ['Lead', 'block_orange'],
    ['In Progress', 'block_magenta'],
    ['Won', 'block_green'],
    ['Lost', 'block_red'],
  ]),
};
const opt = (list: SelectOption[], title: string) => list.find((o) => o.title === title)?.id ?? '';

export const MEMBERS: Member[] = [
  {
    id: uid(4, 1),
    workspaceId: ws,
    userId: uid(5, 1),
    accessLevel: 'admin',
    emailAddress: 'ilya@mymeet.ai',
    firstName: 'Ilya',
    lastName: 'Berdysh',
    suspendedAt: null,
    createdAt: NOW,
  },
  {
    id: uid(4, 2),
    workspaceId: ws,
    userId: uid(5, 2),
    accessLevel: 'member',
    emailAddress: 'team@mymeet.ai',
    firstName: 'Workspace',
    lastName: 'Member',
    suspendedAt: null,
    createdAt: NOW,
  },
];

// ---- records -----------------------------------------------------------------------------------------------------------

// biome-ignore format: table
const COMPANIES: [key: string, name: string][] = [
  ['northwind', 'Northwind Robotics'], ['bluefin', 'Bluefin Analytics'], ['cedar', 'Cedar Health'],
  ['orbit', 'Orbit Logistics'], ['quartz', 'Quartz Studio'], ['helios', 'Helios Energy'],
  ['pinecone-labs', 'Pinecone Labs'], ['atlas-ventures', 'Atlas Ventures'],
];
// biome-ignore format: table
export const PEOPLE: [first: string, last: string, company: string, title: string][] = [
  ['Jane', 'Cooper', 'northwind', 'CEO'], ['Wade', 'Warren', 'northwind', 'Head of Operations'],
  ['Esther', 'Howard', 'bluefin', 'CTO'], ['Cameron', 'Williamson', 'bluefin', 'Data Engineer'],
  ['Brooklyn', 'Simmons', 'cedar', 'COO'], ['Leslie', 'Alexander', 'cedar', 'Product Manager'],
  ['Jenny', 'Wilson', 'orbit', 'VP Sales'], ['Guy', 'Hawkins', 'orbit', 'Founder'],
  ['Robert', 'Fox', 'quartz', 'Creative Director'], ['Jacob', 'Jones', 'helios', 'CFO'],
  ['Kristin', 'Watson', 'helios', 'Procurement Lead'], ['Cody', 'Fisher', 'pinecone-labs', 'Staff Engineer'],
  ['Savannah', 'Nguyen', 'pinecone-labs', 'Head of Developer Relations'], ['Ralph', 'Edwards', 'atlas-ventures', 'Partner'],
  ['Dianne', 'Russell', 'atlas-ventures', 'Associate'], ['Courtney', 'Henry', 'northwind', 'Engineering Manager'],
];

export const companyId = (key: string) => uid(6, COMPANIES.findIndex(([k]) => k === key) + 1);
export const personId = (i: number) => uid(7, i + 1);

export interface ProjectRow {
  id: string;
  code: string;
  summary: string;
  client: string;
  stakeholders: number[];
  phase: string;
  priority: string;
  tags: string[];
  budget: number;
  headcount: number;
  strategic: boolean;
  health: number | null;
  start: string | null;
  city: string;
}

// The research seed's projects with the record ids of the evidence (00-* lists them in id order).
// biome-ignore format: table
export const PROJECTS: ProjectRow[] = ([
  ['de3d1863-6d4f-4eb6-8d92-0ac6b45f0b52', 'SEED-001', 'Warehouse picking automation', 'northwind', [0, 1], 'Build', 'High', ['AI', 'Infra'], 120000, 12, true, 4, '2026-07-01', 'London'],
  ['b2d6682d-86a9-4481-9a3e-6d1f0c2b7e11', 'SEED-002', 'Fraud signal dashboard', 'bluefin', [2, 3], 'Discovery', 'Medium', ['Data'], 45000, 4, false, 3, '2026-09-15', 'Berlin'],
  ['73baac76-e9ac-455f-8f0e-5b1c2d3e4f50', 'SEED-003', 'Patient reminder SMS', 'cedar', [4], 'Review', 'Low', ['Mobile'], 18000, 2, false, 5, '2026-05-10', 'Paris'],
  ['30db1f51-a803-486e-a1b2-c3d4e5f60718', 'SEED-004', 'Route optimisation v2', 'orbit', [6, 7], 'Build', 'Critical', ['AI', 'Data'], 250000, 20, true, 2, '2026-03-01', 'Amsterdam'],
  ['6336038f-ccd4-44c8-9d0e-1f2a3b4c5d6e', 'SEED-005', 'Brand refresh', 'quartz', [8], 'Done', 'Low', [], 9000, 3, false, 5, '2026-01-20', 'Lisbon'],
  ['c3f89281-02d2-4f55-8a6b-7c8d9e0f1a2b', 'SEED-006', 'Installer marketplace CRM', 'helios', [9, 10], 'Discovery', 'High', ['CRM'], 80000, 6, true, 3, '2026-10-01', 'Madrid'],
  ['6dd3df67-ad1a-4b02-9c3d-4e5f6a7b8c9d', 'SEED-007', 'SDK docs portal', 'pinecone-labs', [11, 12], 'Build', 'Medium', ['Infra'], 30000, 5, false, 4, '2026-08-01', 'Dublin'],
  ['f1aecf71-0dac-4600-b1c2-d3e4f5a6b7c8', 'SEED-008', 'Portfolio reporting', 'atlas-ventures', [13, 14], 'Review', 'Medium', ['CRM', 'Data'], 25000, 2, true, 4, '2026-06-12', 'Stockholm'],
  ['4ef6ffb4-6341-41c9-9e2f-3a4b5c6d7e8f', 'SEED-009', 'Robot fleet telemetry', 'northwind', [15], 'Discovery', 'Critical', ['Data', 'Infra'], 60000, 7, true, 1, '2026-11-01', 'London'],
  ['4ca8605b-bbf4-44d2-8e1f-2a3b4c5d6e7f', 'SEED-010', 'Analytics mobile app', 'bluefin', [3], 'Build', 'High', ['Data', 'Mobile'], 70000, 6, false, 3, '2026-04-04', 'Berlin'],
  ['3ea739f7-09f3-4ff2-8b1a-0c9d8e7f6a5b', 'SEED-011', 'Clinic onboarding flow', 'cedar', [5], 'Done', 'Medium', ['CRM'], 12000, 2, false, 4, '2025-12-01', 'Paris'],
  ['82ff9f50-efb3-4c43-b5a6-978877665544', 'SEED-012', 'Courier app redesign', 'orbit', [6], 'Discovery', 'Low', ['Mobile'], 15000, 3, false, null, null, 'Amsterdam'],
] as const).map(([id, code, summary, client, stakeholders, phase, priority, tags, budget, headcount, strategic, health, start, city]) => ({
  id, code, summary, client, stakeholders: [...stakeholders], phase, priority, tags: [...tags], budget, headcount, strategic, health, start, city,
}));

/** Evidence orders: by record id (00-*), by Budget desc (25, 27–31, 36, 51). */
export const byId = [...PROJECTS].sort((a, b) => (a.id < b.id ? -1 : 1));
export const byBudget = [...PROJECTS].sort((a, b) => b.budget - a.budget);

let valueSeq = 0;
function value(
  attr: AttributeDefinition,
  recordId: string,
  v: unknown,
  patch: Partial<AttributeValue> = {},
): AttributeValue {
  valueSeq += 1;
  return {
    id: uid(8, valueSeq),
    workspaceId: ws,
    entityDefinitionId: attr.entityDefinitionId,
    entityInstanceId: recordId,
    attributeDefinitionId: attr.id,
    attributeType: attr.type,
    value: v,
    activeFrom: NOW,
    activeUntil: null,
    sortOrder: attr.isMultiselect ? String.fromCharCode(98 + (valueSeq % 20)) : null,
    createdBy: { type: 'api-token', id: uid(9, 1) },
    deactivatedBy: null,
    ...patch,
  };
}

const API_TOKEN = { referencedActorType: 'api-token', referencedActorId: uid(9, 1) };
const ILYA = { referencedActorType: 'workspace-member', referencedActorId: MEMBERS[0]?.id ?? '' };

/** Current values of one project, per attribute id. */
export function projectValues(p: ProjectRow): Record<string, AttributeValue[]> {
  const out: Record<string, AttributeValue[]> = {};
  const put = (attr: AttributeDefinition, ...vals: unknown[]) => {
    out[attr.id] = vals.map((v, i) => value(attr, p.id, v, attr.isMultiselect ? { sortOrder: `${'bcdefgh'[i]}` } : {}));
  };
  put(A.code, p.code);
  put(A.summary, p.summary);
  put(A.budget, { currencyValue: p.budget, currencyCode: null });
  put(A.headcount, p.headcount);
  put(A.strategic, p.strategic);
  if (p.start) {
    put(A.startDate, p.start);
    put(A.kickoff, `${p.start}T09:30:00.000000Z`);
  }
  if (p.health) put(A.health, p.health);
  put(A.phase, { pipelineStageId: opt(STAGES.phase, p.phase) });
  put(A.tags, ...p.tags.map((t) => ({ selectOptionId: opt(OPTIONS.tags, t) })));
  put(A.priority, { selectOptionId: opt(OPTIONS.priority, p.priority) });
  put(A.client, { entityDefinitionId: OBJ.companies, entityInstanceId: companyId(p.client) });
  put(
    A.stakeholders,
    ...p.stakeholders.map((i) => ({ entityDefinitionId: OBJ.people, entityInstanceId: personId(i) })),
  );
  put(A.owner, ILYA);
  put(A.createdAt, p.code === 'SEED-012' ? '2026-10-09T13:32:00.000000Z' : '2026-10-09T13:31:00.000000Z');
  put(A.createdBy, API_TOKEN);
  put(A.recordId, p.id);
  put(A.office, {
    locality: p.city,
    line1: null,
    line2: null,
    line3: null,
    line4: null,
    region: null,
    postcode: null,
    countryCode: null,
    latitude: null,
    longitude: null,
  });
  put(A.website, { normalizedDomain: `${p.client}.example.com`, rootDomain: 'example.com' });
  put(A.contactEmail, `projects@${p.client}.example.com`);
  put(A.contactPhone, {
    originalPhoneNumber: '+442071234567',
    countryCode: 'GB',
    normalizedPhoneNumber: '+442071234567',
  });
  return out;
}

export interface PersonRow {
  id: string;
  name: { firstName: string; lastName: string; fullName: string };
  emails: string[];
  company: string;
  job: string;
}

/** The people of evidence/C1/32–33 (incl. the merge test record with two addresses), in that screenshot's order. */
export const PEOPLE_ROWS: PersonRow[] = (() => {
  const base = PEOPLE.map(([first, last, company, job], i) => ({
    id: personId(i),
    name: { firstName: `[seed] ${first}`, lastName: last, fullName: `[seed] ${first} ${last}` },
    emails: [`${first}.${last}@${company}.example.com`.toLowerCase()],
    company,
    job,
  }));
  const merge: PersonRow = {
    id: uid(7, 99),
    name: { firstName: '[seed] Merge', lastName: 'Beta', fullName: '[seed] Merge Beta' },
    emails: ['merge.beta@northwind.example.com', 'merge.alpha@northwind.example.com'],
    company: 'northwind',
    job: 'Merge test Beta',
  };
  const order = [
    'Courtney',
    'Ralph',
    'Savannah',
    'Merge',
    'Robert',
    'Guy',
    'Jane',
    'Cody',
    'Esther',
    'Cameron',
    'Dianne',
    'Jacob',
    'Jenny',
    'Kristin',
    'Leslie',
    'Brooklyn',
    'Wade',
  ];
  const all = [...base, merge];
  return order.map((f) => all.find((p) => p.name.firstName === `[seed] ${f}`) as PersonRow);
})();

export function personValues(p: PersonRow): Record<string, AttributeValue[]> {
  return {
    [A.personName.id]: [value(A.personName, p.id, p.name)],
    [A.personEmails.id]: p.emails.map((e, i) =>
      value(
        A.personEmails,
        p.id,
        {
          originalEmailAddress: e,
          normalizedEmailAddress: e,
          emailDomain: e.split('@')[1] ?? '',
          emailRootDomain: 'example.com',
          emailLocalSpecifier: '',
        },
        { sortOrder: `${'bcd'[i]}` },
      ),
    ),
    [A.personPhones.id]: [],
    [A.personCompany.id]: [
      value(A.personCompany, p.id, { entityDefinitionId: OBJ.companies, entityInstanceId: companyId(p.company) }),
    ],
    [A.personJob.id]: [value(A.personJob, p.id, p.job)],
  };
}

export const DEAL = {
  id: uid(10, 1),
  values: {} as Record<string, AttributeValue[]>,
};
DEAL.values = {
  [A.dealStage.id]: [value(A.dealStage, DEAL.id, { pipelineStageId: opt(STAGES.deal, 'In Progress') })],
  [A.dealOwner.id]: [value(A.dealOwner, DEAL.id, ILYA)],
  [A.dealValue.id]: [value(A.dealValue, DEAL.id, { currencyValue: 45000, currencyCode: null })],
  [A.dealCreatedBy.id]: [value(A.dealCreatedBy, DEAL.id, API_TOKEN)],
};

/** The edit history of evidence/C1/36 (Summary of SEED-012). */
export function summaryHistory(recordId: string): AttributeValue[] {
  const ilya = { type: 'workspace-member' as const, id: MEMBERS[0]?.id ?? null };
  return [
    value(A.summary, recordId, 'Courier app redesign', { activeFrom: '2026-10-09T14:06:30Z', createdBy: ilya }),
    value(A.summary, recordId, 'Courier app redesign v2', {
      activeFrom: '2026-10-09T14:06:10Z',
      activeUntil: '2026-10-09T14:06:30Z',
      createdBy: ilya,
      deactivatedBy: ilya,
    }),
    value(A.summary, recordId, 'Courier app redesign', {
      activeFrom: '2026-10-09T13:32:00Z',
      activeUntil: '2026-10-09T14:06:10Z',
      deactivatedBy: ilya,
    }),
  ];
}

// ---- query client and environment ----------------------------------------------------------------------------------

export function galleryQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false, refetchOnMount: false } },
  });
  for (const o of OBJECTS) client.setQueryData(keys.object(ws, o.id), o);
  const byObject = new Map<string, AttributeDefinition[]>();
  for (const a of Object.values(A))
    byObject.set(a.entityDefinitionId, [...(byObject.get(a.entityDefinitionId) ?? []), a]);
  for (const [def, list] of byObject) client.setQueryData(keys.attributes(ws, def), list);
  for (const o of OBJECTS) client.setQueryData([...keys.object(ws, o.id), 'policy'], null);
  client.setQueryData(keys.options(ws, OBJ.projects, A.tags.id), OPTIONS.tags);
  client.setQueryData(keys.options(ws, OBJ.projects, A.priority.id), OPTIONS.priority);
  client.setQueryData(keys.options(ws, OBJ.companies, A.companyCategories.id), OPTIONS.categories);
  client.setQueryData([...keys.options(ws, OBJ.projects, A.phase.id), 'stages'], STAGES.phase);
  client.setQueryData([...keys.options(ws, OBJ.deals, A.dealStage.id), 'stages'], STAGES.deal);
  client.setQueryData(keys.members(ws), MEMBERS);
  // Display names of referenced records.
  COMPANIES.forEach(([key, name]) =>
    client.setQueryData(keys.values(ws, OBJ.companies, A.companyName.id, companyId(key)), {
      values: [value(A.companyName, companyId(key), `[seed] ${name}`)],
      accurateAt: NOW,
    }),
  );
  for (const p of PEOPLE_ROWS)
    client.setQueryData(keys.values(ws, OBJ.people, A.personName.id, p.id), {
      values: [value(A.personName, p.id, p.name)],
      accurateAt: NOW,
    });
  return client;
}

export function galleryEnv(): AttributeEnv {
  const hits: RecordSearchHit[] = [
    ...PEOPLE_ROWS.map((p) => ({
      entityDefinitionId: OBJ.people,
      entityInstanceId: p.id,
      title: p.name.fullName,
      subtitle: p.emails[0] ?? null,
    })),
    ...COMPANIES.map(([key, name]) => ({
      entityDefinitionId: OBJ.companies,
      entityInstanceId: companyId(key),
      title: `[seed] ${name}`,
      subtitle: `${key}.example.com`,
    })),
  ];
  return {
    workspace: GALLERY_WS,
    memberId: MEMBERS[0]?.id ?? null,
    searchRecords: async ({ query, entityDefinitionIds, excludeIds, limit = 25 }) =>
      hits
        .filter((h) => !entityDefinitionIds?.length || entityDefinitionIds.includes(h.entityDefinitionId))
        .filter((h) => !excludeIds?.includes(h.entityInstanceId))
        .filter((h) => !query || (h.title ?? '').toLowerCase().includes(query.toLowerCase()))
        .slice(0, limit),
    searchMembers: async ({ query }) =>
      MEMBERS.filter(
        (m) => !query || `${m.firstName} ${m.lastName} ${m.emailAddress}`.toLowerCase().includes(query.toLowerCase()),
      ).map((m) => ({ ...m, score: 1 })),
    createOption: async (attr, title) => ({
      ...(OPTIONS.tags[0] as SelectOption),
      id: uid(3, 9000 + Math.floor(Math.random() * 1000)),
      attributeDefinitionId: attr.id,
      entityDefinitionId: attr.entityDefinitionId,
      title,
    }),
  };
}
