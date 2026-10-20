// Notes and note templates on the client (BACKLOG 3.12, 3.14). Queries live under the realtime
// resources ['ws', ws, 'note' | 'note-list' | 'note-template' | 'note-template-list', …] (data/realtime/invalidation:
// one prefix per resource). Mutations answer the canonical item plus a change seq: the item is written into its own
// key and the seq becomes the accept-after watermark of the next reads.
import type { CreateNoteInput, ListNotesInput, ListNoteTemplatesInput, RecordRefInput } from '@agentic-crm/contracts';
import { type QueryClient, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { keys } from '../../data/keys';
import { markCovered } from '../../data/realtime/invalidation';
import { api, inWorkspace, noteAcceptAfter, type RouterOutputs, type WorkspaceRef } from '../../data/trpc';
import { newId } from '../../lib/ids';
import { useWorkspace } from '../shell/workspaceContext';

export type Note = RouterOutputs['notes']['get'];
export type NoteTemplate = RouterOutputs['noteTemplates']['get'];

export const noteKeys = {
  note: (ws: string, id: string) => [...keys.resource(ws, 'note'), id] as const,
  list: (ws: string, params: ListNotesInput) => [...keys.resource(ws, 'note-list'), params] as const,
  template: (ws: string, id: string) => [...keys.resource(ws, 'note-template'), id] as const,
  templates: (ws: string, params: ListNoteTemplatesInput) =>
    [...keys.resource(ws, 'note-template-list'), params] as const,
};

export function useWorkspaceRef(): WorkspaceRef {
  const { workspace } = useWorkspace();
  return { id: workspace.id, slug: workspace.slug };
}

// ---- reads -------------------------------------------------------------------------------------------------------

export const noteQuery = (ws: WorkspaceRef, noteId: string) =>
  queryOptions({
    queryKey: noteKeys.note(ws.id, noteId),
    queryFn: () => api.notes.get.query({ noteId }, inWorkspace(ws)),
    retry: (count, error) => count < 2 && !/not found|404/i.test(String((error as Error)?.message)),
  });

export function useNote(noteId: string | null) {
  const ws = useWorkspaceRef();
  return useQuery({ ...noteQuery(ws, noteId ?? ''), enabled: Boolean(noteId) });
}

export const notesListQuery = (ws: WorkspaceRef, params: ListNotesInput) =>
  queryOptions({
    queryKey: noteKeys.list(ws.id, params),
    queryFn: () => api.notes.list.query(params, inWorkspace(ws)),
  });

export function useNotesList(params: ListNotesInput, enabled = true) {
  const ws = useWorkspaceRef();
  return useQuery({ ...notesListQuery(ws, params), enabled, placeholderData: (prev) => prev });
}

export const templateQuery = (ws: WorkspaceRef, templateId: string) =>
  queryOptions({
    queryKey: noteKeys.template(ws.id, templateId),
    queryFn: () => api.noteTemplates.get.query({ templateId }, inWorkspace(ws)),
    retry: (count, error) => count < 2 && !/not found|404/i.test(String((error as Error)?.message)),
  });

export function useNoteTemplate(templateId: string | null) {
  const ws = useWorkspaceRef();
  return useQuery({ ...templateQuery(ws, templateId ?? ''), enabled: Boolean(templateId) });
}

export function useNoteTemplates(params: ListNoteTemplatesInput = {}, enabled = true) {
  const ws = useWorkspaceRef();
  return useQuery({
    queryKey: noteKeys.templates(ws.id, params),
    queryFn: () => api.noteTemplates.list.query(params, inWorkspace(ws)),
    enabled,
    placeholderData: (prev) => prev,
  });
}

// ---- writes ------------------------------------------------------------------------------------------------------

function settleNote(client: QueryClient, ws: WorkspaceRef, note: Note, seq: string | null): void {
  noteAcceptAfter(ws.id, seq);
  const key = noteKeys.note(ws.id, note.id);
  client.setQueryData(key, note);
  markCovered(key, seq);
}

function settleTemplate(client: QueryClient, ws: WorkspaceRef, template: NoteTemplate, seq: string | null): void {
  noteAcceptAfter(ws.id, seq);
  const key = noteKeys.template(ws.id, template.id);
  client.setQueryData(key, template);
  markCovered(key, seq);
}

/** Creates a note on its parent record(s) and answers it (PUT with a client UUID). */
export async function createNote(
  client: QueryClient,
  ws: WorkspaceRef,
  input: Omit<CreateNoteInput, 'id'> & { id?: string },
): Promise<Note> {
  const { note, seq } = await api.notes.create.mutate({ id: input.id ?? newId(), ...input }, inWorkspace(ws));
  settleNote(client, ws, note, seq);
  void client.invalidateQueries({ queryKey: keys.resource(ws.id, 'note-list') });
  return note;
}

export function useCreateNote() {
  const ws = useWorkspaceRef();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { parentRecords: RecordRefInput[]; title?: string; templateId?: string }) =>
      createNote(client, ws, input),
  });
}

