// Mailboxes (F settings §1–3; BACKLOG 7.08 server): the member's connected accounts and mailboxes, visibility level,
// default sending mailbox, sync switches, removal, the mailbox-only blocklist and sharing ("Individuals with full
// access" = mailbox grants), plus the email grants procedures used by the email modal and the Emails tab.
// A mailbox is managed by its owner; admins may list another member's mailboxes (settings → members → accounts) but
// cannot change their sharing level (F settings §3).
import {
  type AddBlocklistInput,
  type AddContactsOutput,
  addBlocklistInputSchema,
  type BlocklistEntry,
  type ConnectMailboxInput,
  connectMailboxInputSchema,
  type EmailGrant,
  type ListGrantsInput,
  type ListMailboxesInput,
  listGrantsInputSchema,
  listMailboxesInputSchema,
  type Mailbox,
  type PutGrantInput,
  putGrantInputSchema,
  removeEntryInputSchema,
  removeGrantInputSchema,
  type UpdateMailboxInput,
  updateMailboxInputSchema,
} from '@agentic-crm/contracts';
import type { MailboxesTable, Selectable } from '@agentic-crm/db';
import { sql } from '@agentic-crm/db';
import { memberAudience, requireMember, resolveRecordRefs, toActor } from '../collab/common.ts';
import { actingMemberId } from '../context.ts';
import { badRequest, conflict, DomainError, forbidden, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import type { Policies } from '../permissions.ts';
import type { Tx } from '../tx.ts';
import { invalidateEmailMemo, loadEmailSettings, toAddress } from './model.ts';
import { classifyContacts } from './settings.ts';

type MailboxRow = Selectable<MailboxesTable>;

/** An OAuth mailbox after consent (7b): who the account is and its sealed credentials. */
export interface OAuthConnectInput {
  provider: 'gmail';
  emailAddress: string;
  /** Provider account id (Google `sub`). */
  externalAccountId: string;
  /** Sealed credentials (never returned by the API). */
  credentials: unknown;
  aliases: string[];
  /** "Reconnect" on this mailbox. */
  reconnectMailboxId: string | null;
}

export function toMailbox(row: MailboxRow, credentialState: Mailbox['credentialState']): Mailbox {
  const status: Mailbox['status'] = row.archived_at
    ? 'archived'
    : row.sync_error || credentialState !== 'active'
      ? 'sync-error'
      : row.sync_state === 'realtime'
        ? 'in-sync'
        : 'syncing';
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    memberId: row.member_id,
    connectedAccountId: row.connected_account_id,
    providerType: row.provider_type,
    emailAddress: row.email_address,
    aliases: row.aliases,
    isDefault: row.is_default,
    mailSyncEnabled: row.mail_sync_enabled,
    calendarSyncEnabled: row.calendar_sync_enabled,
    mailDeliveryEnabled: row.mail_delivery_enabled,
    defaultVisibility: row.default_visibility,
    syncState: row.sync_state,
    status,
    credentialState,
    messagesSynced: row.messages_synced,
    eventsSynced: row.events_synced,
    lastSyncedAt: row.last_synced_at,
    syncError: row.sync_error,
    defaultSignatureId: row.default_signature_id,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
  };
}

async function viewMailboxes(tx: Tx, rows: MailboxRow[]): Promise<Mailbox[]> {
  if (rows.length === 0) return [];
  const accounts = await tx.db
    .selectFrom('connected_accounts')
    .select(['id', 'credential_state'])
    .where(
      'id',
      'in',
      rows.map((r) => r.connected_account_id),
    )
    .execute();
  const state = new Map(accounts.map((a) => [a.id, a.credential_state]));
  return rows.map((r) => toMailbox(r, state.get(r.connected_account_id) ?? 'active'));
}

/** Loads a mailbox; `owner` requires the acting member to own it (non-member actors pass). */
export async function loadMailbox(tx: Tx, mailboxId: string, options: { owner?: boolean } = {}): Promise<MailboxRow> {
  const row = await tx.db.selectFrom('mailboxes').selectAll().where('id', '=', mailboxId).executeTakeFirst();
  if (!row) throw notFound('Mailbox not found', { mailbox_id: mailboxId });
  const memberId = actingMemberId(tx.ctx);
  if (options.owner && memberId && row.member_id !== memberId) {
    // Others' mailboxes do not exist for them (only admins may list them, read-only).
    throw notFound('Mailbox not found', { mailbox_id: mailboxId });
  }
  return row;
}

