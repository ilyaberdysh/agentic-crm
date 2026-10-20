// webhooks.*: target URL (https only) +
// subscriptions (event type and optional filter), status Active / Degraded / Inactive, signing secret, delivery log
// and "Test subscription". Administration is for admins and workspace-level API tokens (the /v2 webhook endpoints are
// "workspace-level only"); each (target URL, event type, filter) is unique within the workspace (409).
import { randomBytes } from 'node:crypto';
import {
  type CreatedWebhook,
  type CreateWebhookInput,
  createWebhookInputSchema,
  type ListWebhookDeliveriesInput,
  listWebhookDeliveriesInputSchema,
  type TestWebhookInput,
  testWebhookInputSchema,
  type UpdateWebhookInput,
  updateWebhookInputSchema,
  type Webhook,
  type WebhookDelivery,
  type WebhookFilter,
  type WebhookSubscription,
} from '@agentic-crm/contracts';
import { jsonb } from '@agentic-crm/db';
import { conflict, forbidden, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import { callerAccessLevel } from '../permissions/admin.ts';
import type { Tx } from '../tx.ts';
import { samplePayloadEvent } from './samples.ts';

const webhookNotFound = (id: string) => notFound(`Webhook with ID "${id}" was not found.`, { webhook_id: id });

/** Admins, the system and workspace-level API tokens manage webhooks; user-level tokens cannot (workspace-level only). */
export async function requireDeveloperAccess(tx: Tx): Promise<void> {
  const actor = tx.ctx.actor;
  if (actor.type === 'system') return;
  if (actor.type === 'api-token') {
    if (tx.ctx.onBehalfOfMemberId) throw forbidden('This endpoint only accepts workspace-level access tokens');
    return;
  }
  if ((await callerAccessLevel(tx)) !== 'admin') throw forbidden('Only workspace admins can manage webhooks');
}

/** Canonical filter text for uniqueness: key and operation order ignored; null = an empty $and. */
export function filterKey(filter: WebhookFilter): string {
  if (!filter) return JSON.stringify({ $and: [] });
  const join = '$and' in filter ? '$and' : '$or';
  const ops = ('$and' in filter ? filter.$and : filter.$or)
    .map((o) => JSON.stringify([o.field, o.operator, o.value]))
    .sort();
  if (join === '$and' && ops.length === 0) return JSON.stringify({ $and: [] });
  return JSON.stringify({ [join]: ops });
}

const uniquenessConflict = () =>
  conflict(
    'SUBSCRIPTION_CONFLICT',
    'Each subscription must have a unique combination of target URL, event type and filter.',
  );

async function assertUnique(
  tx: Tx,
  targetUrl: string,
  subscriptions: WebhookSubscription[],
  excludeWebhookId: string | null,
): Promise<void> {
  const keys = subscriptions.map((s) => `${s.eventType}\n${filterKey(s.filter)}`);
  if (new Set(keys).size !== keys.length) throw uniquenessConflict();
  const others = await tx.db
    .selectFrom('webhook_subscriptions as s')
    .innerJoin('webhooks as w', 'w.id', 's.webhook_id')
    .select(['s.event_type', 's.filter_key'])
    .where('w.target_url', '=', targetUrl)
    .where('w.deleted_at', 'is', null)
    .$if(excludeWebhookId !== null, (q) => q.where('w.id', '!=', excludeWebhookId as string))
    .execute();
  const taken = new Set(others.map((o) => `${o.event_type}\n${o.filter_key}`));
  if (keys.some((k) => taken.has(k))) throw uniquenessConflict();
}

async function requireWebhook(tx: Tx, webhookId: string) {
  const row = await tx.db
    .selectFrom('webhooks')
    .selectAll()
    .where('id', '=', webhookId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw webhookNotFound(webhookId);
  return row;
}

async function toWebhooks(tx: Tx, rows: Awaited<ReturnType<typeof requireWebhook>>[]): Promise<Webhook[]> {
  if (rows.length === 0) return [];
  const subs = await tx.db
    .selectFrom('webhook_subscriptions')
    .selectAll()
    .where(
      'webhook_id',
      'in',
      rows.map((r) => r.id),
    )
    .orderBy('position')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    targetUrl: r.target_url,
    subscriptions: subs
      .filter((s) => s.webhook_id === r.id)
      .map((s) => ({
        eventType: s.event_type as WebhookSubscription['eventType'],
        filter: (s.filter ?? null) as WebhookFilter,
      })),
    status: r.status,
    createdAt: r.created_at,
    createdBy: r.created_by,
    lastDeliveryAt: r.last_delivery_at,
  }));
}

