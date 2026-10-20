// Mailboxes and workspace email settings (BACKLOG 7.08 server; F settings §1–4; slice7-contracts.md procedure names):
// the member's mailboxes (list / get / connect / update / disconnect / sync), the mailbox-only blocklist and
// "Individuals with full access"; workspace email settings, protected / blocked contacts and record suppression
// (admin writes). Thin adapters over packages/domain (I5); mailbox ownership is checked there.
import {
  addBlocklistInputSchema,
  addContactsInputSchema,
  addProtectedContactsInputSchema,
  connectMailboxInputSchema,
  listMailboxesInputSchema,
  mailboxIdInputSchema,
  removeEntryInputSchema,
  removeGrantInputSchema,
  updateMailboxInputSchema,
  updateProtectedContactInputSchema,
  updateWorkspaceEmailSettingsInputSchema,
  uuidSchema,
} from '@agentic-crm/contracts';
import { DomainError } from '@agentic-crm/domain';
import { z } from 'zod';
import { GOOGLE_START_PATH } from '../../integrations/google';
import { acceptAfterOnly, withSeq } from '../mutation';
import { adminProcedure, router, workspaceProcedure } from '../trpc';

export const mailboxesRouter = router({
  /** Settings → Email and calendar accounts (admins may pass another member's id, read-only). */
  list: workspaceProcedure.input(listMailboxesInputSchema).query(({ ctx, input }) => {
    const { acceptAfter: _, ...query } = input ?? {};
    return ctx.domain.mailboxes.list(ctx.service, query);
  }),

  get: workspaceProcedure
    .input(mailboxIdInputSchema)
    .query(({ ctx, input }) => ctx.domain.mailboxes.get(ctx.service, input.mailboxId)),

  /** Test mailboxes: `{provider: 'test', emailAddress}`. Google mailboxes connect through `authorize` (OAuth). */
  connect: workspaceProcedure.input(connectMailboxInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.mailboxes.connect(svc, input));
    return { mailbox: result, seq };
  }),

  /** Which providers this server can connect ("Connect Google Account" shows a not-configured state without it). */
  providers: workspaceProcedure
    .input(acceptAfterOnly)
    .query(({ ctx }) => ({ google: { configured: ctx.domain.integrations.google !== null } })),

  /**
   * 7b: "Connect Google Account" / "Reconnect": the URL the browser opens to start Google's consent (our
   * /api/integrations/google/start, which mints the state + PKCE cookie and redirects to Google).
   */
  authorize: workspaceProcedure
    .input(z.object({ provider: z.enum(['google', 'gmail']), mailboxId: uuidSchema.optional() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.domain.integrations.google) {
        throw new DomainError(400, 'PROVIDER_NOT_CONFIGURED', 'Google is not configured on this server');
      }
      if (input.mailboxId) {
        const mailbox = await ctx.domain.mailboxes.get(ctx.service, input.mailboxId);
        if (mailbox.providerType !== 'gmail') {
          throw new DomainError(400, 'PROVIDER_NOT_SUPPORTED', 'Only Google mailboxes reconnect through Google');
        }
      }
      const query = new URLSearchParams({
        workspace: ctx.workspace.slug,
        ...(input.mailboxId ? { mailboxId: input.mailboxId } : {}),
      });
      return { authorizationUrl: `${GOOGLE_START_PATH}?${query}` };
    }),

  /** General tab: email visibility, default sender, sync switches, default signature. */
  update: workspaceProcedure.input(updateMailboxInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.mailboxes.update(svc, input));
    return { mailbox: result, seq };
  }),

  /** "Remove mailbox": its synced emails and events disappear, its grants are revoked. */
  disconnect: workspaceProcedure.input(z.object({ mailboxId: uuidSchema })).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.mailboxes.disconnect(svc, input.mailboxId));
    return { mailbox: result, seq };
  }),

  /** "Sync now": queues a sync job (or syncs inline when the API runs without jobs). */
  sync: workspaceProcedure
    .input(z.object({ mailboxId: uuidSchema }))
    .mutation(({ ctx, input }) => ctx.domain.mailboxes.sync(ctx.service, { mailboxId: input.mailboxId })),

  /** Mailbox-only blocklist (F settings §2.2). */
  blocklist: router({
    list: workspaceProcedure
      .input(mailboxIdInputSchema)
      .query(({ ctx, input }) => ctx.domain.mailboxes.blocklist.list(ctx.service, input.mailboxId)),
    add: workspaceProcedure.input(addBlocklistInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.mailboxes.blocklist.add(svc, input));
      return { ...result, seq };
    }),
    remove: workspaceProcedure.input(removeEntryInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.mailboxes.blocklist.remove(svc, input));
      return { ...result, seq };
    }),
  }),

  /** "Individuals with full access" (mailbox grants). */
  sharing: router({
    list: workspaceProcedure
      .input(mailboxIdInputSchema)
      .query(({ ctx, input }) => ctx.domain.mailboxes.sharing.list(ctx.service, input.mailboxId)),
    add: workspaceProcedure
      .input(z.object({ mailboxId: uuidSchema, memberId: uuidSchema }))
      .mutation(async ({ ctx, input }) => {
        const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.mailboxes.sharing.add(svc, input));
        return { grant: result, seq };
      }),
    remove: workspaceProcedure.input(removeGrantInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.mailboxes.sharing.remove(svc, input));
      return { ...result, seq };
    }),
  }),
});

/** Settings → Email and calendar (workspace; admins write). */
export const workspaceEmailRouter = router({
  settings: router({
    get: workspaceProcedure
      .input(acceptAfterOnly)
      .query(({ ctx }) => ctx.domain.workspaceEmail.settings.get(ctx.service)),
    /** `{defaultVisibility, recordCreation: 'all' | 'selective' | 'none', autoCreateCompanies, unprotectedDomains}`. */
    update: adminProcedure.input(updateWorkspaceEmailSettingsInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) =>
        ctx.domain.workspaceEmail.settings.update(svc, input),
      );
      return { settings: result, seq };
    }),
  }),
  /** Workspace protected and blocked contacts (Email visibility tab). */
  protectedContacts: router({
    list: workspaceProcedure
      .input(acceptAfterOnly)
      .query(({ ctx }) => ctx.domain.workspaceEmail.protectedContacts.list(ctx.service)),
    add: adminProcedure.input(addProtectedContactsInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) =>
        ctx.domain.workspaceEmail.protectedContacts.add(svc, input),
      );
      return { ...result, seq };
    }),
    update: adminProcedure.input(updateProtectedContactInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) =>
        ctx.domain.workspaceEmail.protectedContacts.update(svc, input),
      );
      return { contact: result, seq };
    }),
    remove: adminProcedure.input(removeEntryInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) =>
        ctx.domain.workspaceEmail.protectedContacts.remove(svc, input),
      );
      return { ...result, seq };
    }),
  }),
});

/** Record creation → Record suppression (admins write). */
export const suppressionRouter = router({
  list: workspaceProcedure.input(acceptAfterOnly).query(({ ctx }) => ctx.domain.suppression.list(ctx.service)),
  add: adminProcedure.input(addContactsInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.suppression.add(svc, input));
    return { ...result, seq };
  }),
  remove: adminProcedure.input(removeEntryInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.suppression.remove(svc, input));
    return { ...result, seq };
  }),
});
