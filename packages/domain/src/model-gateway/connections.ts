import { type Database, sql } from '@agentic-crm/db';
import { z } from 'zod';
import type { ServiceContext } from '../context.ts';
import { badRequest, conflict, forbidden, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import { runInWorkspace, type Tx } from '../tx.ts';
import { type ProviderConnectionBinding, ProviderConnectionSecrets } from './connection-secrets.ts';

const apiKeySchema = z.string().regex(/^[\x21-\x7e]{1,8192}$/);
const idSchema = z.uuid().transform((id) => id.toLowerCase());
const createInputSchema = z.strictObject({
  id: idSchema,
  ownerKind: z.enum(['workspace', 'member']),
  provider: z.enum(['anthropic', 'openai']),
  apiKey: apiKeySchema,
});
const versionedInputSchema = z.strictObject({ id: idSchema, expectedVersion: z.number().int().positive() });
const rotateInputSchema = versionedInputSchema.extend({ apiKey: apiKeySchema });

export type CreateProviderConnectionInput = z.input<typeof createInputSchema>;
export type RotateProviderConnectionInput = z.input<typeof rotateInputSchema>;
export type DisableProviderConnectionInput = z.input<typeof versionedInputSchema>;

interface ConnectionRow {
  id: string;
  workspace_id: string;
  owner_kind: 'workspace' | 'member';
  owner_id: string;
  provider: 'anthropic' | 'openai';
  encrypted_credentials: unknown;
  enabled: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  rotated_at: string | null;
  disabled_at: string | null;
}

export interface ProviderConnectionMetadata {
  id: string;
  workspaceId: string;
  owner: { kind: 'workspace' | 'member'; id: string };
  provider: 'anthropic' | 'openai';
  adapterKind: 'anthropic-api' | 'openai-compatible';
  executionHost: 'cloud-worker';
  dataDestination: 'cloud';
  enabled: boolean;
  version: number;
  credential: { mask: '••••••••'; status: 'configured' | 'unreadable' | 'disabled' };
  /** No provider HTTP call or conformance claim is made by this storage service. */
  verification: 'unverified';
  createdAt: string;
  updatedAt: string;
  rotatedAt: string | null;
  disabledAt: string | null;
}

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  // Do not reflect rejected payloads, field values, provider messages, or Zod internals into secret-write errors.
  if (!result.success) throw badRequest('VALIDATION_ERROR', 'Invalid provider connection input');
  return result.data;
}

const bindingOf = (row: ConnectionRow): ProviderConnectionBinding => ({
  workspaceId: row.workspace_id,
  connectionId: row.id,
  ownerKind: row.owner_kind,
  ownerId: row.owner_id,
  provider: row.provider,
});

/** Only current authenticated humans manage credentials; tokens, agents, workflows, and system fallback deny. */
async function caller(tx: Tx) {
  if (tx.ctx.actor.type !== 'workspace-member') throw forbidden('Provider connections require a workspace member');
  const row = await tx.db
    .selectFrom('workspace_members')
    .select(['id', 'user_id', 'access_level'])
    .where('workspace_id', '=', tx.workspaceId)
    .where('id', '=', tx.ctx.actor.id)
    .where('removed_at', 'is', null)
    .forShare()
    .executeTakeFirst();
  if (!row || (row.access_level !== 'admin' && row.access_level !== 'member'))
    throw forbidden('Provider connections require an active workspace member');
  return row;
}

type Caller = Awaited<ReturnType<typeof caller>>;

function requireManage(row: ConnectionRow, actor: Caller) {
  if (row.owner_kind === 'workspace' && actor.access_level !== 'admin')
    throw forbidden('Only workspace admins can manage workspace provider connections');
  // Personal metadata is private even from another admin; match an absent connection.
  if (row.owner_kind === 'member' && row.owner_id !== actor.id) throw notFound('Provider connection not found');
}

async function load(tx: Tx, actor: Caller, id: string, lock = false): Promise<ConnectionRow> {
  const { rows } = await sql<ConnectionRow>`
    SELECT * FROM provider_connections
    WHERE workspace_id = ${tx.workspaceId}::uuid AND id = ${id}::uuid
      AND (owner_kind = 'workspace' OR (owner_kind = 'member' AND owner_id = ${actor.id}::uuid))
    ${lock ? sql`FOR UPDATE` : sql``}`.execute(tx.db);
  const row = rows[0];
  if (!row) throw notFound('Provider connection not found');
  return row;
}

function checkVersion(row: ConnectionRow, expected: number) {
  if (row.version !== expected) throw conflict('VERSION_CONFLICT', 'Provider connection version has changed');
}

async function changed(tx: Tx, actor: Caller, row: ConnectionRow, kind: 'created' | 'rotated' | 'disabled') {
  await sql`
    INSERT INTO provider_connection_events
      (id, workspace_id, connection_id, connection_version, kind, actor_member_id, created_at)
    VALUES (${newId()}::uuid, ${tx.workspaceId}::uuid, ${row.id}::uuid, ${row.version}, ${kind},
      ${actor.id}::uuid, ${tx.now}::timestamptz)`.execute(tx.db);
  // Existing AI-settings channel; personal invalidations carry only identity and target the owner's auth user.
  tx.emit(
    'ai-settings',
    null,
    { scope: 'provider-connections', ...(row.owner_kind === 'member' ? { memberId: actor.id } : {}) },
    row.owner_kind === 'member' ? { userIds: [actor.user_id] } : null,
  );
}

