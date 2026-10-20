// Standard data model seeded into every workspace (A §4.3, attribute-types §4, C1 README "Default views"):
//   interfaces  system ← entities ← objects; system ← list_entries
//   active      People, Companies (with their system attributes and default views), Tasks, Workspace members
//   archived    Deals, Users, Workspaces — definitions exist; attributes and views are seeded on first activation
//               (A §4.3: activation = PATCH is_archived=false, which seeds attributes, views and layouts)
// Custom objects get the system attributes of API-created custom objects.
import type { AttributeConfig, DefaultValue, Path } from '@agentic-crm/contracts';
import { rankSequence } from '@agentic-crm/contracts';
import { jsonb } from '@agentic-crm/db';
import { ensureDefaultLayout } from '../collab/layouts.ts';
import { newId } from '../ids.ts';
import type { Tx } from '../tx.ts';
import { type AttrDef, type DefInfo, invalidateDefinitions, loadDefinition } from './model.ts';
import {
  type AttributeSpec,
  insertAttributeDefinitions,
  insertEntityDefinition,
  insertOptions,
  type OptionSpec,
} from './service.ts';
import { seedViews } from './standard-views.ts';

interface Seed extends AttributeSpec {
  apiSlug: string;
  /** For entity references: api slugs (or keys) of the allowed definitions. */
  refTo?: string[];
  options?: OptionSpec[];
  /** Interface attribute this attribute implements, as '<interface slug>.<attribute slug>'. */
  implements?: string;
}

const sys = (
  apiSlug: string,
  title: string,
  type: Seed['type'],
  systemAttributeType: string,
  extra: Partial<Seed> = {},
): Seed => ({
  apiSlug,
  title,
  type,
  systemAttributeType,
  isSystem: true,
  ...extra,
});

const PT0S: DefaultValue = { type: 'dynamic', identifier: 'PT0S' };
const CURRENT_USER: DefaultValue = { type: 'dynamic', identifier: 'current-user' };

const recordId = (iface = true) =>
  sys('record_id', 'Record ID', 'text', 'id', {
    isUnique: true,
    isReadOnly: true,
    ...(iface ? { implements: 'entities.record_id' } : {}),
  });
const listEntries = (iface = true) =>
  sys('list_entries', 'List entries', 'entity-reference', 'list-entries', {
    isMultiselect: true,
    isReadOnly: true,
    isHidden: true,
    ...(iface ? { implements: 'entities.list_entries' } : {}),
  });
const nextDueTask = (iface = true) =>
  sys('next_due_task', 'Next due task', 'entity-reference', 'next-due-task', {
    isReadOnly: true,
    isHidden: true,
    refTo: ['tasks'],
    ...(iface ? { implements: 'entities.next_due_task' } : {}),
  });
const createdAt = (iface = true, required = false) =>
  sys('created_at', 'Created at', 'timestamp', 'created-at', {
    isReadOnly: true,
    isRequired: required,
    defaultValue: PT0S,
    ...(iface ? { implements: 'system.created_at' } : {}),
  });
const createdBy = (iface = true) =>
  sys('created_by', 'Created by', 'actor-reference', 'created-by', {
    isReadOnly: true,
    defaultValue: CURRENT_USER,
    ...(iface ? { implements: 'system.created_by' } : {}),
  });

const interactionSeeds = (): Seed[] =>
  (
    [
      ['first_interaction', 'First interaction', 'first-interaction'],
      ['last_interaction', 'Last interaction', 'last-interaction'],
      ['next_interaction', 'Next interaction', 'next-interaction'],
      ['first_calendar_interaction', 'First calendar interaction', 'first-calendar-interaction'],
      ['last_calendar_interaction', 'Last calendar interaction', 'last-calendar-interaction'],
      ['next_calendar_interaction', 'Next calendar interaction', 'next-calendar-interaction'],
      ['first_email_interaction', 'First email interaction', 'first-email-interaction'],
      ['last_email_interaction', 'Last email interaction', 'last-email-interaction'],
    ] as const
  ).map(([slug, title, type]) => sys(slug, title, 'interaction', type, { isReadOnly: true }));

