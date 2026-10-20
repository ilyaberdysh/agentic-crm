import { createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { sql } from '@agentic-crm/db';
import { describe, expect, it } from 'vitest';
import { type SealedValue, SecretBox } from '../src/connectors/google/crypto.ts';
import { memberContext, type ServiceContext } from '../src/context.ts';
import { DomainError, toErrorEnvelope } from '../src/errors.ts';
import { ProviderConnectionSecrets } from '../src/model-gateway/connection-secrets.ts';
import { createProviderConnections } from '../src/model-gateway/connections.ts';
import { runInWorkspace } from '../src/tx.ts';
import { addMember, changeRows, lastChangeId } from './collab-fixtures.ts';
import { createWorkspace, database, expectCode, newId } from './support/harness.ts';

const KEY_A = 'provider-test-w3-original-secret-1234567890';
const KEY_B = 'provider-test-w3-rotated-secret-0987654321';

function world() {
  const master = randomBytes(32);
  return { master, connections: createProviderConnections({ database, encryptionKey: master }) };
}

async function stored(id: string) {
  const { rows } = await sql<{
    id: string;
    workspace_id: string;
    owner_kind: 'workspace' | 'member';
    owner_id: string;
    provider: 'anthropic' | 'openai';
    encrypted_credentials: unknown;
    version: number;
  }>`SELECT * FROM provider_connections WHERE id = ${id}::uuid`.execute(database.kysely);
  const row = rows[0];
  if (!row) throw new Error('Missing test connection');
  return row;
}

async function replaceCiphertext(id: string, sealed: unknown) {
  await sql`UPDATE provider_connections SET encrypted_credentials = ${JSON.stringify(sealed)}::jsonb
    WHERE id = ${id}::uuid`.execute(database.kysely);
}

/** Independent format check using synthetic test keys only; the service has no plaintext-returning API. */
async function persistedKeyForTest(id: string, master: Buffer): Promise<unknown> {
  const row = await stored(id);
  const sealed = row.encrypted_credentials as SealedValue;
  const key = Buffer.from(hkdfSync('sha256', master, 'agentic-crm', 'provider-connection-credentials-v1', 32));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64url'));
  decipher.setAAD(
    Buffer.from(
      JSON.stringify([
        'agentic-crm:provider-connection:v1',
        row.workspace_id,
        row.id,
        row.owner_kind,
        row.owner_id,
        row.provider,
      ]),
    ),
  );
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64url'));
  return JSON.parse(
    Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64url')), decipher.final()]).toString('utf8'),
  );
}

describe('provider connection storage and authorization (real PostgreSQL)', () => {
  it('stores encrypted keys and returns only fixed masked metadata, with an atomic private audit/invalidation', async () => {
    const w = world();
    const ws = await createWorkspace();
    const before = await lastChangeId(ws.workspaceId);
    const id = newId();
    const created = await w.connections.create(ws.ctx, {
      id,
      ownerKind: 'member',
      provider: 'anthropic',
      apiKey: KEY_A,
    });
    expect(created).toMatchObject({
      id,
      owner: { kind: 'member', id: ws.memberId },
      provider: 'anthropic',
      adapterKind: 'anthropic-api',
      executionHost: 'cloud-worker',
      dataDestination: 'cloud',
      credential: { mask: '••••••••', status: 'configured' },
      verification: 'unverified',
      version: 1,
      enabled: true,
    });
    expect(await w.connections.get(ws.ctx, id)).toEqual(created);
    expect(await w.connections.list(ws.ctx)).toEqual([created]);
    const row = await stored(id);
    expect(row.encrypted_credentials).toMatchObject({ v: 1, alg: 'A256GCM' });
    expect(await persistedKeyForTest(id, w.master)).toEqual({ apiKey: KEY_A });
    expect(JSON.stringify(row)).not.toContain(KEY_A);
    for (const response of [created, await w.connections.get(ws.ctx, id), await w.connections.list(ws.ctx)]) {
      const text = JSON.stringify(response);
      expect(text).not.toContain(KEY_A);
      expect(text).not.toContain('encrypted_credentials');
      expect(text).not.toContain('kid');
    }
    const changes = await changeRows(ws.workspaceId, before);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      resource: 'ai-settings',
      scope: { scope: 'provider-connections', memberId: ws.memberId },
      audience: { userIds: [ws.user.userId] },
    });
    const { rows: events } = await sql<{ kind: string; connection_version: number }>`
      SELECT * FROM provider_connection_events WHERE workspace_id = ${ws.workspaceId}::uuid
        AND connection_id = ${id}::uuid`.execute(database.kysely);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'created', connection_version: 1 });
    expect(JSON.stringify([changes, events])).not.toContain(KEY_A);
    expect(JSON.stringify(events)).not.toContain('encrypted_credentials');
  });

  it('lets active members read shared status, lets only admins manage it, and keeps member connections private', async () => {
    const w = world();
    const ws = await createWorkspace();
    const member = await addMember(ws);
    const secondAdmin = await addMember(ws, 'SecondAdmin');
    await database.kysely
      .updateTable('workspace_members')
      .set({ access_level: 'admin' })
      .where('id', '=', secondAdmin.memberId)
      .execute();
    const shared = await w.connections.create(ws.ctx, {
      id: newId(),
      ownerKind: 'workspace',
      provider: 'openai',
      apiKey: KEY_A,
    });
    const personal = await w.connections.create(member.ctx, {
      id: newId(),
      ownerKind: 'member',
      provider: 'openai',
      apiKey: KEY_B,
    });
    expect(shared.owner).toEqual({ kind: 'workspace', id: ws.workspaceId });
    expect(await w.connections.get(member.ctx, shared.id)).toEqual(shared);
    expect((await w.connections.list(member.ctx)).map((r) => r.id)).toEqual([shared.id, personal.id]);
    expect((await w.connections.list(ws.ctx)).map((r) => r.id)).toEqual([shared.id]);
    await expectCode(
      w.connections.create(member.ctx, { id: newId(), ownerKind: 'workspace', provider: 'openai', apiKey: KEY_A }),
      'FORBIDDEN',
      403,
    );
    await expectCode(
      w.connections.rotate(member.ctx, { id: shared.id, expectedVersion: 1, apiKey: KEY_B }),
      'FORBIDDEN',
    );
    await expectCode(w.connections.disable(member.ctx, { id: shared.id, expectedVersion: 1 }), 'FORBIDDEN');
    for (const outsider of [ws.ctx, secondAdmin.ctx]) {
      await expectCode(w.connections.get(outsider, personal.id), 'NOT_FOUND', 404);
      await expectCode(
        w.connections.rotate(outsider, { id: personal.id, expectedVersion: 1, apiKey: KEY_A }),
        'NOT_FOUND',
      );
      await expectCode(w.connections.disable(outsider, { id: personal.id, expectedVersion: 1 }), 'NOT_FOUND');
    }
    expect(
      (await w.connections.rotate(secondAdmin.ctx, { id: shared.id, expectedVersion: 1, apiKey: KEY_B })).version,
    ).toBe(2);
    const disabled = await w.connections.disable(member.ctx, { id: personal.id, expectedVersion: 1 });
    expect(disabled.credential.status).toBe('disabled');
  });

  it('denies cross-tenant reads and writes, foreign members, removed/suspended members, tokens, and trusted fallbacks', async () => {
    const w = world();
    const ws = await createWorkspace();
    const other = await createWorkspace();
    const shared = await w.connections.create(ws.ctx, {
      id: newId(),
      ownerKind: 'workspace',
      provider: 'anthropic',
      apiKey: KEY_A,
    });
    expect(await w.connections.list(other.ctx)).toEqual([]);
    await expectCode(w.connections.get(other.ctx, shared.id), 'NOT_FOUND');
    await expectCode(
      w.connections.rotate(other.ctx, { id: shared.id, expectedVersion: 1, apiKey: KEY_B }),
      'NOT_FOUND',
    );
    await expectCode(w.connections.disable(other.ctx, { id: shared.id, expectedVersion: 1 }), 'NOT_FOUND');
    await expectCode(
      w.connections.create(other.ctx, { id: shared.id, ownerKind: 'workspace', provider: 'anthropic', apiKey: KEY_B }),
      'NOT_FOUND',
    );
    const inactive = await addMember(ws);
    await database.kysely
      .updateTable('workspace_members')
      .set({ access_level: 'suspended' })
      .where('id', '=', inactive.memberId)
      .execute();
    const removed = await addMember(ws, 'Removed');
    await database.kysely
      .updateTable('workspace_members')
      .set({ removed_at: new Date().toISOString() })
      .where('id', '=', removed.memberId)
      .execute();
    const denied: ServiceContext[] = [
      ws.sys,
      inactive.ctx,
      removed.ctx,
      memberContext(ws.workspaceId, other.memberId),
      memberContext(ws.workspaceId, newId()),
      { workspaceId: ws.workspaceId, actor: { type: 'api-token', id: newId() }, onBehalfOfMemberId: ws.memberId },
      { workspaceId: ws.workspaceId, actor: { type: 'workflow', id: newId() } },
      { workspaceId: ws.workspaceId, actor: { type: 'agent', id: newId() } } as unknown as ServiceContext,
    ];
    for (const ctx of denied) {
      await expectCode(w.connections.list(ctx), 'FORBIDDEN');
      await expectCode(w.connections.get(ctx, shared.id), 'FORBIDDEN');
      await expectCode(
        w.connections.create(ctx, { id: newId(), ownerKind: 'member', provider: 'anthropic', apiKey: KEY_A }),
        'FORBIDDEN',
      );
      await expectCode(w.connections.rotate(ctx, { id: shared.id, expectedVersion: 1, apiKey: KEY_B }), 'FORBIDDEN');
      await expectCode(w.connections.disable(ctx, { id: shared.id, expectedVersion: 1 }), 'FORBIDDEN');
    }
    const foreignRows = await runInWorkspace(database, other.ctx, async (tx) => {
      const { rows } = await sql`SELECT * FROM provider_connections WHERE id = ${shared.id}::uuid`.execute(tx.db);
      return rows;
    });
    expect(foreignRows).toEqual([]);
    await expect(
      runInWorkspace(database, other.ctx, async (tx) => {
        const row = await stored(shared.id);
        await sql`INSERT INTO provider_connections
          (id, workspace_id, owner_kind, owner_id, provider, encrypted_credentials, created_by_member_id)
          VALUES (${newId()}::uuid, ${ws.workspaceId}::uuid, 'workspace', ${ws.workspaceId}::uuid, 'anthropic',
            ${JSON.stringify(row.encrypted_credentials)}::jsonb, ${ws.memberId}::uuid)`.execute(tx.db);
      }),
    ).rejects.toThrow();
  });

  it('binds ciphertext to every scope component and rejects cross-row, owner, tenant, provider, and Google swaps', async () => {
    const w = world();
    const ws = await createWorkspace();
    const other = await createWorkspace();
    const member = await addMember(ws);
    const input = { ownerKind: 'workspace' as const, provider: 'anthropic' as const, apiKey: KEY_A };
    const source = await w.connections.create(ws.ctx, { id: newId(), ...input });
    const sourceRow = await stored(source.id);
    const sealed = sourceRow.encrypted_credentials;
    const box = new ProviderConnectionSecrets(w.master);
    const binding = {
      workspaceId: ws.workspaceId,
      connectionId: source.id,
      ownerKind: 'workspace' as const,
      ownerId: ws.workspaceId,
      provider: 'anthropic' as const,
    };
    expect(box.isReadable(sealed, binding)).toBe(true);
    for (const changed of [
      { workspaceId: other.workspaceId },
      { connectionId: newId() },
      { ownerKind: 'member' as const },
      { ownerId: member.memberId },
      { provider: 'openai' as const },
    ])
      expect(box.isReadable(sealed, { ...binding, ...changed })).toBe(false);
    const targets = [
      { ctx: ws.ctx, input: { id: newId(), ...input } },
      { ctx: ws.ctx, input: { id: newId(), ...input, provider: 'openai' as const } },
      { ctx: member.ctx, input: { id: newId(), ...input, ownerKind: 'member' as const } },
      { ctx: other.ctx, input: { id: newId(), ...input } },
    ];
    for (const target of targets) {
      const created = await w.connections.create(target.ctx, target.input);
      await replaceCiphertext(created.id, sealed);
      expect((await w.connections.get(target.ctx, created.id)).credential.status).toBe('unreadable');
    }
    const google = new SecretBox(w.master);
    const googleSealed = google.seal({ apiKey: KEY_A });
    expect(googleSealed.kid).not.toBe((sealed as { kid: string }).kid);
    await replaceCiphertext(source.id, googleSealed);
    expect((await w.connections.get(ws.ctx, source.id)).credential.status).toBe('unreadable');
    expect(google.open(googleSealed)).toEqual({ apiKey: KEY_A });
    const repaired = await w.connections.rotate(ws.ctx, { id: source.id, expectedVersion: 1, apiKey: KEY_B });
    expect(repaired.credential.status).toBe('configured');
    const changedMaster = createProviderConnections({ database, encryptionKey: randomBytes(32) });
    const unreadable = await changedMaster.get(ws.ctx, source.id);
    expect(unreadable.credential.status).toBe('unreadable');
    expect(JSON.stringify(unreadable)).not.toContain(KEY_B);
  });

  it('rotates with version fencing, keeps disables effective, and makes create/disable replays idempotent', async () => {
    const w = world();
    const ws = await createWorkspace();
    const before = await lastChangeId(ws.workspaceId);
    const input = { id: newId(), ownerKind: 'workspace' as const, provider: 'openai' as const, apiKey: KEY_A };
    const created = await w.connections.create(ws.ctx, input);
    const initial = await stored(created.id);
    expect(await w.connections.create(ws.ctx, { ...input, apiKey: KEY_B })).toEqual(created);
    expect((await stored(created.id)).encrypted_credentials).toEqual(initial.encrypted_credentials);
    expect(await persistedKeyForTest(created.id, w.master)).toEqual({ apiKey: KEY_A });
    const attempts = await Promise.allSettled([
      w.connections.rotate(ws.ctx, { id: created.id, expectedVersion: 1, apiKey: KEY_B }),
      w.connections.rotate(ws.ctx, { id: created.id, expectedVersion: 1, apiKey: KEY_A }),
    ]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = attempts.find((r) => r.status === 'rejected');
    expect(failed?.status === 'rejected' && failed.reason).toMatchObject({ code: 'VERSION_CONFLICT' });
    const rotated = await stored(created.id);
    expect(rotated.encrypted_credentials).not.toEqual(initial.encrypted_credentials);
    expect(rotated.version).toBe(2);
    expect((await w.connections.get(ws.ctx, created.id)).rotatedAt).not.toBeNull();
    await expectCode(w.connections.disable(ws.ctx, { id: created.id, expectedVersion: 1 }), 'VERSION_CONFLICT');
    const disabled = await w.connections.disable(ws.ctx, { id: created.id, expectedVersion: 2 });
    expect(disabled).toMatchObject({ enabled: false, version: 3, credential: { status: 'disabled' } });
    expect(disabled.disabledAt).not.toBeNull();
    expect(await w.connections.disable(ws.ctx, { id: created.id, expectedVersion: 3 })).toEqual(disabled);
    const rotatedDisabled = await w.connections.rotate(ws.ctx, { id: created.id, expectedVersion: 3, apiKey: KEY_B });
    expect(rotatedDisabled).toMatchObject({ enabled: false, version: 4, credential: { status: 'disabled' } });
    expect(rotatedDisabled.disabledAt).toBe(disabled.disabledAt);
    expect(await persistedKeyForTest(created.id, w.master)).toEqual({ apiKey: KEY_B });
    expect((await changeRows(ws.workspaceId, before)).filter((r) => r.resource === 'ai-settings')).toHaveLength(4);
    const { rows: events } = await sql<{ kind: string; connection_version: number }>`
      SELECT kind, connection_version FROM provider_connection_events WHERE workspace_id = ${ws.workspaceId}::uuid
        AND connection_id = ${created.id}::uuid ORDER BY connection_version`.execute(database.kysely);
    expect(events).toEqual([
      { kind: 'created', connection_version: 1 },
      { kind: 'rotated', connection_version: 2 },
      { kind: 'disabled', connection_version: 3 },
      { kind: 'rotated', connection_version: 4 },
    ]);
    await expect(
      runInWorkspace(database, ws.ctx, async (tx) => {
        await sql`DELETE FROM provider_connection_events WHERE connection_id = ${created.id}::uuid`.execute(tx.db);
      }),
    ).rejects.toThrow();
    await expect(
      runInWorkspace(database, ws.ctx, async (tx) => {
        await sql`UPDATE provider_connections SET owner_kind = 'member', owner_id = ${ws.memberId}::uuid
          WHERE id = ${created.id}::uuid`.execute(tx.db);
      }),
    ).rejects.toThrow('identity is immutable');
  });

  it('fails closed on unknown providers and input surfaces and never echoes invalid secrets', async () => {
    const w = world();
    const ws = await createWorkspace();
    const input = { id: newId(), ownerKind: 'member' as const, provider: 'openai' as const, apiKey: KEY_A };
    for (const extra of [
      { provider: 'unknown' },
      { ownerKind: 'unknown' },
      { ownerId: newId() },
      { endpoint: 'http://127.0.0.1:11434' },
      { runnerId: newId() },
      { executionHost: 'paired-runner' },
      { apiKey: 'secret-with\nnewline' },
      { apiKey: '' },
    ]) {
      try {
        await w.connections.create(ws.ctx, { ...input, ...extra } as unknown as typeof input);
        throw new Error('Expected validation failure');
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect(error).toMatchObject({ code: 'VALIDATION_ERROR' });
        expect(JSON.stringify(toErrorEnvelope(error))).not.toContain(KEY_A);
        expect(JSON.stringify(toErrorEnvelope(error))).not.toContain('secret-with');
      }
    }
    expect(await w.connections.list(ws.ctx)).toEqual([]);
    // PostgreSQL and AAD use canonical UUIDs even when a transport supplies uppercase UUID text.
    const created = await w.connections.create(
      { ...ws.ctx, workspaceId: ws.workspaceId.toUpperCase() },
      { ...input, id: input.id.toUpperCase() },
    );
    expect(created.credential.status).toBe('configured');
  });
});
