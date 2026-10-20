// Mailbox sync (BACKLOG 7.02; D-21 for the Gmail flavour in 7b): cursor-based, one transaction per connector page.
//
//   read mailbox + cursor (tx) → connector.listMailChanges(cursor) (no tx) → apply page + store next cursor (tx)
//   … until the connector has no more changes; then the same for calendar changes.
//
// The cursor is advanced with a compare-and-set on the value read, so two concurrent syncs of one mailbox never apply
// the same page twice (the loser stops). Each applying transaction runs as the system actor `mail-sync`, refreshes
// the interaction attributes of the records it touched, finalises the value engine and emits invalidations; the
// connection-strength recompute is handed to the job queue (or run inline when none is wired).
import type { SyncResult } from '@agentic-crm/contracts';
import { type Database, sql } from '@agentic-crm/db';
import { ingestCalendarChanges } from '../calendar/ingest.ts';
import type { ConnectorMailbox, ConnectorRegistry, EmailCalendarConnector } from '../connectors/types.ts';
import { type ServiceContext, systemContext } from '../context.ts';
import { DomainError } from '../errors.ts';
import { refreshInteractions } from '../interactions/attributes.ts';
import { engineFor } from '../records/engine.ts';
import { runInWorkspace, type Tx } from '../tx.ts';
import { IngestEffects, type IngestMailbox, ingestMailChanges } from './ingest.ts';

export const SYNC_PAGE_SIZE = 100;
/** Pages per sync run (a run that hits it re-queues itself). */
export const SYNC_MAX_PAGES = 50;

/** Hook that hands the records of a batch to the connection-strength recompute (job or inline). */
export type StrengthScheduler = (
  tx: Tx,
  records: { entityDefinitionId: string; entityInstanceId: string }[],
) => Promise<void>;

interface LoadedMailbox {
  mailbox: ConnectorMailbox & IngestMailbox;
  mailCursor: string | null;
  calendarCursor: string | null;
  mailSync: boolean;
  calendarSync: boolean;
  archived: boolean;
}

async function loadForSync(tx: Tx, mailboxId: string): Promise<LoadedMailbox> {
  const row = await tx.db
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
      'm.mail_cursor',
      'm.calendar_cursor',
      'm.mail_sync_enabled',
      'm.calendar_sync_enabled',
      'm.archived_at',
      'a.credentials',
      'a.credential_state',
    ])
    .where('m.id', '=', mailboxId)
    .executeTakeFirst();
  if (!row) throw new DomainError(404, 'NOT_FOUND', 'Mailbox not found', { mailbox_id: mailboxId });
  return {
    mailbox: {
      id: row.id,
      workspaceId: row.workspace_id,
      memberId: row.member_id,
      providerType: row.provider_type,
      emailAddress: row.email_address,
      aliases: row.aliases,
      connectedAccountId: row.connected_account_id,
      credentials: row.credentials,
    },
    mailCursor: row.mail_cursor,
    calendarCursor: row.calendar_cursor,
    mailSync: row.mail_sync_enabled,
    calendarSync: row.calendar_sync_enabled,
    // Removed mailboxes, and accounts whose grant needs reconnection (7b: revoked / expired / missing scopes), do not
    // sync until reconnected.
    archived: row.archived_at !== null || row.credential_state !== 'active',
  };
}

/** Invalidations, interaction refresh and engine finalisation after a batch (same transaction). */
export async function finishBatch(tx: Tx, effects: IngestEffects, scheduleStrength: StrengthScheduler): Promise<void> {
  const records = [...effects.records.values()];
  await refreshInteractions(tx, records);
  await engineFor(tx).finalize();
  if (records.length > 0) {
    await scheduleStrength(tx, records);
    const byDef = new Map<string, string[]>();
    for (const r of records)
      byDef.set(r.entityDefinitionId, [...(byDef.get(r.entityDefinitionId) ?? []), r.entityInstanceId]);
    for (const [defId, ids] of byDef) {
      tx.emit('email-thread-list', defId, { entityDefinitionId: defId, entityInstanceIds: ids });
      if (effects.meetings.size > 0) {
        tx.emit('meeting-list', defId, { entityDefinitionId: defId, entityInstanceIds: ids });
        tx.emit('record-timeline', defId, { entityInstanceIds: ids });
      }
    }
  }
  if (effects.threads.size > 0) tx.emit('email-thread-list', null, { threadIds: [...effects.threads] });
  for (const id of effects.meetings) tx.emit('meeting', id, { meetingId: id });
}

export interface SyncDeps {
  database: Database;
  connectors: ConnectorRegistry;
  scheduleStrength: StrengthScheduler;
}

