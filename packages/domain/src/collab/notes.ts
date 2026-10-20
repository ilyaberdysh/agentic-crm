// Notes and note templates (BACKLOG 3.12, 3.14; E README §2.1–2.5, §3.1–3.2, §4.1–4.2, §5.1–5.2, §5.7).
// Headers live in notes / note_templates; bodies are documents (collab/documents.ts). A note needs at least one
// parent record the caller can read; reading a note requires read access to at least one of its parent records.
import {
  type ApplyNoteTemplateInput,
  type ApplyNoteTemplateOutput,
  applyNoteTemplateInputSchema,
  type BatchGetNotesInput,
  batchGetNotesInputSchema,
  type CreateNoteInput,
  type CreateNoteTemplateInput,
  type CreateTemplateFromNoteInput,
  createNoteInputSchema,
  createNoteTemplateInputSchema,
  createTemplateFromNoteInputSchema,
  type DocumentContent,
  type ListNotesInput,
  type ListNotesOutput,
  type ListNoteTemplatesInput,
  listNotesInputSchema,
  listNoteTemplatesInputSchema,
  type Note,
  type NoteTemplate,
  type RecordRef,
  type UpdateNoteInput,
  type UpdateNoteTemplateInput,
  updateNoteInputSchema,
  updateNoteTemplateInputSchema,
} from '@agentic-crm/contracts';
import type { NotesTable, NoteTemplatesTable, Selectable } from '@agentic-crm/db';
import { sql } from '@agentic-crm/db';
import { conflict, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import type { Tx } from '../tx.ts';
import { noteEvent } from '../webhooks/events.ts';
import { actorJson, type CollabDeps, positioned, readableDefinitions, resolveRecordRefs, toActor } from './common.ts';
import {
  copyDocument,
  copyIntoPristineDocument,
  createDocument,
  EMPTY_CONTENT,
  readDocuments,
  setDocumentMarkdown,
} from './documents.ts';
import { deleteFavoritesOfTargets, favoriteIdsFor } from './favorites.ts';

type NoteRow = Selectable<NotesTable>;
type TemplateRow = Selectable<NoteTemplatesTable>;

const noteNotFound = (noteId: string) => notFound('Note not found', { note_id: noteId });
const templateNotFound = (id: string) => notFound('Note template not found', { note_template_id: id });

async function parentsOf(tx: Tx, noteIds: string[]): Promise<Map<string, RecordRef[]>> {
  const out = new Map<string, RecordRef[]>(noteIds.map((id) => [id, []]));
  if (noteIds.length === 0) return out;
  const rows = await tx.db
    .selectFrom('note_records')
    .select(['note_id', 'entity_definition_id', 'entity_instance_id'])
    .where('note_id', 'in', noteIds)
    .orderBy('note_id')
    .orderBy('position')
    .execute();
  for (const r of rows) {
    out.get(r.note_id)?.push({ entityDefinitionId: r.entity_definition_id, entityInstanceId: r.entity_instance_id });
  }
  return out;
}

/** Notes the caller may read: at least one parent record of a readable object. */
async function visibleNotes(
  tx: Tx,
  deps: CollabDeps,
  rows: NoteRow[],
): Promise<{ rows: NoteRow[]; parents: Map<string, RecordRef[]> }> {
  const parents = await parentsOf(
    tx,
    rows.map((r) => r.id),
  );
  const readable = await readableDefinitions(
    tx,
    deps,
    [...parents.values()].flat().map((p) => p.entityDefinitionId),
  );
  const visible = rows.filter((r) => (parents.get(r.id) ?? []).some((p) => readable.has(p.entityDefinitionId)));
  return { rows: visible, parents };
}

async function hydrateNotes(
  tx: Tx,
  rows: NoteRow[],
  parents: Map<string, RecordRef[]>,
  includeContent: boolean,
): Promise<Note[]> {
  const favorites = await favoriteIdsFor(
    tx,
    'note',
    rows.map((r) => r.id),
  );
  const contents = includeContent
    ? await readDocuments(
        tx,
        rows.map((r) => r.document_id),
      )
    : new Map<string, DocumentContent>();
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    title: r.title,
    documentId: r.document_id,
    meetingId: r.meeting_id,
    parentRecords: parents.get(r.id) ?? [],
    createdBy: toActor(r.created_by),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    favoriteId: favorites.get(r.id) ?? null,
    ...(includeContent ? { content: contents.get(r.document_id) ?? EMPTY_CONTENT } : {}),
  }));
}