async function emitMailbox(tx: Tx, row: Pick<MailboxRow, 'id' | 'member_id'>): Promise<void> {
  const audience = await memberAudience(tx, row.member_id);
  tx.emit('mailbox', row.id, { mailboxId: row.id }, audience);
  tx.emit('mailbox-list', null, { memberId: row.member_id }, audience);
}

type GrantRow = {
  id: string;
  owner_member_id: string;
  resource_type: 'mailbox' | 'thread' | 'record';
  mailbox_id: string | null;
  thread_id: string | null;
  entity_definition_id: string | null;
  entity_instance_id: string | null;
  target_type: 'member' | 'workspace';
  target_member_id: string | null;
  level: EmailGrant['level'];
  created_by: unknown;
  created_at: string;
};

function toGrant(r: GrantRow): EmailGrant {
  const resource: EmailGrant['resource'] =
    r.resource_type === 'mailbox'
      ? { type: 'mailbox', mailboxId: r.mailbox_id as string }
      : r.resource_type === 'thread'
        ? { type: 'thread', threadId: r.thread_id as string }
        : {
            type: 'record',
            record: {
              entityDefinitionId: r.entity_definition_id as string,
              entityInstanceId: r.entity_instance_id as string,
            },
          };
  return {
    id: r.id,
    ownerMemberId: r.owner_member_id,
    resource,
    target:
      r.target_type === 'workspace'
        ? { type: 'workspace' }
        : { type: 'member', memberId: r.target_member_id as string },
    level: r.level,
    createdBy: toActor(r.created_by),
    createdAt: r.created_at,
  };
}

/** The grant row columns of a resource, after checking the caller may share it. */
async function grantResource(
  tx: Tx,
  deps: { policies: Policies },
  resource: ReturnType<typeof listGrantsInputSchema.parse>['resource'],
  ownerMemberId: string,
): Promise<
  Pick<GrantRow, 'resource_type' | 'mailbox_id' | 'thread_id' | 'entity_definition_id' | 'entity_instance_id'>
> {
  if (resource.type === 'mailbox') {
    const mailbox = await loadMailbox(tx, resource.mailboxId, { owner: true });
    if (mailbox.member_id !== ownerMemberId) throw forbidden('Only the mailbox owner can share it');
    return {
      resource_type: 'mailbox',
      mailbox_id: mailbox.id,
      thread_id: null,
      entity_definition_id: null,
      entity_instance_id: null,
    };
  }
  if (resource.type === 'thread') {
    const own = await tx.db
      .selectFrom('email_messages as m')
      .innerJoin('email_message_copies as c', 'c.message_id', 'm.id')
      .select('m.thread_id')
      .where('m.thread_id', '=', resource.threadId)
      .where('c.member_id', '=', ownerMemberId)
      .where('c.deleted_at', 'is', null)
      .executeTakeFirst();
    if (!own) throw notFound('Email thread not found', { thread_id: resource.threadId });
    return {
      resource_type: 'thread',
      mailbox_id: null,
      thread_id: resource.threadId,
      entity_definition_id: null,
      entity_instance_id: null,
    };
  }
  const [record] = await resolveRecordRefs(tx, deps, [resource.record]);
  const ref = record as { entityDefinitionId: string; entityInstanceId: string };
  return {
    resource_type: 'record',
    mailbox_id: null,
    thread_id: null,
    entity_definition_id: ref.entityDefinitionId,
    entity_instance_id: ref.entityInstanceId,
  };
}

function emitGrants(tx: Tx, grant: Pick<GrantRow, 'mailbox_id' | 'thread_id' | 'entity_instance_id'>): void {
  tx.emit('email-grant-list', null, {
    mailboxIds: grant.mailbox_id ? [grant.mailbox_id] : [],
    threadIds: grant.thread_id ? [grant.thread_id] : [],
    entityInstanceIds: grant.entity_instance_id ? [grant.entity_instance_id] : [],
  });
  // Access to synced email changed: every Emails tab may show more (or less).
  tx.emit('email-thread-list', null, { threadIds: grant.thread_id ? [grant.thread_id] : [] });
}