function connectorFor(deps: SyncDeps, provider: ConnectorMailbox['providerType']): EmailCalendarConnector {
  const connector = deps.connectors[provider];
  if (!connector) {
    throw new DomainError(400, 'PROVIDER_NOT_SUPPORTED', `No connector for ${provider} mailboxes`, { provider });
  }
  return connector;
}

async function recordError(deps: SyncDeps, workspaceId: string, mailboxId: string, message: string | null) {
  await runInWorkspace(deps.database, systemContext(workspaceId, 'mail-sync'), async (tx) => {
    await tx.db
      .updateTable('mailboxes')
      .set({ sync_error: message, updated_at: tx.now })
      .where('id', '=', mailboxId)
      .execute();
  });
}

/** Syncs one mailbox (mail, then calendar) until the connector reports no more changes or SYNC_MAX_PAGES. */
export async function syncMailbox(
  deps: SyncDeps,
  ctx: Pick<ServiceContext, 'workspaceId'>,
  mailboxId: string,
  options: { maxPages?: number } = {},
): Promise<SyncResult & { complete: boolean; createdRecordIds: string[] }> {
  const sys = systemContext(ctx.workspaceId, 'mail-sync');
  const result = {
    mailboxId,
    messages: 0,
    events: 0,
    skipped: 0,
    deleted: 0,
    recordsCreated: 0,
    complete: true,
    createdRecordIds: [] as string[],
  };
  const maxPages = options.maxPages ?? SYNC_MAX_PAGES;
  let pages = 0;
  try {
    for (const stream of ['mail', 'calendar'] as const) {
      for (;;) {
        const loaded = await runInWorkspace(deps.database, sys, (tx) => loadForSync(tx, mailboxId));
        if (loaded.archived) return result;
        if (stream === 'mail' ? !loaded.mailSync : !loaded.calendarSync) break;
        if (pages >= maxPages) {
          result.complete = false;
          return result;
        }
        pages++;
        const connector = connectorFor(deps, loaded.mailbox.providerType);
        const cursor = stream === 'mail' ? loaded.mailCursor : loaded.calendarCursor;
        const page =
          stream === 'mail'
            ? await connector.listMailChanges(loaded.mailbox, cursor, { limit: SYNC_PAGE_SIZE })
            : await connector.listCalendarChanges(loaded.mailbox, cursor, { limit: SYNC_PAGE_SIZE });
        const applied = await runInWorkspace(deps.database, sys, async (tx) => {
          const column = stream === 'mail' ? 'mail_cursor' : 'calendar_cursor';
          const effects = new IngestEffects();
          let created: { entityInstanceId: string }[] = [];
          if (stream === 'mail') {
            const resolver = await ingestMailChanges(
              tx,
              loaded.mailbox,
              page.changes as Parameters<typeof ingestMailChanges>[2],
              effects,
            );
            created = resolver.created;
          } else {
            await ingestCalendarChanges(
              tx,
              loaded.mailbox,
              page.changes as Parameters<typeof ingestCalendarChanges>[2],
              effects,
            );
            created =
              (tx.memo.get('record-resolver') as { created: { entityInstanceId: string }[] } | undefined)?.created ??
              [];
          }
          // Compare-and-set: another sync that advanced the cursor first wins; this batch rolls back.
          const { rows: moved } = await sql<{ id: string }>`
            UPDATE mailboxes SET ${sql.ref(column)} = ${page.nextCursor},
              messages_synced = messages_synced + ${effects.messages}::int,
              events_synced = events_synced + ${effects.events}::int,
              sync_state = ${page.hasMore ? 'historic' : 'realtime'}, last_synced_at = ${tx.now}::timestamptz,
              sync_error = NULL, updated_at = ${tx.now}::timestamptz
            WHERE id = ${mailboxId} AND ${sql.ref(column)} IS NOT DISTINCT FROM ${cursor}::text
            RETURNING id`.execute(tx.db);
          if (moved.length === 0) return null;
          await finishBatch(tx, effects, deps.scheduleStrength);
          const owner = await tx.db
            .selectFrom('workspace_members')
            .select('user_id')
            .where('id', '=', loaded.mailbox.memberId)
            .executeTakeFirst();
          tx.emit('mailbox', mailboxId, { mailboxId }, { userIds: owner ? [owner.user_id] : [] });
          return { effects, created };
        });
        if (!applied) {
          // A concurrent sync is ahead of us; it will finish the work.
          result.complete = false;
          return result;
        }
        result.messages += applied.effects.messages;
        result.events += applied.effects.events;
        result.skipped += applied.effects.skipped;
        result.deleted += applied.effects.deleted;
        result.recordsCreated += applied.created.length;
        result.createdRecordIds.push(...applied.created.map((c) => c.entityInstanceId));
        if (!page.hasMore) break;
      }
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordError(deps, ctx.workspaceId, mailboxId, message.slice(0, 1000)).catch(() => {});
    throw err;
  }
}