const connectionSeeds = (): Seed[] => [
  sys(
    'strongest_connection_strength_legacy',
    'Connection strength (legacy)',
    'number',
    'strongest-connection-strength',
    {
      isReadOnly: true,
    },
  ),
  sys('strongest_connection_strength', 'Connection strength', 'select', 'strongest-connection-strength-enum', {
    isReadOnly: true,
    options: ['Very weak', 'Weak', 'Good', 'Strong', 'Very strong'].map((title) => ({ title })),
  }),
  sys('strongest_connection_user', 'Strongest connection', 'actor-reference', 'strongest-connection-user', {
    isReadOnly: true,
  }),
];

const socialSeeds = (): Seed[] => [
  sys('angellist', 'AngelList', 'text', 'angel-list'),
  sys('facebook', 'Facebook', 'text', 'facebook'),
  sys('instagram', 'Instagram', 'text', 'instagram'),
  sys('linkedin', 'LinkedIn', 'text', 'linked-in'),
  sys('twitter', 'Twitter', 'text', 'twitter'),
  sys('twitter_follower_count', 'Twitter follower count', 'number', 'twitter-follower-count'),
];

const USD: AttributeConfig = {
  currencyConfiguration: {
    defaultCurrencyCode: 'USD',
    defaultDisplayType: 'symbol',
    defaultDecimalPlaces: 'no-decimals',
    defaultGroups: 'default',
  },
};

// Relationship pairs are declared once and expanded into both definitions' batches.
interface PairSeed {
  left: { def: string; seed: Seed };
  right: { def: string; seed: Seed };
}

function companySeeds(): Seed[] {
  return [
    recordId(),
    sys('domains', 'Domains', 'domain', 'domains', { isMultiselect: true, isUnique: true }),
    sys('name', 'Name', 'text', 'name'),
    sys('description', 'Description', 'text', 'description'),
    // team: relationship with people.company (PAIRS)
    listEntries(),
    sys('categories', 'Categories', 'select', 'categories', { isMultiselect: true }),
    sys('primary_location', 'Primary location', 'location', 'primary-location'),
    sys('logo_url', 'Logo URL', 'text', 'avatar-url'),
    ...socialSeeds(),
    sys('estimated_arr_usd', 'Estimated ARR', 'select', 'estimated-arr-usd', {
      options: [
        '$0-$1M',
        '$1M-$10M',
        '$10M-$50M',
        '$50M-$100M',
        '$100M-$250M',
        '$250M-$500M',
        '$500M-$1B',
        '$1B-$10B',
        '$10B+',
      ].map((title) => ({ title })),
    }),
    sys('funding_raised_usd', 'Funding raised', 'currency', 'funding-raised-usd', { config: USD, isHistoric: true }),
    sys('foundation_date', 'Foundation date', 'date', 'foundation-date'),
    sys('employee_range', 'Employee range', 'select', 'employee-range', {
      options: ['1-10', '11-50', '51-250', '251-1K', '1K-5K', '5K-10K', '10K-50K', '50K-100K', '100K+'].map(
        (title) => ({ title }),
      ),
    }),
    ...interactionSeeds(),
    ...connectionSeeds(),
    nextDueTask(),
    createdAt(),
    createdBy(),
  ];
}

function personSeeds(): Seed[] {
  return [
    recordId(),
    sys('name', 'Name', 'personal-name', 'personal-name'),
    sys('email_addresses', 'Email addresses', 'email-address', 'email-address', {
      isMultiselect: true,
      isUnique: true,
    }),
    sys('description', 'Description', 'text', 'description'),
    // company: relationship with companies.team (PAIRS)
    sys('job_title', 'Job title', 'text', 'job-title'),
    sys('avatar_url', 'Avatar URL', 'text', 'avatar-url'),
    sys('phone_numbers', 'Phone numbers', 'phone-number', 'phone-numbers', { isMultiselect: true }),
    sys('primary_location', 'Primary location', 'location', 'primary-location'),
    listEntries(),
    ...socialSeeds(),
    ...interactionSeeds(),
    ...connectionSeeds(),
    nextDueTask(),
    createdAt(),
    createdBy(),
  ];
}