/** A live note the caller can read (404 otherwise, like Attio's "Note not found"). */
async function requireNote(tx: Tx, deps: CollabDeps, noteId: string): Promise<{ row: NoteRow; parents: RecordRef[] }> {
  const row = await tx.db
    .selectFrom('notes')
    .selectAll()
    .where('id', '=', noteId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw noteNotFound(noteId);
  const { rows, parents } = await visibleNotes(tx, deps, [row]);
  if (rows.length === 0) throw noteNotFound(noteId);
  return { row, parents: parents.get(noteId) ?? [] };
}

async function requireTemplate(tx: Tx, templateId: string): Promise<TemplateRow> {
  const row = await tx.db
    .selectFrom('note_templates')
    .selectAll()
    .where('id', '=', templateId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw templateNotFound(templateId);
  return row;
}

async function writeParents(tx: Tx, noteId: string, refs: RecordRef[]): Promise<void> {
  await tx.db.deleteFrom('note_records').where('note_id', '=', noteId).execute();
  if (refs.length === 0) return;
  await tx.db
    .insertInto('note_records')
    .values(
      positioned(refs).map((r) => ({
        note_id: noteId,
        workspace_id: tx.workspaceId,
        entity_definition_id: r.entityDefinitionId,
        entity_instance_id: r.entityInstanceId,
        position: r.position,
        created_at: tx.now,
      })),
    )
    .execute();
}

/** Invalidations of a note change: the header, the record note lists, and their timelines. */
function emitNote(tx: Tx, noteId: string, records: RecordRef[]): void {
  tx.emit('note', noteId, { noteId });
  tx.emit('note-list', null, { entityInstanceIds: records.map((r) => r.entityInstanceId) });
  emitTimelines(tx, records);
}

export function emitTimelines(tx: Tx, records: RecordRef[]): void {
  const byDef = new Map<string, string[]>();
  for (const r of records)
    byDef.set(r.entityDefinitionId, [...(byDef.get(r.entityDefinitionId) ?? []), r.entityInstanceId]);
  for (const [defId, ids] of byDef) {
    tx.emit('record-timeline', defId, { entityDefinitionId: defId, entityInstanceIds: ids });
  }
}

async function oneNote(tx: Tx, deps: CollabDeps, noteId: string, includeContent = true): Promise<Note> {
  const { row, parents } = await requireNote(tx, deps, noteId);
  const [note] = await hydrateNotes(tx, [row], new Map([[noteId, parents]]), includeContent);
  return note as Note;
}

function toTemplate(row: TemplateRow, favoriteId: string | null, content?: DocumentContent): NoteTemplate {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    headerTitle: row.header_title,
    documentId: row.document_id,
    createdBy: toActor(row.created_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    favoriteId,
    ...(content ? { content } : {}),
  };
}

async function oneTemplate(tx: Tx, row: TemplateRow, includeContent = true): Promise<NoteTemplate> {
  const favorites = await favoriteIdsFor(tx, 'note-template', [row.id]);
  const content = includeContent
    ? ((await readDocuments(tx, [row.document_id])).get(row.document_id) ?? EMPTY_CONTENT)
    : undefined;
  return toTemplate(row, favorites.get(row.id) ?? null, content);
}

export const noteOps = {
  /** PUT-style create with a client id (I3); a replay returns the stored note. */
  async create(
    tx: Tx,
    deps: CollabDeps,
    input: CreateNoteInput,
    options: { markdown?: string; createdAt?: string } = {},
  ): Promise<Note> {
    const data = createNoteInputSchema.parse(input);
    const existing = await tx.db
      .selectFrom('notes')
      .select(['id', 'deleted_at'])
      .where('id', '=', data.id)
      .executeTakeFirst();
    if (existing) {
      if (existing.deleted_at !== null) throw conflict('ID_CONFLICT', 'This note id belonged to a deleted note');
      return oneNote(tx, deps, data.id);
    }
    const parents = await resolveRecordRefs(tx, deps, data.parentRecords, { what: 'parent_record' });
    const template = data.templateId ? await requireTemplate(tx, data.templateId) : null;
    const documentId = newId();
    const createdAt = options.createdAt ?? tx.now;
    await tx.db
      .insertInto('notes')
      .values({
        id: data.id,
        workspace_id: tx.workspaceId,
        title: data.title === '' && template ? template.header_title : data.title,
        document_id: documentId,
        meeting_id: data.meetingId ?? null,
        created_by: actorJson(tx),
        created_at: createdAt,
        updated_at: tx.now,
      })
      .execute();
    await writeParents(tx, data.id, parents);
    if (template) {
      await copyDocument(tx, { sourceId: template.document_id, id: documentId, docType: 'note', parentId: data.id });
    } else {
      await createDocument(tx, { id: documentId, docType: 'note', parentId: data.id });
    }
    if (options.markdown !== undefined) await setDocumentMarkdown(tx, documentId, options.markdown);
    emitNote(tx, data.id, parents);
    noteEvent(tx, 'created', data.id, parents[0] ?? null);
    return oneNote(tx, deps, data.id);
  },

  async update(tx: Tx, deps: CollabDeps, input: UpdateNoteInput, options: { markdown?: string } = {}): Promise<Note> {
    const data = updateNoteInputSchema.parse(input);
    const { row, parents } = await requireNote(tx, deps, data.noteId);
    let nextParents = parents;
    if (data.parentRecords) {
      nextParents = await resolveRecordRefs(tx, deps, data.parentRecords, { what: 'parent_record' });
      await writeParents(tx, row.id, nextParents);
    }
    const changesHeader = data.title !== undefined || data.meetingId !== undefined || data.parentRecords !== undefined;
    if (changesHeader || options.markdown !== undefined) {
      await tx.db
        .updateTable('notes')
        .set({
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.meetingId !== undefined ? { meeting_id: data.meetingId } : {}),
          updated_at: tx.now,
        })
        .where('id', '=', row.id)
        .execute();
    }
    if (options.markdown !== undefined) await setDocumentMarkdown(tx, row.document_id, options.markdown);
    emitNote(tx, row.id, [...parents, ...nextParents]);
    if (changesHeader) noteEvent(tx, 'updated', row.id, nextParents[0] ?? null);
    if (options.markdown !== undefined) noteEvent(tx, 'content-updated', row.id, nextParents[0] ?? null);
    return oneNote(tx, deps, row.id);
  },

  /** "Permanently delete this note?" — no undo for users (E README §3.1); soft delete internally (X-22). */
  async delete(tx: Tx, deps: CollabDeps, noteId: string): Promise<{ id: string }> {
    const { row, parents } = await requireNote(tx, deps, noteId);
    await tx.db
      .updateTable('notes')
      .set({ deleted_at: tx.now, deleted_by: actorJson(tx) })
      .where('id', '=', row.id)
      .execute();
    await deleteFavoritesOfTargets(tx, 'note', [row.id]);
    emitNote(tx, row.id, parents);
    noteEvent(tx, 'deleted', row.id, parents[0] ?? null);
    return { id: row.id };
  },

  async get(tx: Tx, deps: CollabDeps, noteId: string): Promise<Note> {
    return oneNote(tx, deps, noteId);
  },

  /** Batch read; unknown, deleted and unreadable notes are omitted. */
  async batchGet(tx: Tx, deps: CollabDeps, input: BatchGetNotesInput): Promise<{ notes: Note[] }> {
    const data = batchGetNotesInputSchema.parse(input);
    const rows = await tx.db
      .selectFrom('notes')
      .selectAll()
      .where('id', 'in', data.noteIds)
      .where('deleted_at', 'is', null)
      .execute();
    const { rows: visible, parents } = await visibleNotes(tx, deps, rows);
    const order = new Map(data.noteIds.map((id, i) => [id, i]));
    visible.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    return { notes: await hydrateNotes(tx, visible, parents, data.includeContent) };
  },

  /** Notes index / record Notes tab, newest first by default (E README §2.1). */
  async list(tx: Tx, deps: CollabDeps, input: ListNotesInput): Promise<ListNotesOutput> {
    const data = listNotesInputSchema.parse(input);
    const record = data.record ? (await resolveRecordRefs(tx, deps, [data.record]))[0] : undefined;
    const memberId = tx.ctx.actor.type === 'workspace-member' ? tx.ctx.actor.id : null;
    const desc = data.sort === 'created_at:desc';
    let query = tx.db
      .selectFrom('notes as n')
      .selectAll('n')
      .where('n.deleted_at', 'is', null)
      // At least one parent record that is still live (records deleted with their notes are soft-deleted anyway).
      .where(({ exists, selectFrom }) =>
        exists(
          selectFrom('note_records as nr')
            .innerJoin('entity_instances as ei', 'ei.id', 'nr.entity_instance_id')
            .select('nr.note_id')
            .whereRef('nr.note_id', '=', 'n.id')
            .where('ei.archived_at', 'is', null)
            .where('ei.merged_at', 'is', null),
        ),
      );
    if (record) {
      query = query.where(({ exists, selectFrom }) =>
        exists(
          selectFrom('note_records as r')
            .select('r.note_id')
            .whereRef('r.note_id', '=', 'n.id')
            .where('r.entity_instance_id', '=', record.entityInstanceId),
        ),
      );
    }
    if (data.createdByMemberId) query = query.where(sql<boolean>`n.created_by ->> 'id' = ${data.createdByMemberId}`);
    if (data.createdFrom) query = query.where('n.created_at', '>=', data.createdFrom);
    if (data.createdTo) query = query.where('n.created_at', '<', data.createdTo);
    if (data.favoritesOnly) {
      query = query.where(({ exists, selectFrom }) =>
        exists(
          selectFrom('favorites as f')
            .select('f.id')
            .whereRef('f.target_id', '=', 'n.id')
            .where('f.favorite_type', '=', 'note')
            .where('f.member_id', '=', memberId ?? '00000000-0000-0000-0000-000000000000'),
        ),
      );
    }
    const all = await query
      .orderBy('n.created_at', desc ? 'desc' : 'asc')
      .orderBy('n.id', desc ? 'desc' : 'asc')
      .execute();
    const { rows: visible, parents } = await visibleNotes(tx, deps, all);
    const page = visible.slice(data.offset, data.offset + data.limit);
    return { notes: await hydrateNotes(tx, page, parents, data.includeContent), total: visible.length };
  },

  /**
   * "Use a template" (E README §3.2): the note's title becomes the template's header title; the body is copied
   * server-side only when the note's document was never stored. Otherwise the client inserts `template.content`
   * into the open editor (the Yjs document is the source of truth).
   */
  async applyTemplate(tx: Tx, deps: CollabDeps, input: ApplyNoteTemplateInput): Promise<ApplyNoteTemplateOutput> {
    const data = applyNoteTemplateInputSchema.parse(input);
    const { row, parents } = await requireNote(tx, deps, data.noteId);
    const template = await requireTemplate(tx, data.templateId);
    const bodyCopied = await copyIntoPristineDocument(tx, {
      sourceId: template.document_id,
      targetId: row.document_id,
    });
    await tx.db
      .updateTable('notes')
      .set({ title: template.header_title, updated_at: tx.now })
      .where('id', '=', row.id)
      .execute();
    emitNote(tx, row.id, parents);
    noteEvent(tx, 'updated', row.id, parents[0] ?? null);
    if (bodyCopied) noteEvent(tx, 'content-updated', row.id, parents[0] ?? null);
    return { note: await oneNote(tx, deps, row.id), template: await oneTemplate(tx, template), bodyCopied };
  },
};

export const noteTemplateOps = {
  async create(tx: Tx, input: CreateNoteTemplateInput): Promise<NoteTemplate> {
    const data = createNoteTemplateInputSchema.parse(input);
    const existing = await tx.db.selectFrom('note_templates').selectAll().where('id', '=', data.id).executeTakeFirst();
    if (existing) {
      if (existing.deleted_at !== null)
        throw conflict('ID_CONFLICT', 'This template id belonged to a deleted template');
      return oneTemplate(tx, existing);
    }
    const documentId = newId();
    const row = await tx.db
      .insertInto('note_templates')
      .values({
        id: data.id,
        workspace_id: tx.workspaceId,
        title: data.title,
        header_title: data.headerTitle ?? data.title,
        document_id: documentId,
        created_by: actorJson(tx),
        created_at: tx.now,
        updated_at: tx.now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await createDocument(tx, { id: documentId, docType: 'note-template', parentId: data.id });
    tx.emit('note-template-list', null, {});
    return oneTemplate(tx, row);
  },

  /** Title edits set the header title too unless it is given (E README §3.2). */
  async update(tx: Tx, input: UpdateNoteTemplateInput): Promise<NoteTemplate> {
    const data = updateNoteTemplateInputSchema.parse(input);
    await requireTemplate(tx, data.templateId);
    const headerTitle = data.headerTitle ?? data.title;
    const row = await tx.db
      .updateTable('note_templates')
      .set({
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(headerTitle !== undefined ? { header_title: headerTitle } : {}),
        updated_at: tx.now,
      })
      .where('id', '=', data.templateId)
      .returningAll()
      .executeTakeFirstOrThrow();
    tx.emit('note-template', row.id, { noteTemplateId: row.id });
    tx.emit('note-template-list', null, {});
    return oneTemplate(tx, row);
  },

  async delete(tx: Tx, templateId: string): Promise<{ id: string }> {
    await requireTemplate(tx, templateId);
    await tx.db
      .updateTable('note_templates')
      .set({ deleted_at: tx.now, deleted_by: actorJson(tx) })
      .where('id', '=', templateId)
      .execute();
    await deleteFavoritesOfTargets(tx, 'note-template', [templateId]);
    tx.emit('note-template', templateId, { noteTemplateId: templateId });
    tx.emit('note-template-list', null, {});
    return { id: templateId };
  },

  async get(tx: Tx, templateId: string): Promise<NoteTemplate> {
    return oneTemplate(tx, await requireTemplate(tx, templateId));
  },

  async list(tx: Tx, input: ListNoteTemplatesInput): Promise<{ templates: NoteTemplate[] }> {
    const data = listNoteTemplatesInputSchema.parse(input);
    const memberId = tx.ctx.actor.type === 'workspace-member' ? tx.ctx.actor.id : null;
    const desc = data.sort === 'created_at:desc';
    let query = tx.db.selectFrom('note_templates as t').selectAll('t').where('t.deleted_at', 'is', null);
    if (data.search?.trim()) {
      const like = `%${data.search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      query = query.where(sql<boolean>`t.title ILIKE ${like}`);
    }
    if (data.favoritesOnly) {
      query = query.where(({ exists, selectFrom }) =>
        exists(
          selectFrom('favorites as f')
            .select('f.id')
            .whereRef('f.target_id', '=', 't.id')
            .where('f.favorite_type', '=', 'note-template')
            .where('f.member_id', '=', memberId ?? '00000000-0000-0000-0000-000000000000'),
        ),
      );
    }
    const rows = await query
      .orderBy('t.created_at', desc ? 'desc' : 'asc')
      .orderBy('t.id', desc ? 'desc' : 'asc')
      .limit(data.limit)
      .execute();
    const favorites = await favoriteIdsFor(
      tx,
      'note-template',
      rows.map((r) => r.id),
    );
    const contents = data.includeContent
      ? await readDocuments(
          tx,
          rows.map((r) => r.document_id),
        )
      : new Map<string, DocumentContent>();
    return {
      templates: rows.map((r) =>
        toTemplate(
          r,
          favorites.get(r.id) ?? null,
          data.includeContent ? (contents.get(r.document_id) ?? EMPTY_CONTENT) : undefined,
        ),
      ),
    };
  },

  /** "Create template from note" (E README §5.7): header title = the note's title; body copied server-side. */
  async createFromNote(tx: Tx, deps: CollabDeps, input: CreateTemplateFromNoteInput): Promise<NoteTemplate> {
    const data = createTemplateFromNoteInputSchema.parse(input);
    const existing = await tx.db.selectFrom('note_templates').selectAll().where('id', '=', data.id).executeTakeFirst();
    if (existing) return oneTemplate(tx, existing);
    const { row: note } = await requireNote(tx, deps, data.noteId);
    const documentId = newId();
    const row = await tx.db
      .insertInto('note_templates')
      .values({
        id: data.id,
        workspace_id: tx.workspaceId,
        title: note.title,
        header_title: note.title,
        document_id: documentId,
        created_by: actorJson(tx),
        created_at: tx.now,
        updated_at: tx.now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await copyDocument(tx, { sourceId: note.document_id, id: documentId, docType: 'note-template', parentId: data.id });
    tx.emit('note-template-list', null, {});
    return oneTemplate(tx, row);
  },
};

/** Who owns a document, for the collab server's room authorisation. */
export async function documentOwner(
  tx: Tx,
  deps: CollabDeps,
  documentId: string,
): Promise<{ kind: 'note' | 'note-template'; id: string } | null> {
  const note = await tx.db
    .selectFrom('notes')
    .select(['id'])
    .where('document_id', '=', documentId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (note) {
    try {
      await requireNote(tx, deps, note.id);
      return { kind: 'note', id: note.id };
    } catch {
      return null;
    }
  }
  const template = await tx.db
    .selectFrom('note_templates')
    .select(['id'])
    .where('document_id', '=', documentId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  return template ? { kind: 'note-template', id: template.id } : null;
}
