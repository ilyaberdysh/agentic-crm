// Developers → Webhooks (BACKLOG 6.07; J workspace-admin §6): target URL (https), event subscriptions (filters are
// kept; the dialog shows "This event is filtered to a subset of values"), Activate / Deactivate, delete, "Test
// subscription" (a sample delivered right away), the delivery log and the signing secret. Admin-only.
import {
  createWebhookInputSchema,
  listWebhookDeliveriesInputSchema,
  testWebhookInputSchema,
  updateWebhookInputSchema,
  uuidSchema,
  webhookIdInputSchema,
} from '@agentic-crm/contracts';
import { z } from 'zod';
import { acceptAfterOnly, withSeq } from '../mutation';
import { adminProcedure, router } from '../trpc';

export const webhooksRouter = router({
  list: adminProcedure.input(acceptAfterOnly).query(({ ctx }) => ctx.domain.webhooks.list(ctx.service)),

  get: adminProcedure
    .input(webhookIdInputSchema)
    .query(({ ctx, input }) => ctx.domain.webhooks.get(ctx.service, input.webhookId)),

  /** "New webhook": answers the webhook with its signing `secret`. 409 SUBSCRIPTION_CONFLICT for duplicates. */
  create: adminProcedure.input(createWebhookInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.webhooks.create(svc, input));
    return { webhook: result, seq };
  }),

  /** "Edit webhook" (URL, subscriptions) and Activate / Deactivate (`status`). */
  update: adminProcedure.input(updateWebhookInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.webhooks.update(svc, input));
    return { webhook: result, seq };
  }),

  delete: adminProcedure.input(z.object({ webhookId: uuidSchema })).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.webhooks.delete(svc, input.webhookId));
    return { ...result, seq };
  }),

  /** "Test subscription": one attempt with a sample payload; answers the delivery (status, response code). */
  test: adminProcedure.input(testWebhookInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.webhooks.test(svc, input));
    return { delivery: result, seq };
  }),

  /** Delivery log, newest first. */
  deliveries: adminProcedure
    .input(listWebhookDeliveriesInputSchema)
    .query(({ ctx, input }) => ctx.domain.webhooks.deliveries(ctx.service, input)),

  /** The signing secret ("Show secret"). */
  secret: adminProcedure
    .input(webhookIdInputSchema)
    .query(({ ctx, input }) => ctx.domain.webhooks.secret(ctx.service, input.webhookId)),
});
