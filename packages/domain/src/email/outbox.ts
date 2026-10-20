// Outbox (F composer §5; BACKLOG 7.07 server): one row per email to deliver (Attio's email instance). Sending a draft
// queues its emails (mass sends spaced MASS_SEND_SPACING_SECONDS apart); the outbox job hands due emails to the
// sender mailbox's connector, outside any transaction:
//   claim (tx: lease the row, count an attempt, per-mailbox hourly / daily caps) → connector.sendMessage (no tx) →
//   record the outcome (tx): completed, or error (retryable, re-scheduled with backoff) / failed with a reason code.
// The member's outbox lists scheduled and erroring emails plus failures of the last three months; scheduled emails
// can be cancelled one by one or all at once.
import {
  type CancelOutboxInput,
  cancelOutboxInputSchema,
  type DeliveryErrorCode,
  deliveryErrorCodes,
  type OutboxItem,
} from '@agentic-crm/contracts';
import type { Database, OutboundEmailsTable, Selectable } from '@agentic-crm/db';
import { sql } from '@agentic-crm/db';
import { memberAudience, requireMember } from '../collab/common.ts';
import {
  ConnectorError,
  type ConnectorMailbox,
  type ConnectorRegistry,
  type OutgoingMessage,
} from '../connectors/types.ts';
import { systemContext } from '../context.ts';
import { conflict } from '../errors.ts';
import { newId } from '../ids.ts';
import type { ObjectStorage } from '../storage/s3.ts';
import { runInWorkspace, type Tx } from '../tx.ts';
import type { DraftPlan } from './drafts.ts';

type OutboundRow = Selectable<OutboundEmailsTable>;

/** Mass sends are spaced this far apart (documented "spaced 5 min apart"). */
export const MASS_SEND_SPACING_SECONDS = 5 * 60;
/** Per mailbox (documented: 12 emails / hour, 200 / rolling 24 h). */
export const HOURLY_CAP = 12;
export const DAILY_CAP = 200;
/** Delivery attempts before `max_delivery_attempts_exceeded` (documented: retried ×7 over about an hour). */
export const MAX_DELIVERY_ATTEMPTS = 7;
/** Backoff after attempt n (minutes): 1, 2, 4, 8, 15, 15 … */
export const retryDelaySeconds = (attempt: number) => Math.min(15, 2 ** Math.max(0, attempt - 1)) * 60;
/** A claimed email is leased for this long: a crashed delivery is retried after it. */
export const LEASE_SECONDS = 10 * 60;
/** Failed emails stay visible in the outbox this long. */
export const FAILED_VISIBLE_DAYS = 90;

/** Failure reasons shown for failed items (F composer §5; quoted texts where the spec quotes them). */
export const FAILURE_REASONS: Record<DeliveryErrorCode, string> = {
  account_access_error: 'The connected email account could not be accessed',
  mailbox_disconnected: 'The connected email account was disconnected — please reconnect it',
  provider_unreachable: 'The email provider could not be reached',
  provider_rate_limited: 'The email provider limited how many emails can be sent right now',
  provider_rejected_request: 'The email provider rejected the email',
  email_preparation_failed: 'The email could not be prepared for sending',
  reply_message_unavailable: 'The email you replied to is no longer available',
  recipient_not_found: 'The email has no recipients',
  mailbox_email_address_not_found: 'The sending email address is no longer connected',
  max_delivery_attempts_exceeded: 'The email could not be delivered after several attempts',
  unknown: 'The email could not be delivered',
};

const isCode = (c: string | null): c is DeliveryErrorCode =>
  c !== null && (deliveryErrorCodes as readonly string[]).includes(c);

type Addr = { emailAddress: string; name: string | null };
const addresses = (v: unknown): Addr[] =>
  Array.isArray(v) ? (v as Addr[]).map((a) => ({ emailAddress: a.emailAddress, name: a.name ?? null })) : [];

