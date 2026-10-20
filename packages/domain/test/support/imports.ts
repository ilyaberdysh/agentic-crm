// Import/export test helpers: a domain whose job queue records what was enqueued (the worker is exercised in
// apps/worker), a "[seed] Projects"-like custom object, and a companies list made with lists.create.
import type { CreateAttributeInput } from '@agentic-crm/contracts';
import { createDomain, RecordingJobQueue, type ServiceContext } from '../../src/index.ts';
import { database, newId, storage, type TestWorkspace } from './harness.ts';

export const jobs = new RecordingJobQueue();
export const dt = createDomain({ database, storage, jobs });

export async function attr(
  ctx: ServiceContext,
  entityDefinitionId: string,
  input: Omit<CreateAttributeInput, 'id' | 'entityDefinitionId'>,
) {
  return dt.schema.createAttribute(ctx, { id: newId(), entityDefinitionId, ...input });
}

/** Projects: Name (required), Code (unique), Budget (EUR), Headcount, Active, Score (rating), Start (date), Kickoff
 * (timestamp), Status (Lead / Active / Won), Tags (multi-select Alpha / Beta), Owner (user), Office (location). */
export async function projectsFixture(ws: TestWorkspace, slug = 'projects') {
  const object = await dt.schema.createObject(ws.ctx, {
    id: newId(),
    apiSlug: slug,
    singularNoun: 'Project',
    pluralNoun: 'Projects',
  });
  const a = {
    name: await attr(ws.ctx, object.id, { title: 'Name', type: 'text', isRequired: true }),
    code: await attr(ws.ctx, object.id, { title: 'Code', type: 'text', isUnique: true }),
    budget: await attr(ws.ctx, object.id, {
      title: 'Budget',
      type: 'currency',
      currencyConfiguration: {
        defaultCurrencyCode: 'EUR',
        defaultDisplayType: 'symbol',
        defaultDecimalPlaces: 'two-decimals',
        defaultGroups: 'default',
      },
    }),
    headcount: await attr(ws.ctx, object.id, { title: 'Headcount', type: 'number' }),
    active: await attr(ws.ctx, object.id, { title: 'Active', type: 'checkbox' }),
    score: await attr(ws.ctx, object.id, { title: 'Score', type: 'rating' }),
    start: await attr(ws.ctx, object.id, { title: 'Start', type: 'date' }),
    kickoff: await attr(ws.ctx, object.id, { title: 'Kickoff', type: 'timestamp' }),
    status: await attr(ws.ctx, object.id, {
      title: 'Status',
      type: 'pipeline',
      stages: [{ title: 'Lead' }, { title: 'Active' }, { title: 'Won', lifecyclePhase: 'WON' }],
    }),
    tags: await attr(ws.ctx, object.id, {
      title: 'Tags',
      type: 'select',
      isMultiselect: true,
      options: [{ title: 'Alpha' }, { title: 'Beta' }],
    }),
    owner: await attr(ws.ctx, object.id, { title: 'Owner', type: 'actor-reference' }),
    office: await attr(ws.ctx, object.id, { title: 'Office', type: 'location' }),
  };
  return { object, a };
}

/** A list over companies (lists.create) with a Stage status (Lead / Qualified) and a Note text attribute. */
export async function listFixture(ws: TestWorkspace, name = 'Pipeline') {
  const { list } = await dt.lists.create(ws.ctx, { name, parentEntityDefinitionIds: ['companies'] });
  const attrs = await dt.schema.listAttributes(ws.ctx, { entityDefinitionId: list.id });
  const stage = await attr(ws.ctx, list.id, {
    title: 'Stage',
    type: 'pipeline',
    stages: [{ title: 'Lead' }, { title: 'Qualified' }],
  });
  const note = await attr(ws.ctx, list.id, { title: 'Note', type: 'text' });
  return {
    listId: list.id,
    companiesId: list.parentEntityDefinitionIds[0] as string,
    entryIdAttr: attrs.find((a) => a.apiSlug === 'entry_id')?.id as string,
    parentAttr: list.parentRecordAttributeId,
    stageAttr: stage.id,
    noteAttr: note.id,
  };
}

/** create → upload (in chunks of 2 rows) → draft. */
export async function startImport(
  ctx: ServiceContext,
  entityDefinitionId: string,
  headers: string[],
  rows: string[][],
  options: { timeZone?: string; fileName?: string } = {},
) {
  const created = await dt.imports.create(ctx, {
    entityDefinitionId,
    fileName: options.fileName ?? 'import.csv',
    columns: headers,
    rowCount: rows.length,
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  });
  for (let i = 0; i < rows.length; i += 2) {
    await dt.imports.uploadRows(ctx, {
      jobId: created.jobId,
      startRow: i,
      rows: rows.slice(i, i + 2),
      final: i + 2 >= rows.length,
    });
  }
  return created;
}

export const propertyFor = (status: { properties: { id: string; columnIndex: number }[] }, columnIndex: number) => {
  const p = status.properties.find((x) => x.columnIndex === columnIndex);
  if (!p) throw new Error(`column ${columnIndex} is not mapped`);
  return p.id;
};
