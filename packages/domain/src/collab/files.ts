// Record files and folders (BACKLOG 3.06; D README §3.9, §4.4, §5; contract E5). Three-step upload (D §4.4):
// createUploadSession (pending, presigned PUT) → the browser PUTs the bytes → complete (verifies the object, accepts
// the session and creates the file entry). Reads need read access to the record's object; writes need update access.
import {
  type CompleteUploadOutput,
  type CreateFolderInput,
  type CreateUploadSessionInput,
  type CreateUploadSessionOutput,
  createFolderInputSchema,
  createUploadSessionInputSchema,
  type DownloadUrlInput,
  type DownloadUrlOutput,
  downloadUrlInputSchema,
  type ListFilesInput,
  type ListFilesOutput,
  listFilesInputSchema,
  type RecordRef,
  type RenameEntryInput,
  renameEntryInputSchema,
  type StorageEntry,
  type UploadSession,
} from '@agentic-crm/contracts';
import { type Selectable, type StorageEntriesTable, sql, type UploadSessionsTable } from '@agentic-crm/db';
import { badRequest, conflict, DomainError, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import type { ObjectStorage } from '../storage/s3.ts';
import type { Tx } from '../tx.ts';
import { actorJson, type CollabDeps, readableDefinitions, resolveRecordRefs, toActor } from './common.ts';
import { emitTimelines } from './notes.ts';

type EntryRow = Selectable<StorageEntriesTable>;
type SessionRow = Selectable<UploadSessionsTable>;

export const UPLOAD_URL_TTL_SECONDS = 15 * 60;
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

export interface FileDeps extends CollabDeps {
  storage: ObjectStorage;
}

const entryNotFound = (id: string) => notFound('The requested file could not be found', { file_id: id });

function toEntry(row: EntryRow, hasChildren: boolean | null): StorageEntry {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    entityDefinitionId: row.entity_definition_id,
    entityInstanceId: row.entity_instance_id,
    parentFolderId: row.parent_folder_id,
    rootEntryId: row.root_entry_id,
    entryType: row.entry_type,
    storageProvider: 'agentic-crm',
    name: row.name,
    contentType: row.content_type,
    contentSize: row.content_size === null ? null : Number(row.content_size),
    hasChildren: row.entry_type === 'folder' ? hasChildren : null,
    createdBy: toActor(row.created_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSession(row: SessionRow): UploadSession {
  return {
    id: row.id,
    entityDefinitionId: row.entity_definition_id,
    entityInstanceId: row.entity_instance_id,
    parentFolderId: row.parent_folder_id,
    filename: row.filename,
    contentType: row.content_type,
    contentSize: Number(row.content_size),
    state: row.state,
    error: row.error,
    fileEntryId: row.file_entry_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

async function withChildFlags(tx: Tx, rows: EntryRow[]): Promise<StorageEntry[]> {
  const folders = rows.filter((r) => r.entry_type === 'folder').map((r) => r.id);
  const withKids = new Set<string>();
  if (folders.length > 0) {
    const kids = await tx.db
      .selectFrom('storage_entries')
      .select('parent_folder_id')
      .where('parent_folder_id', 'in', folders)
      .where('deleted_at', 'is', null)
      .groupBy('parent_folder_id')
      .execute();
    for (const k of kids) if (k.parent_folder_id) withKids.add(k.parent_folder_id);
  }
  return rows.map((r) => toEntry(r, r.entry_type === 'folder' ? withKids.has(r.id) : null));
}

/** A live entry of a live record the caller may read (flag 'update' additionally checks write access). */
async function requireEntry(tx: Tx, deps: CollabDeps, entryId: string, write = false): Promise<EntryRow> {
  const row = await tx.db
    .selectFrom('storage_entries')
    .selectAll()
    .where('id', '=', entryId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw entryNotFound(entryId);
  const live = await tx.db
    .selectFrom('entity_instances')
    .select('id')
    .where('id', '=', row.entity_instance_id)
    .where('archived_at', 'is', null)
    .where('merged_at', 'is', null)
    .executeTakeFirst();
  const readable = await readableDefinitions(tx, deps, [row.entity_definition_id]);
  if (!live || !readable.has(row.entity_definition_id)) throw entryNotFound(entryId);
  if (write) await deps.policies.assertCan(tx, row.entity_definition_id, 'update_entity_instance');
  return row;
}

/** The parent folder (must be a live folder of the same record) → its root entry id. */
async function parentFolder(tx: Tx, record: RecordRef, folderId: string | null): Promise<string | null> {
  if (folderId === null) return null;
  const folder = await tx.db
    .selectFrom('storage_entries')
    .select(['id', 'entity_instance_id', 'entry_type', 'root_entry_id'])
    .where('id', '=', folderId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!folder || folder.entity_instance_id !== record.entityInstanceId || folder.entry_type !== 'folder') {
    throw notFound('The requested folder could not be found', { folder_id: folderId });
  }
  return folder.root_entry_id;
}

async function assertNameFree(
  tx: Tx,
  recordId: string,
  parentId: string | null,
  name: string,
  exceptId?: string,
): Promise<void> {
  const clash = await tx.db
    .selectFrom('storage_entries')
    .select('id')
    .where('entity_instance_id', '=', recordId)
    .where('deleted_at', 'is', null)
    .where(sql<boolean>`lower(name) = lower(${name})`)
    .$if(parentId === null, (q) => q.where('parent_folder_id', 'is', null))
    .$if(parentId !== null, (q) => q.where('parent_folder_id', '=', parentId as string))
    .$if(exceptId !== undefined, (q) => q.where('id', '!=', exceptId as string))
    .executeTakeFirst();
  if (clash) throw conflict('NAME_IN_USE', 'A file with this name already exists', { name, conflicting_id: clash.id });
}

function emitFiles(
  tx: Tx,
  row: { entity_definition_id: string; entity_instance_id: string },
  folderIds: (string | null)[],
): void {
  tx.emit('storage-entry-list', row.entity_instance_id, {
    entityDefinitionId: row.entity_definition_id,
    entityInstanceId: row.entity_instance_id,
    parentFolderIds: [...new Set(folderIds)],
  });
  emitTimelines(tx, [{ entityDefinitionId: row.entity_definition_id, entityInstanceId: row.entity_instance_id }]);
}

function objectKey(workspaceId: string, sessionId: string): string {
  return `workspaces/${workspaceId}/files/${sessionId}`;
}

async function storageCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DomainError) throw err;
    throw new DomainError(503, 'STORAGE_UNAVAILABLE', 'File storage is unavailable, please try again', {
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Inserts the file entry for accepted bytes (shared by complete() and the public API's direct upload). */
export async function insertFileEntry(
  tx: Tx,
  input: {
    id: string;
    record: RecordRef;
    parentFolderId: string | null;
    rootEntryId: string | null;
    name: string;
    contentType: string;
    contentSize: number;
    objectKey: string;
  },
): Promise<EntryRow> {
  await assertNameFree(tx, input.record.entityInstanceId, input.parentFolderId, input.name);
  const row = await tx.db
    .insertInto('storage_entries')
    .values({
      id: input.id,
      workspace_id: tx.workspaceId,
      entity_definition_id: input.record.entityDefinitionId,
      entity_instance_id: input.record.entityInstanceId,
      parent_folder_id: input.parentFolderId,
      root_entry_id: input.rootEntryId ?? input.id,
      entry_type: 'file',
      name: input.name,
      content_type: input.contentType,
      content_size: input.contentSize,
      object_key: input.objectKey,
      created_by: actorJson(tx),
      created_at: tx.now,
      updated_at: tx.now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  emitFiles(tx, row, [input.parentFolderId]);
  return row;
}

export const fileOps = {
  /** Step 1: a pending session and a presigned PUT URL (idempotent per session id while pending). */
  async createUploadSession(
    tx: Tx,
    deps: FileDeps,
    input: CreateUploadSessionInput,
  ): Promise<CreateUploadSessionOutput> {
    const data = createUploadSessionInputSchema.parse(input);
    const [record] = await resolveRecordRefs(tx, deps, [data], {
      flag: 'update_entity_instance',
      allowOwnMemberRecord: true,
    });
    const ref = record as RecordRef;
    let row = await tx.db.selectFrom('upload_sessions').selectAll().where('id', '=', data.id).executeTakeFirst();
    if (row && row.entity_instance_id !== ref.entityInstanceId) {
      throw conflict('ID_CONFLICT', 'This upload session id is already used', { upload_session_id: data.id });
    }
    if (!row) {
      await parentFolder(tx, ref, data.parentFolderId);
      await assertNameFree(tx, ref.entityInstanceId, data.parentFolderId, data.filename);
      row = await tx.db
        .insertInto('upload_sessions')
        .values({
          id: data.id,
          workspace_id: tx.workspaceId,
          entity_definition_id: ref.entityDefinitionId,
          entity_instance_id: ref.entityInstanceId,
          parent_folder_id: data.parentFolderId,
          filename: data.filename,
          content_type: data.contentType,
          content_size: data.contentSize,
          object_key: objectKey(tx.workspaceId, data.id),
          created_by: actorJson(tx),
          created_at: tx.now,
          expires_at: new Date(Date.parse(tx.now) + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      tx.emit('upload-session', row.id, { uploadSessionId: row.id });
    }
    await storageCall(() => deps.storage.ensureBucket());
    return {
      session: toSession(row),
      upload: {
        url: deps.storage.presignPut(row.object_key, {
          contentType: row.content_type,
          expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
        }),
        method: 'PUT',
        headers: { 'content-type': row.content_type },
      },
    };
  },

  /** Loads a session for complete() (outside the write transaction, the object is HEADed in between). */
  async sessionForCompletion(tx: Tx, deps: FileDeps, sessionId: string): Promise<SessionRow> {
    const row = await tx.db.selectFrom('upload_sessions').selectAll().where('id', '=', sessionId).executeTakeFirst();
    if (!row) throw notFound('The upload session could not be found', { upload_session_id: sessionId });
    await resolveRecordRefs(
      tx,
      deps,
      [{ entityDefinitionId: row.entity_definition_id, entityInstanceId: row.entity_instance_id }],
      { flag: 'update_entity_instance', allowOwnMemberRecord: true },
    );
    return row;
  },

  /** Step 3 (after HEAD verified the object): accept the session and create the file entry. Idempotent. */
  async acceptUpload(
    tx: Tx,
    deps: FileDeps,
    sessionId: string,
    object: { contentLength: number } | null,
  ): Promise<CompleteUploadOutput> {
    const row = await tx.db
      .selectFrom('upload_sessions')
      .selectAll()
      .where('id', '=', sessionId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (row.state === 'accepted' && row.file_entry_id) {
      const entry = await requireEntry(tx, deps, row.file_entry_id);
      return { session: toSession(row), entry: (await withChildFlags(tx, [entry]))[0] as StorageEntry };
    }
    if (row.state === 'failed') throw badRequest('UPLOAD_INCOMPLETE', 'This upload failed; start a new one');
    if (!object)
      throw badRequest('UPLOAD_INCOMPLETE', 'The file has not been uploaded yet', { upload_session_id: sessionId });
    if (object.contentLength !== Number(row.content_size)) {
      throw badRequest('UPLOAD_INCOMPLETE', 'The uploaded file does not have the declared size', {
        upload_session_id: sessionId,
        expected: Number(row.content_size),
        received: object.contentLength,
      });
    }
    const record = { entityDefinitionId: row.entity_definition_id, entityInstanceId: row.entity_instance_id };
    const root = await parentFolder(tx, record, row.parent_folder_id);
    const entry = await insertFileEntry(tx, {
      id: newId(),
      record,
      parentFolderId: row.parent_folder_id,
      rootEntryId: root,
      name: row.filename,
      contentType: row.content_type,
      contentSize: Number(row.content_size),
      objectKey: row.object_key,
    });
    const session = await tx.db
      .updateTable('upload_sessions')
      .set({ state: 'accepted', file_entry_id: entry.id, completed_at: tx.now })
      .where('id', '=', row.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    tx.emit('upload-session', row.id, { uploadSessionId: row.id });
    return { session: toSession(session), entry: (await withChildFlags(tx, [entry]))[0] as StorageEntry };
  },

  async list(tx: Tx, deps: CollabDeps, input: ListFilesInput): Promise<ListFilesOutput> {
    const data = listFilesInputSchema.parse(input);
    const [record] = await resolveRecordRefs(tx, deps, [data]);
    const ref = record as RecordRef;
    if (data.parentFolderId !== null) await parentFolder(tx, ref, data.parentFolderId);
    let rows: EntryRow[];
    if (data.recursive) {
      const { rows: all } = await sql<EntryRow>`
        WITH RECURSIVE tree AS (
          SELECT * FROM storage_entries
          WHERE entity_instance_id = ${ref.entityInstanceId} AND deleted_at IS NULL
            AND parent_folder_id IS NOT DISTINCT FROM ${data.parentFolderId}::uuid
          UNION ALL
          SELECT e.* FROM storage_entries e JOIN tree t ON e.parent_folder_id = t.id WHERE e.deleted_at IS NULL
        )
        SELECT * FROM tree`.execute(tx.db);
      rows = all;
    } else {
      rows = await tx.db
        .selectFrom('storage_entries')
        .selectAll()
        .where('entity_instance_id', '=', ref.entityInstanceId)
        .where('deleted_at', 'is', null)
        .$if(data.parentFolderId === null, (q) => q.where('parent_folder_id', 'is', null))
        .$if(data.parentFolderId !== null, (q) => q.where('parent_folder_id', '=', data.parentFolderId as string))
        .execute();
    }
    // Folders first, then by name (D §3.9 "folders listed first").
    rows.sort((a, b) =>
      a.entry_type !== b.entry_type
        ? a.entry_type === 'folder'
          ? -1
          : 1
        : a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
    );
    return { entries: await withChildFlags(tx, rows) };
  },

  async get(tx: Tx, deps: CollabDeps, entryId: string): Promise<StorageEntry> {
    const row = await requireEntry(tx, deps, entryId);
    return (await withChildFlags(tx, [row]))[0] as StorageEntry;
  },

  async createFolder(tx: Tx, deps: CollabDeps, input: CreateFolderInput): Promise<StorageEntry> {
    const data = createFolderInputSchema.parse(input);
    const [record] = await resolveRecordRefs(tx, deps, [data], { flag: 'update_entity_instance' });
    const ref = record as RecordRef;
    const existing = await tx.db.selectFrom('storage_entries').selectAll().where('id', '=', data.id).executeTakeFirst();
    if (existing) {
      if (existing.entity_instance_id !== ref.entityInstanceId || existing.entry_type !== 'folder') {
        throw conflict('ID_CONFLICT', 'This id is already used', { id: data.id });
      }
      return (await withChildFlags(tx, [existing]))[0] as StorageEntry;
    }
    const root = await parentFolder(tx, ref, data.parentFolderId);
    await assertNameFree(tx, ref.entityInstanceId, data.parentFolderId, data.name);
    const row = await tx.db
      .insertInto('storage_entries')
      .values({
        id: data.id,
        workspace_id: tx.workspaceId,
        entity_definition_id: ref.entityDefinitionId,
        entity_instance_id: ref.entityInstanceId,
        parent_folder_id: data.parentFolderId,
        root_entry_id: root ?? data.id,
        entry_type: 'folder',
        name: data.name,
        created_by: actorJson(tx),
        created_at: tx.now,
        updated_at: tx.now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    emitFiles(tx, row, [data.parentFolderId]);
    return (await withChildFlags(tx, [row]))[0] as StorageEntry;
  },

  async rename(tx: Tx, deps: CollabDeps, input: RenameEntryInput): Promise<StorageEntry> {
    const data = renameEntryInputSchema.parse(input);
    const row = await requireEntry(tx, deps, data.entryId, true);
    if (row.name === data.name) return (await withChildFlags(tx, [row]))[0] as StorageEntry;
    await assertNameFree(tx, row.entity_instance_id, row.parent_folder_id, data.name, row.id);
    const updated = await tx.db
      .updateTable('storage_entries')
      .set({ name: data.name, updated_at: tx.now })
      .where('id', '=', row.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    emitFiles(tx, row, [row.parent_folder_id]);
    return (await withChildFlags(tx, [updated]))[0] as StorageEntry;
  },

  /** Deletes a file, or a folder with everything inside it (soft, X-22). */
  async delete(tx: Tx, deps: CollabDeps, entryId: string): Promise<{ deletedIds: string[] }> {
    const row = await requireEntry(tx, deps, entryId, true);
    const { rows } = await sql<{ id: string }>`
      WITH RECURSIVE tree AS (
        SELECT id FROM storage_entries WHERE id = ${row.id}
        UNION ALL
        SELECT e.id FROM storage_entries e JOIN tree t ON e.parent_folder_id = t.id WHERE e.deleted_at IS NULL
      )
      UPDATE storage_entries s SET deleted_at = ${tx.now}, deleted_by = ${JSON.stringify(tx.ctx.actor)}::jsonb
      FROM tree WHERE s.id = tree.id AND s.deleted_at IS NULL
      RETURNING s.id`.execute(tx.db);
    emitFiles(tx, row, [row.parent_folder_id, row.id]);
    return { deletedIds: rows.map((r) => r.id) };
  },

  /** Short-lived signed download link (D §3.9 "Download ({size})"). */
  async downloadUrl(tx: Tx, deps: FileDeps, input: DownloadUrlInput): Promise<DownloadUrlOutput> {
    const data = downloadUrlInputSchema.parse(input);
    const row = await requireEntry(tx, deps, data.entryId);
    if (row.entry_type !== 'file' || !row.object_key)
      throw badRequest('VALIDATION_ERROR', 'Folders cannot be downloaded');
    return {
      url: deps.storage.presignGet(row.object_key, {
        expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
        filename: row.name,
        disposition: data.disposition,
        ...(row.content_type ? { contentType: row.content_type } : {}),
      }),
      expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    };
  },
};

/** The storage key namespace for direct (public API) uploads. */
export function directUploadKey(workspaceId: string, fileId: string): string {
  return objectKey(workspaceId, fileId);
}
export { storageCall };
