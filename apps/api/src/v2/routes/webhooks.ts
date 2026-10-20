// Webhooks (BACKLOG 6.07; api.json /v2/webhooks; docs rest-api/guides/webhooks): list (limit / offset), create
// (answers the signing secret), get, update (target URL, subscriptions), delete. Workspace-level tokens only (user-level
// tokens get 403, "Supported token levels"); scopes webhook:read / webhook:read-write.
import type { Webhook, WebhookFilter } from '@agentic-crm/contracts';
import { webhookFilterSchema } from '@agentic-crm/contracts';
import {
  createWebhookBody,
  getWebhookPathParams,
  listWebhooksQuery,
  updateWebhookBody,
  v2Operations,
} from '@agentic-crm/contracts/v2';
import type { V2Context } from '../context';
import { publicErrors, withHints } from '../errors';
import { attioTimestamp } from '../mappers';
import { page, params, parseInput, type RouteSpec } from '../route';

type PublicSubscription = { event_type: string; filter?: unknown };

function toPublic(webhook: Webhook, secret?: string) {
  return {
    target_url: webhook.targetUrl,
    subscriptions: webhook.subscriptions.map((s) => ({ event_type: s.eventType, filter: s.filter })),
    id: { workspace_id: webhook.workspaceId, webhook_id: webhook.id },
    status: webhook.status,
    created_at: attioTimestamp(webhook.createdAt),
    ...(secret !== undefined ? { secret } : {}),
  };
}

function toSubscriptions(input: PublicSubscription[]) {
  return input.map((s, i) => {
    const filter = webhookFilterSchema.safeParse(s.filter ?? null);
    if (!filter.success) {
      throw publicErrors.validation(
        `Invalid filter for subscription ${i}: use {"$and": [...]} or {"$or": [...]} or null.`,
      );
    }
    return {
      eventType: s.event_type as Webhook['subscriptions'][number]['eventType'],
      filter: filter.data as WebhookFilter,
    };
  });
}

function webhookIdParam(raw: Record<string, string>): string {
  const parsed = getWebhookPathParams.safeParse(raw);
  if (!parsed.success) throw publicErrors.notFound(`Webhook with ID "${raw.webhook_id ?? ''}" was not found.`);
  return parsed.data.webhook_id.toLowerCase();
}

/** "Webhook endpoints are workspace-level only." */
function requireWorkspaceToken(v2: V2Context): void {
  if (v2.identity.token.tokenLevel !== 'workspace') {
    throw publicErrors.forbidden('This endpoint only supports workspace-level access tokens.');
  }
}

const notFound = (id: string) => publicErrors.notFound(`Webhook with ID "${id}" was not found.`);

/** Domain errors of webhook calls: unknown webhooks get Attio's message; uniqueness conflicts its 409. */
async function onWebhook<T>(id: string | null, fn: () => Promise<T>): Promise<T> {
  try {
    return await withHints({}, fn);
  } catch (err) {
    const e = err as { statusCode?: number; code?: string };
    if (id && e.statusCode === 404) throw notFound(id);
    throw err;
  }
}

export const webhookRoutes: RouteSpec[] = [
  {
    method: 'GET',
    url: '/webhooks',
    scopes: v2Operations.listWebhooks.scopes,
    async handler(v2, request) {
      requireWorkspaceToken(v2);
      const query = parseInput(listWebhooksQuery, request.query, 'query parameters');
      const webhooks = await onWebhook(null, () => v2.domain.webhooks.list(v2.ctx));
      return { data: page(webhooks, { limit: query.limit ?? 10, offset: query.offset ?? 0 }).map((w) => toPublic(w)) };
    },
  },
  {
    method: 'POST',
    url: '/webhooks',
    scopes: v2Operations.createWebhook.scopes,
    async handler(v2, request) {
      requireWorkspaceToken(v2);
      const { data } = parseInput(createWebhookBody, request.body, 'request body');
      const created = await onWebhook(null, () =>
        v2.domain.webhooks.create(v2.ctx, {
          targetUrl: data.target_url,
          subscriptions: toSubscriptions(data.subscriptions),
        }),
      );
      return { data: toPublic(created, created.secret) };
    },
  },
  {
    method: 'GET',
    url: '/webhooks/:webhook_id',
    scopes: v2Operations.getWebhook.scopes,
    async handler(v2, request) {
      requireWorkspaceToken(v2);
      const id = webhookIdParam(params(request));
      return { data: toPublic(await onWebhook(id, () => v2.domain.webhooks.get(v2.ctx, id))) };
    },
  },
  {
    method: 'PATCH',
    url: '/webhooks/:webhook_id',
    scopes: v2Operations.updateWebhook.scopes,
    async handler(v2, request) {
      requireWorkspaceToken(v2);
      const id = webhookIdParam(params(request));
      const { data } = parseInput(updateWebhookBody, request.body, 'request body');
      const updated = await onWebhook(id, () =>
        v2.domain.webhooks.update(v2.ctx, {
          webhookId: id,
          ...(data.target_url !== undefined ? { targetUrl: data.target_url } : {}),
          ...(data.subscriptions !== undefined ? { subscriptions: toSubscriptions(data.subscriptions) } : {}),
        }),
      );
      return { data: toPublic(updated) };
    },
  },
  {
    method: 'DELETE',
    url: '/webhooks/:webhook_id',
    scopes: v2Operations.deleteWebhook.scopes,
    async handler(v2, request) {
      requireWorkspaceToken(v2);
      const id = webhookIdParam(params(request));
      await onWebhook(id, () => v2.domain.webhooks.delete(v2.ctx, id));
      return {};
    },
  },
];