async function writeSubscriptions(tx: Tx, webhookId: string, subscriptions: WebhookSubscription[]): Promise<void> {
  await tx.db.deleteFrom('webhook_subscriptions').where('webhook_id', '=', webhookId).execute();
  await tx.db
    .insertInto('webhook_subscriptions')
    .values(
      subscriptions.map((s, i) => ({
        id: newId(),
        workspace_id: tx.workspaceId,
        webhook_id: webhookId,
        event_type: s.eventType,
        filter: jsonb(s.filter ?? null),
        filter_key: filterKey(s.filter ?? null),
        position: i,
      })),
    )
    .execute();
}

function emitWebhook(tx: Tx, webhookId: string): void {
  tx.emit('webhook', webhookId, { webhookId });
  tx.emit('webhook-list', null);
}

type DeliveryRow = {
  id: string;
  webhook_id: string;
  event_type: string;
  is_test: boolean;
  status: 'pending' | 'succeeded' | 'failed';
  attempts: number;
  next_attempt_at: string | null;
  last_status_code: number | null;
  last_error: string | null;
  payload: unknown;
  attempt_log: unknown;
  created_at: string;
  completed_at: string | null;
};

export function toDelivery(r: DeliveryRow): WebhookDelivery {
  return {
    id: r.id,
    webhookId: r.webhook_id,
    eventType: r.event_type,
    isTest: r.is_test,
    status: r.status,
    attempts: r.attempts,
    nextAttemptAt: r.status === 'pending' ? r.next_attempt_at : null,
    lastStatusCode: r.last_status_code,
    lastError: r.last_error,
    payload: r.payload,
    attemptLog: (r.attempt_log ?? []) as WebhookDelivery['attemptLog'],
    createdAt: r.created_at,
    completedAt: r.completed_at,
  };
}

