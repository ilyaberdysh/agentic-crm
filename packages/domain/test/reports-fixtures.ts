// Slice-9 fixtures: a "Deals" object with every attribute kind reports group or aggregate by, records written through
// the domain, and helpers that rewrite value history / creation times with SQL so as-of, funnel and time-in-stage
// numbers can be computed by hand (the write path always stamps `now`).
import type { DatasetInput, DatasetOutputFor, Path } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { createRecord } from './collab-fixtures.ts';
import { createWorkspace, database, domain, newId, type TestWorkspace } from './support/harness.ts';

export interface DealsFixture extends TestWorkspace {
  companies: string;
  deals: string;
  attrs: Record<
    | 'name'
    | 'stage'
    | 'amount'
    | 'priority'
    | 'tags'
    | 'close'
    | 'signed'
    | 'owner'
    | 'rating'
    | 'score'
    | 'active'
    | 'company',
    string
  >;
  stages: { lead: string; qualified: string; proposal: string; won: string; lost: string };
  options: { high: string; low: string; alpha: string; beta: string };
  path(attr: keyof DealsFixture['attrs']): Path;
  companyName(): Promise<Path>;
}

export async function dealsFixture(): Promise<DealsFixture> {
  const ws = await createWorkspace();
  const companies = (await domain.schema.getObject(ws.ctx, 'companies')).id;
  const object = await domain.schema.createObject(ws.ctx, {
    id: newId(),
    apiSlug: `deals_${Math.random().toString(36).slice(2, 8)}`,
    singularNoun: 'Deal',
    pluralNoun: 'Deals',
  });
  const deals = object.id;
  const create = (input: Record<string, unknown>) =>
    domain.schema.createAttribute(ws.ctx, { id: newId(), entityDefinitionId: deals, ...input } as never);
  const name = await create({ title: 'Name', type: 'text' });
  const stage = await create({
    title: 'Stage',
    type: 'pipeline',
    stages: [{ title: 'Lead' }, { title: 'Qualified' }, { title: 'Proposal' }, { title: 'Won' }, { title: 'Lost' }],
  });
  const amount = await create({
    title: 'Amount',
    type: 'currency',
    currencyConfiguration: {
      defaultCurrencyCode: 'EUR',
      defaultDisplayType: 'symbol',
      defaultDecimalPlaces: 'two-decimals',
      defaultGroups: 'default',
    },
  });
  const priority = await create({ title: 'Priority', type: 'select', options: [{ title: 'High' }, { title: 'Low' }] });
  const tags = await create({
    title: 'Tags',
    type: 'select',
    isMultiselect: true,
    options: [{ title: 'Alpha' }, { title: 'Beta' }],
  });
  const close = await create({ title: 'Close date', type: 'date' });
  const signed = await create({ title: 'Signed at', type: 'timestamp' });
  const owner = await create({ title: 'Owner', type: 'actor-reference' });
  const rating = await create({ title: 'Rating', type: 'rating' });
  const score = await create({ title: 'Score', type: 'number' });
  const active = await create({ title: 'Active', type: 'checkbox' });
  const company = await create({
    title: 'Company',
    type: 'entity-reference',
    entityReferenceConfiguration: { allowedEntityDefinitionIds: [companies] },
  });
  const stageRows = await domain.schema.listStages(ws.ctx, {
    entityDefinitionId: deals,
    attributeDefinitionId: stage.id,
  });
  const [lead, qualified, proposal, won, lost] = stageRows.map((s) => s.id) as [string, string, string, string, string];
  const prio = await domain.schema.listOptions(ws.ctx, {
    entityDefinitionId: deals,
    attributeDefinitionId: priority.id,
  });
  const tagRows = await domain.schema.listOptions(ws.ctx, {
    entityDefinitionId: deals,
    attributeDefinitionId: tags.id,
  });
  const attrs = {
    name: name.id,
    stage: stage.id,
    amount: amount.id,
    priority: priority.id,
    tags: tags.id,
    close: close.id,
    signed: signed.id,
    owner: owner.id,
    rating: rating.id,
    score: score.id,
    active: active.id,
    company: company.id,
  };
  const companyNameAttr = (await domain.schema.getAttribute(ws.ctx, 'companies', 'name')).id;
  return {
    ...ws,
    companies,
    deals,
    attrs,
    stages: { lead, qualified, proposal, won, lost },
    options: {
      high: prio[0]?.id as string,
      low: prio[1]?.id as string,
      alpha: tagRows[0]?.id as string,
      beta: tagRows[1]?.id as string,
    },
    path: (a) => [{ entityDefinitionId: deals, attributeDefinitionId: attrs[a] }],
    companyName: async () => [
      { entityDefinitionId: deals, attributeDefinitionId: company.id },
      { entityDefinitionId: companies, attributeDefinitionId: companyNameAttr },
    ],
  };
}