const BASE_PAIRS: PairSeed[] = [
  {
    left: { def: 'companies', seed: sys('team', 'Team', 'entity-reference', 'team', { isMultiselect: true }) },
    right: { def: 'people', seed: sys('company', 'Company', 'entity-reference', 'company') },
  },
];

const DEAL_STAGES: OptionSpec[] = [
  { title: 'Lead', color: 'block_blue', lifecyclePhase: 'ACTIVE' },
  { title: 'In progress', color: 'block_yellow', lifecyclePhase: 'ACTIVE' },
  { title: 'Won', color: 'block_green', lifecyclePhase: 'WON', celebrationEnabled: true },
  { title: 'Lost', color: 'block_red', lifecyclePhase: 'LOST' },
];

function dealSeeds(): Seed[] {
  return [
    recordId(),
    sys('name', 'Deal name', 'text', 'name', { isRequired: true }),
    sys('stage', 'Deal stage', 'pipeline', 'deal-stage', { isRequired: true, isHistoric: true, options: DEAL_STAGES }),
    listEntries(),
    sys('owner', 'Deal owner', 'actor-reference', 'deal-owner', { isRequired: true, defaultValue: CURRENT_USER }),
    sys('value', 'Deal value', 'currency', 'deal-value', { config: USD, isHistoric: true }),
    // associated_people / associated_company: relationships (DEAL_PAIRS)
    nextDueTask(),
    createdAt(),
    createdBy(),
  ];
}

const DEAL_PAIRS: PairSeed[] = [
  {
    left: {
      def: 'deals',
      seed: sys('associated_people', 'Associated people', 'entity-reference', 'deal-associated-people', {
        isMultiselect: true,
      }),
    },
    right: {
      def: 'people',
      seed: sys('associated_deals', 'Associated deals', 'entity-reference', 'deal-associated-people', {
        isMultiselect: true,
      }),
    },
  },
  {
    left: {
      def: 'deals',
      seed: sys('associated_company', 'Associated company', 'entity-reference', 'deal-associated-company'),
    },
    right: {
      def: 'companies',
      seed: sys('associated_deals', 'Associated deals', 'entity-reference', 'deal-associated-company', {
        isMultiselect: true,
      }),
    },
  },
];

function userSeeds(): Seed[] {
  return [
    recordId(),
    sys('person', 'Person', 'entity-reference', 'user-associated-person', { refTo: ['people'] }),
    sys('primary_email_address', 'Primary email address', 'email-address', 'email-address', { isUnique: true }),
    sys('user_id', 'ID', 'text', 'user-id', { isUnique: true }),
    listEntries(),
    nextDueTask(),
    createdAt(),
    createdBy(),
  ];
}

function workspaceSeeds(): Seed[] {
  return [
    recordId(),
    sys('workspace_id', 'Workspace ID', 'text', 'workspace-id', { isUnique: true }),
    sys('name', 'Name', 'text', 'name'),
    sys('users', 'Users', 'entity-reference', 'workspace-associated-users', { isMultiselect: true, refTo: ['users'] }),
    sys('company', 'Company', 'entity-reference', 'workspace-associated-company', { refTo: ['companies'] }),
    sys('avatar_url', 'Avatar URL', 'text', 'workspace-avatar-url'),
    listEntries(),
    nextDueTask(),
    createdAt(),
    createdBy(),
  ];
}

function taskSeeds(): Seed[] {
  return [
    sys('deadline', 'Deadline', 'timestamp', 'task-deadline'),
    sys('completed', 'Completed', 'checkbox', 'task-completed', {
      defaultValue: { type: 'static', identifier: '[false]' },
    }),
    sys('referenced_records', 'Records', 'entity-reference', 'task-referenced-records', { isMultiselect: true }),
    sys('assignees', 'Assignees', 'actor-reference', 'task-assignees', { isMultiselect: true }),
    createdAt(),
    createdBy(),
  ];
}

