// Email (BACKLOG 7.03 server, 7.06–7.07 server; slice7-contracts.md procedure names): the record Emails tab and the
// email modal with visibility applied, sharing grants, drafts (autosave per field), review, send, outbox, templates,
// signatures and variable values; plus the test connector's dev API (`connectors.test.*`, refused in production
// unless AGENTIC_CRM_ENABLE_TEST_CONNECTOR=1). Thin adapters over packages/domain (I5).
import {
  cancelOutboxInputSchema,
  createDraftAttachmentInputSchema,
  createDraftInputSchema,
  createSignatureInputSchema,
  createTemplateInputSchema,
  draftAttachmentRefInputSchema,
  draftIdInputSchema,
  favoriteTemplateInputSchema,
  getEmailInputSchema,
  getThreadInputSchema,
  injectEventInputSchema,
  injectMessageInputSchema,
  listGrantsInputSchema,
  listOutboxInputSchema,
  listRecordThreadsInputSchema,
  mailboxIdInputSchema,
  putGrantInputSchema,
  removeGrantInputSchema,
  removeInjectedInputSchema,
  sendDraftInputSchema,
  signatureIdInputSchema,
  templateIdInputSchema,
  updateDraftInputSchema,
  updateSignatureInputSchema,
  updateTemplateInputSchema,
  uuidSchema,
  variableValuesInputSchema,
} from '@agentic-crm/contracts';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { acceptAfterOnly, withSeq } from '../mutation';
import { router, workspaceProcedure } from '../trpc';

const strip = <T extends { acceptAfter?: unknown }>(input: T) => {
  const { acceptAfter: _, ...rest } = input;
  return rest;
};

