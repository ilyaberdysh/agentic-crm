// Webhooks (BACKLOG 6.07; J workspace-admin §6; Attio docs rest-api/guides/webhooks and the webhooks OpenAPI). A
// webhook = an https target URL + subscriptions (event type + optional filter). The worker turns committed domain
// events (change_log) into deliveries: POST {webhook_id, events:[event]} signed with HMAC-SHA256 of the body
// (`Attio-Signature`, duplicated as `X-Attio-Signature`), `Idempotency-Key` per delivery, retried with exponential
// back-off up to 10 times; then the webhook is marked degraded.
import { z } from 'zod';
import { acceptAfterSchema, timestampSchema, uuidSchema } from './common.ts';

/** The event catalogue the app produces (webhooks.json; the 27 types the settings dialog offers). */
export const webhookEventTypes = [
  'call-recording.created',
  'comment.created',
  'comment.resolved',
  'comment.unresolved',
  'comment.deleted',
  'list.created',
  'list.updated',
  'list.deleted',
  'list-attribute.created',
  'list-attribute.updated',
  'list-entry.created',
  'list-entry.updated',
  'list-entry.deleted',
  'object-attribute.created',
  'object-attribute.updated',
  'note.created',
  'note-content.updated',
  'note.updated',
  'note.deleted',
  'record.created',
  'record.merged',
  'record.updated',
  'record.deleted',
  'task.created',
  'task.updated',
  'task.deleted',
  'workspace-member.created',
] as const;
export type WebhookEventType = (typeof webhookEventTypes)[number];

/** Types the public API also accepts (api.json enum: activities are not produced by this app). */
export const publicWebhookEventTypes = [
  'activity.created',
  'activity.updated',
  'activity.deleted',
  'activity-attribute.created',
  'activity-attribute.updated',
  'activity-record.created',
  'activity-record.deleted',
  ...webhookEventTypes,
] as const;
export const webhookEventTypeSchema = z.enum(publicWebhookEventTypes);

const filterOperation = z.object({
  /** Dot path into the event payload, e.g. "id.list_id", "actor.type". */
  field: z.string().min(1).max(200),
  operator: z.enum(['equals', 'not_equals']),
  value: z.string().max(500),
});
export const webhookFilterSchema = z
  .union([z.object({ $and: z.array(filterOperation).max(50) }), z.object({ $or: z.array(filterOperation).max(50) })])
  .nullable();
export type WebhookFilter = z.infer<typeof webhookFilterSchema>;

export const webhookSubscriptionSchema = z.object({
  eventType: webhookEventTypeSchema,
  filter: webhookFilterSchema,
});
export type WebhookSubscription = z.infer<typeof webhookSubscriptionSchema>;

export const webhookStatusSchema = z.enum(['active', 'degraded', 'inactive']);
export type WebhookStatus = z.infer<typeof webhookStatusSchema>;

/** "Must provide secure URL": https only. */
export const webhookTargetUrlSchema = z.url({ protocol: /^https$/, error: 'Must provide secure URL' }).max(2000);

export const webhookSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  targetUrl: z.string(),
  subscriptions: z.array(webhookSubscriptionSchema),
  status: webhookStatusSchema,
  createdAt: timestampSchema,
  createdBy: z.unknown(),
  /** Last delivery outcome, for the settings list. */
  lastDeliveryAt: timestampSchema.nullable(),
});
export type Webhook = z.infer<typeof webhookSchema>;

/** Creation answers the signing secret (also readable later by admins, as Attio's GET …/secret). */
export const createdWebhookSchema = webhookSchema.extend({ secret: z.string() });
export type CreatedWebhook = z.infer<typeof createdWebhookSchema>;

export const createWebhookInputSchema = z.object({
  id: uuidSchema.optional(),
  targetUrl: webhookTargetUrlSchema,
  subscriptions: z.array(webhookSubscriptionSchema).min(1, 'Must have at least one event').max(100),
});
export type CreateWebhookInput = z.input<typeof createWebhookInputSchema>;

export const updateWebhookInputSchema = z.object({
  webhookId: uuidSchema,
  targetUrl: webhookTargetUrlSchema.optional(),
  subscriptions: z.array(webhookSubscriptionSchema).min(1, 'Must have at least one event').max(100).optional(),
  /** Activate / Deactivate. */
  status: z.enum(['active', 'inactive']).optional(),
});
export type UpdateWebhookInput = z.input<typeof updateWebhookInputSchema>;

export const webhookIdInputSchema = z.object({ webhookId: uuidSchema, acceptAfter: acceptAfterSchema });

export const testWebhookInputSchema = z.object({
  webhookId: uuidSchema,
  /** "Test subscription": one of the webhook's event types (default: its first). */
  eventType: webhookEventTypeSchema.optional(),
});
export type TestWebhookInput = z.input<typeof testWebhookInputSchema>;

export const webhookDeliveryAttemptSchema = z.object({
  at: timestampSchema,
  statusCode: z.number().int().nullable(),
  error: z.string().nullable(),
  durationMs: z.number().int(),
});

export const webhookDeliverySchema = z.object({
  /** Also the Idempotency-Key header (same across retries). */
  id: uuidSchema,
  webhookId: uuidSchema,
  eventType: z.string(),
  isTest: z.boolean(),
  status: z.enum(['pending', 'succeeded', 'failed']),
  attempts: z.number().int(),
  nextAttemptAt: timestampSchema.nullable(),
  lastStatusCode: z.number().int().nullable(),
  lastError: z.string().nullable(),
  payload: z.unknown(),
  attemptLog: z.array(webhookDeliveryAttemptSchema),
  createdAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
});
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;

export const listWebhookDeliveriesInputSchema = z.object({
  webhookId: uuidSchema,
  limit: z.number().int().min(1).max(200).default(50),
  acceptAfter: acceptAfterSchema,
});
export type ListWebhookDeliveriesInput = z.input<typeof listWebhookDeliveriesInputSchema>;

/** Retry schedule: 10 attempts with exponential back-off over ≈ 3 days (Attio "Delivery attempts"). */
export const WEBHOOK_MAX_ATTEMPTS = 10;
/** Seconds to wait after the n-th failed attempt (1-based): 8.5 min · 2^(n−1) — the 9 waits add up to ≈ 3 days. */
export function webhookRetryDelaySeconds(failedAttempts: number): number {
  return 510 * 2 ** Math.min(Math.max(0, failedAttempts - 1), 12);
}
/** Target response deadline (Attio: 5 s). */
export const WEBHOOK_TIMEOUT_MS = 5000;