export const mailboxOps = {
  async list(tx: Tx, input: ListMailboxesInput): Promise<Mailbox[]> {
    const data = listMailboxesInputSchema.parse(input) ?? { includeArchived: false };
    const caller = actingMemberId(tx.ctx);
    const memberId = data.memberId ?? caller;
    if (!memberId) throw badRequest('VALIDATION_ERROR', 'memberId is required', { field: 'memberId' });
    if (caller && memberId !== caller) {
      const me = await tx.db
        .selectFrom('workspace_members')
        .select('access_level')
        .where('id', '=', caller)
        .executeTakeFirst();
      if (me?.access_level !== 'admin') throw forbidden("Only workspace admins can see other members' accounts");
    }
    const rows = await tx.db
      .selectFrom('mailboxes')
      .selectAll()
      .where('member_id', '=', memberId)
      .$if(!data.includeArchived, (q) => q.where('archived_at', 'is', null))
      .orderBy('created_at')
      .execute();
    return viewMailboxes(tx, rows);
  },

  async get(tx: Tx, mailboxId: string): Promise<Mailbox> {
    const row = await loadMailbox(tx, mailboxId, { owner: true });
    return (await viewMailboxes(tx, [row]))[0] as Mailbox;
  },

  /**
   * Connects a mailbox. 7a supports the `test` provider (address given by the caller); Gmail connects through OAuth
   * in 7b. Newly connected mailboxes take the workspace default visibility; the member's first one is the default
   * sending mailbox. Idempotent by id.
   */
  async connect(tx: Tx, input: ConnectMailboxInput, available: Set<string>): Promise<Mailbox> {
    const data = connectMailboxInputSchema.parse(input);
    const memberId = requireMember(tx);
    if (data.provider !== 'test' || !available.has(data.provider)) {
      throw new DomainError(
        400,
        'PROVIDER_NOT_SUPPORTED',
        data.provider === 'gmail'
          ? 'Google mailboxes connect through Google sign-in (mailboxes.authorize)'
          : `Connecting ${data.provider} mailboxes is not available yet`,
      );
    }
    const address = data.emailAddress ? toAddress(data.emailAddress) : null;
    if (!address) throw badRequest('VALIDATION_ERROR', 'A valid email address is required', { field: 'emailAddress' });
    const id = data.id ?? newId();
    const existing = await tx.db.selectFrom('mailboxes').selectAll().where('id', '=', id).executeTakeFirst();
    if (existing) {
      if (existing.member_id !== memberId) throw conflict('ID_CONFLICT', 'A mailbox with this id already exists');
      return (await viewMailboxes(tx, [existing]))[0] as Mailbox;
    }
    const taken = await tx.db
      .selectFrom('mailboxes')
      .select('id')
      .where('email_address', '=', address.email)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    if (taken) {
      throw conflict('MAILBOX_ALREADY_CONNECTED', 'This email address is already connected', {
        email_address: address.email,
      });
    }
    const settings = await loadEmailSettings(tx);
    const accountId = newId();
    await tx.db
      .insertInto('connected_accounts')
      .values({
        id: accountId,
        workspace_id: tx.workspaceId,
        member_id: memberId,
        provider: data.provider,
        external_account_id: address.email,
        email_address: address.email,
      })
      .execute();
    const hasDefault = await tx.db
      .selectFrom('mailboxes')
      .select('id')
      .where('member_id', '=', memberId)
      .where('is_default', '=', true)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    const aliases = [
      ...new Set((data.aliases ?? []).map((a) => toAddress(a)?.email).filter((a): a is string => !!a)),
    ].filter((a) => a !== address.email);
    const row = await tx.db
      .insertInto('mailboxes')
      .values({
        id,
        workspace_id: tx.workspaceId,
        connected_account_id: accountId,
        member_id: memberId,
        provider_type: data.provider,
        email_address: address.email,
        aliases,
        is_default: !hasDefault,
        calendar_sync_enabled: data.syncCalendar,
        default_visibility: settings.defaultVisibility,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    invalidateEmailMemo(tx);
    await emitMailbox(tx, row);
    return (await viewMailboxes(tx, [row]))[0] as Mailbox;
  },

  /**
   * Connects or reconnects an OAuth mailbox (7b: Gmail) after the provider's consent. The member's active mailbox
   * with the same address — or the one named by `reconnectMailboxId` — gets the new credentials and becomes active
   * again (sync resumes from its cursor); otherwise a new mailbox is created like `connect` does. An address another
   * member has connected is refused.
   */
  async connectOAuth(tx: Tx, input: OAuthConnectInput): Promise<{ mailbox: Mailbox; reconnected: boolean }> {
    const memberId = requireMember(tx);
    const address = toAddress(input.emailAddress);
    if (!address) throw badRequest('VALIDATION_ERROR', 'The account has no valid email address');
    const aliases = [
      ...new Set(input.aliases.map((a) => toAddress(a)?.email).filter((a): a is string => !!a && a !== address.email)),
    ];
    let target: MailboxRow | null = null;
    if (input.reconnectMailboxId) {
      const row = await loadMailbox(tx, input.reconnectMailboxId, { owner: true });
      if (row.provider_type !== input.provider) {
        throw badRequest('VALIDATION_ERROR', 'Only Google mailboxes reconnect through Google');
      }
      if (!row.archived_at) {
        if (row.email_address !== address.email) {
          throw conflict('MAILBOX_ACCOUNT_MISMATCH', `You signed in as ${address.email}, not ${row.email_address}`, {
            email_address: address.email,
            expected_email_address: row.email_address,
          });
        }
        target = row;
      }
    }
    if (!target) {
      const taken = await tx.db
        .selectFrom('mailboxes')
        .selectAll()
        .where('email_address', '=', address.email)
        .where('archived_at', 'is', null)
        .executeTakeFirst();
      if (taken && (taken.member_id !== memberId || taken.provider_type !== input.provider)) {
        throw conflict('MAILBOX_ALREADY_CONNECTED', 'This email address is already connected', {
          email_address: address.email,
        });
      }
      target = taken ?? null;
    }
    if (target) {
      await tx.db
        .updateTable('connected_accounts')
        .set({
          credentials: JSON.stringify(input.credentials),
          credential_state: 'active',
          credential_error: null,
          external_account_id: input.externalAccountId,
          updated_at: tx.now,
        })
        .where('id', '=', target.connected_account_id)
        .execute();
      const row = await tx.db
        .updateTable('mailboxes')
        .set({ aliases: [...new Set([...target.aliases, ...aliases])], sync_error: null, updated_at: tx.now })
        .where('id', '=', target.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      invalidateEmailMemo(tx);
      await emitMailbox(tx, row);
      return { mailbox: (await viewMailboxes(tx, [row]))[0] as Mailbox, reconnected: true };
    }
    const settings = await loadEmailSettings(tx);
    const accountId = newId();
    await tx.db
      .insertInto('connected_accounts')
      .values({
        id: accountId,
        workspace_id: tx.workspaceId,
        member_id: memberId,
        provider: input.provider,
        external_account_id: input.externalAccountId,
        email_address: address.email,
        credentials: JSON.stringify(input.credentials),
      })
      .execute();
    const hasDefault = await tx.db
      .selectFrom('mailboxes')
      .select('id')
      .where('member_id', '=', memberId)
      .where('is_default', '=', true)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    const row = await tx.db
      .insertInto('mailboxes')
      .values({
        id: newId(),
        workspace_id: tx.workspaceId,
        connected_account_id: accountId,
        member_id: memberId,
        provider_type: input.provider,
        email_address: address.email,
        aliases,
        is_default: !hasDefault,
        calendar_sync_enabled: true,
        default_visibility: settings.defaultVisibility,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    invalidateEmailMemo(tx);
    await emitMailbox(tx, row);
    return { mailbox: (await viewMailboxes(tx, [row]))[0] as Mailbox, reconnected: false };
  },

  async update(tx: Tx, input: UpdateMailboxInput): Promise<Mailbox> {
    const data = updateMailboxInputSchema.parse(input);
    const row = await loadMailbox(tx, data.mailboxId, { owner: true });
    if (row.archived_at) throw badRequest('VALIDATION_ERROR', 'This mailbox was removed');
    if (data.defaultSignatureId) {
      const signature = await tx.db
        .selectFrom('mailbox_signatures')
        .select('id')
        .where('id', '=', data.defaultSignatureId)
        .where('mailbox_id', '=', row.id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!signature) throw notFound('Signature not found', { signature_id: data.defaultSignatureId });
    }
    if (data.isDefault) {
      await tx.db
        .updateTable('mailboxes')
        .set({ is_default: false })
        .where('member_id', '=', row.member_id)
        .where('id', '!=', row.id)
        .execute();
    }
    const updated = await tx.db
      .updateTable('mailboxes')
      .set({
        ...(data.defaultVisibility ? { default_visibility: data.defaultVisibility } : {}),
        ...(data.isDefault ? { is_default: true } : {}),
        ...(data.mailSyncEnabled !== undefined ? { mail_sync_enabled: data.mailSyncEnabled } : {}),
        ...(data.calendarSyncEnabled !== undefined ? { calendar_sync_enabled: data.calendarSyncEnabled } : {}),
        ...(data.defaultSignatureId !== undefined ? { default_signature_id: data.defaultSignatureId } : {}),
        updated_at: tx.now,
      })
      .where('id', '=', row.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await emitMailbox(tx, updated);
    if (data.defaultVisibility && data.defaultVisibility !== row.default_visibility) {
      tx.emit('email-thread-list', null, { mailboxIds: [row.id] });
      tx.emit('meeting-list', null, { mailboxIds: [row.id] });
    }
    return (await viewMailboxes(tx, [updated]))[0] as Mailbox;
  },

  /**
   * "Remove mailbox" (F settings §1): the mailbox is archived, its synced copies (emails and calendar events) are
   * removed, its grants are revoked. Returns the records whose interactions must be recomputed.
   */
  async disconnect(
    tx: Tx,
    mailboxId: string,
  ): Promise<{ mailbox: Mailbox; records: { entityDefinitionId: string; entityInstanceId: string }[] }> {
    const row = await loadMailbox(tx, mailboxId, { owner: true });
    if (row.archived_at) return { mailbox: (await viewMailboxes(tx, [row]))[0] as Mailbox, records: [] };
    const { rows: records } = await sql<{ entity_definition_id: string; entity_instance_id: string }>`
      SELECT DISTINCT r.entity_definition_id, r.entity_instance_id
      FROM email_message_copies c JOIN email_message_records r ON r.message_id = c.message_id
      WHERE c.mailbox_id = ${row.id} AND c.deleted_at IS NULL
      UNION
      SELECT DISTINCT d.id, x.record_id FROM calendar_events e
      JOIN LATERAL (
        SELECT p.person_id AS record_id FROM meeting_participants p WHERE p.meeting_id = e.meeting_id AND p.person_id IS NOT NULL
        UNION SELECT p.company_id FROM meeting_participants p WHERE p.meeting_id = e.meeting_id AND p.company_id IS NOT NULL
      ) x ON true
      JOIN entity_instances i ON i.id = x.record_id
      JOIN entity_definitions d ON d.id = i.entity_definition_id
      WHERE e.mailbox_id = ${row.id} AND e.deleted_at IS NULL`.execute(tx.db);
    await tx.db
      .updateTable('email_message_copies')
      .set({ deleted_at: tx.now })
      .where('mailbox_id', '=', row.id)
      .where('deleted_at', 'is', null)
      .execute();
    const events = await tx.db
      .updateTable('calendar_events')
      .set({ deleted_at: tx.now })
      .where('mailbox_id', '=', row.id)
      .where('deleted_at', 'is', null)
      .returning('meeting_id')
      .execute();
    // Synced meetings left without any calendar copy are gone.
    const meetingIds = [...new Set(events.map((e) => e.meeting_id))];
    if (meetingIds.length > 0) {
      await sql`
        UPDATE meetings m SET deleted_at = ${tx.now}::timestamptz, deleted_by = ${JSON.stringify(tx.ctx.actor)}::jsonb
        WHERE m.id = ANY(${meetingIds}::uuid[]) AND m.source = 'calendar' AND m.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM calendar_events e WHERE e.meeting_id = m.id AND e.deleted_at IS NULL)`.execute(
        tx.db,
      );
    }
    await tx.db.deleteFrom('email_grants').where('mailbox_id', '=', row.id).execute();
    await tx.db
      .updateTable('connected_accounts')
      .set({ credential_state: 'disconnected', disconnected_at: tx.now, credentials: null, updated_at: tx.now })
      .where('id', '=', row.connected_account_id)
      .execute();
    const archived = await tx.db
      .updateTable('mailboxes')
      .set({ archived_at: tx.now, is_default: false, updated_at: tx.now })
      .where('id', '=', row.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    // Another active mailbox of the member becomes the default sender.
    if (row.is_default) {
      const next = await tx.db
        .selectFrom('mailboxes')
        .select('id')
        .where('member_id', '=', row.member_id)
        .where('archived_at', 'is', null)
        .orderBy('created_at')
        .executeTakeFirst();
      if (next) await tx.db.updateTable('mailboxes').set({ is_default: true }).where('id', '=', next.id).execute();
    }
    invalidateEmailMemo(tx);
    await emitMailbox(tx, archived);
    tx.emit('email-thread-list', null, { mailboxIds: [row.id] });
    tx.emit('meeting-list', null, { mailboxIds: [row.id] });
    return {
      mailbox: (await viewMailboxes(tx, [archived]))[0] as Mailbox,
      records: records.map((r) => ({
        entityDefinitionId: r.entity_definition_id,
        entityInstanceId: r.entity_instance_id,
      })),
    };
  },

  async listBlocklist(tx: Tx, mailboxId: string): Promise<BlocklistEntry[]> {
    const row = await loadMailbox(tx, mailboxId, { owner: true });
    const rows = await tx.db
      .selectFrom('mailbox_blocklist')
      .selectAll()
      .where('mailbox_id', '=', row.id)
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      mailboxId: r.mailbox_id,
      kind: r.kind,
      value: r.value,
      createdBy: toActor(r.created_by),
      createdAt: r.created_at,
    }));
  },

  async addBlocklist(tx: Tx, input: AddBlocklistInput): Promise<AddContactsOutput> {
    const data = addBlocklistInputSchema.parse(input);
    const row = await loadMailbox(tx, data.mailboxId, { owner: true });
    const existing = await tx.db
      .selectFrom('mailbox_blocklist')
      .select(['kind', 'value'])
      .where('mailbox_id', '=', row.id)
      .execute();
    const { fresh, duplicates, invalid } = classifyContacts(
      data.values,
      new Set(existing.map((e) => `${e.kind}:${e.value}`)),
    );
    const added =
      fresh.length === 0
        ? []
        : await tx.db
            .insertInto('mailbox_blocklist')
            .values(
              fresh.map((c) => ({
                id: newId(),
                workspace_id: tx.workspaceId,
                mailbox_id: row.id,
                kind: c.kind,
                value: c.value,
                created_by: JSON.stringify(tx.ctx.actor),
              })),
            )
            .returningAll()
            .execute();
    tx.memo.delete(`mailbox-blocklist:${row.id}`);
    tx.emit('mailbox-blocklist', row.id, { mailboxId: row.id }, await memberAudience(tx, row.member_id));
    return {
      added: added.map((r) => ({
        id: r.id,
        kind: r.kind,
        value: r.value,
        createdBy: toActor(r.created_by),
        createdAt: r.created_at,
      })),
      duplicates,
      invalid,
    };
  },

  async removeBlocklist(tx: Tx, input: { id: string }): Promise<{ id: string }> {
    const { id } = removeEntryInputSchema.parse(input);
    const entry = await tx.db
      .selectFrom('mailbox_blocklist')
      .select('mailbox_id')
      .where('id', '=', id)
      .executeTakeFirst();
    if (!entry) throw notFound('Blocklist entry not found', { id });
    const row = await loadMailbox(tx, entry.mailbox_id, { owner: true });
    await tx.db.deleteFrom('mailbox_blocklist').where('id', '=', id).execute();
    tx.memo.delete(`mailbox-blocklist:${row.id}`);
    tx.emit('mailbox-blocklist', row.id, { mailboxId: row.id }, await memberAudience(tx, row.member_id));
    return { id };
  },
};

/** Provider credentials of connected accounts, written on behalf of connectors (token refresh, revoked grants). */
export const accountOps = {
  /** Stores refreshed (sealed) credentials of an active account. */
  async saveCredentials(tx: Tx, accountId: string, credentials: unknown): Promise<void> {
    await tx.db
      .updateTable('connected_accounts')
      .set({ credentials: JSON.stringify(credentials), updated_at: tx.now })
      .where('id', '=', accountId)
      .where('credential_state', '=', 'active')
      .where('disconnected_at', 'is', null)
      .execute();
  },

  /**
   * The provider grant is gone (revoked, expired, unreadable or missing scopes): the account needs reconnection. Its
   * mailboxes show "Sync Error" with the reason; sync and delivery stop until the member reconnects.
   */
  async markNeedsReconnect(tx: Tx, accountId: string, message: string): Promise<void> {
    const updated = await tx.db
      .updateTable('connected_accounts')
      .set({ credential_state: 'error-detected', credential_error: message, updated_at: tx.now })
      .where('id', '=', accountId)
      .where('disconnected_at', 'is', null)
      .returning('id')
      .execute();
    if (updated.length === 0) return;
    const rows = await tx.db
      .updateTable('mailboxes')
      .set({ sync_error: message, updated_at: tx.now })
      .where('connected_account_id', '=', accountId)
      .where('archived_at', 'is', null)
      .returningAll()
      .execute();
    for (const row of rows) await emitMailbox(tx, row);
  },
};

export const grantOps = {
  /** Grants of a resource the caller owns (their mailbox, their copies of a thread, their emails on a record). */
  async list(tx: Tx, deps: { policies: Policies }, input: ListGrantsInput): Promise<EmailGrant[]> {
    const data = listGrantsInputSchema.parse(input);
    const owner = requireMember(tx);
    const cols = await grantResource(tx, deps, data.resource, owner);
    const rows = await tx.db
      .selectFrom('email_grants')
      .selectAll()
      .where('owner_member_id', '=', owner)
      .where('resource_type', '=', cols.resource_type)
      .$if(cols.mailbox_id !== null, (q) => q.where('mailbox_id', '=', cols.mailbox_id as string))
      .$if(cols.thread_id !== null, (q) => q.where('thread_id', '=', cols.thread_id as string))
      .$if(cols.entity_instance_id !== null, (q) =>
        q.where('entity_instance_id', '=', cols.entity_instance_id as string),
      )
      .orderBy('created_at')
      .execute();
    return rows.map((r) => toGrant(r as GrantRow));
  },

  /** Shares the caller's emails (upsert per resource and target; the level is replaced). */
  async put(tx: Tx, deps: { policies: Policies }, input: PutGrantInput): Promise<EmailGrant> {
    const data = putGrantInputSchema.parse(input);
    const owner = requireMember(tx);
    const cols = await grantResource(tx, deps, data.resource, owner);
    const targetMemberId = data.target.type === 'member' ? data.target.memberId : null;
    if (targetMemberId) {
      if (targetMemberId === owner) throw badRequest('VALIDATION_ERROR', 'You always see your own emails');
      const member = await tx.db
        .selectFrom('workspace_members')
        .select('id')
        .where('id', '=', targetMemberId)
        .executeTakeFirst();
      if (!member) throw notFound('Workspace member not found', { member_id: targetMemberId });
    }
    const { rows } = await sql<GrantRow>`
      INSERT INTO email_grants (id, workspace_id, owner_member_id, resource_type, mailbox_id, thread_id,
        entity_definition_id, entity_instance_id, target_type, target_member_id, level, created_by)
      VALUES (${newId()}, ${tx.workspaceId}, ${owner}, ${cols.resource_type}, ${cols.mailbox_id}, ${cols.thread_id},
        ${cols.entity_definition_id}, ${cols.entity_instance_id}, ${data.target.type}, ${targetMemberId}, ${data.level},
        ${JSON.stringify(tx.ctx.actor)}::jsonb)
      ON CONFLICT (owner_member_id, resource_type, coalesce(mailbox_id, thread_id, entity_instance_id), target_type,
        coalesce(target_member_id, '00000000-0000-0000-0000-000000000000'::uuid))
      DO UPDATE SET level = excluded.level
      RETURNING *`.execute(tx.db);
    const grant = rows[0] as GrantRow;
    emitGrants(tx, grant);
    return toGrant(grant);
  },

  async remove(tx: Tx, input: { grantId: string }): Promise<{ id: string }> {
    const { grantId } = removeGrantInputSchema.parse(input);
    const owner = requireMember(tx);
    const row = await tx.db
      .deleteFrom('email_grants')
      .where('id', '=', grantId)
      .where('owner_member_id', '=', owner)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw notFound('Grant not found', { grant_id: grantId });
    emitGrants(tx, row);
    return { id: grantId };
  },
};