export interface DealSpec {
  name: string;
  stage?: string;
  amount?: number;
  priority?: string;
  tags?: string[];
  close?: string;
  signed?: string;
  owner?: string;
  rating?: number;
  score?: number;
  active?: boolean;
  company?: string;
}

export async function createDeal(f: DealsFixture, d: DealSpec): Promise<string> {
  const values: Record<string, { value: unknown }[]> = { [f.attrs.name]: [{ value: d.name }] };
  const put = (attr: keyof DealsFixture['attrs'], value: unknown) => {
    values[f.attrs[attr]] = [{ value }];
  };
  if (d.stage) put('stage', { pipelineStageId: d.stage });
  if (d.amount !== undefined) put('amount', { currencyValue: d.amount });
  if (d.priority) put('priority', { selectOptionId: d.priority });
  if (d.tags) values[f.attrs.tags] = d.tags.map((t) => ({ value: { selectOptionId: t } }));
  if (d.close) put('close', d.close);
  if (d.signed) put('signed', d.signed);
  if (d.owner) put('owner', { referencedActorType: 'workspace-member', referencedActorId: d.owner });
  if (d.rating !== undefined) put('rating', d.rating);
  if (d.score !== undefined) put('score', d.score);
  if (d.active !== undefined) put('active', d.active);
  if (d.company) put('company', { entityDefinitionId: f.companies, entityInstanceId: d.company });
  return createRecord(f, f.deals, values);
}

export interface HistoryValue {
  ref?: string;
  num?: number;
  from: string;
  until?: string | null;
}

/** Replaces the whole value history of one attribute of one record (rows inserted as given, I6 shape). */
export async function setHistory(
  f: DealsFixture,
  instanceId: string,
  attr: keyof DealsFixture['attrs'],
  values: HistoryValue[],
): Promise<void> {
  const attributeId = f.attrs[attr];
  await sql`DELETE FROM attribute_values WHERE instance_id = ${instanceId}::uuid AND attribute_id = ${attributeId}::uuid`.execute(
    database.kysely,
  );
  for (const v of values) {
    await sql`
      INSERT INTO attribute_values (id, workspace_id, entity_definition_id, instance_id, attribute_id, active_from,
        active_until, created_by_type, v_ref, v_num, sort_order)
      VALUES (${newId()}::uuid, ${f.workspaceId}::uuid, ${f.deals}::uuid, ${instanceId}::uuid, ${attributeId}::uuid,
        ${v.from}::timestamptz, ${v.until ?? null}::timestamptz, 3, ${v.ref ?? null}::uuid, ${v.num ?? null}::numeric, 'n')`.execute(
      database.kysely,
    );
  }
}

/** Moves a record's creation time (as-of reports count records from the bucket they were created in). */
export async function setCreatedAt(instanceId: string, iso: string): Promise<void> {
  await sql`UPDATE entity_instances SET created_at = ${iso}::timestamptz WHERE id = ${instanceId}::uuid`.execute(
    database.kysely,
  );
}

/** Recomputes the projection after SQL history edits. */
export async function rebuild(f: DealsFixture): Promise<void> {
  await domain.schema.rebuildProjection(f.ctx, f.deals);
}

type WithoutDefinition<T> = T extends unknown ? Omit<T, 'entityDefinitionId'> & { entityDefinitionId?: string } : never;

/** reporting.dataset on the Deals object (unless another source is named), typed by the query type. */
export async function dataset<T extends WithoutDefinition<DatasetInput>>(
  f: DealsFixture,
  input: T,
): Promise<DatasetOutputFor<T['type']>> {
  const out = await domain.reporting.dataset(f.ctx, { entityDefinitionId: f.deals, ...input } as DatasetInput);
  return out as DatasetOutputFor<T['type']>;
}

/** Pivot rows as `{ "<group>|<segment>": value }` for compact assertions. */
export function byKey(rows: { group: string | null; segment: string | null; value: number | null }[]) {
  return Object.fromEntries(rows.map((r) => [`${r.group ?? '∅'}|${r.segment ?? '∅'}`, r.value]));
}