export const emailRouter = router({
  /** Record Emails tab: threads with the viewer's access ("via N mailboxes", restricted subjects). */
  threads: workspaceProcedure
    .input(listRecordThreadsInputSchema)
    .query(({ ctx, input }) => ctx.domain.email.threads(ctx.service, strip(input))),

  /** Email modal: one message (restricted shape below full access; 404 for protected emails). */
  get: workspaceProcedure
    .input(getEmailInputSchema)
    .query(({ ctx, input }) => ctx.domain.email.get(ctx.service, { messageId: input.messageId })),

  thread: workspaceProcedure
    .input(getThreadInputSchema)
    .query(({ ctx, input }) => ctx.domain.email.thread(ctx.service, { threadId: input.threadId })),

  /** Email modal "Share" and Emails tab "Manage access". */
  grants: router({
    list: workspaceProcedure
      .input(listGrantsInputSchema)
      .query(({ ctx, input }) => ctx.domain.email.grants.list(ctx.service, strip(input))),
    put: workspaceProcedure.input(putGrantInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.email.grants.put(svc, input));
      return { grant: result, seq };
    }),
    remove: workspaceProcedure.input(removeGrantInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.email.grants.remove(svc, input));
      return { ...result, seq };
    }),
  }),

  drafts: router({
    list: workspaceProcedure.input(acceptAfterOnly).query(({ ctx }) => ctx.domain.email.drafts.list(ctx.service)),
    get: workspaceProcedure
      .input(draftIdInputSchema)
      .query(({ ctx, input }) => ctx.domain.email.drafts.get(ctx.service, input.draftId)),
    /** Opening the composer creates the draft (client-minted id); `templateId` = "Use template". */
    create: workspaceProcedure.input(createDraftInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.email.drafts.create(svc, input));
      return { draft: result, seq };
    }),
    /** Autosave: only the given fields are written (each stamped in fieldUpdatedAt). */
    update: workspaceProcedure.input(updateDraftInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.email.drafts.update(svc, input));
      return { draft: result, seq };
    }),
    delete: workspaceProcedure.input(z.object({ draftId: uuidSchema })).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.email.drafts.delete(svc, input.draftId));
      return { ...result, seq };
    }),
    /** Review step: each email as it will be sent (merged variables), and the issues that block sending. */
    review: workspaceProcedure
      .input(draftIdInputSchema)
      .query(({ ctx, input }) => ctx.domain.email.drafts.review(ctx.service, input.draftId)),
    send: workspaceProcedure.input(sendDraftInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.email.drafts.send(svc, input));
      return { ...result, seq };
    }),
    /** Attachments: create (presigned PUT) → upload → commit; remove. */
    attachments: router({
      create: workspaceProcedure.input(createDraftAttachmentInputSchema).mutation(async ({ ctx, input }) => {
        const { result, seq } = await withSeq(ctx.service, (svc) =>
          ctx.domain.email.drafts.attachments.create(svc, input),
        );
        return { ...result, seq };
      }),
      commit: workspaceProcedure.input(draftAttachmentRefInputSchema).mutation(async ({ ctx, input }) => {
        const { result, seq } = await withSeq(ctx.service, (svc) =>
          ctx.domain.email.drafts.attachments.commit(svc, input),
        );
        return { attachment: result, seq };
      }),
      remove: workspaceProcedure.input(draftAttachmentRefInputSchema).mutation(async ({ ctx, input }) => {
        const { result, seq } = await withSeq(ctx.service, (svc) =>
          ctx.domain.email.drafts.attachments.remove(svc, input),
        );
        return { ...result, seq };
      }),
    }),
  }),

  outbox: router({
    /** Scheduled and erroring emails plus failures of the last three months (with failure reasons). */
    list: workspaceProcedure.input(listOutboxInputSchema).query(({ ctx, input }) => {
      const { acceptAfter: _, ...query } = input ?? {};
      return ctx.domain.email.outbox.list(ctx.service, query);
    }),
    /** "Cancel email" (`{ids}`) / "Cancel all emails" (`{all: true}`). */
    cancel: workspaceProcedure.input(cancelOutboxInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.email.outbox.cancel(svc, input));
      return { canceled: result, seq };
    }),
  }),

  /** Email templates (bodies are documents edited through apps/collab, or replaced here). */
  templates: router({
    list: workspaceProcedure.input(acceptAfterOnly).query(({ ctx }) => ctx.domain.email.templates.list(ctx.service)),
    get: workspaceProcedure
      .input(templateIdInputSchema)
      .query(({ ctx, input }) => ctx.domain.email.templates.get(ctx.service, input.templateId)),
    create: workspaceProcedure.input(createTemplateInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.email.templates.create(svc, input));
      return { template: result, seq };
    }),
    update: workspaceProcedure.input(updateTemplateInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.email.templates.update(svc, input));
      return { template: result, seq };
    }),
    delete: workspaceProcedure.input(z.object({ templateId: uuidSchema })).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) =>
        ctx.domain.email.templates.delete(svc, input.templateId),
      );
      return { ...result, seq };
    }),
    /** "Add to favorites" / remove (per member). */
    favorite: workspaceProcedure.input(favoriteTemplateInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.email.templates.favorite(svc, input));
      return { template: result, seq };
    }),
  }),

  /** Mailbox signatures (the first one becomes the default). */
  signatures: router({
    list: workspaceProcedure
      .input(mailboxIdInputSchema)
      .query(({ ctx, input }) => ctx.domain.email.signatures.list(ctx.service, input.mailboxId)),
    create: workspaceProcedure.input(createSignatureInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.email.signatures.create(svc, input));
      return { signature: result, seq };
    }),
    update: workspaceProcedure.input(updateSignatureInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.email.signatures.update(svc, input));
      return { signature: result, seq };
    }),
    setDefault: workspaceProcedure
      .input(signatureIdInputSchema.extend({ isDefault: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.email.signatures.setDefault(svc, input));
        return { signature: result, seq };
      }),
    delete: workspaceProcedure.input(signatureIdInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) =>
        ctx.domain.email.signatures.delete(svc, input.signatureId),
      );
      return { ...result, seq };
    }),
  }),

  /** Merge-field preview: values of variables for recipient records (fallbacks not applied). */
  variables: workspaceProcedure
    .input(variableValuesInputSchema)
    .query(({ ctx, input }) => ctx.domain.email.variables(ctx.service, strip(input))),
});

/** Dev + tests only: the test connector's inject API. */
const testConnectorProcedure = workspaceProcedure.use(({ next }) => {
  if (process.env.NODE_ENV === 'production' && process.env.AGENTIC_CRM_ENABLE_TEST_CONNECTOR !== '1') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'The test connector is disabled in production' });
  }
  return next();
});

export const connectorsRouter = router({
  test: router({
    injectMessage: testConnectorProcedure.input(injectMessageInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.connectors.test.injectMessage(svc, input));
      return { ...result, seq };
    }),
    injectEvent: testConnectorProcedure.input(injectEventInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.connectors.test.injectEvent(svc, input));
      return { ...result, seq };
    }),
    remove: testConnectorProcedure.input(removeInjectedInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.connectors.test.remove(svc, input));
      return { sync: result, seq };
    }),
    sent: testConnectorProcedure
      .input(mailboxIdInputSchema)
      .query(({ ctx, input }) => ctx.domain.connectors.test.sent(ctx.service, input.mailboxId)),
    /** Seeds a short customer thread, a newsletter and two meetings into a test mailbox (and syncs). */
    seedFixtures: testConnectorProcedure.input(z.object({ mailboxId: uuidSchema })).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) =>
        ctx.domain.connectors.test.seedFixtures(svc, input.mailboxId),
      );
      return { sync: result, seq };
    }),
  }),
});
