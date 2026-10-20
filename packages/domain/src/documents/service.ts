// Rich-text documents (D-09; slice3-contracts "Rich text"): one store for notes, note templates and later email
// templates / insight sections. The Yjs state is the source of truth; `blocks`, `markdown` and `search_text` are
// projections computed here (with the shared @agentic-crm/editor model) in the same transaction that writes the state,
// so every writer — the collab server persisting live edits, the API writing markdown, a template copied into a note —
// goes through one code path (I1) and emits one `document` change_log row.
//
// Ownership: notes and templates create their document (collab/documents.ts) with `parent_ref` = the header id.
// Access follows the owner: a note's body is editable by members who may update one of its parent records and
// readable by members who may read one (collab/notes.ts documentOwner); a template's by every active member; a
// standalone document (no owner) by every active member of its workspace.
//
// Concurrency: every write merges, never overwrites. storeState() merges the stored state with the caller's
// (Yjs updates commute); server-side writes apply their change as a Yjs diff and NOTIFY `document_state` so a collab
// server holding the document in memory pulls the merged state and fans it out (documents/content.ts).
import type { Actor } from '@agentic-crm/contracts';
import { type Database, type DB, jsonb, sql, type Transaction } from '@agentic-crm/db';
import {
  type Block,
  blocksSchema,
  blocksToPlaintext,
  blocksToState,
  markdownToBlocks,
  projectBlocks,
  projectYDoc,
  yDocFromState,
} from '@agentic-crm/editor/model';
import * as Y from 'yjs';
import { z } from 'zod';
import { isDraftSection, touchSection } from '../calls/touch.ts';
import { documentOwner } from '../collab/notes.ts';
import { actingMemberId, type ServiceContext } from '../context.ts';
import { conflict, DomainError, forbidden, notFound } from '../errors.ts';
import { notifyDocumentMentions } from '../notifications/producers.ts';
import type { Policies } from '../permissions.ts';
import { runAsOwner, runInWorkspace, type Tx } from '../tx.ts';
import { noteEvent } from '../webhooks/events.ts';
import {
  baseDocument,
  DOCUMENT_STATE_CHANNEL,
  notifyDocumentState,
  storedBlocks,
  writeDocumentBlocks,
} from './content.ts';

export { DOCUMENT_STATE_CHANNEL };

/** Hard limit of a stored Yjs state (Attio answers 413 "YDoc exceeded hard size limit"). */
export const MAX_DOCUMENT_STATE_BYTES = 8 * 1024 * 1024;

export const DOC_TYPES = ['note', 'note-template', 'email-template', 'email-signature', 'insight-section'] as const;
export type DocType = (typeof DOC_TYPES)[number];

const uuid = z.uuid();

export const documentContentInputSchema = z.union([
  z.object({ blocks: blocksSchema.max(10_000) }),
  z.object({ markdown: z.string().max(1_000_000) }),
]);
export type DocumentContentInput = z.infer<typeof documentContentInputSchema>;

export const createDocumentInputSchema = z.object({
  id: uuid,
  docType: z.enum(DOC_TYPES),
  /** Owning header id (a note or template); omitted = a standalone document of the workspace. */
  parentId: uuid.nullable().optional(),
  content: documentContentInputSchema.optional(),
});
export type CreateDocumentInput = z.infer<typeof createDocumentInputSchema>;

export const replaceDocumentContentInputSchema = z.object({ id: uuid, content: documentContentInputSchema });
export type ReplaceDocumentContentInput = z.infer<typeof replaceDocumentContentInputSchema>;

export const storeDocumentStateInputSchema = z.object({
  id: uuid,
  state: z
    .custom<Uint8Array>((v) => v instanceof Uint8Array, 'Expected a Yjs update (Uint8Array)')
    .refine((s) => s.byteLength <= MAX_DOCUMENT_STATE_BYTES, 'Document is too large'),
});
export type StoreDocumentStateInput = z.infer<typeof storeDocumentStateInputSchema>;

/** What the acting member may do with a document. */
export type DocumentAccess = 'edit' | 'read' | 'none';

