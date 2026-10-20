// Demo data (ARCHITECTURE D-23, BACKLOG 1.01): team accounts and a `mymeet` workspace mirroring the research seed
// of Attio's test workspace (research/tools/seed/seed.mjs): 8 companies on example.com domains, 16 people, a custom
// object "Projects" with 15 attribute types and 12 records, Deals activated with a few deals, and default views.
//
// Every write goes through the domain services (I1) acting as the first team member. Ids are derived from the
// workspace id and a stable key, so re-running is a no-op for anything that exists (PUT-idempotent creates, I3):
// it never duplicates, never overwrites edits and never resurrects deleted records. Demo records keep the
// research seed's "[seed]" marker so they stay easy to find and remove once real data arrives.
import { createHash } from 'node:crypto';
import type { AttributeDefinition, CreateAttributeInput, ValuesMap } from '@agentic-crm/contracts';
import { type Domain, DomainError, memberContext, type ServiceContext, systemContext } from '@agentic-crm/domain';
import type { Auth } from '../auth/auth';
import { generatePassword } from '../cli/password';

export interface SeedUserSpec {
  email: string;
  name: string;
}

export interface SeedOptions {
  users: SeedUserSpec[];
  workspaceSlug?: string;
  workspaceName?: string;
}

export interface SeededUser {
  email: string;
  userId: string;
  /** Generated password of a newly created account; null when the account already existed (left unchanged). */
  password: string | null;
}

export interface SeedResult {
  users: SeededUser[];
  workspace: { id: string; slug: string; created: boolean };
  counts: { companies: number; people: number; projects: number; deals: number; created: number };
  agenticDemo: { entityDefinitionId: string; entityInstanceId: string; agentTabSlug: string; reviewerEmail: string };
}

/** Default team accounts; override with SEED_USERS="email:Name,email:Name". */
export const DEFAULT_SEED_USERS: SeedUserSpec[] = [
  { email: 'ilya@mymeet.ai', name: 'Ilya' },
  { email: 'team@mymeet.ai', name: 'Team Mymeet' },
];

export function parseSeedUsers(raw: string | undefined): SeedUserSpec[] {
  if (!raw?.trim()) return DEFAULT_SEED_USERS;
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [email = '', ...name] = entry.split(':');
      const address = email.trim().toLowerCase();
      return { email: address, name: name.join(':').trim() || (address.split('@')[0] ?? address) };
    });
}

