// Email templates and mailbox signatures (F composer §2.12, §6; F settings §2.3; CROSS-DOMAIN B.10): headers here,
// bodies in the rich-text document store. A template has two documents (subject: one block; body), both doc type
// 'email-template' owned by the template (parent_ref) and editable by every member (apps/collab co-editing, or the
// server-side writes below). A signature has one 'email-signature' document editable by the mailbox owner. Variables
// live in the blocks (B.11). Templates are visible to and editable by all members; favourites are per member.
import {
  type AnnotatedText,
  type CreateSignatureInput,
  type CreateTemplateInput,
  createSignatureInputSchema,
  createTemplateInputSchema,
  type EmailTemplate,
  favoriteTemplateInputSchema,
  type MailboxSignature,
  signatureIdInputSchema,
  templateIdInputSchema,
  type UpdateSignatureInput,
  type UpdateTemplateInput,
  updateSignatureInputSchema,
  updateTemplateInputSchema,
} from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { type Block, blocksSchema, textBlock, type VariableRef } from '@agentic-crm/editor/model';
import { requireMember, toActor } from '../collab/common.ts';
import { actingMemberId } from '../context.ts';
import { notifyDocumentState, storedBlocks, writeDocumentBlocks } from '../documents/content.ts';
import { documentOps } from '../documents/service.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import type { Tx } from '../tx.ts';
import { loadMailbox } from './mailboxes.ts';
import { previewAnnotated } from './render.ts';

/** Validates body blocks with the editor schema (variables included). */
export function parseBody(body: unknown[] | undefined): Block[] {
  if (body === undefined) return [];
  const parsed = blocksSchema.safeParse(body);
  if (!parsed.success) throw badRequest('VALIDATION_ERROR', 'Invalid email body', { field: 'body' });
  return parsed.data;
}

/** Subject → the one-block document body that stores it. */
export function subjectBlocks(subject: AnnotatedText | undefined): Block[] {
  if (!subject || subject.text === '') return [];
  return [
    { ...textBlock('unstyled', subject.text.replace(/\n/g, ' ')), variables: subject.variables as VariableRef[] },
  ];
}

/** Stored subject document → annotated text (first block only). */
export function subjectFromBlocks(blocks: Block[]): AnnotatedText {
  const first = blocks[0];
  return first
    ? { text: first.text, variables: (first.variables ?? []) as AnnotatedText['variables'] }
    : { text: '', variables: [] };
}

