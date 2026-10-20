// Shared fixtures of the slice-7 tests: a workspace whose admin (Ada) has a test mailbox at ourco.io, helpers to add
// members with mailboxes, inject messages / events through the test connector (synced at once), and read records.
import type { InjectEventInput, InjectMessageInput } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { memberContext, type ServiceContext } from '../src/index.ts';
import { addMember } from './collab-fixtures.ts';
import { createWorkspace, database, domain, newId, type TestWorkspace } from './support/harness.ts';

export interface Member {
  memberId: string;
  ctx: ServiceContext;
  mailboxId: string;
  address: string;
}

export interface EmailFixture extends TestWorkspace {
  ada: Member;
  people: string;
  companies: string;
  /** Unique business domain suffix of this workspace's tests (no clashes across test files). */
  tag: string;
}

let seq = 0;
const unique = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

export async function emailFixture(
  settings: { recordCreation?: 'all' | 'selective' | 'none'; autoCreateCompanies?: boolean } = {},
): Promise<EmailFixture> {
  const ws = await createWorkspace();
  const tag = unique();
  const address = `ada@ourco-${tag}.io`;
  const mailbox = await domain.mailboxes.connect(ws.ctx, { id: newId(), provider: 'test', emailAddress: address });
  if (Object.keys(settings).length > 0) await domain.workspaceEmail.settings.update(ws.ctx, settings);
  return {
    ...ws,
    tag,
    ada: { memberId: ws.memberId, ctx: ws.ctx, mailboxId: mailbox.id, address },
    people: (await domain.schema.getObject(ws.ctx, 'people')).id,
    companies: (await domain.schema.getObject(ws.ctx, 'companies')).id,
  };
}

/** Another member with a test mailbox at the workspace's domain. */
export async function memberWithMailbox(
  f: EmailFixture,
  name: string,
  visibility?: 'full-access' | 'subject-line' | 'metadata-only',
): Promise<Member> {
  const joined = await addMember(f, name);
  const ctx = memberContext(f.workspaceId, joined.memberId);
  const address = `${name.toLowerCase()}@ourco-${f.tag}.io`;
  const mailbox = await domain.mailboxes.connect(ctx, { id: newId(), provider: 'test', emailAddress: address });
  if (visibility) await domain.mailboxes.update(ctx, { mailboxId: mailbox.id, defaultVisibility: visibility });
  return { memberId: joined.memberId, ctx, mailboxId: mailbox.id, address };
}

/** A member without a mailbox. */
export async function plainMember(f: EmailFixture, name: string): Promise<{ memberId: string; ctx: ServiceContext }> {
  const joined = await addMember(f, name);
  return { memberId: joined.memberId, ctx: memberContext(f.workspaceId, joined.memberId) };
}

export async function injectMessage(m: Member, message: InjectMessageInput['message']) {
  return domain.connectors.test.injectMessage(m.ctx, { mailboxId: m.mailboxId, message, syncNow: true });
}

export async function injectEvent(m: Member, event: InjectEventInput['event']) {
  return domain.connectors.test.injectEvent(m.ctx, { mailboxId: m.mailboxId, event, syncNow: true });
}

/** Live record ids of an object holding a unique value (email address / domain). */
export async function recordsByValue(
  f: EmailFixture,
  object: 'people' | 'companies',
  value: string,
): Promise<string[]> {
  const attribute = object === 'people' ? 'email_addresses' : 'domains';
  const def = await domain.schema.getObject(f.ctx, object);
  const attrs = await domain.schema.listAttributes(f.ctx, { entityDefinitionId: def.id });
  const attr = attrs.find((a) => a.apiSlug === attribute);
  if (!attr) throw new Error('missing attribute');
  const { entityInstanceIds } = await domain.records.findByUniqueValues(f.ctx, {
    entityDefinitionId: def.id,
    attributeDefinitionId: attr.id,
    values: [{ value }],
  });
  return entityInstanceIds;
}

/** Current values of one attribute of a record (by api slug). */
export async function valuesOf(f: EmailFixture, object: string, recordId: string, slug: string) {
  const record = await domain.records.get(f.ctx, { entityDefinitionId: object, entityInstanceId: recordId });
  const def = await domain.schema.getObject(f.ctx, object);
  const attrs = await domain.schema.listAttributes(f.ctx, { entityDefinitionId: def.id });
  const attr = attrs.find((a) => a.apiSlug === slug);
  if (!attr) throw new Error(`no attribute ${slug}`);
  return record.values[attr.id] ?? [];
}

/** Count of live records of an object in the workspace. */
export async function recordCount(f: EmailFixture, object: string): Promise<number> {
  const def = await domain.schema.getObject(f.ctx, object);
  const { rows } = await sql<{ n: string }>`
    SELECT count(*)::text AS n FROM entity_instances
    WHERE entity_definition_id = ${def.id} AND archived_at IS NULL AND merged_at IS NULL`.execute(database.kysely);
  return Number(rows[0]?.n ?? 0);
}

export const iso = (offsetHours: number, base = Date.now()) => new Date(base + offsetHours * 3_600_000).toISOString();