export interface DocumentView {
  id: string;
  workspaceId: string;
  docType: DocType;
  /** Owning header id (note / template), or null. */
  parentId: string | null;
  blocks: Block[];
  markdown: string;
  /** Block texts joined by newlines, images as empty lines (public API `content_plaintext`). */
  plaintext: string;
  searchText: string;
  version: number;
  createdBy: Actor | null;
  updatedBy: Actor | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredState {
  documentId: string;
  workspaceId: string;
  docType: DocType;
  parentId: string | null;
  /** The stored Yjs state; for rows written without one (markdown writes, copies) a state built from the body. */
  state: Uint8Array | null;
  version: number;
}

export interface StoreStateResult {
  /** The merged state now stored (the caller applies it back: it may hold changes the caller did not have). */
  state: Uint8Array;
  /** False when the stored state already contained everything (nothing written). */
  written: boolean;
  /** True when blocks/markdown changed (a change_log row was emitted). */
  projectionChanged: boolean;
  version: number;
}

type DocumentRow = {
  id: string;
  workspace_id: string;
  doc_type: DocType;
  parent_ref: string | null;
  blocks: unknown;
  markdown: string | null;
  search_text: string | null;
  version: string;
  created_by: unknown;
  updated_by: unknown;
  created_at: string;
  updated_at: string;
};

const VIEW_COLUMNS = [
  'id',
  'workspace_id',
  'doc_type',
  'parent_ref',
  'blocks',
  'markdown',
  'search_text',
  'version',
  'created_by',
  'updated_by',
  'created_at',
  'updated_at',
] as const;

function toView(row: DocumentRow): DocumentView {
  const blocks = storedBlocks(row);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    docType: row.doc_type,
    parentId: row.parent_ref,
    blocks,
    markdown: row.markdown ?? '',
    plaintext: blocksToPlaintext(blocks),
    searchText: row.search_text ?? '',
    version: Number(row.version),
    createdBy: (row.created_by as Actor | null) ?? null,
    updatedBy: (row.updated_by as Actor | null) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function contentBlocks(content: DocumentContentInput | undefined): Block[] {
  if (!content) return [];
  return 'blocks' in content ? content.blocks : markdownToBlocks(content.markdown);
}

/** Active members (and non-member actors acting for the workspace) may edit workspace-level documents. */
async function workspaceAccess(tx: Tx): Promise<DocumentAccess> {
  const memberId = actingMemberId(tx.ctx);
  if (!memberId) return 'edit';
  const member = await tx.db
    .selectFrom('workspace_members')
    .select('access_level')
    .where('id', '=', memberId)
    .executeTakeFirst();
  return member && member.access_level !== 'suspended' ? 'edit' : 'none';
}

/** A signature body is editable by the owner of its mailbox only (non-member actors act for the workspace). */
async function signatureDocumentAccess(tx: Tx, signatureId: string): Promise<DocumentAccess> {
  const memberId = actingMemberId(tx.ctx);
  if (!memberId) return 'edit';
  const owner = await tx.db
    .selectFrom('mailbox_signatures as s')
    .innerJoin('mailboxes as m', 'm.id', 's.mailbox_id')
    .select('m.member_id')
    .where('s.id', '=', signatureId)
    .where('s.deleted_at', 'is', null)
    .executeTakeFirst();
  return owner?.member_id === memberId ? 'edit' : 'none';
}

/** Access of the acting member to document `id` (see the header comment). */
async function accessOf(tx: Tx, policies: Policies, id: string): Promise<DocumentAccess> {
  const row = await tx.db
    .selectFrom('documents')
    .select(['parent_ref', 'doc_type'])
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) return 'none';
  if (row.parent_ref === null) return workspaceAccess(tx);
  // Email templates: every member (F composer §6); signatures: the mailbox owner (email/templates.ts).
  if (row.doc_type === 'email-template') return workspaceAccess(tx);
  if (row.doc_type === 'email-signature') return signatureDocumentAccess(tx, row.parent_ref);
  // Insight-template sections (slice 10): every member; published versions are read-only.
  if (row.doc_type === 'insight-section') {
    const access = await workspaceAccess(tx);
    if (access === 'none') return 'none';
    return (await isDraftSection(tx, row.parent_ref)) ? 'edit' : 'read';
  }
  const owner = await documentOwner(tx, { policies }, id);
  if (!owner) return 'none';
  if (owner.kind === 'note-template') return workspaceAccess(tx);
  const parents = await tx.db
    .selectFrom('note_records')
    .select('entity_definition_id')
    .distinct()
    .where('note_id', '=', owner.id)
    .execute();
  if (parents.length === 0) return 'none';
  const { policies: resolved } = await policies.resolve(tx, {
    entityDefinitionIds: parents.map((p) => p.entity_definition_id),
  });
  let access: DocumentAccess = 'none';
  for (const entry of Object.values(resolved)) {
    if (entry.state !== 'complete') continue;
    if (entry.value.update_entity_instance) return 'edit';
    if (entry.value.read_entity_instance) access = 'read';
  }
  return access;
}

async function lockRow(tx: Tx, id: string) {
  return tx.db
    .selectFrom('documents')
    .select([...VIEW_COLUMNS, 'yjs_state', 'deleted_at'])
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
}

export const documentOps = {
  /** A standalone or owned document (idempotent by id). Owned documents are normally created by their owner. */
  async create(tx: Tx, input: CreateDocumentInput, policies?: Policies): Promise<DocumentView> {
    const data = createDocumentInputSchema.parse(input);
    const parentId = data.parentId ?? null;
    const existing = await lockRow(tx, data.id);
    if (existing) {
      // Idempotent create (I3): the same id with the same type and owner returns the document.
      if (existing.deleted_at === null && existing.doc_type === data.docType && existing.parent_ref === parentId)
        return toView(existing as DocumentRow);
      throw conflict('ID_CONFLICT', 'A document with this id already exists', { document_id: data.id });
    }
    if (parentId === null && (await workspaceAccess(tx)) !== 'edit')
      throw forbidden('You do not have permission to do this', { document_id: data.id });
    const blocks = contentBlocks(data.content);
    const projection = projectBlocks(blocks);
    const state = blocks.length > 0 ? blocksToState(blocks) : null;
    const actor = jsonb(tx.ctx.actor);
    const row = await tx.db
      .insertInto('documents')
      .values({
        id: data.id,
        workspace_id: tx.workspaceId,
        doc_type: data.docType,
        parent_ref: parentId,
        yjs_state: state ? Buffer.from(state) : null,
        blocks: jsonb(projection.blocks),
        markdown: projection.markdown,
        search_text: projection.searchText,
        version: 1,
        created_by: actor,
        updated_by: actor,
      })
      .returning([...VIEW_COLUMNS])
      .executeTakeFirstOrThrow();
    tx.emit('document', data.id, { docType: data.docType, parentId, version: 1 });
    if (policies && data.docType === 'note') await notifyDocumentMentions(tx, policies, data.id, [], projection.blocks);
    return toView(row as DocumentRow);
  },

  async get(tx: Tx, policies: Policies, id: string): Promise<DocumentView> {
    const docId = uuid.parse(id);
    const row = await tx.db
      .selectFrom('documents')
      .select([...VIEW_COLUMNS])
      .where('id', '=', docId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row || (await accessOf(tx, policies, docId)) === 'none')
      throw notFound('Document not found', { document_id: id });
    return toView(row as DocumentRow);
  },

  async replaceContent(tx: Tx, policies: Policies, input: ReplaceDocumentContentInput): Promise<DocumentView> {
    const data = replaceDocumentContentInputSchema.parse(input);
    const access = await accessOf(tx, policies, data.id);
    if (access === 'none') throw notFound('Document not found', { document_id: data.id });
    if (access !== 'edit') throw forbidden('You do not have permission to do this', { document_id: data.id });
    const previous = await tx.db
      .selectFrom('documents')
      .select(['doc_type', 'blocks', 'markdown'])
      .where('id', '=', data.id)
      .executeTakeFirst();
    await writeDocumentBlocks(tx, data.id, contentBlocks(data.content));
    const view = await documentOps.get(tx, policies, data.id);
    if (previous?.doc_type === 'note') {
      await notifyDocumentMentions(tx, policies, data.id, storedBlocks(previous), view.blocks);
    }
    return view;
  },

  async delete(tx: Tx, policies: Policies, id: string): Promise<void> {
    const docId = uuid.parse(id);
    const access = await accessOf(tx, policies, docId);
    if (access === 'none') throw notFound('Document not found', { document_id: id });
    if (access !== 'edit') throw forbidden('You do not have permission to do this', { document_id: id });
    const row = await lockRow(tx, docId);
    if (!row) throw notFound('Document not found', { document_id: id });
    await tx.db
      .updateTable('documents')
      .set({ deleted_at: sql<string>`now()`, updated_by: jsonb(tx.ctx.actor), updated_at: sql<string>`now()` })
      .where('id', '=', docId)
      .execute();
    tx.emit('document', docId, { docType: row.doc_type, parentId: row.parent_ref, deleted: true });
    await notifyDocumentState(tx, docId, 'delete');
  },

  resolveAccess(tx: Tx, policies: Policies, id: string): Promise<DocumentAccess> {
    const parsed = uuid.safeParse(id);
    return parsed.success ? accessOf(tx, policies, parsed.data) : Promise.resolve('none');
  },

  async loadState(tx: Tx, id: string): Promise<StoredState | null> {
    const row = await tx.db
      .selectFrom('documents')
      .select(['id', 'workspace_id', 'doc_type', 'parent_ref', 'yjs_state', 'blocks', 'markdown', 'version'])
      .where('id', '=', uuid.parse(id))
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) return null;
    // Written without a Yjs state (or with an unreadable one): the state is built from the body.
    let state: Uint8Array | null = null;
    if (row.yjs_state || storedBlocks(row).length > 0) {
      const ydoc = baseDocument(row);
      state = Y.encodeStateAsUpdate(ydoc);
      ydoc.destroy();
    }
    return {
      documentId: row.id,
      workspaceId: row.workspace_id,
      docType: row.doc_type,
      parentId: row.parent_ref,
      state,
      version: Number(row.version),
    };
  },

