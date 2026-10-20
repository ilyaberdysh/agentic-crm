// /v2 contract tests: webhook CRUD, uniqueness, scopes, token level, signatures, actors and event types.
import { createHmac, randomUUID } from 'node:crypto';
import { systemContext } from '@agentic-crm/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from '../support/harness';
import { expectError, expectOk, type V2Fixture, v2Fixture } from './support';

let h: Harness;
let f: V2Fixture;
const sent: { headers: Record<string, string>; body: string }[] = [];

beforeAll(async () => {
  h = await startHarness(
    {},
    {
      publicApi: { rateLimits: { readsPerSecond: 5000, writesPerSecond: 5000 } },
      webhookSender: async (request) => {
        sent.push(request);
        return { status: 200 };
      },
    },
  );
  f = await v2Fixture(h, 'webhooks');
});
afterAll(async () => {
  await h?.close();
});

const subscription = (event_type: string, filter: unknown = null) => ({ event_type, filter });

describe('/v2/webhooks', () => {
  it('create answers the secret; list, get, update and delete follow the OpenAPI', async () => {
    const created = expectOk(
      'createWebhook',
      await f.call('POST', '/webhooks', {
        body: {
          data: {
            target_url: 'https://example.com/hook',
            subscriptions: [
              subscription('record.created'),
              subscription('list-entry.updated', {
                $and: [{ field: 'id.list_id', operator: 'equals', value: randomUUID() }],
              }),
            ],
          },
        },
      }),
    );
    expect(created.data).toMatchObject({
      target_url: 'https://example.com/hook',
      status: 'active',
      id: { workspace_id: f.workspaceId },
    });
    expect(created.data.secret).toMatch(/^[0-9a-f]{64}$/);
    const id = created.data.id.webhook_id as string;

    const got = expectOk('getWebhook', await f.call('GET', `/webhooks/${id}`));
    expect(got.data).not.toHaveProperty('secret');
    expect(got.data.subscriptions).toHaveLength(2);
    const listed = expectOk('listWebhooks', await f.call('GET', '/webhooks', { query: { limit: '10', offset: '0' } }));
    expect(listed.data.map((w: { id: { webhook_id: string } }) => w.id.webhook_id)).toContain(id);

    const updated = expectOk(
      'updateWebhook',
      await f.call('PATCH', `/webhooks/${id}`, {
        body: { data: { target_url: 'https://example.com/hook2', subscriptions: [subscription('note.created')] } },
      }),
    );
    expect(updated.data).toMatchObject({
      target_url: 'https://example.com/hook2',
      subscriptions: [{ event_type: 'note.created', filter: null }],
    });

    const deleted = await f.call('DELETE', `/webhooks/${id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({});
    expectError('getWebhook', await f.call('GET', `/webhooks/${id}`), 404, 'not_found');
    expectError('deleteWebhook', await f.call('DELETE', `/webhooks/${randomUUID()}`), 404, 'not_found');
  });

  it('409 uniqueness_conflict for the same target URL, event type and filter; 400 for http targets', async () => {
    const body = {
      data: {
        target_url: 'https://example.com/unique',
        subscriptions: [
          subscription('task.created', { $or: [{ field: 'actor.type', operator: 'equals', value: 'api-token' }] }),
        ],
      },
    };
    expectOk('createWebhook', await f.call('POST', '/webhooks', { body }));
    const conflict = expectError(
      'createWebhook',
      await f.call('POST', '/webhooks', { body }),
      409,
      'uniqueness_conflict',
    );
    expect(conflict.message).toBe(
      'Each subscription must have a unique combination of target URL, event type and filter.',
    );
    expectError(
      'createWebhook',
      await f.call('POST', '/webhooks', {
        body: { data: { target_url: 'http://example.com/plain', subscriptions: [subscription('task.created')] } },
      }),
      400,
      'validation_type',
    );
  });

  it('needs the webhook scopes and a workspace-level token', async () => {
    const readOnly = await f.mint(['webhook:read']);
    expectOk('listWebhooks', await f.call('GET', '/webhooks', { token: readOnly }));
    expectError(
      'createWebhook',
      await f.call('POST', '/webhooks', {
        token: readOnly,
        body: { data: { target_url: 'https://example.com/x', subscriptions: [subscription('task.created')] } },
      }),
      403,
      'unauthorized',
    );
    const userToken = await h.domain.apiTokens.create(systemContext(f.workspaceId, 'test'), {
      name: 'User-level',
      scopes: ['webhook:read-write'],
      tokenLevel: 'user',
      authorizedByMemberId: f.memberId,
    });
    expectError('listWebhooks', await f.call('GET', '/webhooks', { token: userToken.token }), 403, 'unauthorized');
  });
});

describe('deliveries', () => {
  it('events of /v2 writes are delivered signed and match the webhooks OpenAPI', async () => {
    const created = expectOk(
      'createWebhook',
      await f.call('POST', '/webhooks', {
        body: {
          data: {
            target_url: 'https://example.com/events',
            subscriptions: [
              'record.created',
              'record.updated',
              'record.deleted',
              'list-entry.created',
              'note.created',
              'task.created',
              'comment.created',
            ].map((t) => subscription(t)),
          },
        },
      }),
    );
    const webhookId = created.data.id.webhook_id as string;
    const secret = created.data.secret as string;

    const company = expectOk(
      'createRecord',
      await f.call('POST', '/objects/companies/records', { body: { data: { values: { name: 'Initech' } } } }),
    );
    const recordId = company.data.id.record_id as string;
    expectOk(
      'updateRecord',
      await f.call('PATCH', `/objects/companies/records/${recordId}`, {
        body: { data: { values: { name: 'Initrode' } } },
      }),
    );
    const list = expectOk(
      'createList',
      await f.call('POST', '/lists', {
        body: {
          data: {
            name: 'Hooks',
            api_slug: 'hooks',
            parent_object: 'companies',
            workspace_access: 'full-access',
            workspace_member_access: [],
          },
        },
      }),
    );
    expectOk(
      'createEntry',
      await f.call('POST', `/lists/${list.data.id.list_id}/entries`, {
        body: { data: { parent_record_id: recordId, parent_object: 'companies', entry_values: {} } },
      }),
    );
    expectOk(
      'createNote',
      await f.call('POST', '/notes', {
        body: {
          data: {
            parent_object: 'companies',
            parent_record_id: recordId,
            title: 'Hello',
            format: 'plaintext',
            content: 'Hi',
          },
        },
      }),
    );
    expectOk(
      'createTask',
      await f.call('POST', '/tasks', {
        body: {
          data: {
            content: 'Follow up',
            format: 'plaintext',
            deadline_at: null,
            is_completed: false,
            linked_records: [],
            assignees: [],
          },
        },
      }),
    );
    expectOk(
      'createComment',
      await f.call('POST', '/comments', {
        body: {
          data: {
            format: 'plaintext',
            content: 'Looks good',
            author: { type: 'workspace-member', id: f.memberId },
            record: { object: 'companies', record_id: recordId },
          },
        },
      }),
    );
    const deleted = await f.call('DELETE', `/objects/companies/records/${recordId}`);
    expect(deleted.status).toBe(200);

    // Transactions of parallel test files hold the fan-out bound back for a moment: poll until all arrive.
    for (const deadline = Date.now() + 15_000; Date.now() < deadline; ) {
      await h.domain.webhooks.fanOut();
      await h.domain.webhooks.deliverDue({ limit: 100 });
      if (sent.filter((s) => JSON.parse(s.body).webhook_id === webhookId).length >= 7) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const mine = sent.filter((s) => JSON.parse(s.body).webhook_id === webhookId);
    const types = mine.map((s) => JSON.parse(s.body).events[0].event_type);
    expect(types.sort()).toEqual(
      [
        'comment.created',
        'list-entry.created',
        'note.created',
        'record.created',
        'record.deleted',
        'record.updated',
        'task.created',
      ].sort(),
    );
    for (const s of mine) {
      expect(s.headers['attio-signature']).toBe(createHmac('sha256', secret).update(s.body).digest('hex'));
      expect(JSON.parse(s.body).events[0].actor).toEqual({ type: 'api-token', id: f.tokenId });
    }
  });
});
