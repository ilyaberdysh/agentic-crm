// Shared fixtures of the slice-3 domain tests: a workspace with a company and a person, raw document access and
// change_log inspection.
import { sql } from '@agentic-crm/db';
import { blocksToState, markdownToBlocks } from '@agentic-crm/editor/model';
import { memberContext } from '../src/index.ts';
import { insertAttributeDefinitions, insertEntityDefinition } from '../src/schema/service.ts';
import { runInWorkspace } from '../src/tx.ts';
import { createUser, createWorkspace, database, domain, newId, type TestWorkspace } from './support/harness.ts';

export interface CollabFixture extends TestWorkspace {
  companies: string;
  people: string;
  company: string;
  person: string;
  record: { entityDefinitionId: string; entityInstanceId: string };
}

export async function collabFixture(): Promise<CollabFixture> {
  const ws = await createWorkspace();
  const companies = (await domain.schema.getObject(ws.ctx, 'companies')).id;
  const people = (await domain.schema.getObject(ws.ctx, 'people')).id;
  const company = await createRecord(ws, 'companies', { name: [{ value: 'Acme' }] });
  const person = await createRecord(ws, 'people', { name: [{ value: { firstName: 'Jane', lastName: 'Cooper' } }] });
  return {
    ...ws,
    companies,
    people,
    company,
    person,
    record: { entityDefinitionId: companies, entityInstanceId: company },
  };
}

export async function createRecord(
  ws: TestWorkspace,
  object: string,
  values: Record<string, { value: unknown }[]> = {},
): Promise<string> {
  const id = newId();
  await domain.records.create(ws.ctx, { entityDefinitionId: object, entityInstanceId: id, values });
  return id;
}

export async function documentRow(id: string) {
  const { rows } = await sql<{
    id: string;
    workspace_id: string;
    doc_type: string;
    parent_ref: string | null;
    markdown: string | null;
    blocks: unknown;
    yjs_state: Buffer | null;
  }>`SELECT id, workspace_id, doc_type, parent_ref, markdown, blocks, yjs_state FROM documents WHERE id = ${id}`.execute(
    database.kysely,
  );
  return rows[0];
}

/** Acts as the collab server persisting a document (Yjs state + projections). */
/** Writes a body as the collab server would: a real Yjs state (editor model) plus projections. */
export async function storeDocument(id: string, content: { markdown: string; blocks?: unknown[] }) {
  const blocks = markdownToBlocks(content.markdown);
  await sql`UPDATE documents SET yjs_state = ${Buffer.from(blocksToState(blocks))}, markdown = ${content.markdown},
    blocks = ${JSON.stringify(content.blocks ?? blocks)}::jsonb,
    version = version + 1, updated_at = now() WHERE id = ${id}`.execute(database.kysely);
}

export async function changeRows(workspaceId: string, sinceId = '0') {
  const { rows } = await sql<{
    id: string;
    resource: string;
    resource_id: string | null;
    scope: Record<string, unknown>;
    audience: unknown;
  }>`
    SELECT id::text, resource, resource_id::text, scope, audience FROM change_log
    WHERE workspace_id = ${workspaceId} AND id > ${sinceId}::bigint ORDER BY id`.execute(database.kysely);
  return rows;
}

/** A list of `parentDefinitionId` records with a text attribute `stage_note` (slice-4 lists service). */
export async function createList(ws: TestWorkspace, parentDefinitionId: string) {
  const { list } = await domain.lists.create(ws.ctx, {
    name: `Pipeline ${newId().slice(-6)}`,
    parentEntityDefinitionIds: [parentDefinitionId],
  });
  await domain.schema.createAttribute(ws.ctx, {
    id: newId(),
    entityDefinitionId: list.id,
    apiSlug: 'stage_note',
    title: 'Stage note',
    type: 'text',
  });
  const listId = list.id;
  return {
    listId,
    async addEntry(recordId: string): Promise<string> {
      const { entries } = await domain.entries.add(ws.ctx, {
        listId,
        parentRecords: [{ entityDefinitionId: parentDefinitionId, entityInstanceId: recordId }],
        onDuplicate: 'keep',
      });
      return (entries[0] as { id: string }).id;
    },
  };
}

/** A second member of the workspace (invite + accept); returns their context. */
export async function addMember(ws: TestWorkspace, firstName = 'Grace') {
  const user = await createUser(firstName, 'Hopper');
  await domain.invites.create(ws.ctx, { invites: [{ emailAddress: user.emailAddress }] });
  const joined = await domain.invites.accept(user, { workspaceId: ws.workspaceId });
  return {
    memberId: joined.membership.id,
    userId: user.userId,
    ctx: memberContext(ws.workspaceId, joined.membership.id),
  };
}

export async function lastChangeId(workspaceId: string): Promise<string> {
  const { rows } = await sql<{ id: string | null }>`
    SELECT max(id)::text AS id FROM change_log WHERE workspace_id = ${workspaceId}`.execute(database.kysely);
  return rows[0]?.id ?? '0';
}