/** Stable id for a seeded resource of a workspace (RFC 9562 version 8, from SHA-256 of the key). */
export function seedId(workspaceId: string, key: string): string {
  const h = createHash('sha256').update(`agentic-crm-seed:${workspaceId}:${key}`).digest('hex');
  const variant = ((Number.parseInt(h[16] as string, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Research seed data

// biome-ignore format: table
const COMPANIES: [key: string, name: string, description: string][] = [
  ['northwind', 'Northwind Robotics', 'Industrial robots for warehouses'],
  ['bluefin', 'Bluefin Analytics', 'Product analytics for fintech'],
  ['cedar', 'Cedar Health', 'Clinic scheduling software'],
  ['orbit', 'Orbit Logistics', 'Last-mile delivery platform'],
  ['quartz', 'Quartz Studio', 'Design agency'],
  ['helios', 'Helios Energy', 'Solar installation marketplace'],
  ['pinecone-labs', 'Pinecone Labs', 'Developer tooling'],
  ['atlas-ventures', 'Atlas Ventures', 'Seed-stage VC fund'],
];

// biome-ignore format: table
const PEOPLE: [first: string, last: string, company: string, title: string][] = [
  ['Jane', 'Cooper', 'northwind', 'CEO'], ['Wade', 'Warren', 'northwind', 'Head of Operations'],
  ['Esther', 'Howard', 'bluefin', 'CTO'], ['Cameron', 'Williamson', 'bluefin', 'Data Engineer'],
  ['Brooklyn', 'Simmons', 'cedar', 'COO'], ['Leslie', 'Alexander', 'cedar', 'Product Manager'],
  ['Jenny', 'Wilson', 'orbit', 'VP Sales'], ['Guy', 'Hawkins', 'orbit', 'Founder'],
  ['Robert', 'Fox', 'quartz', 'Creative Director'], ['Jacob', 'Jones', 'helios', 'CFO'],
  ['Kristin', 'Watson', 'helios', 'Procurement Lead'], ['Cody', 'Fisher', 'pinecone-labs', 'Staff Engineer'],
  ['Savannah', 'Nguyen', 'pinecone-labs', 'Head of Developer Relations'], ['Ralph', 'Edwards', 'atlas-ventures', 'Partner'],
  ['Dianne', 'Russell', 'atlas-ventures', 'Associate'], ['Courtney', 'Henry', 'northwind', 'Engineering Manager'],
];

const PHASES = ['Discovery', 'Build', 'Review', 'Done'] as const;
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
const TAGS = ['AI', 'CRM', 'Data', 'Mobile', 'Infra'] as const;
const PHASE_COLORS = ['block_blue', 'block_yellow', 'block_purple', 'block_green'] as const;

interface ProjectSeed {
  code: string;
  summary: string;
  client: string;
  stakeholders: number[];
  phase: (typeof PHASES)[number];
  priority: (typeof PRIORITIES)[number];
  tags: (typeof TAGS)[number][];
  budget: number;
  headcount: number;
  strategic: boolean;
  health: number | null;
  start: string | null;
  city: string;
}

const P = (
  code: string,
  summary: string,
  client: string,
  stakeholders: number[],
  phase: ProjectSeed['phase'],
  priority: ProjectSeed['priority'],
  tags: ProjectSeed['tags'],
  budget: number,
  headcount: number,
  strategic: boolean,
  health: number | null,
  start: string | null,
  city: string,
): ProjectSeed => ({
  code,
  summary,
  client,
  stakeholders,
  phase,
  priority,
  tags,
  budget,
  headcount,
  strategic,
  health,
  start,
  city,
});

// biome-ignore format: table
const PROJECTS: ProjectSeed[] = [
  P('SEED-001', 'Warehouse picking automation', 'northwind', [0, 1], 'Build', 'High', ['AI', 'Infra'], 120000, 12, true, 4, '2026-07-01', 'London'),
  P('SEED-002', 'Fraud signal dashboard', 'bluefin', [2, 3], 'Discovery', 'Medium', ['Data'], 45000, 4, false, 3, '2026-09-15', 'Berlin'),
  P('SEED-003', 'Patient reminder SMS', 'cedar', [4], 'Review', 'Low', ['Mobile'], 18000, 2, false, 5, '2026-05-10', 'Paris'),
  P('SEED-004', 'Route optimisation v2', 'orbit', [6, 7], 'Build', 'Critical', ['AI', 'Data'], 250000, 20, true, 2, '2026-03-01', 'Amsterdam'),
  P('SEED-005', 'Brand refresh', 'quartz', [8], 'Done', 'Low', [], 9000, 3, false, 5, '2026-01-20', 'Lisbon'),
  P('SEED-006', 'Installer marketplace CRM', 'helios', [9, 10], 'Discovery', 'High', ['CRM'], 80000, 6, true, 3, '2026-10-01', 'Madrid'),
  P('SEED-007', 'SDK docs portal', 'pinecone-labs', [11, 12], 'Build', 'Medium', ['Infra'], 30000, 5, false, 4, '2026-08-01', 'Dublin'),
  P('SEED-008', 'Portfolio reporting', 'atlas-ventures', [13, 14], 'Review', 'Medium', ['Data', 'CRM'], 25000, 2, true, 4, '2026-06-12', 'Stockholm'),
  P('SEED-009', 'Robot fleet telemetry', 'northwind', [15], 'Discovery', 'Critical', ['Infra', 'Data'], 60000, 7, true, 1, '2026-11-01', 'London'),
  P('SEED-010', 'Analytics mobile app', 'bluefin', [3], 'Build', 'High', ['Mobile', 'Data'], 70000, 6, false, 3, '2026-04-04', 'Berlin'),
  P('SEED-011', 'Clinic onboarding flow', 'cedar', [5], 'Done', 'Medium', ['CRM'], 12000, 2, false, 4, '2025-12-01', 'Paris'),
  P('SEED-012', 'Courier app redesign', 'orbit', [6], 'Discovery', 'Low', ['Mobile'], 15000, 3, false, null, null, 'Amsterdam'),
];

// biome-ignore format: table
const DEALS: [key: string, name: string, stage: string, value: number, company: string, people: number[]][] = [
  ['northwind-expansion', 'Northwind warehouse expansion', 'In progress', 48000, 'northwind', [0, 15]],
  ['bluefin-pilot', 'Bluefin analytics pilot', 'Lead', 12000, 'bluefin', [2]],
  ['orbit-renewal', 'Orbit annual renewal', 'Won', 96000, 'orbit', [6, 7]],
  ['helios-marketplace', 'Helios marketplace rollout', 'In progress', 35000, 'helios', [9]],
  ['quartz-retainer', 'Quartz design retainer', 'Lost', 8000, 'quartz', [8]],
];

// ---------------------------------------------------------------------------------------------------------------

type AttrSpec = Omit<CreateAttributeInput, 'id' | 'entityDefinitionId'> & { apiSlug: string };

/** "Projects": one attribute per user-creatable type (15), as in the research seed plus domain and email. */
function projectAttributes(ids: (key: string) => string, companiesId: string, peopleId: string): AttrSpec[] {
  const opt = (kind: string, titles: readonly string[]) =>
    titles.map((title) => ({ id: ids(`projects.${kind}.${title}`), title }));
  return [
    { apiSlug: 'code', title: 'Code', type: 'text', isUnique: true },
    { apiSlug: 'summary', title: 'Summary', type: 'text' },
    {
      apiSlug: 'budget',
      title: 'Budget',
      type: 'currency',
      currencyConfiguration: {
        defaultCurrencyCode: 'EUR',
        defaultDisplayType: 'symbol',
        defaultDecimalPlaces: 'no-decimals',
        defaultGroups: 'default',
      },
    },
    { apiSlug: 'headcount', title: 'Headcount', type: 'number' },
    { apiSlug: 'strategic', title: 'Strategic', type: 'checkbox' },
    { apiSlug: 'start_date', title: 'Start date', type: 'date' },
    { apiSlug: 'kickoff_at', title: 'Kickoff at', type: 'timestamp' },
    { apiSlug: 'health', title: 'Health', type: 'rating' },
    {
      apiSlug: 'phase',
      title: 'Phase',
      type: 'pipeline',
      stages: PHASES.map((title, i) => ({
        id: ids(`projects.phase.${title}`),
        title,
        color: PHASE_COLORS[i],
        lifecyclePhase: title === 'Done' ? ('WON' as const) : ('ACTIVE' as const),
        celebrationEnabled: title === 'Done',
      })),
    },
    { apiSlug: 'priority', title: 'Priority', type: 'select', options: opt('priority', PRIORITIES) },
    { apiSlug: 'tags', title: 'Tags', type: 'select', isMultiselect: true, options: opt('tags', TAGS) },
    {
      apiSlug: 'client',
      title: 'Client',
      type: 'entity-reference',
      entityReferenceConfiguration: { allowedEntityDefinitionIds: [companiesId] },
    },
    {
      apiSlug: 'stakeholders',
      title: 'Stakeholders',
      type: 'entity-reference',
      isMultiselect: true,
      entityReferenceConfiguration: { allowedEntityDefinitionIds: [peopleId] },
    },
    { apiSlug: 'owner', title: 'Owner', type: 'actor-reference' },
    { apiSlug: 'contact_phone', title: 'Contact phone', type: 'phone-number' },
    { apiSlug: 'office', title: 'Office', type: 'location' },
    { apiSlug: 'website', title: 'Website', type: 'domain' },
    { apiSlug: 'contact_email', title: 'Contact email', type: 'email-address' },
  ];
}

async function ensureUsers(auth: Auth, specs: SeedUserSpec[]): Promise<SeededUser[]> {
  const ctx = await auth.$context;
  const out: SeededUser[] = [];
  for (const spec of specs) {
    const existing = await ctx.internalAdapter.findUserByEmail(spec.email);
    if (existing) {
      out.push({ email: spec.email, userId: existing.user.id, password: null });
      continue;
    }
    const password = generatePassword();
    const user = await ctx.internalAdapter.createUser(
      { email: spec.email, name: spec.name, emailVerified: true },
      { method: 'admin' },
    );
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: await ctx.password.hash(password),
    });
    out.push({ email: spec.email, userId: user.id, password });
  }
  return out;
}

const identityOf = (user: SeededUser, spec: SeedUserSpec) => {
  const [firstName = '', ...rest] = spec.name.split(/\s+/);
  return { userId: user.userId, emailAddress: user.email, firstName, lastName: rest.join(' ') };
};

export async function seedDemo(deps: { domain: Domain; auth: Auth }, options: SeedOptions): Promise<SeedResult> {
  const { domain, auth } = deps;
  const slug = options.workspaceSlug ?? 'mymeet';
  if (options.users.length === 0) throw new Error('at least one seed user is required');
  const users = await ensureUsers(auth, options.users);
  const [owner, ...others] = users as [SeededUser, ...SeededUser[]];
  const ownerSpec = options.users[0] as SeedUserSpec;

  // 1. Workspace: created by the first user, who must own it on re-runs.
  let created = false;
  let resolution = await domain.workspaces.resolveForUser(owner.userId, { slug });
  if (resolution.status === 'not-member') {
    throw new Error(`workspace "${slug}" exists and ${owner.email} is not an active member of it; refusing to seed`);
  }
  if (resolution.status === 'not-found') {
    await domain.workspaces.create(identityOf(owner, ownerSpec), { name: options.workspaceName ?? 'mymeet', slug });
    created = true;
    resolution = await domain.workspaces.resolveForUser(owner.userId, { slug });
  }
  if (resolution.status !== 'ok') throw new Error(`could not resolve workspace "${slug}"`);
  const workspaceId = resolution.workspace.id;
  const ownerMemberId = resolution.membership.id;
  const ctx: ServiceContext = memberContext(workspaceId, ownerMemberId);
  const ids = (key: string) => seedId(workspaceId, key);

  // 2. Teammates join as admins (invite + accept, as the UI does).
  for (const [i, user] of others.entries()) {
    const member = await domain.workspaces.resolveForUser(user.userId, { id: workspaceId });
    if (member.status === 'ok') continue;
    const pending = await domain.invites.listForEmail(user.email);
    if (!pending.some((p) => p.workspaceId === workspaceId)) {
      await domain.invites.create(ctx, { invites: [{ emailAddress: user.email, accessLevel: 'admin' }] });
    }
    await domain.invites.accept(identityOf(user, options.users[i + 1] as SeedUserSpec), { workspaceId });
  }

  let createdRecords = 0;
  const put = async (entityDefinitionId: string, key: string, values: ValuesMap) => {
    const result = await domain.records.create(ctx, { entityDefinitionId, entityInstanceId: ids(key), values });
    if (result.created) createdRecords += 1;
    return result.record.entityInstanceId;
  };

  // 3. Companies and people.
  const companies = await domain.schema.getObject(ctx, 'companies');
  const people = await domain.schema.getObject(ctx, 'people');
  const companyIds = new Map<string, string>();
  for (const [key, name, description] of COMPANIES) {
    companyIds.set(
      key,
      await put(companies.id, `company:${key}`, {
        name: [{ value: `[seed] ${name}` }],
        domains: [{ value: `${key}.example.com` }],
        description: [{ value: description }],
      }),
    );
  }
  const personIds: string[] = [];
  for (const [first, last, company, title] of PEOPLE) {
    const email = `${first}.${last}@${company}.example.com`.toLowerCase();
    personIds.push(
      await put(people.id, `person:${email}`, {
        name: [{ value: { firstName: `[seed] ${first}`, lastName: last, fullName: `[seed] ${first} ${last}` } }],
        email_addresses: [{ value: email }],
        job_title: [{ value: title }],
        company: [{ value: { entityInstanceId: companyIds.get(company) as string } }],
      }),
    );
  }

  // 4. Custom object "Projects" with 15 attribute types, 12 records and default views.
  const projects = await domain.schema.createObject(ctx, {
    id: ids('object:projects'),
    apiSlug: 'projects',
    singularNoun: 'Project',
    pluralNoun: 'Projects',
    icon: 'folder',
  });
  const attrs = new Map<string, AttributeDefinition>();
  for (const spec of projectAttributes(ids, companies.id, people.id)) {
    const attr = await domain.schema.createAttribute(ctx, {
      ...spec,
      id: ids(`projects.attr.${spec.apiSlug}`),
      entityDefinitionId: projects.id,
      description: '',
    });
    attrs.set(spec.apiSlug, attr);
  }
  for (const p of PROJECTS) {
    const values: ValuesMap = {
      code: [{ value: p.code }],
      summary: [{ value: p.summary }],
      budget: [{ value: { currencyValue: p.budget } }],
      headcount: [{ value: p.headcount }],
      strategic: [{ value: p.strategic }],
      phase: [{ value: { pipelineStageId: ids(`projects.phase.${p.phase}`) } }],
      priority: [{ value: { selectOptionId: ids(`projects.priority.${p.priority}`) } }],
      tags: p.tags.map((t) => ({ value: { selectOptionId: ids(`projects.tags.${t}`) } })),
      client: [{ value: { entityInstanceId: companyIds.get(p.client) as string } }],
      stakeholders: p.stakeholders.map((i) => ({ value: { entityInstanceId: personIds[i] as string } })),
      owner: [{ value: { referencedActorType: 'workspace-member', referencedActorId: ownerMemberId } }],
      contact_phone: [{ value: { originalPhoneNumber: '+442071234567', countryCode: 'GB' } }],
      office: [{ value: { locality: p.city } }],
      website: [{ value: `${p.client}.example.com` }],
      contact_email: [{ value: `projects@${p.client}.example.com` }],
      ...(p.health ? { health: [{ value: p.health }] } : {}),
      ...(p.start ? { start_date: [{ value: p.start }], kickoff_at: [{ value: `${p.start}T09:30:00.000Z` }] } : {}),
    };
    await put(projects.id, `project:${p.code}`, values);
  }
  const path = (slug: string) => [
    { entityDefinitionId: projects.id, attributeDefinitionId: (attrs.get(slug) as AttributeDefinition).id },
  ];
  const column = (slug: string, width?: number) => ({
    id: ids(`projects.view.column.${slug}`),
    path: path(slug),
    ...(width ? { tableColumnWidth: width } : {}),
  });
  await domain.views.create(ctx, {
    id: ids('projects.view.all'),
    entityDefinitionId: projects.id,
    type: 'table',
    title: 'All Projects',
    columns: ['code', 'phase', 'priority', 'client', 'budget', 'health', 'start_date', 'owner', 'tags'].map((s) =>
      column(s, s === 'client' ? 200 : undefined),
    ),
    sorts: [{ id: ids('projects.view.all.sort'), path: path('start_date'), direction: 'desc' }],
  });
  await domain.views.create(ctx, {
    id: ids('projects.view.board'),
    entityDefinitionId: projects.id,
    type: 'kanban',
    title: 'Projects by phase',
    kanbanPivotPath: path('phase'),
    columns: ['client', 'budget', 'owner'].map((s) => ({ ...column(s), id: ids(`projects.board.column.${s}`) })),
  });

  // 5. Deals: activate the standard object (seeds its attributes and default views once), then a few deals.
  const deals = await domain.schema.updateObject(ctx, { entityDefinitionId: 'deals', isArchived: false });
  const stages = await domain.schema.listStages(ctx, {
    entityDefinitionId: deals.id,
    attributeDefinitionId: 'stage',
    includeArchived: false,
  });
  for (const [key, name, stage, value, company, contacts] of DEALS) {
    const stageId = stages.find((s) => s.title === stage)?.id;
    if (!stageId) continue; // the stage was renamed or archived since the first run
    await put(deals.id, `deal:${key}`, {
      name: [{ value: `[seed] ${name}` }],
      stage: [{ value: { pipelineStageId: stageId } }],
      owner: [{ value: { referencedActorType: 'workspace-member', referencedActorId: ownerMemberId } }],
      value: [{ value: { currencyValue: value } }],
      associated_company: [{ value: { entityInstanceId: companyIds.get(company) as string } }],
      associated_people: contacts.map((i) => ({ value: { entityInstanceId: personIds[i] as string } })),
    });
  }

  // 6. Credential-free Agent-tab demo: a real note backs immutable evidence and one exact task proposal.
  // Stable ids make retries safe. If somebody edits or deletes the seeded note, later seed runs leave it alone.
  const demoRecord = {
    entityDefinitionId: companies.id,
    entityInstanceId: companyIds.get('northwind') as string,
  };
  const noteId = ids('agentic.follow-up.note');
  const evidenceId = ids('agentic.follow-up.evidence');
  const actionId = ids('agentic.follow-up.action');
  const taskId = ids('agentic.follow-up.crm-task');
  const queueTaskId = ids('agentic.follow-up.queue-task');
  const quote = 'Could you send over the rollout timeline by Friday?';
  let note = await domain.notes.get(ctx, noteId).catch((error: unknown) => {
    if (error instanceof DomainError && error.statusCode === 404) return null;
    throw error;
  });
  if (!note) {
    note = await domain.notes
      .create(
        ctx,
        { id: noteId, title: '[seed] Customer rollout request', parentRecords: [demoRecord] },
        { markdown: quote },
      )
      .catch((error: unknown) => {
        // A deleted seed note keeps ownership of its id. Never resurrect or overwrite it.
        if (error instanceof DomainError && error.code === 'ID_CONFLICT') return null;
        throw error;
      });
  }
  if (note?.content?.markdown === quote) {
    const evidence = await domain.agentic.evidence.capture(ctx, {
      id: evidenceId,
      scope: demoRecord,
      source: { kind: 'crm.note', id: note.id },
      band: 'VERIFIED',
      claim: 'The customer requested the rollout timeline by Friday.',
      fragment: { start: 0, end: quote.length, quote },
    });
    await domain.agentic.actions.propose(ctx, {
      id: actionId,
      scope: demoRecord,
      diff: {
        operation: 'create',
        task: {
          id: taskId,
          content: { text: 'Send the rollout timeline by Friday' },
          linkedRecords: [demoRecord],
        },
      },
      evidenceIds: [evidence.id],
      reviewerMemberId: ownerMemberId,
    });
    await domain.agentic.tasks.enqueue(systemContext(workspaceId), {
      id: queueTaskId,
      scope: demoRecord,
      moduleId: 'record-follow-up',
      taskType: 'record.follow_up',
      actionId,
      dueAt: '2099-01-01T00:00:00.000Z',
      reason: 'The proposed follow-up task is paused for the assigned reviewer.',
      nextEvent: 'Approval will create the exact CRM task and close this queue item.',
    });
  }

  const demoLayout = await domain.layouts.get(ctx, { entityDefinitionId: companies.id });
  const agentTabSlug = demoLayout.elements.find((item) => item.type === 'agent-tab')?.slug;
  if (!agentTabSlug) throw new Error('Agent demo layout has no Agent tab');

  return {
    users,
    workspace: { id: workspaceId, slug, created },
    counts: {
      companies: COMPANIES.length,
      people: PEOPLE.length,
      projects: PROJECTS.length,
      deals: DEALS.length,
      created: createdRecords,
    },
    agenticDemo: { ...demoRecord, agentTabSlug, reviewerEmail: owner.email },
  };
}