export async function updateNoteTitle(client: QueryClient, ws: WorkspaceRef, noteId: string, title: string) {
  const { note, seq } = await api.notes.update.mutate({ noteId, title }, inWorkspace(ws));
  settleNote(client, ws, note, seq);
  return note;
}

export async function deleteNote(client: QueryClient, ws: WorkspaceRef, noteId: string): Promise<void> {
  const { seq } = await api.notes.delete.mutate({ noteId }, inWorkspace(ws));
  noteAcceptAfter(ws.id, seq);
  client.removeQueries({ queryKey: noteKeys.note(ws.id, noteId) });
  // Drop the note from every cached list right away (no undo).
  client.setQueriesData<{ notes: Note[]; total: number }>({ queryKey: keys.resource(ws.id, 'note-list') }, (prev) =>
    prev?.notes.some((n) => n.id === noteId)
      ? { notes: prev.notes.filter((n) => n.id !== noteId), total: Math.max(0, prev.total - 1) }
      : prev,
  );
  void client.invalidateQueries({ queryKey: keys.resource(ws.id, 'note-list') });
  void client.invalidateQueries({ queryKey: keys.resource(ws.id, 'favorite-list') });
}

/** "Use a template": the note takes the template's title; the body is copied server-side for a pristine note. */
export async function applyTemplate(client: QueryClient, ws: WorkspaceRef, noteId: string, templateId: string) {
  const out = await api.notes.applyTemplate.mutate({ noteId, templateId }, inWorkspace(ws));
  settleNote(client, ws, out.note, out.seq);
  return out;
}

export async function createTemplate(
  client: QueryClient,
  ws: WorkspaceRef,
  input: { title?: string; headerTitle?: string } = {},
): Promise<NoteTemplate> {
  const { template, seq } = await api.noteTemplates.create.mutate({ id: newId(), ...input }, inWorkspace(ws));
  settleTemplate(client, ws, template, seq);
  void client.invalidateQueries({ queryKey: keys.resource(ws.id, 'note-template-list') });
  return template;
}

export async function createTemplateFromNote(client: QueryClient, ws: WorkspaceRef, noteId: string) {
  const { template, seq } = await api.noteTemplates.createFromNote.mutate({ id: newId(), noteId }, inWorkspace(ws));
  settleTemplate(client, ws, template, seq);
  void client.invalidateQueries({ queryKey: keys.resource(ws.id, 'note-template-list') });
  return template;
}

export async function updateTemplateTitle(client: QueryClient, ws: WorkspaceRef, templateId: string, title: string) {
  const { template, seq } = await api.noteTemplates.update.mutate({ templateId, title }, inWorkspace(ws));
  settleTemplate(client, ws, template, seq);
  return template;
}

export async function deleteTemplate(client: QueryClient, ws: WorkspaceRef, templateId: string): Promise<void> {
  const { seq } = await api.noteTemplates.delete.mutate({ templateId }, inWorkspace(ws));
  noteAcceptAfter(ws.id, seq);
  client.removeQueries({ queryKey: noteKeys.template(ws.id, templateId) });
  client.setQueriesData<{ templates: NoteTemplate[] }>(
    { queryKey: keys.resource(ws.id, 'note-template-list') },
    (prev) => (prev ? { templates: prev.templates.filter((t) => t.id !== templateId) } : prev),
  );
  void client.invalidateQueries({ queryKey: keys.resource(ws.id, 'note-template-list') });
  void client.invalidateQueries({ queryKey: keys.resource(ws.id, 'favorite-list') });
}
