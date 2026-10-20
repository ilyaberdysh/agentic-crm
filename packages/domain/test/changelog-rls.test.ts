// change_log rows per write (I1, packages/realtime contract) and the RLS backstop (I2).
import { sql } from '@agentic-crm/db';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { databaseUrl } from './support/env.ts';
import { createWorkspace, database, domain, expectCode, newId } from './support/harness.ts';

async function changes(workspaceId: string, afterId = '0') {
  return database.kysely
    .selectFrom('change_log')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('id', '>', afterId)
    .orderBy('id')
    .execute();
}

async function lastId(workspaceId: string): Promise<string> {
  const rows = await changes(workspaceId);
  return rows.at(-1)?.id ?? '0';
}

describe('change_log', () => {
  it('appends one row per changed key in the write transaction and notifies after commit', async () => {
    const ws = await createWorkspace();
    const listener = new pg.Client({ connectionString: databaseUrl() });
    await listener.connect();
    const notified: string[] = [];
    listener.on('notification', (n) => {
      if (n.channel === 'change_log' && n.payload) notified.push(n.payload);
    });
    await listener.query('LISTEN change_log');
    try {
      const before = await lastId(ws.workspaceId);
      const people = await domain.schema.listAttributes(ws.ctx, { entityDefinitionId: 'people' });
      const jobTitle = people.find((a) => a.apiSlug === 'job_title');
      const id = newId();
      await domain.records.create(ws.ctx, {
        entityDefinitionId: 'people',
        entityInstanceId: id,
        values: { job_title: [{ value: 'CTO' }], email_addresses: [{ value: 'cto@example.com' }] },
      });
      const rows = await changes(ws.workspaceId, before);
      const keys = rows.map((r) => `${r.resource}:${r.resource_id}`);
      expect(new Set(keys).size).toBe(keys.length); // one row per key
      const instance = rows.find((r) => r.resource === 'entity-instance');
      expect(instance).toMatchObject({ resource_id: id, scope: { entityDefinitionId: jobTitle?.entityDefinitionId } });
      const values = rows.find((r) => r.resource === 'attribute-value-list' && r.resource_id === jobTitle?.id);
      expect(values?.scope).toMatchObject({ entityInstanceIds: [id], attributeDefinitionId: jobTitle?.id });
      expect(
        rows.some((r) => r.resource === 'snapshot-selection' && r.resource_id === jobTitle?.entityDefinitionId),
      ).toBe(true);
      for (const r of rows) expect(r.actor).toEqual({ type: 'workspace-member', id: ws.memberId });
      expect(rows.every((r) => r.audience === null)).toBe(true);

      // NOTIFY carries the last id of the transaction and arrives only after commit.
      await new Promise((r) => setTimeout(r, 100));
      expect(notified).toContain(rows.at(-1)?.id);

      // A failed write leaves no change_log rows (same transaction).
      const mark = await lastId(ws.workspaceId);
      await expectCode(
        domain.records.create(ws.ctx, {
          entityDefinitionId: 'people',
          entityInstanceId: newId(),
          values: { email_addresses: [{ value: 'cto@example.com' }] },
        }),
        'UNIQUE_CONSTRAINT_VIOLATION',
      );
      expect(await changes(ws.workspaceId, mark)).toEqual([]);

      // Value-level writes and schema writes use the realtime resource names.
      const mark2 = await lastId(ws.workspaceId);
      await domain.values.put(ws.ctx, {
        entityDefinitionId: 'people',
        entityInstanceId: id,
        attributeDefinitionId: 'job_title',
        attributeValueId: newId(),
        value: 'CEO',
      });
      await domain.schema.createAttribute(ws.ctx, {
        id: newId(),
        entityDefinitionId: 'people',
        title: 'Nickname',
        type: 'text',
      });
      await domain.views.create(ws.ctx, { id: newId(), entityDefinitionId: 'people', title: 'Mine' });
      const resources = new Set((await changes(ws.workspaceId, mark2)).map((r) => r.resource));
      for (const r of [
        'attribute-value-list',
        'snapshot-selection',
        'attribute-definition',
        'attribute-definition-list',
        'entity-view',
        'entity-view-list',
      ]) {
        expect(resources.has(r), r).toBe(true);
      }
    } finally {
      await listener.end();
    }
  });
});

