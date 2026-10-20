// Files and folders (D README §6; data-model-documented §5.7): list a record's entries (every level unless a folder is
// given), create a folder, upload a file (multipart, 50 MB), get, delete (folders with their contents), download
// (302 to a signed URL). Connected storage providers are not supported (no third-party storage).
import type { StorageEntry } from '@agentic-crm/contracts';
import { MAX_FILE_BYTES } from '@agentic-crm/contracts';
import { createFileEntryBody, getFilePathParams, listFilesQuery, v2Operations } from '@agentic-crm/contracts/v2';
import { newId } from '@agentic-crm/domain';
import { fileToPublic } from '../collab-mappers';
import type { V2Context } from '../context';
import { PublicApiError, publicErrors, withHints } from '../errors';
import { isMultipartBody } from '../multipart';
import { params, parseInput, type RouteSpec } from '../route';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fileNotFound = (id: string) => publicErrors.notFound(`File with ID "${id}" not found.`);

function fileId(raw: Record<string, string>): string {
  const parsed = getFilePathParams.safeParse(raw);
  if (!parsed.success) throw fileNotFound(raw.file_id ?? '');
  return parsed.data.file_id.toLowerCase();
}

async function getEntry(v2: V2Context, id: string): Promise<StorageEntry> {
  try {
    return await v2.domain.files.get(v2.ctx, id);
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode === 404) throw fileNotFound(id);
    throw err;
  }
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const n = Number(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!Number.isInteger(n) || n < 0) throw publicErrors.validation('Invalid cursor.');
  return n;
}

export const fileRoutes: RouteSpec[] = [
  {
    method: 'GET',
    url: '/files',
    scopes: v2Operations.listFiles.scopes,
    async handler(v2, request) {
      const query = parseInput(listFilesQuery, request.query, 'query parameters');
      const def = await v2.object(query.object);
      if (query.storage_provider && query.storage_provider !== 'attio')
        return { data: [], pagination: { next_cursor: null } };
      const { entries } = await withHints({ object: query.object, recordId: query.record_id }, () =>
        v2.domain.files.list(v2.ctx, {
          entityDefinitionId: def.id,
          entityInstanceId: query.record_id,
          parentFolderId: query.parent_folder_id ?? null,
          // Without a folder, entries at every nesting level are returned.
          recursive: query.parent_folder_id === undefined,
        }),
      );
      const offset = decodeCursor(query.cursor);
      const limit = query.limit ?? 50;
      const page = entries.slice(offset, offset + limit);
      return {
        data: await Promise.all(page.map((e) => fileToPublic(v2, e))),
        pagination: {
          next_cursor:
            offset + limit < entries.length ? Buffer.from(String(offset + limit)).toString('base64url') : null,
        },
      };
    },
  },
  {
    method: 'POST',
    url: '/files',
    scopes: v2Operations.createFileEntry.scopes,
    async handler(v2, request) {
      const body = parseInput(createFileEntryBody, request.body, 'request body');
      if (body.file_type !== 'folder') {
        throw publicErrors.validation(
          `The storage provider "${body.storage_provider}" is not connected to this workspace.`,
        );
      }
      const def = await v2.object(body.object);
      const entry = await withHints({ object: body.object, recordId: body.record_id }, () =>
        v2.domain.files.createFolder(v2.ctx, {
          id: newId(),
          entityDefinitionId: def.id,
          entityInstanceId: body.record_id,
          parentFolderId: body.parent_folder_id ?? null,
          name: body.name,
        }),
      );
      return { data: await fileToPublic(v2, entry) };
    },
  },
  {
    method: 'POST',
    url: '/files/upload',
    scopes: v2Operations.uploadFile.scopes,
    async handler(v2, request, reply) {
      const body = request.body;
      if (!isMultipartBody(body)) throw publicErrors.validation('Send the file as multipart/form-data.');
      const file = body.files.file;
      const { object, record_id: recordId, parent_folder_id: parentFolderId } = body.fields;
      if (!file) throw publicErrors.validation('file: Required.');
      if (!object) throw publicErrors.validation('object: Required.');
      if (!recordId || !UUID.test(recordId)) throw publicErrors.validation('record_id: Invalid UUID.');
      if (parentFolderId !== undefined && parentFolderId !== '' && !UUID.test(parentFolderId)) {
        throw publicErrors.validation('parent_folder_id: Invalid UUID.');
      }
      if (file.data.byteLength > MAX_FILE_BYTES) {
        throw new PublicApiError(413, 'invalid_request_error', 'validation_type', 'Files can be at most 50 MB.');
      }
      const def = await v2.object(object);
      const entry = await withHints({ object, recordId }, () =>
        v2.domain.files.upload(v2.ctx, {
          record: { entityDefinitionId: def.id, entityInstanceId: recordId.toLowerCase() },
          parentFolderId: parentFolderId ? parentFolderId.toLowerCase() : null,
          name: file.filename || 'file',
          contentType: file.contentType,
          body: file.data,
        }),
      );
      reply.status(201);
      return { data: await fileToPublic(v2, entry) };
    },
  },
  {
    method: 'GET',
    url: '/files/:file_id',
    scopes: v2Operations.getFile.scopes,
    async handler(v2, request) {
      const entry = await getEntry(v2, fileId(params(request)));
      return { data: await fileToPublic(v2, entry, { hasChildren: true }) };
    },
  },
  {
    method: 'DELETE',
    url: '/files/:file_id',
    scopes: v2Operations.deleteFile.scopes,
    async handler(v2, request) {
      const id = fileId(params(request));
      await getEntry(v2, id);
      await withHints({}, () => v2.domain.files.delete(v2.ctx, id));
      return {};
    },
  },
  {
    method: 'GET',
    url: '/files/:file_id/download',
    scopes: v2Operations.downloadFile.scopes,
    async handler(v2, request, reply) {
      const id = fileId(params(request));
      const entry = await getEntry(v2, id);
      if (entry.entryType !== 'file') throw publicErrors.validation('Folders cannot be downloaded.');
      const { url } = await withHints({}, () => v2.domain.files.downloadUrl(v2.ctx, { entryId: id }));
      return reply.redirect(url, 302);
    },
  },
];