/** API-key storage only. No reveal, credential resolver, routing, provider I/O, endpoint, or runner support. */
export function createProviderConnections(options: { database: Database; encryptionKey: Buffer }) {
  const secrets = new ProviderConnectionSecrets(options.encryptionKey);
  function metadata(row: ConnectionRow): ProviderConnectionMetadata {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      owner: { kind: row.owner_kind, id: row.owner_id },
      provider: row.provider,
      adapterKind: row.provider === 'anthropic' ? 'anthropic-api' : 'openai-compatible',
      executionHost: 'cloud-worker',
      dataDestination: 'cloud',
      enabled: row.enabled,
      version: row.version,
      credential: {
        mask: '••••••••',
        status: !row.enabled
          ? 'disabled'
          : secrets.isReadable(row.encrypted_credentials, bindingOf(row))
            ? 'configured'
            : 'unreadable',
      },
      verification: 'unverified',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      rotatedAt: row.rotated_at,
      disabledAt: row.disabled_at,
    };
  }

  return {
    async create(ctx: ServiceContext, input: CreateProviderConnectionInput): Promise<ProviderConnectionMetadata> {
      const data = parse(createInputSchema, input);
      return runInWorkspace(options.database, ctx, async (tx) => {
        const actor = await caller(tx);
        if (data.ownerKind === 'workspace' && actor.access_level !== 'admin')
          throw forbidden('Only workspace admins can manage workspace provider connections');
        const binding: ProviderConnectionBinding = {
          workspaceId: tx.workspaceId,
          connectionId: data.id,
          ownerKind: data.ownerKind,
          ownerId: data.ownerKind === 'workspace' ? tx.workspaceId : actor.id,
          provider: data.provider,
        };
        const sealed = secrets.seal(data.apiKey, binding);
        const { rows } = await sql<ConnectionRow>`
          INSERT INTO provider_connections
            (id, workspace_id, owner_kind, owner_id, provider, encrypted_credentials, created_by_member_id,
             created_at, updated_at)
          VALUES (${data.id}::uuid, ${tx.workspaceId}::uuid, ${data.ownerKind}, ${binding.ownerId}::uuid,
            ${data.provider}, ${JSON.stringify(sealed)}::jsonb, ${actor.id}::uuid,
            ${tx.now}::timestamptz, ${tx.now}::timestamptz)
          ON CONFLICT (id) DO NOTHING RETURNING *`.execute(tx.db);
        const row = rows[0];
        if (row) {
          await changed(tx, actor, row, 'created');
          return metadata(row);
        }
        const existing = await load(tx, actor, data.id);
        requireManage(existing, actor);
        if (
          existing.owner_kind !== binding.ownerKind ||
          existing.owner_id !== binding.ownerId ||
          existing.provider !== binding.provider
        )
          throw conflict('ID_CONFLICT', 'Provider connection identity differs');
        // Replay never changes a credential. Call rotate with the current version to replace a key.
        return metadata(existing);
      });
    },

    async get(ctx: ServiceContext, id: string): Promise<ProviderConnectionMetadata> {
      const connectionId = parse(idSchema, id);
      return runInWorkspace(options.database, ctx, async (tx) =>
        metadata(await load(tx, await caller(tx), connectionId)),
      );
    },

    async list(ctx: ServiceContext): Promise<ProviderConnectionMetadata[]> {
      return runInWorkspace(options.database, ctx, async (tx) => {
        const actor = await caller(tx);
        const { rows } = await sql<ConnectionRow>`
          SELECT * FROM provider_connections WHERE workspace_id = ${tx.workspaceId}::uuid
            AND (owner_kind = 'workspace' OR (owner_kind = 'member' AND owner_id = ${actor.id}::uuid))
          ORDER BY created_at, id`.execute(tx.db);
        return rows.map(metadata);
      });
    },

    async rotate(ctx: ServiceContext, input: RotateProviderConnectionInput): Promise<ProviderConnectionMetadata> {
      const data = parse(rotateInputSchema, input);
      return runInWorkspace(options.database, ctx, async (tx) => {
        const actor = await caller(tx);
        const row = await load(tx, actor, data.id, true);
        requireManage(row, actor);
        checkVersion(row, data.expectedVersion);
        const sealed = secrets.seal(data.apiKey, bindingOf(row));
        const { rows } = await sql<ConnectionRow>`
          UPDATE provider_connections SET encrypted_credentials = ${JSON.stringify(sealed)}::jsonb,
            version = version + 1, updated_at = ${tx.now}::timestamptz, rotated_at = ${tx.now}::timestamptz
          WHERE workspace_id = ${tx.workspaceId}::uuid AND id = ${row.id}::uuid RETURNING *`.execute(tx.db);
        const updated = rows[0];
        if (!updated) throw notFound('Provider connection not found');
        await changed(tx, actor, updated, 'rotated');
        return metadata(updated);
      });
    },

    async disable(ctx: ServiceContext, input: DisableProviderConnectionInput): Promise<ProviderConnectionMetadata> {
      const data = parse(versionedInputSchema, input);
      return runInWorkspace(options.database, ctx, async (tx) => {
        const actor = await caller(tx);
        const row = await load(tx, actor, data.id, true);
        requireManage(row, actor);
        checkVersion(row, data.expectedVersion);
        if (!row.enabled) return metadata(row);
        const { rows } = await sql<ConnectionRow>`
          UPDATE provider_connections SET enabled = false, version = version + 1,
            updated_at = ${tx.now}::timestamptz, disabled_at = ${tx.now}::timestamptz
          WHERE workspace_id = ${tx.workspaceId}::uuid AND id = ${row.id}::uuid RETURNING *`.execute(tx.db);
        const updated = rows[0];
        if (!updated) throw notFound('Provider connection not found');
        await changed(tx, actor, updated, 'disabled');
        return metadata(updated);
      });
    },
  };
}

export type ProviderConnections = ReturnType<typeof createProviderConnections>;