describe('RLS backstop', () => {
  it('hides other workspaces from the application role', async () => {
    const a = await createWorkspace('A');
    const b = await createWorkspace('B');
    const id = newId();
    await domain.records.create(a.ctx, {
      entityDefinitionId: 'people',
      entityInstanceId: id,
      values: { job_title: [{ value: 'Secret' }] },
    });
    const peopleA = await domain.schema.getObject(a.ctx, 'people');
    const table = (
      await database.kysely
        .selectFrom('entity_definitions')
        .select('projection_table')
        .where('id', '=', peopleA.id)
        .executeTakeFirstOrThrow()
    ).projection_table as string;

    const countAs = (workspaceId: string | null) =>
      database.kysely.transaction().execute(async (trx) => {
        if (workspaceId) await sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`.execute(trx);
        await sql`SELECT set_config('role', 'agentic_crm_app', true)`.execute(trx);
        const one = async (q: string) => Number((await sql.raw<{ n: string }>(q).execute(trx)).rows[0]?.n);
        return {
          instances: await one(`SELECT count(*) AS n FROM entity_instances WHERE id = '${id}'`),
          values: await one(`SELECT count(*) AS n FROM attribute_values WHERE instance_id = '${id}'`),
          projection: await one(`SELECT count(*) AS n FROM proj."${table}"`),
          definitions: await one(`SELECT count(*) AS n FROM entity_definitions WHERE id = '${peopleA.id}'`),
          changes: await one(`SELECT count(*) AS n FROM change_log WHERE workspace_id = '${a.workspaceId}'`),
          members: await one(`SELECT count(*) AS n FROM workspace_members WHERE workspace_id = '${a.workspaceId}'`),
        };
      });

    const own = await countAs(a.workspaceId);
    expect(own.instances).toBe(1);
    expect(own.values).toBeGreaterThan(0);
    expect(own.projection).toBe(1);
    const other = await countAs(b.workspaceId);
    expect(other).toEqual({ instances: 0, values: 0, projection: 0, definitions: 0, changes: 0, members: 0 });
    const none = await countAs(null);
    expect(none).toEqual({ instances: 0, values: 0, projection: 0, definitions: 0, changes: 0, members: 0 });

    // Writes into another workspace are rejected by WITH CHECK.
    await expect(
      database.kysely.transaction().execute(async (trx) => {
        await sql`SELECT set_config('app.workspace_id', ${b.workspaceId}, true), set_config('role', 'agentic_crm_app', true)`.execute(
          trx,
        );
        await sql`INSERT INTO change_log (workspace_id, resource) VALUES (${a.workspaceId}::uuid, 'workspace')`.execute(
          trx,
        );
      }),
    ).rejects.toThrow(/row-level security/);

    // Through the services: B cannot address A's definitions, records or snapshots.
    await expectCode(
      domain.records.get(b.ctx, { entityDefinitionId: peopleA.id, entityInstanceId: id }),
      'NOT_FOUND',
      404,
    );
    const peopleB = await domain.schema.getObject(b.ctx, 'people');
    await expectCode(
      domain.records.get(b.ctx, { entityDefinitionId: peopleB.id, entityInstanceId: id }),
      'NOT_FOUND',
      404,
    );
    const snap = await domain.views.query(a.ctx, { entityDefinitionId: 'people' });
    expect(snap.ids).toContain(id);
    await expectCode(
      domain.views.chunk(b.ctx, { snapshotId: snap.snapshotId, start: 0, size: 10 }),
      'SNAPSHOT_NOT_FOUND',
      404,
    );
    const fromB = await domain.views.query(b.ctx, { entityDefinitionId: 'people' });
    expect(fromB.ids).not.toContain(id);
  });
});