  /**
   * Persists a Yjs state from the collab server: merged with the stored state (never overwritten), projections
   * recomputed; one change_log row when blocks/markdown changed. Callers check edit access when the editing session
   * starts (collab: onAuthenticate), so this does not re-resolve permissions on every debounced save.
   */
  async storeState(tx: Tx, input: StoreDocumentStateInput, policies?: Policies): Promise<StoreStateResult> {
    const data = storeDocumentStateInputSchema.parse(input);
    const row = await lockRow(tx, data.id);
    if (!row || row.deleted_at !== null) throw notFound('Document not found', { document_id: data.id });
    let stored: Uint8Array | null = row.yjs_state ? new Uint8Array(row.yjs_state) : null;
    let merged: Uint8Array;
    try {
      merged = stored ? Y.mergeUpdates([stored, data.state]) : data.state;
    } catch {
      // An unreadable stored state is replaced by the caller's (which was built from the projections on load).
      stored = null;
      merged = data.state;
    }
    if (stored && Buffer.from(merged).equals(Buffer.from(stored)))
      return { state: stored, written: false, projectionChanged: false, version: Number(row.version) };
    if (merged.byteLength > MAX_DOCUMENT_STATE_BYTES)
      throw new DomainError(413, 'VALIDATION_ERROR', 'Document exceeded the size limit', {
        document_id: data.id,
        max_bytes: MAX_DOCUMENT_STATE_BYTES,
      });

    const ydoc = yDocFromState(merged);
    try {
      const state = Y.encodeStateAsUpdate(ydoc);
      const projection = projectYDoc(ydoc);
      const projectionChanged =
        projection.markdown !== (row.markdown ?? '') ||
        JSON.stringify(projection.blocks) !== JSON.stringify(row.blocks ?? []);
      const version = Number(row.version) + (projectionChanged ? 1 : 0);
      await tx.db
        .updateTable('documents')
        .set({
          yjs_state: Buffer.from(state),
          ...(projectionChanged
            ? {
                blocks: jsonb(projection.blocks),
                markdown: projection.markdown,
                search_text: projection.searchText,
                version,
                updated_by: jsonb(tx.ctx.actor),
                updated_at: sql<string>`now()`,
              }
            : {}),
        })
        .where('id', '=', data.id)
        .execute();
      if (projectionChanged) tx.emit('document', data.id, { docType: row.doc_type, parentId: row.parent_ref, version });
      // note-content.updated (webhooks); the note's parent record is completed at fan-out.
      if (projectionChanged && row.doc_type === 'note' && row.parent_ref) {
        noteEvent(tx, 'content-updated', row.parent_ref, null);
      }
      // An edited insight-template section touches its draft (Publish / Discard become available, slice 10).
      if (projectionChanged && row.doc_type === 'insight-section' && row.parent_ref) {
        await touchSection(tx, row.parent_ref);
      }
      // Members newly @mentioned in a note body (collab edits) are notified (note-mentioned).
      if (projectionChanged && policies && row.doc_type === 'note') {
        await notifyDocumentMentions(tx, policies, data.id, storedBlocks(row), projection.blocks);
      }
      return { state, written: true, projectionChanged, version };
    } finally {
      ydoc.destroy();
    }
  },
};

