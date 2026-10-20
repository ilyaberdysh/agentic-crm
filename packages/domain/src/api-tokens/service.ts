// Workspace API tokens for the public REST API (BACKLOG 1.12; J workspace-admin §6; Attio docs authentication guide).
// Admins create, rename/re-scope and revoke tokens; the secret is returned once and only its SHA-256 is stored.
// authenticate() resolves a presented secret to its token and workspace before any workspace context exists, so it
// runs as the owner role (cross-tenant by nature, like the workspace picker).
import { createHash, randomBytes } from 'node:crypto';
import {
  type ApiToken,
  type ApiTokenIdentity,
  type CreateApiTokenInput,
  type CreatedApiToken,
  createApiTokenInputSchema,
  type UpdateApiTokenInput,
  updateApiTokenInputSchema,
} from '@agentic-crm/contracts';
import { type ApiTokensTable, type Database, type Selectable, sql } from '@agentic-crm/db';
import { badRequest, forbidden, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import { runAsOwner, type Tx } from '../tx.ts';

type TokenRow = Selectable<ApiTokensTable>;

const PREFIX_LENGTH = 8;
/** last_used_at is refreshed at most this often, so authenticated requests do not each write a row. */
const LAST_USED_GRANULARITY = '1 minute';

export function hashApiToken(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

function toApiToken(r: TokenRow): ApiToken {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    scopes: r.scopes as ApiToken['scopes'],
    tokenLevel: r.token_level,
    tokenPrefix: r.token_prefix,
    authorizedByMemberId: r.authorized_by_member_id,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at,
  };
}

/** Token administration is for admins; system callers (CLI, seed) are trusted; other tokens may not mint tokens. */
async function requireTokenAdmin(tx: Tx): Promise<string | null> {
  const actor = tx.ctx.actor;
  if (actor.type === 'system') return null;
  if (actor.type !== 'workspace-member') throw forbidden('Only workspace admins can manage access tokens');
  const row = await tx.db
    .selectFrom('workspace_members')
    .select('access_level')
    .where('id', '=', actor.id as string)
    .executeTakeFirst();
  if (row?.access_level !== 'admin') throw forbidden('Only workspace admins can manage access tokens');
  return actor.id;
}

async function loadToken(tx: Tx, tokenId: string): Promise<TokenRow> {
  const row = await tx.db.selectFrom('api_tokens').selectAll().where('id', '=', tokenId).executeTakeFirst();
  if (!row) throw notFound('The requested access token could not be found', { api_token_id: tokenId });
  return row;
}

export const apiTokenOps = {
  /** Creates a workspace-level token; the returned `token` is the only time the secret is visible. */
  async create(tx: Tx, input: CreateApiTokenInput): Promise<CreatedApiToken> {
    const data = createApiTokenInputSchema.parse(input);
    const memberId = await requireTokenAdmin(tx);
    let authorizedBy = memberId;
    if (memberId === null && data.authorizedByMemberId) {
      const member = await tx.db
        .selectFrom('workspace_members')
        .select('id')
        .where('id', '=', data.authorizedByMemberId)
        .executeTakeFirst();
      if (!member)
        throw badRequest('VALIDATION_ERROR', 'Unknown workspace member', { member_id: data.authorizedByMemberId });
      authorizedBy = member.id;
    }
    const tokenLevel = data.tokenLevel ?? 'workspace';
    if (tokenLevel === 'user' && (memberId !== null || !authorizedBy)) {
      throw badRequest('VALIDATION_ERROR', 'User-level tokens are minted by the system for a member', {
        token_level: tokenLevel,
      });
    }
    const secret = randomBytes(32).toString('hex');
    const id = data.id ?? newId();
    await tx.db
      .insertInto('api_tokens')
      .values({
        id,
        workspace_id: tx.workspaceId,
        name: data.name,
        token_hash: hashApiToken(secret),
        token_prefix: secret.slice(0, PREFIX_LENGTH),
        scopes: data.scopes,
        token_level: tokenLevel,
        authorized_by_member_id: authorizedBy,
        created_at: tx.now,
        updated_at: tx.now,
      })
      .execute();
    tx.emit('api-token-list', null);
    return { ...toApiToken(await loadToken(tx, id)), token: secret };
  },

  /** Active (non-revoked) tokens, oldest first. */
  async list(tx: Tx): Promise<ApiToken[]> {
    await requireTokenAdmin(tx);
    const rows = await tx.db
      .selectFrom('api_tokens')
      .selectAll()
      .where('revoked_at', 'is', null)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows.map(toApiToken);
  },

  /** "Edit access token": name and scopes can change on existing tokens. */
  async update(tx: Tx, input: UpdateApiTokenInput): Promise<ApiToken> {
    const data = updateApiTokenInputSchema.parse(input);
    await requireTokenAdmin(tx);
    const row = await loadToken(tx, data.tokenId);
    if (row.revoked_at !== null) throw notFound('The requested access token could not be found');
    await tx.db
      .updateTable('api_tokens')
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.scopes !== undefined ? { scopes: data.scopes } : {}),
        updated_at: tx.now,
      })
      .where('id', '=', row.id)
      .execute();
    tx.emit('api-token-list', null);
    return toApiToken(await loadToken(tx, row.id));
  },

  /** "Delete access token": revokes it (idempotent). Revoked tokens answer `{active: false}` on /v2/self. */
  async revoke(tx: Tx, tokenId: string): Promise<ApiToken> {
    await requireTokenAdmin(tx);
    const row = await loadToken(tx, tokenId);
    if (row.revoked_at === null) {
      await tx.db
        .updateTable('api_tokens')
        .set({ revoked_at: tx.now, updated_at: tx.now })
        .where('id', '=', row.id)
        .execute();
      tx.emit('api-token-list', null);
    }
    return toApiToken(await loadToken(tx, row.id));
  },

  /** Resolves a presented secret to its active token and workspace; null for unknown or revoked secrets. */
  async authenticate(database: Database, secret: string): Promise<ApiTokenIdentity | null> {
    if (secret.length === 0 || secret.length > 512) return null;
    const hash = hashApiToken(secret);
    return runAsOwner(database, async (trx) => {
      const row = await trx
        .selectFrom('api_tokens as t')
        .innerJoin('workspaces as w', 'w.id', 't.workspace_id')
        .selectAll('t')
        .select(['w.slug as w_slug', 'w.name as w_name', 'w.logo_url as w_logo_url'])
        .where('t.token_hash', '=', hash)
        .where('t.revoked_at', 'is', null)
        .executeTakeFirst();
      if (!row) return null;
      await trx
        .updateTable('api_tokens')
        .set({ last_used_at: sql<string>`now()` })
        .where('id', '=', row.id)
        .where((eb) =>
          eb.or([
            eb('last_used_at', 'is', null),
            eb('last_used_at', '<', sql<string>`now() - ${LAST_USED_GRANULARITY}::interval`),
          ]),
        )
        .execute();
      return {
        token: toApiToken(row),
        workspace: { id: row.workspace_id, slug: row.w_slug, name: row.w_name, logoUrl: row.w_logo_url },
      };
    });
  },
};
