// Notes (E README §6; data-model-documented §5.1): list, create (plaintext or markdown), get, update (title and/or a
// full content replacement), delete. Content is read from the document projections (documents.markdown / blocks).
import {
  createNoteBody,
  getNotePathParams,
  listNotesQuery,
  updateNoteBody,
  updateNotePathParams,
  v2Operations,
} from '@agentic-crm/contracts/v2';
import { newId, plaintextToMarkdown } from '@agentic-crm/domain';
import { noteToPublic } from '../collab-mappers';
import { PublicApiError, publicErrors, withHints } from '../errors';
import { params, parseInput, type RouteSpec } from '../route';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
/** Largest note body accepted (larger bodies are 413 validation_type). */
const MAX_CONTENT_CHARS = 1_000_000;

const noteNotFound = (id: string) => publicErrors.notFound(`Note with ID "${id}" not found.`);

function noteId(raw: Record<string, string>, schema: typeof getNotePathParams | typeof updateNotePathParams): string {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw noteNotFound(raw.note_id ?? '');
  return parsed.data.note_id.toLowerCase();
}

function markdownOf(format: 'plaintext' | 'markdown', content: string): string {
  if (content.length > MAX_CONTENT_CHARS) {
    throw new PublicApiError(413, 'invalid_request_error', 'validation_type', 'The note content is too large.');
  }
  return format === 'markdown' ? content : plaintextToMarkdown(content);
}

/** Every readable note (optionally of one record), newest first. */
async function allNotes(
  v2: Parameters<RouteSpec['handler']>[0],
  record: { entityDefinitionId: string; entityInstanceId: string } | undefined,
) {
  const out = [];
  for (let offset = 0; ; offset += 200) {
    const page = await withHints({ recordId: record?.entityInstanceId }, () =>
      v2.domain.notes.list(v2.ctx, { ...(record ? { record } : {}), limit: 200, offset }),
    );
    out.push(...page.notes);
    if (offset + 200 >= page.total) return out;
  }
}

async function getNote(v2: Parameters<RouteSpec['handler']>[0], id: string) {
  try {
    return await v2.domain.notes.get(v2.ctx, id);
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode === 404) throw noteNotFound(id);
    throw err;
  }
}

export const noteRoutes: RouteSpec[] = [
  {
    method: 'GET',
    url: '/notes',
    scopes: v2Operations.listNotes.scopes,
    async handler(v2, request) {
      const query = parseInput(listNotesQuery, request.query, 'query parameters');
      const limit = Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
      const offset = Math.max(Math.trunc(query.offset ?? 0), 0);
      if (query.parent_record_id && !query.parent_object) {
        throw publicErrors.validation('parent_object is required when parent_record_id is given.');
      }
      const def = query.parent_object ? await v2.object(query.parent_object) : null;
      const record =
        def && query.parent_record_id
          ? { entityDefinitionId: def.id, entityInstanceId: query.parent_record_id }
          : undefined;
      const notes = (await allNotes(v2, record)).filter(
        // Object-only filter: the note's parent (its first parent record) belongs to the object.
        (n) => !def || record || n.parentRecords[0]?.entityDefinitionId === def.id,
      );
      const page = notes.slice(offset, offset + limit);
      return { data: await Promise.all(page.map((n) => noteToPublic(v2, n))) };
    },
  },
  {
    method: 'POST',
    url: '/notes',
    scopes: v2Operations.createNote.scopes,
    async handler(v2, request) {
      const { data } = parseInput(createNoteBody, request.body, 'request body');
      const def = await v2.object(data.parent_object);
      // A note can belong to a meeting (slice 7); unknown meetings are Attio's 404.
      const meetingId = data.meeting_id ? data.meeting_id.toLowerCase() : null;
      if (meetingId) {
        await v2.domain.meetings.get(v2.ctx, meetingId).catch(() => {
          throw publicErrors.notFound(`Meeting with ID "${data.meeting_id}" not found.`);
        });
      }
      let createdAt: string | undefined;
      if (data.created_at !== undefined) {
        const t = Date.parse(data.created_at);
        if (Number.isNaN(t) || t < 0 || t > Date.now() + 60_000) {
          throw publicErrors.validation('created_at must be a valid timestamp between 1970 and now.');
        }
        createdAt = new Date(t).toISOString();
      }
      const note = await withHints({ object: data.parent_object, recordId: data.parent_record_id }, () =>
        v2.domain.notes.create(
          v2.ctx,
          {
            id: newId(),
            title: data.title,
            parentRecords: [{ entityDefinitionId: def.id, entityInstanceId: data.parent_record_id }],
            ...(meetingId ? { meetingId } : {}),
          },
          { markdown: markdownOf(data.format, data.content), ...(createdAt ? { createdAt } : {}) },
        ),
      );
      return { data: await noteToPublic(v2, note) };
    },
  },
  {
    method: 'GET',
    url: '/notes/:note_id',
    scopes: v2Operations.getNote.scopes,
    async handler(v2, request) {
      const id = noteId(params(request), getNotePathParams);
      return { data: await noteToPublic(v2, await getNote(v2, id)) };
    },
  },
  {
    method: 'PATCH',
    url: '/notes/:note_id',
    scopes: v2Operations.updateNote.scopes,
    async handler(v2, request) {
      const id = noteId(params(request), updateNotePathParams);
      const { data } = parseInput(updateNoteBody, request.body, 'request body');
      if (data.content !== undefined && data.format === undefined) {
        throw publicErrors.validation('format is required when content is given.');
      }
      await getNote(v2, id);
      const note = await withHints({}, () =>
        v2.domain.notes.update(
          v2.ctx,
          { noteId: id, ...(data.title !== undefined ? { title: data.title } : {}) },
          data.content !== undefined ? { markdown: markdownOf(data.format ?? 'plaintext', data.content) } : {},
        ),
      );
      return { data: await noteToPublic(v2, note) };
    },
  },
  {
    method: 'DELETE',
    url: '/notes/:note_id',
    scopes: v2Operations.deleteNote.scopes,
    async handler(v2, request) {
      const id = noteId(params(request), getNotePathParams);
      await getNote(v2, id);
      await withHints({}, () => v2.domain.notes.delete(v2.ctx, id));
      return {};
    },
  },
];