export function toOutboxItem(row: OutboundRow): OutboxItem {
  const code = isCode(row.last_error_code) ? row.last_error_code : row.last_error_code ? 'unknown' : null;
  return {
    id: row.id,
    draftId: row.draft_id,
    mailboxId: row.mailbox_id,
    parentType: row.parent_type,
    source: row.parent_type === 'message-draft-mass-send' ? 'mass-send' : 'single-send',
    from: row.from_address,
    to: addresses(row.to_recipients),
    cc: addresses(row.cc_recipients),
    bcc: addresses(row.bcc_recipients),
    subject: row.subject,
    bodyText: row.body_text,
    deliveryState: row.delivery_state,
    deliveryScheduledAt: row.delivery_scheduled_at,
    attempts: row.attempts,
    lastErrorCode: code,
    failureReason:
      code && (row.delivery_state === 'failed' || row.delivery_state === 'error') ? FAILURE_REASONS[code] : null,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

async function emitOutbox(tx: Tx, memberId: string): Promise<void> {
  tx.emit('outbox', null, { memberId }, await memberAudience(tx, memberId));
}

const addSeconds = (iso: string, seconds: number) => new Date(Date.parse(iso) + seconds * 1000).toISOString();

export const outboxOps = {
  /** Queues the planned emails of a draft and closes the draft (send). */
  async enqueue(tx: Tx, plan: DraftPlan): Promise<OutboxItem[]> {
    const { draft, sender } = plan;
    if (!sender) throw conflict('MAILBOX_UNAVAILABLE', 'No mailbox to send from');
    const attachments = await tx.db
      .selectFrom('message_draft_attachments')
      .select(['id', 'name', 'content_type', 'content_size', 'object_key'])
      .where('draft_id', '=', draft.id)
      .where('deleted_at', 'is', null)
      .orderBy('position')
      .execute();
    const files = attachments.map((a) => ({
      id: a.id,
      name: a.name,
      contentType: a.content_type,
      size: Number(a.content_size),
      objectKey: a.object_key,
    }));
    const rows: OutboundRow[] = [];
    for (const [i, email] of plan.emails.entries()) {
      const row = await tx.db
        .insertInto('outbound_emails')
        .values({
          id: newId(),
          workspace_id: tx.workspaceId,
          member_id: draft.member_id,
          mailbox_id: sender.id,
          draft_id: draft.id,
          parent_type: draft.is_mass_send ? 'message-draft-mass-send' : 'message-draft',
          parent_message_id: draft.parent_message_id,
          recipient_entity_definition_id: email.record?.entityDefinitionId ?? null,
          recipient_entity_instance_id: email.record?.entityInstanceId ?? null,
          from_address: sender.email_address,
          to_recipients: JSON.stringify(email.to.map((r) => ({ emailAddress: r.emailAddress, name: r.name }))),
          cc_recipients: JSON.stringify(email.cc.map((r) => ({ emailAddress: r.emailAddress, name: r.name }))),
          bcc_recipients: JSON.stringify(email.bcc.map((r) => ({ emailAddress: r.emailAddress, name: r.name }))),
          subject: email.subject,
          body_text: email.bodyText,
          body_html: email.bodyHtml,
          attachments: JSON.stringify(files),
          delivery_state: 'scheduled',
          delivery_scheduled_at: addSeconds(tx.now, i * MASS_SEND_SPACING_SECONDS),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      rows.push(row);
    }
    await tx.db
      .updateTable('message_drafts')
      .set({ send_requested_at: tx.now, updated_at: tx.now })
      .where('id', '=', draft.id)
      .execute();
    const audience = await memberAudience(tx, draft.member_id);
    tx.emit('message-draft', draft.id, { draftId: draft.id }, audience);
    tx.emit('message-draft-list', null, { memberId: draft.member_id }, audience);
    await emitOutbox(tx, draft.member_id);
    return rows.map(toOutboxItem);
  },

  /** The member's outbox: scheduled / erroring emails and recent failures, soonest first. */
  async list(tx: Tx, input?: { now?: string | undefined }): Promise<OutboxItem[]> {
    const memberId = requireMember(tx);
    const now = input?.now ?? tx.now;
    const since = new Date(Date.parse(now) - FAILED_VISIBLE_DAYS * 86_400_000).toISOString();
    const rows = await tx.db
      .selectFrom('outbound_emails')
      .selectAll()
      .where('member_id', '=', memberId)
      .where((eb) =>
        eb.or([
          eb('delivery_state', 'in', ['scheduled', 'error']),
          eb.and([eb('delivery_state', '=', 'failed'), eb('delivery_scheduled_at', '>=', since)]),
        ]),
      )
      .orderBy('delivery_scheduled_at')
      .orderBy('id')
      .execute();
    return rows.map(toOutboxItem);
  },

  /** "Cancel email" / "Cancel all emails". */
  async cancel(tx: Tx, input: CancelOutboxInput): Promise<OutboxItem[]> {
    const data = cancelOutboxInputSchema.parse(input);
    const memberId = requireMember(tx);
    const targets = await tx.db
      .selectFrom('outbound_emails')
      .selectAll()
      .where('member_id', '=', memberId)
      .$if('ids' in data, (q) => q.where('id', 'in', (data as { ids: string[] }).ids))
      .$if('all' in data, (q) => q.where('delivery_state', 'in', ['scheduled', 'error']))
      .forUpdate()
      .execute();
    if ('ids' in data) {
      const found = new Set(targets.map((t) => t.id));
      const blocked = targets.filter((t) => t.delivery_state !== 'scheduled' && t.delivery_state !== 'error');
      if (data.ids.some((id) => !found.has(id)) || blocked.length > 0) {
        throw conflict('EMAIL_STATE_CONFLICT', 'Only scheduled emails can be cancelled', {
          email_ids: [...blocked.map((b) => b.id), ...data.ids.filter((id) => !found.has(id))],
        });
      }
    }
    if (targets.length === 0) return [];
    const rows = await tx.db
      .updateTable('outbound_emails')
      .set({ delivery_state: 'canceled', canceled_by: JSON.stringify(tx.ctx.actor), updated_at: tx.now })
      .where(
        'id',
        'in',
        targets.map((t) => t.id),
      )
      .returningAll()
      .execute();
    await emitOutbox(tx, memberId);
    return rows.map(toOutboxItem);
  },
};

export interface DeliveryDeps {
  database: Database;
  connectors: ConnectorRegistry;
  storage: ObjectStorage;
  /** After a successful send (e.g. queue a sync of the sender mailbox so the sent message is ingested). */
  afterSend?: (tx: Tx, mailboxId: string) => Promise<void>;
}

export interface DeliveryResult {
  sent: number;
  retried: number;
  failed: number;
  deferred: number;
}

interface Claimed {
  row: OutboundRow;
  mailbox: ConnectorMailbox;
  references: string[];
  inReplyTo: string | null;
  providerThreadId: string | null;
}

/** Claims the next due email of the workspace (or null), applying caps and mailbox checks. */
async function claim(tx: Tx, now: string, result: DeliveryResult): Promise<Claimed | 'retry' | null> {
  const { rows } = await sql<OutboundRow>`
    SELECT * FROM outbound_emails
    WHERE delivery_state IN ('scheduled', 'error') AND delivery_scheduled_at <= ${now}::timestamptz
    ORDER BY (parent_type = 'message-draft') DESC, delivery_scheduled_at, id
    LIMIT 1 FOR UPDATE SKIP LOCKED`.execute(tx.db);
  const row = rows[0];
  if (!row) return null;
  const fail = async (code: DeliveryErrorCode) => {
    await tx.db
      .updateTable('outbound_emails')
      .set({ delivery_state: 'failed', last_error_code: code, last_attempt_at: now, updated_at: tx.now })
      .where('id', '=', row.id)
      .execute();
    await emitOutbox(tx, row.member_id);
    result.failed++;
    return 'retry' as const;
  };
  const mailbox = await tx.db
    .selectFrom('mailboxes as m')
    .innerJoin('connected_accounts as a', 'a.id', 'm.connected_account_id')
    .select([
      'm.id',
      'm.workspace_id',
      'm.member_id',
      'm.provider_type',
      'm.email_address',
      'm.aliases',
      'm.connected_account_id',
      'm.archived_at',
      'm.mail_delivery_enabled',
      'a.credentials',
      'a.credential_state',
    ])
    .where('m.id', '=', row.mailbox_id)
    .executeTakeFirst();
  if (!mailbox || mailbox.archived_at || mailbox.credential_state === 'disconnected')
    return fail('mailbox_disconnected');
  if (mailbox.credential_state !== 'active' || !mailbox.mail_delivery_enabled) return fail('account_access_error');
  if (![mailbox.email_address, ...mailbox.aliases].includes(row.from_address)) {
    return fail('mailbox_email_address_not_found');
  }
  if (
    addresses(row.to_recipients).length + addresses(row.cc_recipients).length + addresses(row.bcc_recipients).length ===
    0
  ) {
    return fail('recipient_not_found');
  }
  let references: string[] = [];
  let inReplyTo: string | null = null;
  let providerThreadId: string | null = null;
  if (row.parent_message_id) {
    const parent = await tx.db
      .selectFrom('email_messages')
      .select(['rfc_message_id', 'references_ids'])
      .where('id', '=', row.parent_message_id)
      .executeTakeFirst();
    if (!parent) return fail('reply_message_unavailable');
    inReplyTo = parent.rfc_message_id;
    references = [...parent.references_ids, parent.rfc_message_id];
    const copy = await tx.db
      .selectFrom('email_message_copies')
      .select('provider_thread_id')
      .where('message_id', '=', row.parent_message_id)
      .where('mailbox_id', '=', row.mailbox_id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    providerThreadId = copy?.provider_thread_id ?? null;
  }
  // Per-mailbox caps: defer to when the window frees up.
  const { rows: sent } = await sql<{
    hour: string;
    day: string;
    oldest_hour: string | null;
    oldest_day: string | null;
  }>`
    SELECT count(*) FILTER (WHERE sent_at > ${now}::timestamptz - interval '1 hour')::text AS hour,
           count(*)::text AS day,
           min(sent_at) FILTER (WHERE sent_at > ${now}::timestamptz - interval '1 hour') AS oldest_hour,
           min(sent_at) AS oldest_day
    FROM outbound_emails
    WHERE mailbox_id = ${row.mailbox_id} AND sent_at > ${now}::timestamptz - interval '24 hours'`.execute(tx.db);
  const usage = sent[0];
  let deferUntil: string | null = null;
  if (usage && Number(usage.hour) >= HOURLY_CAP && usage.oldest_hour) deferUntil = addSeconds(usage.oldest_hour, 3600);
  if (usage && Number(usage.day) >= DAILY_CAP && usage.oldest_day) deferUntil = addSeconds(usage.oldest_day, 86_400);
  if (deferUntil) {
    await tx.db
      .updateTable('outbound_emails')
      .set({ delivery_scheduled_at: deferUntil, updated_at: tx.now })
      .where('id', '=', row.id)
      .execute();
    result.deferred++;
    return 'retry';
  }
  const leased = await tx.db
    .updateTable('outbound_emails')
    .set({
      attempts: row.attempts + 1,
      last_attempt_at: now,
      delivery_scheduled_at: addSeconds(now, LEASE_SECONDS),
      updated_at: tx.now,
    })
    .where('id', '=', row.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  return {
    row: leased,
    mailbox: {
      id: mailbox.id,
      workspaceId: mailbox.workspace_id,
      memberId: mailbox.member_id,
      providerType: mailbox.provider_type,
      emailAddress: mailbox.email_address,
      aliases: mailbox.aliases,
      connectedAccountId: mailbox.connected_account_id,
      credentials: mailbox.credentials,
    },
    references,
    inReplyTo,
    providerThreadId,
  };
}

/** Delivers the workspace's due emails (outbox job). `now` overrides the clock for due checks (tests). */
export async function deliverDue(
  deps: DeliveryDeps,
  workspaceId: string,
  options: { now?: string; limit?: number } = {},
): Promise<DeliveryResult> {
  const ctx = systemContext(workspaceId, 'outbox');
  const result: DeliveryResult = { sent: 0, retried: 0, failed: 0, deferred: 0 };
  const limit = options.limit ?? 50;
  for (let i = 0; i < limit; i++) {
    const claimed = await runInWorkspace(deps.database, ctx, (tx) => claim(tx, options.now ?? tx.now, result));
    if (claimed === null) break;
    if (claimed === 'retry') continue;
    const { row, mailbox } = claimed;
    const connector = deps.connectors[mailbox.providerType];
    const files = (Array.isArray(row.attachments) ? row.attachments : []) as {
      name: string;
      contentType: string;
      size: number;
      objectKey: string;
    }[];
    const message: OutgoingMessage = {
      outboundId: row.id,
      from: { emailAddress: row.from_address, name: null },
      to: addresses(row.to_recipients),
      cc: addresses(row.cc_recipients),
      bcc: addresses(row.bcc_recipients),
      subject: row.subject,
      bodyText: row.body_text,
      bodyHtml: row.body_html,
      inReplyTo: claimed.inReplyTo,
      references: claimed.references,
      providerThreadId: claimed.providerThreadId,
      attachments: files.map((f) => ({
        name: f.name,
        contentType: f.contentType,
        size: f.size,
        downloadUrl: deps.storage.presignGet(f.objectKey, { expiresInSeconds: 3600, filename: f.name }),
      })),
    };
    let outcome:
      | { ok: true; sent: Awaited<ReturnType<NonNullable<typeof connector>['sendMessage']>> }
      | {
          ok: false;
          error: ConnectorError;
        };
    try {
      if (!connector) throw new ConnectorError('account_access_error', `No connector for ${mailbox.providerType}`);
      outcome = { ok: true, sent: await connector.sendMessage(mailbox, message) };
    } catch (err) {
      outcome = {
        ok: false,
        error: err instanceof ConnectorError ? err : new ConnectorError('unknown', String(err), true),
      };
    }
    await runInWorkspace(deps.database, ctx, async (tx) => {
      const now = options.now ?? tx.now;
      if (outcome.ok) {
        await tx.db
          .updateTable('outbound_emails')
          .set({
            delivery_state: 'completed',
            sent_at: now,
            provider_message_id: outcome.sent.providerMessageId,
            rfc_message_id: outcome.sent.rfcMessageId,
            last_error_code: null,
            updated_at: tx.now,
          })
          .where('id', '=', row.id)
          .execute();
        result.sent++;
        await deps.afterSend?.(tx, mailbox.id);
      } else if (outcome.error.retryable && row.attempts < MAX_DELIVERY_ATTEMPTS) {
        await tx.db
          .updateTable('outbound_emails')
          .set({
            delivery_state: 'error',
            last_error_code: outcome.error.code,
            delivery_scheduled_at: addSeconds(now, retryDelaySeconds(row.attempts)),
            updated_at: tx.now,
          })
          .where('id', '=', row.id)
          .execute();
        result.retried++;
      } else {
        await tx.db
          .updateTable('outbound_emails')
          .set({
            delivery_state: 'failed',
            last_error_code: outcome.error.retryable ? 'max_delivery_attempts_exceeded' : outcome.error.code,
            updated_at: tx.now,
          })
          .where('id', '=', row.id)
          .execute();
        result.failed++;
      }
      await emitOutbox(tx, row.member_id);
    });
  }
  return result;
}

/** Workspaces with due emails (cross-tenant scan for the cron job; runs as the owner role). */
export async function workspacesWithDueEmails(database: Database, now?: string): Promise<string[]> {
  const { rows } = await sql<{ workspace_id: string }>`
    SELECT DISTINCT workspace_id FROM outbound_emails
    WHERE delivery_state IN ('scheduled', 'error') AND delivery_scheduled_at <= coalesce(${now ?? null}::timestamptz, now())`.execute(
    database.kysely,
  );
  return rows.map((r) => r.workspace_id);
}
