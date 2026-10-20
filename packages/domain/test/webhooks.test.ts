// Webhooks (BACKLOG 6.07; Attio docs rest-api/guides/webhooks, webhooks OpenAPI): settings CRUD with uniqueness,
// events from the write path fanned out of change_log into signed deliveries, filters, retries with back-off and the
// degraded state, and "Test subscription".
import { createHmac } from 'node:crypto';
import { sql } from '@agentic-crm/db';
import { afterEach, describe, expect, it } from 'vitest';
import { createDomain, type WebhookSender } from '../src/index.ts';
import { addMember } from './collab-fixtures.ts';
import { createWorkspace, database, expectCode, newId, domain as plain, storage } from './support/harness.ts';

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: string;
}
const sent: Sent[] = [];
let respond = 200;
const sender: WebhookSender = async (request) => {
  sent.push(request);
  return { status: respond };
};
const domain = createDomain({ database, storage, webhookSender: sender });

afterEach(() => {
  sent.length = 0;
  respond = 200;
});

/** Fan out and deliver everything due; answers the requests sent to `webhookId`. */
async function pump(
  webhookId: string,
  expected = 1,
): Promise<{ body: Record<string, unknown>; headers: Record<string, string> }[]> {
  // Transactions of parallel test files hold the (global) fan-out bound back: everything committed before this call
  // is fanned out once the cursor passes a fresh xid. Poll until then (or until `expected` requests arrived).
  const { rows } = await sql<{ xid: string }>`SELECT pg_current_xact_id()::text AS xid`.execute(database.kysely);
  const marker = BigInt((rows[0] as { xid: string }).xid);
  const deadline = Date.now() + 45_000;
  for (;;) {
    await domain.webhooks.fanOut();
    const { rows: state } = await sql<{ c: string }>`
      SELECT xid_cursor::text AS c FROM webhook_fanout_state WHERE id = 1`.execute(database.kysely);
    const caughtUp = state[0] !== undefined && BigInt(state[0].c) > marker;
    await domain.webhooks.deliverDue({ limit: 200 });
    const count = sent.filter((s) => JSON.parse(s.body).webhook_id === webhookId).length;
    if ((expected > 0 && count >= expected) || caughtUp || Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  return sent
    .map((s) => ({ body: JSON.parse(s.body) as Record<string, unknown>, headers: s.headers, raw: s.body }))
    .filter((s) => s.body.webhook_id === webhookId)
    .map((s) => {
      // Attio-Signature = hex HMAC-SHA256 of the raw body under the webhook secret (checked by the caller).
      return { body: s.body, headers: { ...s.headers, raw: s.raw } };
    });
}

const eventsOf = (requests: { body: Record<string, unknown> }[]) =>
  requests.flatMap((r) => r.body.events as Record<string, unknown>[]);

describe('webhook settings', () => {
  it('create answers the secret; https only; (target, event, filter) is unique; edit, deactivate, delete', async () => {
    const ws = await createWorkspace();
    const bob = await addMember(ws, 'Bob');
    const filter = {
      $and: [
        { field: 'id.object_id', operator: 'equals' as const, value: 'a' },
        { field: 'actor.type', operator: 'equals' as const, value: 'workspace-member' },
      ],
    };
    const created = await domain.webhooks.create(ws.ctx, {
      targetUrl: 'https://hooks.example.com/a',
      subscriptions: [
        { eventType: 'record.created', filter: null },
        { eventType: 'record.updated', filter },
      ],
    });
    expect(created.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(created).toMatchObject({ status: 'active', targetUrl: 'https://hooks.example.com/a' });
    await expectCode(
      domain.webhooks.create(bob.ctx, {
        targetUrl: 'https://x.example.com',
        subscriptions: [{ eventType: 'task.created', filter: null }],
      }),
      'FORBIDDEN',
      403,
    );
    await expect(
      domain.webhooks.create(ws.ctx, {
        targetUrl: 'http://insecure.example.com',
        subscriptions: [{ eventType: 'task.created', filter: null }],
      }),
    ).rejects.toThrow('Must provide secure URL');
    // Same URL + event + filter (operation order ignored; null = empty $and) → 409, also inside one request.
    await expectCode(
      domain.webhooks.create(ws.ctx, {
        targetUrl: 'https://hooks.example.com/a',
        subscriptions: [{ eventType: 'record.updated', filter: { $and: [...filter.$and].reverse() } }],
      }),
      'SUBSCRIPTION_CONFLICT',
      409,
    );
    await expectCode(
      domain.webhooks.create(ws.ctx, {
        targetUrl: 'https://hooks.example.com/b',
        subscriptions: [
          { eventType: 'note.created', filter: null },
          { eventType: 'note.created', filter: { $and: [] } },
        ],
      }),
      'SUBSCRIPTION_CONFLICT',
      409,
    );
    const updated = await domain.webhooks.update(ws.ctx, {
      webhookId: created.id,
      subscriptions: [{ eventType: 'task.created', filter: null }],
      status: 'inactive',
    });
    expect(updated).toMatchObject({ status: 'inactive', subscriptions: [{ eventType: 'task.created', filter: null }] });
    expect((await domain.webhooks.secret(ws.ctx, created.id)).secret).toBe(created.secret);
    expect(await domain.webhooks.list(ws.ctx)).toHaveLength(1);
    await domain.webhooks.delete(ws.ctx, created.id);
    expect(await domain.webhooks.list(ws.ctx)).toHaveLength(0);
    await expectCode(domain.webhooks.get(ws.ctx, created.id), 'NOT_FOUND', 404);
  });
});

describe('webhook deliveries', () => {
  it('a record created by a member is delivered once, signed, with Attio’s payload; filters narrow events', async () => {
    const ws = await createWorkspace();
    const people = await domain.schema.getObject(ws.ctx, 'people');
    const hook = await domain.webhooks.create(ws.ctx, {
      targetUrl: 'https://hooks.example.com/records',
      subscriptions: [
        {
          eventType: 'record.created',
          filter: { $and: [{ field: 'id.object_id', operator: 'equals', value: people.id }] },
        },
        { eventType: 'record.updated', filter: null },
        { eventType: 'record.deleted', filter: null },
      ],
    });
    const personId = newId();
    await domain.records.create(ws.ctx, {
      entityDefinitionId: 'people',
      entityInstanceId: personId,
      values: { name: [{ value: { firstName: 'Ada', lastName: 'Lovelace' } }] },
    });
    await domain.records.create(ws.ctx, {
      entityDefinitionId: 'companies',
      entityInstanceId: newId(),
      values: { name: [{ value: 'Filtered out' }] },
    });
    const requests = await pump(hook.id);
    expect(requests).toHaveLength(1);
    const [request] = requests as [(typeof requests)[number]];
    expect(request.body).toEqual({
      webhook_id: hook.id,
      events: [
        {
          event_type: 'record.created',
          id: { workspace_id: ws.workspaceId, object_id: people.id, record_id: personId },
          actor: { type: 'workspace-member', id: ws.memberId },
        },
      ],
    });
    const signature = createHmac('sha256', hook.secret)
      .update(request.headers.raw as string)
      .digest('hex');
    expect(request.headers['attio-signature']).toBe(signature);
    expect(request.headers['x-attio-signature']).toBe(signature);
    expect(request.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(request.headers['content-type']).toBe('application/json');

    // Nothing is delivered twice.
    sent.length = 0;
    expect(await pump(hook.id)).toHaveLength(0);

    // Updates report the attribute; deletes are their own event.
    await domain.records.update(ws.ctx, {
      entityDefinitionId: 'people',
      entityInstanceId: personId,
      values: { name: [{ value: { firstName: 'Ada', lastName: 'King' } }] },
    });
    await domain.records.delete(ws.ctx, { entityDefinitionId: 'people', entityInstanceId: personId });
    const later = eventsOf(await pump(hook.id, 2));
    const name = (await domain.schema.listAttributes(ws.ctx, { entityDefinitionId: 'people' })).find(
      (a) => a.apiSlug === 'name',
    );
    expect(later.map((e) => [e.event_type, (e.id as Record<string, string>).attribute_id ?? null])).toEqual([
      ['record.updated', name?.id],
      ['record.deleted', null],
    ]);
    const log = await domain.webhooks.deliveries(ws.ctx, { webhookId: hook.id });
    expect(log.map((d) => [d.eventType, d.status, d.attempts])).toEqual([
      ['record.deleted', 'succeeded', 1],
      ['record.updated', 'succeeded', 1],
      ['record.created', 'succeeded', 1],
    ]);
  });

  it('lists, entries, notes, tasks, comments, attributes and members produce their catalogue events', async () => {
    const ws = await createWorkspace();
    const hook = await domain.webhooks.create(ws.ctx, {
      targetUrl: 'https://hooks.example.com/all',
      subscriptions: [
        'list.created',
        'list-entry.created',
        'list-attribute.created',
        'object-attribute.created',
        'note.created',
        'task.created',
        'comment.created',
        'comment.resolved',
        'workspace-member.created',
      ].map((eventType) => ({ eventType: eventType as 'list.created', filter: null })),
    });
    const companies = await domain.schema.getObject(ws.ctx, 'companies');
    const companyId = newId();
    await domain.records.create(ws.ctx, {
      entityDefinitionId: 'companies',
      entityInstanceId: companyId,
      values: { name: [{ value: 'Acme' }] },
    });
    const { list } = await domain.lists.create(ws.ctx, { name: 'Pipeline', parentEntityDefinitionIds: ['companies'] });
    const { entries } = await domain.entries.add(ws.ctx, {
      listId: list.id,
      parentRecords: [{ entityDefinitionId: companies.id, entityInstanceId: companyId }],
      onDuplicate: 'keep',
    });
    const listAttr = await domain.schema.createAttribute(ws.ctx, {
      id: newId(),
      entityDefinitionId: list.id,
      title: 'Value',
      type: 'number',
    });
    const objectAttr = await domain.schema.createAttribute(ws.ctx, {
      id: newId(),
      entityDefinitionId: 'companies',
      title: 'Tier',
      type: 'text',
    });
    const noteId = newId();
    await domain.notes.create(ws.ctx, {
      id: noteId,
      parentRecords: [{ entityDefinitionId: companies.id, entityInstanceId: companyId }],
      title: 'Kickoff',
    });
    const taskId = newId();
    await domain.tasks.create(ws.ctx, { id: taskId, content: { text: 'Call' } });
    const commentId = newId();
    await domain.comments.create(ws.ctx, {
      id: commentId,
      target: { kind: 'record', entityDefinitionId: companies.id, entityInstanceId: companyId },
      content: { text: 'Nice' },
    });
    await domain.comments.resolve(ws.ctx, { commentId, resolved: true });
    const bob = await addMember(ws, 'Bob');

    const events = eventsOf(await pump(hook.id, 9));
    const byType = new Map(events.map((e) => [e.event_type as string, e]));
    const entryId = (entries[0] as { id: string }).id;
    expect(byType.get('list.created')).toMatchObject({ id: { workspace_id: ws.workspaceId, list_id: list.id } });
    expect(byType.get('list-entry.created')).toMatchObject({
      id: { list_id: list.id, entry_id: entryId },
      parent_object_id: companies.id,
      parent_record_id: companyId,
    });
    expect(byType.get('list-attribute.created')).toMatchObject({ id: { list_id: list.id, attribute_id: listAttr.id } });
    expect(byType.get('object-attribute.created')).toMatchObject({
      id: { object_id: companies.id, attribute_id: objectAttr.id },
    });
    expect(byType.get('note.created')).toMatchObject({
      id: { note_id: noteId },
      parent_object_id: companies.id,
      parent_record_id: companyId,
    });
    expect(byType.get('task.created')).toMatchObject({ id: { task_id: taskId } });
    expect(byType.get('comment.created')).toMatchObject({
      id: { comment_id: commentId },
      thread_id: commentId,
      object_id: companies.id,
      record_id: companyId,
      list_id: null,
      entry_id: null,
    });
    expect(byType.get('comment.resolved')).toMatchObject({ id: { comment_id: commentId } });
    expect(byType.get('workspace-member.created')).toMatchObject({
      id: { workspace_member_id: bob.memberId },
      actor: { type: 'system', id: null },
    });
  });

  it('failed deliveries are retried with back-off; ten failures fail the delivery and degrade the webhook', async () => {
    const ws = await createWorkspace();
    const hook = await domain.webhooks.create(ws.ctx, {
      targetUrl: 'https://hooks.example.com/flaky',
      subscriptions: [{ eventType: 'task.created', filter: null }],
    });
    await domain.tasks.create(ws.ctx, { id: newId(), content: { text: 'Retry me' } });
    respond = 500;
    expect(await pump(hook.id)).toHaveLength(1);
    let [delivery] = await domain.webhooks.deliveries(ws.ctx, { webhookId: hook.id });
    expect(delivery).toMatchObject({ status: 'pending', attempts: 1, lastStatusCode: 500 });
    const waitSeconds = (Date.parse(delivery?.nextAttemptAt as string) - Date.now()) / 1000;
    expect(waitSeconds).toBeGreaterThan(400); // 8.5 min after the first failure

    // Not due yet: nothing is sent.
    sent.length = 0;
    await domain.webhooks.deliverDue();
    expect(sent.filter((s) => s.body.includes(hook.id))).toHaveLength(0);

    for (let i = 2; i <= 10; i++) {
      await sql`UPDATE webhook_deliveries SET next_attempt_at = now() WHERE id = ${delivery?.id}::uuid`.execute(
        database.kysely,
      );
      await domain.webhooks.deliverDue({ limit: 200 });
    }
    [delivery] = await domain.webhooks.deliveries(ws.ctx, { webhookId: hook.id });
    expect(delivery).toMatchObject({ status: 'failed', attempts: 10, nextAttemptAt: null });
    expect(delivery?.attemptLog).toHaveLength(10);
    expect((await domain.webhooks.get(ws.ctx, hook.id)).status).toBe('degraded');

    // Degraded webhooks still receive events; a success makes them active again.
    respond = 204;
    sent.length = 0;
    await domain.tasks.create(ws.ctx, { id: newId(), content: { text: 'Recovered' } });
    expect(await pump(hook.id)).toHaveLength(1);
    expect((await domain.webhooks.get(ws.ctx, hook.id)).status).toBe('active');
  });

  it('inactive webhooks receive nothing; "Test subscription" delivers a sample right away', async () => {
    const ws = await createWorkspace();
    const hook = await domain.webhooks.create(ws.ctx, {
      targetUrl: 'https://hooks.example.com/test',
      subscriptions: [{ eventType: 'record.created', filter: null }],
    });
    await domain.webhooks.update(ws.ctx, { webhookId: hook.id, status: 'inactive' });
    await domain.records.create(ws.ctx, {
      entityDefinitionId: 'people',
      entityInstanceId: newId(),
      values: {},
    });
    expect(await pump(hook.id)).toHaveLength(0);

    const recordId = newId();
    await plain.records.create(ws.ctx, { entityDefinitionId: 'people', entityInstanceId: recordId, values: {} });
    await domain.webhooks.update(ws.ctx, { webhookId: hook.id, status: 'active' });
    sent.length = 0;
    const delivery = await domain.webhooks.test(ws.ctx, { webhookId: hook.id, eventType: 'record.created' });
    expect(delivery).toMatchObject({ isTest: true, status: 'succeeded', attempts: 1, lastStatusCode: 200 });
    const body = JSON.parse((sent[0] as Sent).body);
    expect(body).toMatchObject({
      webhook_id: hook.id,
      events: [{ event_type: 'record.created', id: { workspace_id: ws.workspaceId, record_id: recordId } }],
    });
    respond = 500;
    const failed = await domain.webhooks.test(ws.ctx, { webhookId: hook.id, eventType: 'note.created' });
    expect(failed).toMatchObject({ isTest: true, status: 'failed', attempts: 1, lastStatusCode: 500 });
  });
});