/** Cross-tenant lookup by primary key (the collab server learns the workspace of a document before entering it). */
async function locate(trx: Transaction<DB>, id: string) {
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return null;
  const row = await trx
    .selectFrom('documents')
    .select(['id', 'workspace_id', 'doc_type', 'deleted_at'])
    .where('id', '=', parsed.data)
    .executeTakeFirst();
  return row
    ? { id: row.id, workspaceId: row.workspace_id, docType: row.doc_type, deleted: row.deleted_at !== null }
    : null;
}

/** The documents API of the domain (merged into `domain.documents` with the collab services' `owner`). */
export function documentsApi(database: Database, policies: Policies) {
  const run = <T>(ctx: ServiceContext, fn: (tx: Tx) => Promise<T>) => runInWorkspace(database, ctx, fn);
  return {
    /** Creates a document (idempotent by id); `content` as blocks or markdown. */
    create: (ctx: ServiceContext, input: CreateDocumentInput) =>
      run(ctx, (tx) => documentOps.create(tx, input, policies)),
    /** Body projections (blocks, markdown, plaintext); 404 unless the caller may read the document. */
    get: (ctx: ServiceContext, id: string) => run(ctx, (tx) => documentOps.get(tx, policies, id)),
    /** Replaces the body (server-side writes); live editors receive the change. */
    replaceContent: (ctx: ServiceContext, input: ReplaceDocumentContentInput) =>
      run(ctx, (tx) => documentOps.replaceContent(tx, policies, input)),
    /** Soft delete; open editors are disconnected. */
    delete: (ctx: ServiceContext, id: string) => run(ctx, (tx) => documentOps.delete(tx, policies, id)),
    resolveAccess: (ctx: ServiceContext, id: string) => run(ctx, (tx) => documentOps.resolveAccess(tx, policies, id)),
    /** Collab server: the stored Yjs state. */
    loadState: (ctx: ServiceContext, id: string) => run(ctx, (tx) => documentOps.loadState(tx, id)),
    /** Collab server: merge + persist a Yjs state and its projections. */
    storeState: (ctx: ServiceContext, input: StoreDocumentStateInput) =>
      run(ctx, (tx) => documentOps.storeState(tx, input, policies)),
    /** Collab server: workspace of a document id (no tenant context yet). */
    locate: (id: string) => runAsOwner(database, (trx) => locate(trx, id)),
  };
}

export type DocumentsApi = ReturnType<typeof documentsApi>;