/** Plain preview of a body: block texts with variables as `{{token}}`. */
export function bodyPreview(blocks: Block[], max = 300): string {
  return blocks
    .filter((b) => b.type !== 'image-embed')
    .map((b) => previewAnnotated(b.text, b.variables))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

async function documentBlocks(tx: Tx, ids: string[]): Promise<Map<string, Block[]>> {
  const out = new Map<string, Block[]>();
  if (ids.length === 0) return out;
  const { rows } = await sql<{ id: string; blocks: unknown; markdown: string | null }>`
    SELECT id, blocks, markdown FROM documents WHERE id = ANY(${ids}::uuid[])`.execute(tx.db);
  for (const r of rows) out.set(r.id, storedBlocks(r));
  return out;
}

type TemplateRow = {
  id: string;
  workspace_id: string;
  title: string;
  subject_document_id: string;
  body_document_id: string;
  created_by: unknown;
  created_at: string;
  updated_at: string;
};

async function viewTemplates(tx: Tx, rows: TemplateRow[]): Promise<EmailTemplate[]> {
  const docs = await documentBlocks(
    tx,
    rows.flatMap((r) => [r.subject_document_id, r.body_document_id]),
  );
  const memberId = actingMemberId(tx.ctx);
  const favorites = memberId
    ? new Set(
        (
          await tx.db
            .selectFrom('email_template_favorites')
            .select('template_id')
            .where('member_id', '=', memberId)
            .execute()
        ).map((f) => f.template_id),
      )
    : new Set<string>();
  return rows.map((r) => {
    const body = docs.get(r.body_document_id) ?? [];
    return {
      id: r.id,
      workspaceId: r.workspace_id,
      title: r.title,
      subjectDocumentId: r.subject_document_id,
      bodyDocumentId: r.body_document_id,
      subject: subjectFromBlocks(docs.get(r.subject_document_id) ?? []),
      body: body as unknown as Record<string, unknown>[],
      preview: bodyPreview(body),
      isFavorite: favorites.has(r.id),
      createdBy: toActor(r.created_by),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

async function loadTemplate(tx: Tx, id: string): Promise<TemplateRow> {
  const row = await tx.db
    .selectFrom('email_templates')
    .selectAll()
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw notFound('Template not found', { template_id: id });
  return row as TemplateRow;
}

function emitTemplate(tx: Tx, id: string): void {
  tx.emit('email-template', id, { templateId: id });
  tx.emit('email-template-list', null, {});
}

export const templateOps = {
  async list(tx: Tx): Promise<EmailTemplate[]> {
    requireMember(tx);
    const rows = await tx.db
      .selectFrom('email_templates')
      .selectAll()
      .where('deleted_at', 'is', null)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    return viewTemplates(tx, rows as TemplateRow[]);
  },

  async get(tx: Tx, input: { templateId: string }): Promise<EmailTemplate> {
    const { templateId } = templateIdInputSchema.parse(input);
    return (await viewTemplates(tx, [await loadTemplate(tx, templateId)]))[0] as EmailTemplate;
  },

  /** "New template" / "Create email template" (idempotent by id): header + subject and body documents. */
  async create(tx: Tx, input: CreateTemplateInput): Promise<EmailTemplate> {
    const data = createTemplateInputSchema.parse(input);
    requireMember(tx);
    const existing = await tx.db.selectFrom('email_templates').selectAll().where('id', '=', data.id).executeTakeFirst();
    if (existing) {
      if (existing.deleted_at) throw conflict('ID_CONFLICT', 'A template with this id already existed');
      return (await viewTemplates(tx, [existing as TemplateRow]))[0] as EmailTemplate;
    }
    const subjectDocumentId = newId();
    const bodyDocumentId = newId();
    const body = parseBody(data.body);
    await tx.db
      .insertInto('email_templates')
      .values({
        id: data.id,
        workspace_id: tx.workspaceId,
        title: data.title,
        subject_document_id: subjectDocumentId,
        body_document_id: bodyDocumentId,
        created_by: JSON.stringify(tx.ctx.actor),
      })
      .execute();
    await documentOps.create(tx, {
      id: subjectDocumentId,
      docType: 'email-template',
      parentId: data.id,
      content: { blocks: subjectBlocks(data.subject) },
    });
    await documentOps.create(tx, {
      id: bodyDocumentId,
      docType: 'email-template',
      parentId: data.id,
      content: { blocks: body },
    });
    emitTemplate(tx, data.id);
    return templateOps.get(tx, { templateId: data.id });
  },

  /** Title (Enter commits), and server-side subject / body replacements (live editors merge them). */
  async update(tx: Tx, input: UpdateTemplateInput): Promise<EmailTemplate> {
    const data = updateTemplateInputSchema.parse(input);
    requireMember(tx);
    const row = await loadTemplate(tx, data.templateId);
    if (data.subject !== undefined) await writeDocumentBlocks(tx, row.subject_document_id, subjectBlocks(data.subject));
    if (data.body !== undefined) await writeDocumentBlocks(tx, row.body_document_id, parseBody(data.body));
    await tx.db
      .updateTable('email_templates')
      .set({ ...(data.title !== undefined ? { title: data.title } : {}), updated_at: tx.now })
      .where('id', '=', row.id)
      .execute();
    emitTemplate(tx, row.id);
    return templateOps.get(tx, { templateId: row.id });
  },

  async delete(tx: Tx, input: { templateId: string }): Promise<{ id: string }> {
    const { templateId } = templateIdInputSchema.parse(input);
    requireMember(tx);
    const row = await loadTemplate(tx, templateId);
    await tx.db.updateTable('email_templates').set({ deleted_at: tx.now }).where('id', '=', row.id).execute();
    await tx.db.deleteFrom('email_template_favorites').where('template_id', '=', row.id).execute();
    for (const doc of [row.subject_document_id, row.body_document_id]) {
      await tx.db.updateTable('documents').set({ deleted_at: tx.now }).where('id', '=', doc).execute();
      await notifyDocumentState(tx, doc, 'delete');
    }
    emitTemplate(tx, row.id);
    return { id: row.id };
  },

  async favorite(tx: Tx, input: { templateId: string; favorite: boolean }): Promise<EmailTemplate> {
    const data = favoriteTemplateInputSchema.parse(input);
    const memberId = requireMember(tx);
    const row = await loadTemplate(tx, data.templateId);
    if (data.favorite) {
      await tx.db
        .insertInto('email_template_favorites')
        .values({ member_id: memberId, template_id: row.id, workspace_id: tx.workspaceId })
        .onConflict((oc) => oc.doNothing())
        .execute();
    } else {
      await tx.db
        .deleteFrom('email_template_favorites')
        .where('member_id', '=', memberId)
        .where('template_id', '=', row.id)
        .execute();
    }
    tx.emit('email-template-list', null, { memberId });
    return templateOps.get(tx, { templateId: row.id });
  },

  /** Subject and body of a template (drafts created from it copy these, variables kept). */
  async content(tx: Tx, templateId: string): Promise<{ subject: AnnotatedText; body: Block[] }> {
    const row = await loadTemplate(tx, templateId);
    const docs = await documentBlocks(tx, [row.subject_document_id, row.body_document_id]);
    return {
      subject: subjectFromBlocks(docs.get(row.subject_document_id) ?? []),
      body: docs.get(row.body_document_id) ?? [],
    };
  },
};

type SignatureRow = {
  id: string;
  mailbox_id: string;
  title: string;
  document_id: string;
  created_at: string;
  updated_at: string;
};

async function viewSignatures(tx: Tx, rows: SignatureRow[], defaultId: string | null): Promise<MailboxSignature[]> {
  const docs = await documentBlocks(
    tx,
    rows.map((r) => r.document_id),
  );
  return rows.map((r) => ({
    id: r.id,
    mailboxId: r.mailbox_id,
    title: r.title,
    documentId: r.document_id,
    body: (docs.get(r.document_id) ?? []) as unknown as Record<string, unknown>[],
    isDefault: r.id === defaultId,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

async function loadSignature(tx: Tx, id: string) {
  const row = await tx.db
    .selectFrom('mailbox_signatures')
    .selectAll()
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw notFound('Signature not found', { signature_id: id });
  const mailbox = await loadMailbox(tx, row.mailbox_id, { owner: true });
  return { row: row as SignatureRow, mailbox };
}

async function emitSignatures(tx: Tx, mailboxId: string, memberId: string): Promise<void> {
  const owner = await tx.db
    .selectFrom('workspace_members')
    .select('user_id')
    .where('id', '=', memberId)
    .executeTakeFirst();
  tx.emit('mailbox-signature-list', mailboxId, { mailboxId }, { userIds: owner ? [owner.user_id] : [] });
}

export const signatureOps = {
  async list(tx: Tx, mailboxId: string): Promise<MailboxSignature[]> {
    const mailbox = await loadMailbox(tx, mailboxId, { owner: true });
    const rows = await tx.db
      .selectFrom('mailbox_signatures')
      .selectAll()
      .where('mailbox_id', '=', mailbox.id)
      .where('deleted_at', 'is', null)
      .orderBy('created_at')
      .execute();
    return viewSignatures(tx, rows as SignatureRow[], mailbox.default_signature_id);
  },

  /** "Create first signature" / "+ New signature"; the mailbox's first signature becomes its default. */
  async create(tx: Tx, input: CreateSignatureInput): Promise<MailboxSignature> {
    const data = createSignatureInputSchema.parse(input);
    const mailbox = await loadMailbox(tx, data.mailboxId, { owner: true });
    const existing = await tx.db
      .selectFrom('mailbox_signatures')
      .selectAll()
      .where('id', '=', data.id)
      .executeTakeFirst();
    if (existing) {
      if (existing.mailbox_id !== mailbox.id || existing.deleted_at) {
        throw conflict('ID_CONFLICT', 'A signature with this id already exists');
      }
      const fresh = await loadMailbox(tx, mailbox.id);
      return (await viewSignatures(tx, [existing as SignatureRow], fresh.default_signature_id))[0] as MailboxSignature;
    }
    const documentId = newId();
    await tx.db
      .insertInto('mailbox_signatures')
      .values({
        id: data.id,
        workspace_id: tx.workspaceId,
        mailbox_id: mailbox.id,
        title: data.title,
        document_id: documentId,
        created_by: JSON.stringify(tx.ctx.actor),
      })
      .execute();
    await documentOps.create(tx, {
      id: documentId,
      docType: 'email-signature',
      parentId: data.id,
      content: { blocks: parseBody(data.body) },
    });
    let defaultId = mailbox.default_signature_id;
    if (!defaultId) {
      defaultId = data.id;
      await tx.db
        .updateTable('mailboxes')
        .set({ default_signature_id: data.id })
        .where('id', '=', mailbox.id)
        .execute();
    }
    await emitSignatures(tx, mailbox.id, mailbox.member_id);
    const row = await tx.db
      .selectFrom('mailbox_signatures')
      .selectAll()
      .where('id', '=', data.id)
      .executeTakeFirstOrThrow();
    return (await viewSignatures(tx, [row as SignatureRow], defaultId))[0] as MailboxSignature;
  },

  async update(tx: Tx, input: UpdateSignatureInput): Promise<MailboxSignature> {
    const data = updateSignatureInputSchema.parse(input);
    const { row, mailbox } = await loadSignature(tx, data.signatureId);
    if (data.body !== undefined) await writeDocumentBlocks(tx, row.document_id, parseBody(data.body));
    const updated = await tx.db
      .updateTable('mailbox_signatures')
      .set({ ...(data.title !== undefined ? { title: data.title } : {}), updated_at: tx.now })
      .where('id', '=', row.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await emitSignatures(tx, mailbox.id, mailbox.member_id);
    return (await viewSignatures(tx, [updated as SignatureRow], mailbox.default_signature_id))[0] as MailboxSignature;
  },

  /** "Set as default" / "Clear default". */
  async setDefault(tx: Tx, input: { signatureId: string; isDefault: boolean }): Promise<MailboxSignature> {
    const { signatureId } = signatureIdInputSchema.parse(input);
    const { row, mailbox } = await loadSignature(tx, signatureId);
    const next = input.isDefault
      ? row.id
      : mailbox.default_signature_id === row.id
        ? null
        : mailbox.default_signature_id;
    await tx.db.updateTable('mailboxes').set({ default_signature_id: next }).where('id', '=', mailbox.id).execute();
    await emitSignatures(tx, mailbox.id, mailbox.member_id);
    return (await viewSignatures(tx, [row], next))[0] as MailboxSignature;
  },

  /** "This signature will be permanently deleted"; the mailbox default returns to null when it was this one. */
  async delete(tx: Tx, input: { signatureId: string }): Promise<{ id: string }> {
    const { signatureId } = signatureIdInputSchema.parse(input);
    const { row, mailbox } = await loadSignature(tx, signatureId);
    await tx.db.updateTable('mailbox_signatures').set({ deleted_at: tx.now }).where('id', '=', row.id).execute();
    await tx.db.updateTable('documents').set({ deleted_at: tx.now }).where('id', '=', row.document_id).execute();
    await notifyDocumentState(tx, row.document_id, 'delete');
    if (mailbox.default_signature_id === row.id) {
      await tx.db.updateTable('mailboxes').set({ default_signature_id: null }).where('id', '=', mailbox.id).execute();
    }
    await tx.db.updateTable('message_drafts').set({ signature_id: null }).where('signature_id', '=', row.id).execute();
    await emitSignatures(tx, mailbox.id, mailbox.member_id);
    return { id: row.id };
  },
};