function memberSeeds(): Seed[] {
  return [
    recordId(false),
    sys('workspace_member_id', 'Member', 'actor-reference', 'workspace-member-id', { isReadOnly: true }),
    sys('name', 'Name', 'personal-name', 'workspace-member-name', { isReadOnly: true }),
    sys('email_address', 'Email address', 'email-address', 'workspace-member-email-address', {
      isReadOnly: true,
      isUnique: true,
    }),
    createdAt(),
    createdBy(),
  ];
}

/** System attributes of a custom object (attribute-types §4: API-created custom objects have no interface bindings). */
export function customObjectSeeds(): Seed[] {
  return [recordId(false), listEntries(false), nextDueTask(false), createdAt(false, true), createdBy(false)];
}

/** Seeds reference definitions by api slug; Tasks (whose slug is their id) by the key 'tasks'. */
async function definitionIdForSeed(tx: Tx, slug: string): Promise<string> {
  if (slug !== 'tasks') return (await loadDefinition(tx, slug)).id;
  const row = await tx.db
    .selectFrom('entity_definitions')
    .select('id')
    .where('entity_type', '=', 'task')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Resolves seed references (definition slugs, interface attributes) and inserts the batch. */
async function insertSeeds(tx: Tx, def: DefInfo, seeds: Seed[]): Promise<AttrDef[]> {
  const specs: AttributeSpec[] = [];
  for (const seed of seeds) {
    const { refTo, options: _options, implements: impl, ...spec } = seed;
    if (refTo) {
      const ids = await Promise.all(refTo.map((slug) => definitionIdForSeed(tx, slug)));
      spec.config = { entityReferenceConfiguration: { allowedEntityDefinitionIds: ids } };
    }
    if (impl) {
      const [ifaceSlug, attrSlug] = impl.split('.') as [string, string];
      spec.interfaceAttributeId = (await loadDefinition(tx, ifaceSlug)).bySlug.get(attrSlug)?.id ?? null;
    }
    specs.push(spec);
  }
  const attrs = await insertAttributeDefinitions(tx, def, specs);
  for (const [i, seed] of seeds.entries()) {
    if (seed.options?.length) await insertOptions(tx, attrs[i] as AttrDef, seed.options);
  }
  return attrs;
}

/** Expands relationship pairs into seeds for `defSlug` (ids are shared between both sides). */
function pairSeedsFor(
  pairs: PairSeed[],
  ids: Map<PairSeed, [string, string]>,
  defIds: Map<string, string>,
  defSlug: string,
): Seed[] {
  const out: Seed[] = [];
  for (const pair of pairs) {
    const [leftId, rightId] = ids.get(pair) as [string, string];
    if (pair.left.def === defSlug) {
      out.push({
        ...pair.left.seed,
        id: leftId,
        relationshipAttributeId: rightId,
        config: {
          entityReferenceConfiguration: { allowedEntityDefinitionIds: [defIds.get(pair.right.def) as string] },
        },
      });
    }
    if (pair.right.def === defSlug) {
      out.push({
        ...pair.right.seed,
        id: rightId,
        relationshipAttributeId: leftId,
        config: { entityReferenceConfiguration: { allowedEntityDefinitionIds: [defIds.get(pair.left.def) as string] } },
      });
    }
  }
  return out;
}

function pairIds(pairs: PairSeed[]): Map<PairSeed, [string, string]> {
  return new Map(pairs.map((p) => [p, [newId(), newId()]]));
}

async function setDisplayPaths(tx: Tx, slug: string, epithet: string | null, image: string | null): Promise<void> {
  const def = await loadDefinition(tx, slug);
  const path = (attrSlug: string | null): Path | null => {
    const attr = attrSlug ? def.bySlug.get(attrSlug) : undefined;
    return attr ? [{ entityDefinitionId: def.id, attributeDefinitionId: attr.id }] : null;
  };
  await tx.db
    .updateTable('entity_definitions')
    .set({ epithet_path: jsonb(path(epithet)), image_path: jsonb(path(image)) })
    .where('id', '=', def.id)
    .execute();
  invalidateDefinitions(tx);
}

/** Seeds the data model of a new workspace. Runs inside the workspace-creation transaction. */
export async function bootstrapWorkspaceSchema(tx: Tx): Promise<void> {
  // 1. Interfaces.
  const system = await insertEntityDefinition(tx, {
    entityType: 'interface',
    entitySubType: 'system-interface',
    apiSlug: 'system',
    singularNoun: 'System',
    pluralNoun: 'System',
    isSystem: true,
  });
  const entities = await insertEntityDefinition(tx, {
    entityType: 'interface',
    entitySubType: 'entity-interface',
    apiSlug: 'entities',
    singularNoun: 'Entity',
    pluralNoun: 'Entities',
    interfaceIds: [system.id],
    isSystem: true,
  });
  const objects = await insertEntityDefinition(tx, {
    entityType: 'interface',
    entitySubType: 'object-interface',
    apiSlug: 'objects',
    singularNoun: 'Object',
    pluralNoun: 'Objects',
    interfaceIds: [entities.id],
    isSystem: true,
  });
  await insertEntityDefinition(tx, {
    entityType: 'interface',
    entitySubType: 'list-entry-interface',
    apiSlug: 'list_entries',
    singularNoun: 'List entry',
    pluralNoun: 'List entries',
    interfaceIds: [system.id],
    isSystem: true,
  });

  // 2. Definitions (sidebar order: Companies, People, Deals, Users, Workspaces).
  const [rCompanies, rPeople, rDeals, rUsers, rWorkspaces] = rankSequence(5);
  const tasksId = newId();
  // biome-ignore format: table
  const objectDefs: [string, Parameters<typeof insertEntityDefinition>[1]][] = [
    ['companies', { entityType: 'company-record', apiSlug: 'companies', singularNoun: 'Company', pluralNoun: 'Companies', sortOrder: rCompanies ?? null }],
    ['people', { entityType: 'person-record', apiSlug: 'people', singularNoun: 'Person', pluralNoun: 'People', sortOrder: rPeople ?? null }],
    ['deals', { entityType: 'standard-object', standardObjectType: 'deal', apiSlug: 'deals', singularNoun: 'Deal', pluralNoun: 'Deals', sortOrder: rDeals ?? null, isArchived: true, seeded: false }],
    ['users', { entityType: 'standard-object', standardObjectType: 'user', apiSlug: 'users', singularNoun: 'User', pluralNoun: 'Users', sortOrder: rUsers ?? null, isArchived: true, seeded: false }],
    ['workspaces', { entityType: 'standard-object', standardObjectType: 'workspace', apiSlug: 'workspaces', singularNoun: 'Workspace', pluralNoun: 'Workspaces', sortOrder: rWorkspaces ?? null, isArchived: true, seeded: false }],
  ];
  for (const [, spec] of objectDefs)
    await insertEntityDefinition(tx, { ...spec, interfaceIds: [objects.id], isSystem: true });
  // Tasks are addressed by their definition id (A §4.3: the api_slug of tasks is the definition's UUID).
  await insertEntityDefinition(tx, {
    id: tasksId,
    entityType: 'task',
    apiSlug: tasksId,
    singularNoun: 'Task',
    pluralNoun: 'Tasks',
    interfaceIds: [system.id],
    isSystem: true,
  });
  await insertEntityDefinition(tx, {
    entityType: 'workspace-member',
    apiSlug: 'workspace_members',
    singularNoun: 'Workspace member',
    pluralNoun: 'Workspace members',
    interfaceIds: [system.id],
    isSystem: true,
  });

  // 3. Interface attributes (tasks exist now, so next_due_task can reference them).
  await insertSeeds(tx, await loadDefinition(tx, 'system'), [createdAt(false), createdBy(false)]);
  await insertSeeds(tx, await loadDefinition(tx, 'entities'), [
    recordId(false),
    listEntries(false),
    nextDueTask(false),
  ]);

  // 4. Attributes of the active objects.
  const defIds = new Map<string, string>();
  for (const slug of ['companies', 'people']) defIds.set(slug, (await loadDefinition(tx, slug)).id);
  const ids = pairIds(BASE_PAIRS);
  await insertSeeds(
    tx,
    await loadDefinition(tx, 'companies'),
    withPairs(companySeeds(), pairSeedsFor(BASE_PAIRS, ids, defIds, 'companies'), 'description'),
  );
  await insertSeeds(
    tx,
    await loadDefinition(tx, 'people'),
    withPairs(personSeeds(), pairSeedsFor(BASE_PAIRS, ids, defIds, 'people'), 'description'),
  );
  await insertSeeds(tx, await loadDefinition(tx, tasksId), taskSeeds());
  await insertSeeds(tx, await loadDefinition(tx, 'workspace_members'), memberSeeds());
  await setDisplayPaths(tx, 'companies', 'name', 'logo_url');
  await setDisplayPaths(tx, 'people', 'name', 'avatar_url');
  await setDisplayPaths(tx, 'workspace_members', 'name', null);

  // 5. Default views and record page layouts.
  await seedViews(tx, await loadDefinition(tx, 'companies'));
  await seedViews(tx, await loadDefinition(tx, 'people'));
  await ensureDefaultLayout(tx, await loadDefinition(tx, 'companies'));
  await ensureDefaultLayout(tx, await loadDefinition(tx, 'people'));
}

/** Inserts relationship seeds right after `afterSlug` so attribute order matches Attio's. */
function withPairs(seeds: Seed[], pairs: Seed[], afterSlug: string): Seed[] {
  const i = seeds.findIndex((s) => s.apiSlug === afterSlug);
  return [...seeds.slice(0, i + 1), ...pairs, ...seeds.slice(i + 1)];
}

/** First activation of Deals, Users or Workspaces: system attributes, relationships and default views. */
export async function seedStandardObject(tx: Tx, def: DefInfo): Promise<void> {
  if (def.seededAt !== null) return;
  if (def.standardObjectType === 'deal') {
    const defIds = new Map<string, string>();
    for (const slug of ['deals', 'people', 'companies']) defIds.set(slug, (await loadDefinition(tx, slug)).id);
    const ids = pairIds(DEAL_PAIRS);
    await insertSeeds(tx, def, withPairs(dealSeeds(), pairSeedsFor(DEAL_PAIRS, ids, defIds, 'deals'), 'value'));
    await insertSeeds(tx, await loadDefinition(tx, 'people'), pairSeedsFor(DEAL_PAIRS, ids, defIds, 'people'));
    await insertSeeds(tx, await loadDefinition(tx, 'companies'), pairSeedsFor(DEAL_PAIRS, ids, defIds, 'companies'));
    // Default stage: the first one ("Lead").
    const stage = (await loadDefinition(tx, def.id)).bySlug.get('stage') as AttrDef;
    const lead = await tx.db
      .selectFrom('select_options')
      .select('id')
      .where('attribute_id', '=', stage.id)
      .orderBy('sort_order')
      .executeTakeFirst();
    if (lead) {
      await tx.db
        .updateTable('attribute_definitions')
        .set({ default_value: { type: 'static', identifier: JSON.stringify([{ pipelineStageId: lead.id }]) } })
        .where('id', '=', stage.id)
        .execute();
    }
    await setDisplayPaths(tx, 'deals', 'name', null);
  } else if (def.standardObjectType === 'user') {
    await insertSeeds(tx, def, userSeeds());
    await setDisplayPaths(tx, 'users', 'primary_email_address', null);
  } else if (def.standardObjectType === 'workspace') {
    await insertSeeds(tx, def, workspaceSeeds());
    await setDisplayPaths(tx, 'workspaces', 'name', 'avatar_url');
  } else {
    return;
  }
  await tx.db.updateTable('entity_definitions').set({ seeded_at: tx.now }).where('id', '=', def.id).execute();
  invalidateDefinitions(tx);
  await seedViews(tx, await loadDefinition(tx, def.id));
  await ensureDefaultLayout(tx, await loadDefinition(tx, def.id));
}

/** System attributes of a new custom object. */
export async function seedCustomObject(tx: Tx, def: DefInfo): Promise<void> {
  await insertSeeds(tx, def, customObjectSeeds());
  invalidateDefinitions(tx);
  await ensureDefaultLayout(tx, await loadDefinition(tx, def.id));
}
