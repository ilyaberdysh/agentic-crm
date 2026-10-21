// Message drafts, review and send (F composer §2, §3; BACKLOG 7.06–7.07 server, acceptance 4).
//   • Drafts are private to their creator and autosave per field: every update writes only the fields it carries and
//     stamps them in field_updated_at (revision +1 per write), so two windows editing different fields never
//     overwrite each other.
//   • Subject = text with variables, body = editor blocks with variables (B.11); recipients = addresses with the
//     person record they belong to (matched by address when not given).
//   • Review (§2.10) renders every email as it will be sent — one per To recipient in mass send, one otherwise — with
//     variables merged from the recipient record, and lists what blocks sending (no recipients, variables with
//     several recipients outside mass send, unresolved variables without fallback, pending attachments, sender
//     mailbox unavailable, …). Send re-runs the review, queues the emails in the outbox and closes the draft.
import {
  type CreateDraftAttachmentInput,
  type CreateDraftInput,
  createDraftAttachmentInputSchema,
  createDraftInputSchema,
  type DraftAttachment,
  type DraftField,
  type MessageDraft,
  type ReviewDraftOutput,
  type SendDraftInput,
  sendDraftInputSchema,
  type UpdateDraftInput,
  updateDraftInputSchema,
} from '@agentic-crm/contracts';
import type { MessageDraftsTable, Selectable } from '@agentic-crm/db';
import type { Block, VariableRef } from '@agentic-crm/editor/model';
import { memberAudience, requireMember, resolveRecordRefs } from '../collab/common.ts';
import { badRequest, conflict, DomainError, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import type { Policies } from '../permissions.ts';
import type { Tx } from '../tx.ts';
import { messageAccess } from './access.ts';
import { rank, toAddress } from './model.ts';
import { RecordResolver } from './records.ts';
import { hasVariables, renderAnnotated, renderBody } from './render.ts';
import { bodyPreview, parseBody, templateOps } from './templates.ts';
import { VariableResolver } from './variables.ts';

type DraftRow = Selectable<MessageDraftsTable>;

/** Mass send recipient cap (F composer §2.9: 50 outside the Free plan). */
export const MASS_SEND_MAX_RECIPIENTS = 50;
/** Attachment limits (Gmail's message limit is 25 MB). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const ATTACHMENT_URL_TTL_SECONDS = 15 * 60;

export interface Recipient {
  emailAddress: string;
  name: string | null;
  record: { entityDefinitionId: string; entityInstanceId: string } | null;
}

interface Subject {
  text: string;
  variables: VariableRef[];
}

export interface DraftDeps {
  policies: Policies;
}

const recipientsOf = (value: unknown): Recipient[] => (Array.isArray(value) ? (value as Recipient[]) : []);
const subjectOf = (value: unknown): Subject => {
  const v = (value ?? {}) as Partial<Subject>;
  return { text: typeof v.text === 'string' ? v.text : '', variables: Array.isArray(v.variables) ? v.variables : [] };
};
const bodyOf = (value: unknown): Block[] => (Array.isArray(value) ? (value as Block[]) : []);

export function draftAttachmentKey(workspaceId: string, draftId: string, attachmentId: string): string {
  return `workspaces/${workspaceId}/message-attachments/${draftId}/${attachmentId}`;
}

async function attachmentsOf(tx: Tx, draftIds: string[]): Promise<Map<string, DraftAttachment[]>> {
  const out = new Map<string, DraftAttachment[]>();
  if (draftIds.length === 0) return out;
  const rows = await tx.db
    .selectFrom('message_draft_attachments')
    .selectAll()
    .where('draft_id', 'in', draftIds)
    .where('deleted_at', 'is', null)
    .orderBy('position')
    .execute();
  for (const r of rows) {
    const list = out.get(r.draft_id) ?? [];
    list.push({ id: r.id, name: r.name, contentType: r.content_type, size: Number(r.content_size), state: r.state });
    out.set(r.draft_id, list);
  }
  return out;
}

function toDraft(row: DraftRow, attachments: DraftAttachment[]): MessageDraft {
  const subject = subjectOf(row.subject);
  const body = bodyOf(row.body);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    memberId: row.member_id,
    senderMailboxId: row.sender_mailbox_id,
    subject,
    body: body as unknown as Record<string, unknown>[],
    to: recipientsOf(row.to_recipients),
    cc: recipientsOf(row.cc_recipients),
    bcc: recipientsOf(row.bcc_recipients),
    isMassSend: row.is_mass_send,
    signatureId: row.signature_id,
    parentMessageId: row.parent_message_id,
    templateId: row.template_id,
    attachments,
    revision: row.revision,
    fieldUpdatedAt: (row.field_updated_at ?? {}) as Record<string, string>,
    hasVariables: hasVariables(subject, body),
    preview: bodyPreview(body),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadDraft(tx: Tx, draftId: string, options: { open?: boolean } = {}): Promise<DraftRow> {
  const memberId = requireMember(tx);
  const row = await tx.db
    .selectFrom('message_drafts')
    .selectAll()
    .where('id', '=', draftId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  // Drafts are private: someone else's draft does not exist for the caller.
  if (!row || row.member_id !== memberId) throw notFound('Draft not found', { draft_id: draftId });
  if (options.open && row.send_requested_at !== null) {
    throw conflict('EMAIL_STATE_CONFLICT', 'This draft has already been sent', { draft_id: draftId });
  }
  return row;
}

async function viewDraft(tx: Tx, row: DraftRow): Promise<MessageDraft> {
  return toDraft(row, (await attachmentsOf(tx, [row.id])).get(row.id) ?? []);
}

async function emitDraft(tx: Tx, row: Pick<DraftRow, 'id' | 'member_id'>): Promise<void> {
  const audience = await memberAudience(tx, row.member_id);
  tx.emit('message-draft', row.id, { draftId: row.id }, audience);
  tx.emit('message-draft-list', null, { memberId: row.member_id }, audience);
}

/** Validates recipients; records are resolved (and matched by address when not given). */
async function normalizeRecipients(
  tx: Tx,
  deps: DraftDeps,
  list: {
    emailAddress: string;
    name?: string | null;
    record?: { entityDefinitionId: string; entityInstanceId: string } | null;
  }[],
  field: string,
): Promise<Recipient[]> {
  const resolver = await RecordResolver.create(tx);
  const out: Recipient[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    const address = toAddress(r.emailAddress, r.name ?? null);
    if (!address) throw badRequest('VALIDATION_ERROR', `Invalid email address "${r.emailAddress}"`, { field });
    if (seen.has(address.email)) continue;
    seen.add(address.email);
    let record: Recipient['record'] = null;
    if (r.record) {
      const [ref] = await resolveRecordRefs(tx, deps, [r.record], { what: field });
      record = ref ?? null;
    } else {
      const personId = await resolver.findPerson(address);
      if (personId) record = { entityDefinitionId: resolver.peopleId, entityInstanceId: personId };
    }
    out.push({ emailAddress: address.original, name: address.name, record });
  }
  return out;
}

async function senderMailbox(tx: Tx, memberId: string, requested: string | null | undefined) {
  if (requested) {
    const row = await tx.db
      .selectFrom('mailboxes')
      .selectAll()
      .where('id', '=', requested)
      .where('member_id', '=', memberId)
      .executeTakeFirst();
    if (!row) throw notFound('Mailbox not found', { mailbox_id: requested });
    return row;
  }
  return (
    (await tx.db
      .selectFrom('mailboxes')
      .selectAll()
      .where('member_id', '=', memberId)
      .where('archived_at', 'is', null)
      .orderBy('is_default', 'desc')
      .orderBy('created_at')
      .executeTakeFirst()) ?? null
  );
}

function stamp(row: DraftRow, fields: DraftField[], now: string): Record<string, string> {
  const current = { ...((row.field_updated_at ?? {}) as Record<string, string>) };
  for (const f of fields) current[f] = now;
  return current;
}

export interface PlannedEmail {
  to: Recipient[];
  cc: Recipient[];
  bcc: Recipient[];
  /** The record variables were merged from. */
  record: Recipient['record'];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  missing: { location: 'subject' | 'body'; variable: VariableRef }[];
}

export interface DraftPlan {
  draft: DraftRow;
  sender: Awaited<ReturnType<typeof senderMailbox>>;
  emails: PlannedEmail[];
  issues: string[];
}

/** Renders the emails a draft would send and the reasons it cannot be sent (review step). */
export async function planDraft(tx: Tx, deps: DraftDeps, row: DraftRow): Promise<DraftPlan> {
  const subject = subjectOf(row.subject);
  const body = bodyOf(row.body);
  const to = recipientsOf(row.to_recipients);
  const cc = recipientsOf(row.cc_recipients);
  const bcc = recipientsOf(row.bcc_recipients);
  const issues: string[] = [];
  const usesVariables = hasVariables(subject, body);
  if (to.length === 0) issues.push('no-recipients');
  if (usesVariables && !row.is_mass_send && to.length > 1) issues.push('variables-need-mass-send');
  if (row.is_mass_send && to.length > MASS_SEND_MAX_RECIPIENTS) issues.push('too-many-recipients');
  const sender = await senderMailbox(tx, row.member_id, row.sender_mailbox_id);
  if (!sender) issues.push('no-sender');
  else {
    const account = await tx.db
      .selectFrom('connected_accounts')
      .select('credential_state')
      .where('id', '=', sender.connected_account_id)
      .executeTakeFirst();
    if (sender.archived_at || !sender.mail_delivery_enabled || account?.credential_state !== 'active') {
      issues.push('sender-disconnected');
    }
  }
  const attachments = (await attachmentsOf(tx, [row.id])).get(row.id) ?? [];
  if (attachments.some((a) => a.state !== 'committed')) issues.push('pending-attachments');
  if (subject.text.trim() === '' && body.every((b) => b.type !== 'image-embed' && b.text.trim() === '')) {
    issues.push('no-content');
  }

  const variables = new VariableResolver(tx, deps.policies);
  const groups: { to: Recipient[]; record: Recipient['record'] }[] = row.is_mass_send
    ? to.map((r) => ({ to: [r], record: r.record }))
    : [{ to, record: to[0]?.record ?? null }];
  const emails: PlannedEmail[] = [];
  for (const group of groups) {
    const all = [...subject.variables, ...body.flatMap((b) => b.variables ?? [])];
    const values = new Map<VariableRef, string | null>();
    for (const v of all) values.set(v, group.record ? await variables.resolve(group.record, v) : null);
    const resolve = (v: VariableRef) => values.get(v) ?? null;
    const renderedSubject = renderAnnotated(subject.text, subject.variables, resolve);
    const renderedBody = renderBody(body, resolve);
    emails.push({
      to: group.to,
      cc,
      bcc,
      record: group.record,
      subject: renderedSubject.text,
      bodyText: renderedBody.text,
      bodyHtml: renderedBody.html,
      missing: [
        ...renderedSubject.missing.map((variable) => ({ location: 'subject' as const, variable })),
        ...renderedBody.missing.map((variable) => ({ location: 'body' as const, variable })),
      ],
    });
  }
  if (emails.some((e) => e.missing.length > 0)) issues.push('unresolved-variables');
  return { draft: row, sender, emails, issues };
}

export const draftOps = {
  async list(tx: Tx): Promise<MessageDraft[]> {
    const memberId = requireMember(tx);
    const rows = await tx.db
      .selectFrom('message_drafts')
      .selectAll()
      .where('member_id', '=', memberId)
      .where('deleted_at', 'is', null)
      .where('send_requested_at', 'is', null)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    const attachments = await attachmentsOf(
      tx,
      rows.map((r) => r.id),
    );
    return rows.map((r) => toDraft(r, attachments.get(r.id) ?? []));
  },

  async get(tx: Tx, draftId: string): Promise<MessageDraft> {
    return viewDraft(tx, await loadDraft(tx, draftId));
  },

  /** Opening the composer creates the draft at once (F composer §2.2); idempotent by id. */
  async create(tx: Tx, deps: DraftDeps, input: CreateDraftInput): Promise<MessageDraft> {
    const data = createDraftInputSchema.parse(input);
    const memberId = requireMember(tx);
    const existing = await tx.db.selectFrom('message_drafts').selectAll().where('id', '=', data.id).executeTakeFirst();
    if (existing) {
      if (existing.member_id !== memberId || existing.deleted_at) {
        throw conflict('ID_CONFLICT', 'A draft with this id already exists', { draft_id: data.id });
      }
      return viewDraft(tx, existing);
    }
    let subject: Subject = data.subject
      ? { text: data.subject.text, variables: data.subject.variables as VariableRef[] }
      : { text: '', variables: [] };
    let body = parseBody(data.body);
    if (data.templateId) {
      const template = await templateOps.content(tx, data.templateId);
      if (!data.subject)
        subject = { text: template.subject.text, variables: template.subject.variables as VariableRef[] };
      if (!data.body) body = template.body;
    }
    let to = await normalizeRecipients(tx, deps, data.to ?? [], 'to');
    if (data.parentMessageId) {
      const access = (await messageAccess(tx, [data.parentMessageId])).get(data.parentMessageId);
      if (!access || access.access === 'none') throw notFound('Email not found', { message_id: data.parentMessageId });
      const parent = await tx.db
        .selectFrom('email_messages')
        .select(['subject'])
        .where('id', '=', data.parentMessageId)
        .executeTakeFirstOrThrow();
      if (!data.subject && rank(access.access) >= rank('subject-line')) {
        subject = { text: /^re:/i.test(parent.subject) ? parent.subject : `Re: ${parent.subject}`, variables: [] };
      }
      if (!data.to) {
        const participants = await tx.db
          .selectFrom('email_participants')
          .select(['role', 'original_email_address', 'name', 'member_id'])
          .where('message_id', '=', data.parentMessageId)
          .execute();
        const from = participants.find((p) => p.role === 'reply-to') ?? participants.find((p) => p.role === 'from');
        const replyTo =
          from && from.member_id !== memberId
            ? [from]
            : participants.filter((p) => p.role === 'to' && p.member_id !== memberId);
        to = await normalizeRecipients(
          tx,
          deps,
          replyTo.map((p) => ({ emailAddress: p.original_email_address, name: p.name })),
          'to',
        );
      }
    }
    const sender = await senderMailbox(tx, memberId, data.senderMailboxId);
    const signature = sender?.default_signature_id ?? null;
    const provided: DraftField[] = ['subject', 'body', 'to', 'cc', 'bcc', 'isMassSend', 'senderMailboxId'];
    const row = await tx.db
      .insertInto('message_drafts')
      .values({
        id: data.id,
        workspace_id: tx.workspaceId,
        member_id: memberId,
        sender_mailbox_id: sender?.id ?? null,
        subject: JSON.stringify(subject),
        body: JSON.stringify(body),
        to_recipients: JSON.stringify(to),
        cc_recipients: JSON.stringify(await normalizeRecipients(tx, deps, data.cc ?? [], 'cc')),
        bcc_recipients: JSON.stringify(await normalizeRecipients(tx, deps, data.bcc ?? [], 'bcc')),
        is_mass_send: data.isMassSend ?? false,
        signature_id: signature,
        parent_message_id: data.parentMessageId ?? null,
        template_id: data.templateId ?? null,
        field_updated_at: JSON.stringify(Object.fromEntries(provided.map((f) => [f, tx.now]))),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await emitDraft(tx, row);
    return viewDraft(tx, row);
  },

  /** Autosave: writes only the given fields (each stamped in fieldUpdatedAt); revision +1. */
  async update(tx: Tx, deps: DraftDeps, input: UpdateDraftInput): Promise<MessageDraft> {
    const data = updateDraftInputSchema.parse(input);
    const row = await loadDraft(tx, data.draftId, { open: true });
    const set: Record<string, unknown> = {};
    const fields: DraftField[] = [];
    if (data.subject !== undefined) {
      set.subject = JSON.stringify(data.subject);
      fields.push('subject');
    }
    if (data.body !== undefined) {
      set.body = JSON.stringify(parseBody(data.body));
      fields.push('body');
    }
    for (const [field, column] of [
      ['to', 'to_recipients'],
      ['cc', 'cc_recipients'],
      ['bcc', 'bcc_recipients'],
    ] as const) {
      const list = data[field];
      if (list === undefined) continue;
      set[column] = JSON.stringify(await normalizeRecipients(tx, deps, list, field));
      fields.push(field);
    }
    if (data.isMassSend !== undefined) {
      set.is_mass_send = data.isMassSend;
      fields.push('isMassSend');
    }
    if (data.senderMailboxId !== undefined) {
      const sender = await senderMailbox(tx, row.member_id, data.senderMailboxId);
      set.sender_mailbox_id = sender?.id ?? null;
      fields.push('senderMailboxId');
    }
    if (data.signatureId !== undefined) {
      if (data.signatureId) {
        const signature = await tx.db
          .selectFrom('mailbox_signatures as s')
          .innerJoin('mailboxes as m', 'm.id', 's.mailbox_id')
          .select('s.id')
          .where('s.id', '=', data.signatureId)
          .where('m.member_id', '=', row.member_id)
          .where('s.deleted_at', 'is', null)
          .executeTakeFirst();
        if (!signature) throw notFound('Signature not found', { signature_id: data.signatureId });
      }
      set.signature_id = data.signatureId;
      fields.push('signatureId');
    }
    if (fields.length === 0) return viewDraft(tx, row);
    const updated = await tx.db
      .updateTable('message_drafts')
      .set({
        ...set,
        field_updated_at: JSON.stringify(stamp(row, fields, tx.now)),
        revision: row.revision + 1,
        updated_at: tx.now,
      } as never)
      .where('id', '=', row.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await emitDraft(tx, updated);
    return viewDraft(tx, updated);
  },

  /** Drafts list ⋮ → Delete draft / composer trash / closing an empty draft. */
  async delete(tx: Tx, draftId: string): Promise<{ id: string }> {
    const row = await loadDraft(tx, draftId);
    await tx.db.updateTable('message_drafts').set({ deleted_at: tx.now }).where('id', '=', row.id).execute();
    await tx.db
      .updateTable('message_draft_attachments')
      .set({ deleted_at: tx.now })
      .where('draft_id', '=', row.id)
      .where('deleted_at', 'is', null)
      .execute();
    await emitDraft(tx, row);
    return { id: row.id };
  },

  async review(tx: Tx, deps: DraftDeps, draftId: string): Promise<ReviewDraftOutput> {
    const row = await loadDraft(tx, draftId, { open: true });
    const plan = await planDraft(tx, deps, row);
    const variables = new VariableResolver(tx, deps.policies);
    const peopleId = (await RecordResolver.create(tx)).peopleId;
    const emails = [];
    for (const e of plan.emails) {
      const missing = [];
      for (const m of e.missing) {
        missing.push({
          location: m.location,
          label: m.variable.label ?? (await variables.label(e.record?.entityDefinitionId ?? peopleId, m.variable)),
          path: m.variable.path,
          field: m.variable.field,
        });
      }
      for (const recipient of e.to) {
        emails.push({
          recipient,
          subject: e.subject,
          bodyText: e.bodyText,
          bodyHtml: e.bodyHtml,
          missing,
        });
        if (!row.is_mass_send) break;
      }
    }
    return {
      draftId: row.id,
      isMassSend: row.is_mass_send,
      emails,
      issues: plan.issues,
      canSend: plan.issues.length === 0,
    };
  },

  /** Attachment upload, step 1: a pending row and a presigned PUT URL (B.23). */
  async createAttachment(
    tx: Tx,
    input: CreateDraftAttachmentInput,
    presign: (key: string, contentType: string) => string,
  ): Promise<{ attachment: DraftAttachment; uploadUrl: string }> {
    const data = createDraftAttachmentInputSchema.parse(input);
    const row = await loadDraft(tx, data.draftId, { open: true });
    if (data.size > MAX_ATTACHMENT_BYTES) {
      throw badRequest(
        'VALIDATION_ERROR',
        `Attachment is too large. Max size is ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`,
        {
          field: 'size',
          max_bytes: MAX_ATTACHMENT_BYTES,
        },
      );
    }
    const current = await tx.db
      .selectFrom('message_draft_attachments')
      .select(['id', 'content_size'])
      .where('draft_id', '=', row.id)
      .where('deleted_at', 'is', null)
      .execute();
    const existing = await tx.db
      .selectFrom('message_draft_attachments')
      .selectAll()
      .where('id', '=', data.id)
      .executeTakeFirst();
    if (existing && existing.draft_id !== row.id)
      throw conflict('ID_CONFLICT', 'An attachment with this id already exists');
    if (!existing) {
      const total = current.reduce((n, a) => n + Number(a.content_size), 0) + data.size;
      if (total > MAX_ATTACHMENT_BYTES) {
        throw badRequest('VALIDATION_ERROR', 'Attachments exceed the size limit of one email', {
          field: 'size',
          max_bytes: MAX_ATTACHMENT_BYTES,
        });
      }
      await tx.db
        .insertInto('message_draft_attachments')
        .values({
          id: data.id,
          workspace_id: tx.workspaceId,
          draft_id: row.id,
          name: data.name,
          content_type: data.contentType,
          content_size: data.size,
          object_key: draftAttachmentKey(tx.workspaceId, row.id, data.id),
          position: current.length,
        })
        .execute();
      await emitDraft(tx, row);
    }
    const attachment = await tx.db
      .selectFrom('message_draft_attachments')
      .selectAll()
      .where('id', '=', data.id)
      .executeTakeFirstOrThrow();
    return {
      attachment: {
        id: attachment.id,
        name: attachment.name,
        contentType: attachment.content_type,
        size: Number(attachment.content_size),
        state: attachment.state,
      },
      uploadUrl: presign(attachment.object_key, attachment.content_type),
    };
  },

  /** Attachment upload, step 3 (after the PUT): checks the object and commits the attachment. */
  async commitAttachment(
    tx: Tx,
    input: { draftId: string; attachmentId: string },
    object: { contentLength: number } | null,
  ): Promise<DraftAttachment> {
    const row = await loadDraft(tx, input.draftId, { open: true });
    const attachment = await tx.db
      .selectFrom('message_draft_attachments')
      .selectAll()
      .where('id', '=', input.attachmentId)
      .where('draft_id', '=', row.id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!attachment) throw notFound('Attachment not found', { attachment_id: input.attachmentId });
    if (attachment.state !== 'committed') {
      if (!object || object.contentLength !== Number(attachment.content_size)) {
        throw new DomainError(409, 'UPLOAD_INCOMPLETE', 'The attachment has not been uploaded completely', {
          attachment_id: attachment.id,
        });
      }
      await tx.db
        .updateTable('message_draft_attachments')
        .set({ state: 'committed' })
        .where('id', '=', attachment.id)
        .execute();
      await emitDraft(tx, row);
    }
    return {
      id: attachment.id,
      name: attachment.name,
      contentType: attachment.content_type,
      size: Number(attachment.content_size),
      state: 'committed',
    };
  },

  async attachmentForCommit(tx: Tx, input: { draftId: string; attachmentId: string }) {
    await loadDraft(tx, input.draftId, { open: true });
    const attachment = await tx.db
      .selectFrom('message_draft_attachments')
      .select(['id', 'object_key', 'state'])
      .where('id', '=', input.attachmentId)
      .where('draft_id', '=', input.draftId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!attachment) throw notFound('Attachment not found', { attachment_id: input.attachmentId });
    return attachment;
  },

  async removeAttachment(tx: Tx, input: { draftId: string; attachmentId: string }): Promise<{ id: string }> {
    const row = await loadDraft(tx, input.draftId, { open: true });
    const removed = await tx.db
      .updateTable('message_draft_attachments')
      .set({ deleted_at: tx.now })
      .where('id', '=', input.attachmentId)
      .where('draft_id', '=', row.id)
      .where('deleted_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (!removed) throw notFound('Attachment not found', { attachment_id: input.attachmentId });
    await emitDraft(tx, row);
    return { id: input.attachmentId };
  },

  /** Send (single or mass): the outbox rows to create; the caller inserts them (outbox.ts) and closes the draft. */
  async prepareSend(tx: Tx, deps: DraftDeps, input: SendDraftInput): Promise<DraftPlan> {
    const data = sendDraftInputSchema.parse(input);
    const row = await loadDraft(tx, data.draftId, { open: true });
    const plan = await planDraft(tx, deps, row);
    const blocking = plan.issues.filter((i) => !(data.allowEmptyVariables && i === 'unresolved-variables'));
    if (blocking.length > 0) {
      throw new DomainError(400, 'DRAFT_NOT_SENDABLE', 'This draft cannot be sent yet', { issues: blocking });
    }
    return plan;
  },
};
