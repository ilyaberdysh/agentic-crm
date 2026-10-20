// Slice-7 services wired for createDomain(): mailboxes, workspace email settings, suppression, synced emails with
// visibility, sharing grants, drafts / review / send, outbox, templates, signatures, variables, meetings and call
// recordings, interaction attributes and connection strength, and the test connector's inject API. Every method is
// one workspace transaction (I1), except the ones that talk to a connector (sync, delivery, attachment commit),
// which keep connector / storage calls outside their transactions.
import {
  type AddBlocklistInput,
  type AddProtectedContactsInput,
  type CancelOutboxInput,
  type ConnectMailboxInput,
  type CreateDraftAttachmentInput,
  type CreateDraftInput,
  type CreateMeetingInput,
  type CreateSignatureInput,
  type CreateTemplateInput,
  draftAttachmentRefInputSchema,
  type InjectEventInput,
  type InjectMessageInput,
  injectEventInputSchema,
  injectMessageInputSchema,
  type ListGrantsInput,
  type ListMailboxesInput,
  type ListMeetingsInput,
  type ListRecordThreadsInput,
  type PutGrantInput,
  type RemoveInjectedInput,
  removeInjectedInputSchema,
  type SendDraftInput,
  type SyncResult,
  type UpdateDraftInput,
  type UpdateMailboxInput,
  type UpdateMeetingInput,
  type UpdateSignatureInput,
  type UpdateTemplateInput,
  type UpdateWorkspaceEmailSettingsInput,
  type VariableValuesInput,
  variableValuesInputSchema,
} from '@agentic-crm/contracts';
import { type Database, sql } from '@agentic-crm/db';
import { resolveRecordRefs } from '../collab/common.ts';
import { createGoogleIntegration } from '../connectors/google/integration.ts';
import type { GoogleSettings } from '../connectors/google/settings.ts';
import { appendTestItem, TestConnector, testFixtures } from '../connectors/test-connector.ts';
import type { ConnectorEvent, ConnectorMessage, ConnectorRegistry } from '../connectors/types.ts';
import { type ServiceContext, systemContext } from '../context.ts';
import { badRequest, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import { recordsWithStaleNext, refreshInteractions } from '../interactions/attributes.ts';
import { recomputeConnectionStrength, recordsWithStrength } from '../interactions/strength.ts';
import { JOB_NAMES, type JobQueue } from '../jobs/queue.ts';
import { meetingOps } from '../meetings/service.ts';
import type { Policies } from '../permissions.ts';
import { engineFor } from '../records/engine.ts';
import type { ObjectStorage } from '../storage/s3.ts';
import { runInWorkspace, type Tx } from '../tx.ts';
import { ATTACHMENT_URL_TTL_SECONDS, draftOps } from './drafts.ts';
import { grantOps, loadMailbox, mailboxOps } from './mailboxes.ts';
import { deliverDue, outboxOps, workspacesWithDueEmails } from './outbox.ts';
import { settingsOps } from './settings.ts';
import { type StrengthScheduler, syncMailbox } from './sync.ts';
import { signatureOps, templateOps } from './templates.ts';
import { threadOps } from './threads.ts';
import { VariableResolver } from './variables.ts';

export interface EmailWiring {
  database: Database;
  policies: Policies;
  storage: ObjectStorage;
  /** Background jobs; without them sync, delivery and connection strength run inline when asked to. */
  jobs?: JobQueue | undefined;
  /** Connectors by provider (default: the test connector). */
  connectors?: ConnectorRegistry | undefined;
  /** Google OAuth client (slice 7b): registers the gmail connector and the connect flow; null = not configured. */
  google?: GoogleSettings | null | undefined;
}

/** Providers whose mailboxes the worker polls (no push notifications yet). */
export const POLLED_PROVIDERS = ['gmail'] as const;

type RecordKey = { entityDefinitionId: string; entityInstanceId: string };

export function createEmailServices(wiring: EmailWiring) {
  const { database, policies, storage, jobs } = wiring;
  const run = <T>(ctx: ServiceContext, fn: (tx: Tx) => Promise<T>) => runInWorkspace(database, ctx, fn);
  const queueSync = async (tx: Tx, mailboxId: string) => {
    if (jobs)
      await jobs.send(tx, JOB_NAMES.emailSync, { workspaceId: tx.workspaceId, mailboxId }, { singletonKey: mailboxId });
  };
  const google = wiring.google ? createGoogleIntegration({ database, settings: wiring.google, queueSync }) : null;
  const connectors: ConnectorRegistry = {
    test: new TestConnector(database),
    ...(google ? { gmail: google.connector } : {}),
    ...wiring.connectors,
  };

  /** Connection strength after new interactions: a job when jobs are wired, else in the same transaction. */
  const scheduleStrength: StrengthScheduler = async (tx, records) => {
    if (jobs) {
      await jobs.send(tx, JOB_NAMES.connectionStrength, { workspaceId: tx.workspaceId, records });
      return;
    }
    await recomputeConnectionStrength(tx, records);
    await engineFor(tx).finalize();
  };
  const syncDeps = { database, connectors, scheduleStrength };
  const meetingDeps = { policies, scheduleStrength };

  const deliveryDeps = { database, connectors, storage, afterSend: queueSync };

  const syncNow = (ctx: ServiceContext, mailboxId: string) => syncMailbox(syncDeps, ctx, mailboxId);

  /** Test connector inject: append to the feed, then sync now (or queue a sync). */
  const inject = async (
    ctx: ServiceContext,
    mailboxId: string,
    kind: 'message' | 'message-deleted' | 'event' | 'event-deleted',
    payload: unknown,
    now: boolean,
  ) => {
    await run(ctx, async (tx) => {
      const mailbox = await loadMailbox(tx, mailboxId, { owner: true });
      if (mailbox.provider_type !== 'test')
        throw badRequest('VALIDATION_ERROR', 'Only test mailboxes accept injected items');
      if (mailbox.archived_at) throw notFound('Mailbox not found', { mailbox_id: mailboxId });
      await appendTestItem(tx, mailbox.id, kind, payload);
      if (!now) await queueSync(tx, mailbox.id);
    });
    return now ? syncNow(ctx, mailboxId) : null;
  };

  const strength = (ctx: ServiceContext, records: RecordKey[]) =>
    run(ctx, async (tx) => {
      await recomputeConnectionStrength(tx, records);
      await engineFor(tx).finalize();
    });

  return {
    mailboxes: {
      list: (ctx: ServiceContext, input?: ListMailboxesInput) => run(ctx, (tx) => mailboxOps.list(tx, input)),
      get: (ctx: ServiceContext, mailboxId: string) => run(ctx, (tx) => mailboxOps.get(tx, mailboxId)),
      /** 7a: test mailboxes; Gmail OAuth connect arrives with 7b. */
      connect: (ctx: ServiceContext, input: ConnectMailboxInput) =>
        run(ctx, (tx) => mailboxOps.connect(tx, input, new Set(Object.keys(connectors)))),
      update: (ctx: ServiceContext, input: UpdateMailboxInput) => run(ctx, (tx) => mailboxOps.update(tx, input)),
      /** "Remove mailbox": copies and grants removed; interactions of the records involved recomputed. */
      disconnect: (ctx: ServiceContext, mailboxId: string) =>
        run(ctx, async (tx) => {
          const { mailbox, records } = await mailboxOps.disconnect(tx, mailboxId);
          await refreshInteractions(tx, records);
          await engineFor(tx).finalize();
          if (records.length > 0) await scheduleStrength(tx, records);
          return mailbox;
        }),
      /**
       * "Sync now": queues a sync job (when jobs are wired and `wait` is not set) or syncs inline. Owner only.
       */
      sync: async (
        ctx: ServiceContext,
        input: { mailboxId: string; wait?: boolean },
      ): Promise<{ queued: boolean; result: SyncResult | null }> => {
        const queued = await run(ctx, async (tx) => {
          await loadMailbox(tx, input.mailboxId, { owner: true });
          if (jobs && !input.wait) {
            await queueSync(tx, input.mailboxId);
            return true;
          }
          return false;
        });
        if (queued) return { queued: true, result: null };
        const result = await syncNow(ctx, input.mailboxId);
        const { complete: _complete, createdRecordIds: _created, ...summary } = result;
        return { queued: false, result: summary };
      },
      blocklist: {
        list: (ctx: ServiceContext, mailboxId: string) => run(ctx, (tx) => mailboxOps.listBlocklist(tx, mailboxId)),
        add: (ctx: ServiceContext, input: AddBlocklistInput) => run(ctx, (tx) => mailboxOps.addBlocklist(tx, input)),
        remove: (ctx: ServiceContext, input: { id: string }) => run(ctx, (tx) => mailboxOps.removeBlocklist(tx, input)),
      },
      /** "Individuals with full access" (mailbox grants to members, level full access). */
      sharing: {
        list: (ctx: ServiceContext, mailboxId: string) =>
          run(ctx, (tx) => grantOps.list(tx, { policies }, { resource: { type: 'mailbox', mailboxId } })),
        add: (ctx: ServiceContext, input: { mailboxId: string; memberId: string }) =>
          run(ctx, (tx) =>
            grantOps.put(
              tx,
              { policies },
              {
                resource: { type: 'mailbox', mailboxId: input.mailboxId },
                target: { type: 'member', memberId: input.memberId },
                level: 'full-access',
              },
            ),
          ),
        remove: (ctx: ServiceContext, input: { grantId: string }) => run(ctx, (tx) => grantOps.remove(tx, input)),
      },
    },

    workspaceEmail: {
      settings: {
        get: (ctx: ServiceContext) => run(ctx, (tx) => settingsOps.get(tx)),
        update: (ctx: ServiceContext, input: UpdateWorkspaceEmailSettingsInput) =>
          run(ctx, (tx) => settingsOps.update(tx, input)),
      },
      /** Workspace protected and blocked contacts (Email visibility tab). */
      protectedContacts: {
        list: (ctx: ServiceContext) => run(ctx, (tx) => settingsOps.listProtected(tx)),
        add: (ctx: ServiceContext, input: AddProtectedContactsInput) =>
          run(ctx, (tx) => settingsOps.addProtected(tx, input)),
        update: (ctx: ServiceContext, input: { id: string; enforcement: 'protected' | 'blocked' }) =>
          run(ctx, (tx) => settingsOps.updateProtected(tx, input)),
        remove: (ctx: ServiceContext, input: { id: string }) =>
          run(ctx, (tx) => settingsOps.removeProtected(tx, input)),
      },
    },

    suppression: {
      list: (ctx: ServiceContext) => run(ctx, (tx) => settingsOps.listSuppression(tx)),
      add: (ctx: ServiceContext, input: { values: string[] }) =>
        run(ctx, (tx) => settingsOps.addSuppression(tx, input)),
      remove: (ctx: ServiceContext, input: { id: string }) =>
        run(ctx, (tx) => settingsOps.removeSuppression(tx, input)),
    },

    email: {
      /** Record Emails tab. */
      threads: (ctx: ServiceContext, input: ListRecordThreadsInput) =>
        run(ctx, (tx) => threadOps.listForRecord(tx, { policies }, input)),
      /** Email modal: one message (restricted shape below full access). */
      get: (ctx: ServiceContext, input: { messageId: string }) => run(ctx, (tx) => threadOps.get(tx, input)),
      thread: (ctx: ServiceContext, input: { threadId: string }) => run(ctx, (tx) => threadOps.thread(tx, input)),
      grants: {
        list: (ctx: ServiceContext, input: ListGrantsInput) => run(ctx, (tx) => grantOps.list(tx, { policies }, input)),
        put: (ctx: ServiceContext, input: PutGrantInput) => run(ctx, (tx) => grantOps.put(tx, { policies }, input)),
        remove: (ctx: ServiceContext, input: { grantId: string }) => run(ctx, (tx) => grantOps.remove(tx, input)),
      },
      drafts: {
        list: (ctx: ServiceContext) => run(ctx, (tx) => draftOps.list(tx)),
        get: (ctx: ServiceContext, draftId: string) => run(ctx, (tx) => draftOps.get(tx, draftId)),
        create: (ctx: ServiceContext, input: CreateDraftInput) =>
          run(ctx, (tx) => draftOps.create(tx, { policies }, input)),
        update: (ctx: ServiceContext, input: UpdateDraftInput) =>
          run(ctx, (tx) => draftOps.update(tx, { policies }, input)),
        delete: (ctx: ServiceContext, draftId: string) => run(ctx, (tx) => draftOps.delete(tx, draftId)),
        /** Review step data: every email as it will be sent, and what blocks sending. */
        review: (ctx: ServiceContext, draftId: string) => run(ctx, (tx) => draftOps.review(tx, { policies }, draftId)),
        /** Queues the draft's emails in the outbox (and the delivery job). */
        send: (ctx: ServiceContext, input: SendDraftInput) =>
          run(ctx, async (tx) => {
            const plan = await draftOps.prepareSend(tx, { policies }, input);
            const outbox = await outboxOps.enqueue(tx, plan);
            if (jobs) await jobs.send(tx, JOB_NAMES.emailOutbox, { workspaceId: tx.workspaceId });
            return { draftId: plan.draft.id, outbox };
          }),
        attachments: {
          create: (ctx: ServiceContext, input: CreateDraftAttachmentInput) =>
            run(ctx, (tx) =>
              draftOps.createAttachment(tx, input, (key, contentType) =>
                storage.presignPut(key, { contentType, expiresInSeconds: ATTACHMENT_URL_TTL_SECONDS }),
              ),
            ),
          /** After the browser PUT: HEAD the object (outside the transaction), then commit. */
          commit: async (ctx: ServiceContext, input: { draftId: string; attachmentId: string }) => {
            const data = draftAttachmentRefInputSchema.parse(input);
            const attachment = await run(ctx, (tx) => draftOps.attachmentForCommit(tx, data));
            const object =
              attachment.state === 'committed' ? { contentLength: -1 } : await storage.head(attachment.object_key);
            return run(ctx, (tx) => draftOps.commitAttachment(tx, data, object));
          },
          remove: (ctx: ServiceContext, input: { draftId: string; attachmentId: string }) =>
            run(ctx, (tx) => draftOps.removeAttachment(tx, draftAttachmentRefInputSchema.parse(input))),
        },
      },
      outbox: {
        list: (ctx: ServiceContext, input?: { now?: string }) => run(ctx, (tx) => outboxOps.list(tx, input)),
        cancel: (ctx: ServiceContext, input: CancelOutboxInput) => run(ctx, (tx) => outboxOps.cancel(tx, input)),
        /** Worker: delivers the due emails of a workspace (all workspaces with due emails when omitted). */
        deliverDue: async (workspaceId?: string, options: { now?: string; limit?: number } = {}) => {
          const targets = workspaceId ? [workspaceId] : await workspacesWithDueEmails(database, options.now);
          const totals = { sent: 0, retried: 0, failed: 0, deferred: 0 };
          for (const ws of targets) {
            const r = await deliverDue(deliveryDeps, ws, options);
            totals.sent += r.sent;
            totals.retried += r.retried;
            totals.failed += r.failed;
            totals.deferred += r.deferred;
          }
          return totals;
        },
      },
      templates: {
        list: (ctx: ServiceContext) => run(ctx, (tx) => templateOps.list(tx)),
        get: (ctx: ServiceContext, templateId: string) => run(ctx, (tx) => templateOps.get(tx, { templateId })),
        create: (ctx: ServiceContext, input: CreateTemplateInput) => run(ctx, (tx) => templateOps.create(tx, input)),
        update: (ctx: ServiceContext, input: UpdateTemplateInput) => run(ctx, (tx) => templateOps.update(tx, input)),
        delete: (ctx: ServiceContext, templateId: string) => run(ctx, (tx) => templateOps.delete(tx, { templateId })),
        favorite: (ctx: ServiceContext, input: { templateId: string; favorite: boolean }) =>
          run(ctx, (tx) => templateOps.favorite(tx, input)),
      },
      signatures: {
        list: (ctx: ServiceContext, mailboxId: string) => run(ctx, (tx) => signatureOps.list(tx, mailboxId)),
        create: (ctx: ServiceContext, input: CreateSignatureInput) => run(ctx, (tx) => signatureOps.create(tx, input)),
        update: (ctx: ServiceContext, input: UpdateSignatureInput) => run(ctx, (tx) => signatureOps.update(tx, input)),
        setDefault: (ctx: ServiceContext, input: { signatureId: string; isDefault: boolean }) =>
          run(ctx, (tx) => signatureOps.setDefault(tx, input)),
        delete: (ctx: ServiceContext, signatureId: string) =>
          run(ctx, (tx) => signatureOps.delete(tx, { signatureId })),
      },
      /** Merge-field preview: values of variables for recipient records (fallbacks not applied). */
      variables: (ctx: ServiceContext, input: VariableValuesInput) =>
        run(ctx, async (tx) => {
          const data = variableValuesInputSchema.parse(input);
          const refs = await resolveRecordRefs(tx, { policies }, data.records);
          const resolver = new VariableResolver(tx, policies);
          const values: Record<string, (string | null)[]> = {};
          for (const ref of refs) {
            const list: (string | null)[] = [];
            for (const v of data.variables) list.push(await resolver.resolve(ref, v));
            values[ref.entityInstanceId] = list;
          }
          return { values };
        }),
      /**
       * Worker (cron): queues a sync of every active mailbox of a polled provider (Gmail; push notifications are not
       * wired). Mailboxes needing reconnection are skipped. Returns how many were queued.
       */
      queuePolledSyncs: async (): Promise<{ queued: number }> => {
        if (!jobs) return { queued: 0 };
        const due = await mailboxesToPoll(database);
        for (const m of due) await run(systemContext(m.workspace_id, 'mail-sync'), (tx) => queueSync(tx, m.id));
        return { queued: due.length };
      },
      /** Worker: one mailbox sync run (resumable; a run that stops early re-queues itself). */
      syncMailbox: async (workspaceId: string, mailboxId: string) => {
        const result = await syncMailbox(syncDeps, { workspaceId }, mailboxId);
        if (!result.complete && jobs) {
          await run(systemContext(workspaceId, 'mail-sync'), (tx) => queueSync(tx, mailboxId));
        }
        return result;
      },
    },

    meetings: {
      list: (ctx: ServiceContext, input: ListMeetingsInput) =>
        run(ctx, (tx) => meetingOps.list(tx, meetingDeps, input)),
      get: (ctx: ServiceContext, meetingId: string) => run(ctx, (tx) => meetingOps.get(tx, meetingId)),
      create: (ctx: ServiceContext, input: CreateMeetingInput, options: { source?: 'manual' | 'api' } = {}) =>
        run(ctx, (tx) =>
          meetingOps.create(
            tx,
            meetingDeps,
            input,
            options.source ?? (ctx.actor.type === 'api-token' ? 'api' : 'manual'),
          ),
        ),
      update: (ctx: ServiceContext, input: UpdateMeetingInput) =>
        run(ctx, (tx) => meetingOps.update(tx, meetingDeps, input)),
      delete: (ctx: ServiceContext, meetingId: string) =>
        run(ctx, (tx) => meetingOps.delete(tx, meetingDeps, meetingId)),
    },

    interactions: {
      /** Recomputes interaction attributes of records (people / companies). */
      refresh: (ctx: ServiceContext, records: RecordKey[], now?: string) =>
        run(ctx, async (tx) => {
          await refreshInteractions(tx, records, now);
          await engineFor(tx).finalize();
        }),
      /** Worker: connection strength of records. */
      recomputeConnectionStrength: strength,
      /** Worker (cron): records whose next meeting has started move it to "last"; daily decay of strength. */
      refreshDue: (ctx: ServiceContext, options: { decay?: boolean } = {}) =>
        run(ctx, async (tx) => {
          const stale = await recordsWithStaleNext(tx, tx.now);
          await refreshInteractions(tx, stale);
          const decayed = options.decay ? await recordsWithStrength(tx) : [];
          if (decayed.length > 0) await recomputeConnectionStrength(tx, decayed);
          await engineFor(tx).finalize();
          return { refreshed: stale.length, decayed: decayed.length };
        }),
    },

    /** OAuth integrations (slice 7b): Google when GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are configured. */
    integrations: {
      google: google
        ? {
            configured: true as const,
            redirectUri: google.redirectUri,
            begin: google.begin,
            verify: google.verify,
            complete: google.complete,
          }
        : null,
    },

    /** The test connector's dev / test API (slice7-contracts.md). */
    connectors: {
      test: {
        injectMessage: (ctx: ServiceContext, input: InjectMessageInput) => {
          const data = injectMessageInputSchema.parse(input);
          const m = data.message;
          const id = m.providerMessageId ?? `msg-${newId()}`;
          const payload: ConnectorMessage = {
            providerMessageId: id,
            providerThreadId: m.providerThreadId ?? `thread-${id}`,
            rfcMessageId: m.rfcMessageId ?? `<${id}@test.agentic-crm.local>`,
            inReplyTo: m.inReplyTo ?? null,
            references: m.references ?? [],
            subject: m.subject,
            snippet: m.bodyText.slice(0, 200),
            bodyText: m.bodyText,
            bodyHtml: m.bodyHtml ?? null,
            sentAt: m.sentAt ?? new Date().toISOString(),
            from: { emailAddress: m.from.emailAddress, name: m.from.name ?? null },
            replyTo: (m.replyTo ?? []).map((a) => ({ emailAddress: a.emailAddress, name: a.name ?? null })),
            to: m.to.map((a) => ({ emailAddress: a.emailAddress, name: a.name ?? null })),
            cc: (m.cc ?? []).map((a) => ({ emailAddress: a.emailAddress, name: a.name ?? null })),
            bcc: (m.bcc ?? []).map((a) => ({ emailAddress: a.emailAddress, name: a.name ?? null })),
            attachments: (m.attachments ?? []).map((a, i) => ({ providerAttachmentId: `${id}-${i}`, ...a })),
            labels: m.labels ?? [],
          };
          return inject(ctx, data.mailboxId, 'message', payload, data.syncNow).then((result) => ({
            providerMessageId: id,
            rfcMessageId: payload.rfcMessageId,
            sync: result,
          }));
        },
        injectEvent: (ctx: ServiceContext, input: InjectEventInput) => {
          const data = injectEventInputSchema.parse(input);
          const e = data.event;
          const id = e.providerEventId ?? `evt-${newId()}`;
          const payload: ConnectorEvent = {
            providerEventId: id,
            icalUid: e.icalUid ?? `${id}@test.agentic-crm.local`,
            title: e.title,
            description: e.description,
            start:
              'date' in e.start
                ? { date: e.start.date }
                : { dateTime: e.start.dateTime, timeZone: e.start.timeZone ?? null },
            end:
              'date' in e.end ? { date: e.end.date } : { dateTime: e.end.dateTime, timeZone: e.end.timeZone ?? null },
            status: e.status,
            conferenceUrl: e.conferenceUrl ?? null,
            location: e.location ?? null,
            attendees: e.attendees.map((a) => ({
              emailAddress: a.emailAddress,
              name: a.name ?? null,
              status: a.status,
              isOrganizer: a.isOrganizer,
            })),
          };
          return inject(ctx, data.mailboxId, 'event', payload, data.syncNow).then((result) => ({
            providerEventId: id,
            icalUid: payload.icalUid,
            sync: result,
          }));
        },
        /** A provider-side deletion of a message or event. */
        remove: (ctx: ServiceContext, input: RemoveInjectedInput) => {
          const data = removeInjectedInputSchema.parse(input);
          return inject(
            ctx,
            data.mailboxId,
            data.kind === 'message' ? 'message-deleted' : 'event-deleted',
            data.kind === 'message' ? { providerMessageId: data.providerId } : { providerEventId: data.providerId },
            data.syncNow,
          );
        },
        /** Messages "sent" through the test connector (newest first). */
        sent: (ctx: ServiceContext, mailboxId: string) =>
          run(ctx, async (tx) => {
            const mailbox = await loadMailbox(tx, mailboxId, { owner: true });
            const rows = await tx.db
              .selectFrom('test_connector_sent')
              .select(['id', 'payload', 'created_at'])
              .where('mailbox_id', '=', mailbox.id)
              .orderBy('created_at', 'desc')
              .execute();
            return rows.map((r) => ({ id: r.id, createdAt: r.created_at, message: r.payload }));
          }),
        /** Dev seed: a short customer thread, a newsletter and two meetings in a test mailbox. */
        seedFixtures: async (ctx: ServiceContext, mailboxId: string) => {
          await run(ctx, async (tx) => {
            const mailbox = await loadMailbox(tx, mailboxId, { owner: true });
            if (mailbox.provider_type !== 'test')
              throw badRequest('VALIDATION_ERROR', 'Only test mailboxes take fixtures');
            const fixtures = testFixtures(mailbox.email_address);
            for (const m of fixtures.messages) await appendTestItem(tx, mailbox.id, 'message', m);
            for (const e of fixtures.events) await appendTestItem(tx, mailbox.id, 'event', e);
          });
          return syncNow(ctx, mailboxId);
        },
      },
    },
  };
}

export type EmailServices = ReturnType<typeof createEmailServices>;

/** Active mailboxes of polled providers with usable credentials (cross-tenant scan for the cron; owner role). */
async function mailboxesToPoll(database: Database): Promise<{ id: string; workspace_id: string }[]> {
  const { rows } = await sql<{ id: string; workspace_id: string }>`
    SELECT m.id, m.workspace_id FROM mailboxes m
    JOIN connected_accounts a ON a.id = m.connected_account_id
    WHERE m.provider_type = ANY(${[...POLLED_PROVIDERS]}::text[]) AND m.archived_at IS NULL
      AND a.credential_state = 'active' AND (m.mail_sync_enabled OR m.calendar_sync_enabled)
    ORDER BY m.last_synced_at NULLS FIRST`.execute(database.kysely);
  return rows;
}