export const webhookOps = {
  async list(tx: Tx): Promise<Webhook[]> {
    await requireDeveloperAccess(tx);
    const rows = await tx.db
      .selectFrom('webhooks')
      .selectAll()
      .where('deleted_at', 'is', null)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return toWebhooks(tx, rows);
  },

  async get(tx: Tx, webhookId: string): Promise<Webhook> {
    await requireDeveloperAccess(tx);
    return (await toWebhooks(tx, [await requireWebhook(tx, webhookId)]))[0] as Webhook;
  },

  /** "New webhook": answers the signing secret (also readable later through secret()). Idempotent per client id. */
  async create(tx: Tx, input: CreateWebhookInput): Promise<CreatedWebhook> {
    const data = createWebhookInputSchema.parse(input);
    await requireDeveloperAccess(tx);
    const id = data.id ?? newId();
    const existing = await tx.db.selectFrom('webhooks').selectAll().where('id', '=', id).executeTakeFirst();
    if (existing) {
      if (existing.deleted_at !== null) throw conflict('ID_CONFLICT', 'This webhook id belonged to a deleted webhook');
      return { ...((await toWebhooks(tx, [existing]))[0] as Webhook), secret: existing.secret };
    }
    await assertUnique(tx, data.targetUrl, data.subscriptions, null);
    const secret = randomBytes(32).toString('hex');
    await tx.db
      .insertInto('webhooks')
      .values({
        id,
        workspace_id: tx.workspaceId,
        target_url: data.targetUrl,
        status: 'active',
        secret,
        created_by: jsonb(tx.ctx.actor),
        created_at: tx.now,
        updated_at: tx.now,
      })
      .execute();
    await writeSubscriptions(tx, id, data.subscriptions);
    emitWebhook(tx, id);
    return { ...(await webhookOps.get(tx, id)), secret };
  },

  /** "Edit webhook" / Activate / Deactivate; subscriptions are replaced as a whole. */
  async update(tx: Tx, input: UpdateWebhookInput): Promise<Webhook> {
    const data = updateWebhookInputSchema.parse(input);
    await requireDeveloperAccess(tx);
    const row = await requireWebhook(tx, data.webhookId);
    const current = (await toWebhooks(tx, [row]))[0] as Webhook;
    const targetUrl = data.targetUrl ?? row.target_url;
    const subscriptions = data.subscriptions ?? current.subscriptions;
    if (data.targetUrl !== undefined || data.subscriptions !== undefined) {
      await assertUnique(tx, targetUrl, subscriptions, row.id);
    }
    await tx.db
      .updateTable('webhooks')
      .set({
        target_url: targetUrl,
        ...(data.status !== undefined ? { status: data.status, degraded_at: null } : {}),
        updated_at: tx.now,
      })
      .where('id', '=', row.id)
      .execute();
    if (data.subscriptions !== undefined) await writeSubscriptions(tx, row.id, subscriptions);
    emitWebhook(tx, row.id);
    return webhookOps.get(tx, row.id);
  },

  /** "Are you sure you want to delete this webhook? Any connected services will stop functioning." */
  async delete(tx: Tx, webhookId: string): Promise<{ id: string }> {
    await requireDeveloperAccess(tx);
    const row = await requireWebhook(tx, webhookId);
    await tx.db
      .updateTable('webhooks')
      .set({ deleted_at: tx.now, status: 'inactive', updated_at: tx.now })
      .where('id', '=', row.id)
      .execute();
    await tx.db
      .updateTable('webhook_deliveries')
      .set({ status: 'failed', last_error: 'Webhook deleted', completed_at: tx.now })
      .where('webhook_id', '=', row.id)
      .where('status', '=', 'pending')
      .execute();
    emitWebhook(tx, row.id);
    return { id: row.id };
  },

  /** The signing secret (admins only). */
  async secret(tx: Tx, webhookId: string): Promise<{ secret: string }> {
    await requireDeveloperAccess(tx);
    return { secret: (await requireWebhook(tx, webhookId)).secret };
  },

  /** Delivery log, newest first. */
  async deliveries(tx: Tx, input: ListWebhookDeliveriesInput): Promise<WebhookDelivery[]> {
    const data = listWebhookDeliveriesInputSchema.parse(input);
    await requireDeveloperAccess(tx);
    await requireWebhook(tx, data.webhookId);
    const rows = await tx.db
      .selectFrom('webhook_deliveries')
      .selectAll()
      .where('webhook_id', '=', data.webhookId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(data.limit)
      .execute();
    return rows.map(toDelivery);
  },

  async delivery(tx: Tx, deliveryId: string): Promise<WebhookDelivery> {
    const row = await tx.db
      .selectFrom('webhook_deliveries')
      .selectAll()
      .where('id', '=', deliveryId)
      .executeTakeFirst();
    if (!row) throw notFound('The delivery could not be found', { delivery_id: deliveryId });
    return toDelivery(row);
  },

  /**
   * "Test subscription": queues a sample event of the type (real ids from the workspace when there are some; filters
   * are not applied) as a test delivery; the caller attempts it right away (index.ts).
   */
  async createTestDelivery(tx: Tx, input: TestWebhookInput): Promise<WebhookDelivery> {
    const data = testWebhookInputSchema.parse(input);
    await requireDeveloperAccess(tx);
    const row = await requireWebhook(tx, data.webhookId);
    const webhook = (await toWebhooks(tx, [row]))[0] as Webhook;
    const eventType = data.eventType ?? webhook.subscriptions[0]?.eventType ?? 'record.created';
    const event = await samplePayloadEvent(tx, eventType);
    const id = newId();
    await tx.db
      .insertInto('webhook_deliveries')
      .values({
        id,
        workspace_id: tx.workspaceId,
        webhook_id: row.id,
        event_type: eventType,
        payload: jsonb({ webhook_id: row.id, events: [event] }),
        is_test: true,
        status: 'pending',
        next_attempt_at: tx.now,
        created_at: tx.now,
      })
      .execute();
    emitWebhook(tx, row.id);
    return webhookOps.delivery(tx, id);
  },
};
