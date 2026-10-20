// Notes and note templates (BACKLOG 3.12, 3.14; E README §3.1–3.2). Thin adapters over domain.notes /
// domain.noteTemplates (permission checks live in the domain: a note is readable through its parent records).
// Bodies are edited through apps/collab (documents); these procedures carry headers and content projections.
import {
  applyNoteTemplateInputSchema,
  batchGetNotesInputSchema,
  createNoteInputSchema,
  createNoteTemplateInputSchema,
  createTemplateFromNoteInputSchema,
  listNotesInputSchema,
  listNoteTemplatesInputSchema,
  noteIdInputSchema,
  noteTemplateIdInputSchema,
  updateNoteInputSchema,
  updateNoteTemplateInputSchema,
  uuidSchema,
} from '@agentic-crm/contracts';
import { z } from 'zod';
import { acceptAfterInput, withSeq } from '../mutation';
import { router, workspaceProcedure } from '../trpc';

export const notesRouter = router({
  /** PUT create with a client UUID (I3): parent records (≥ 1), title, optional meeting and template. */
  create: workspaceProcedure.input(createNoteInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.notes.create(svc, input));
    return { note: result, seq };
  }),

  /** Debounced title autosave, "Link a meeting", parent record changes (full replacement). */
  update: workspaceProcedure.input(updateNoteInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.notes.update(svc, input));
    return { note: result, seq };
  }),

  /** "Permanently delete this note?" — no undo (E README §3.1). */
  delete: workspaceProcedure.input(z.object({ noteId: uuidSchema })).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.notes.delete(svc, input.noteId));
    return { id: result.id, seq };
  }),

  /** One note with its content projection; 404 "Note not found" for deleted or unreadable notes. */
  get: workspaceProcedure
    .input(noteIdInputSchema)
    .query(({ ctx, input }) => ctx.domain.notes.get(ctx.service, input.noteId)),

  batchGet: workspaceProcedure
    .input(batchGetNotesInputSchema)
    .query(({ ctx, input }) => ctx.domain.notes.batchGet(ctx.service, input)),

  /** Notes index / record Notes tab: filters (record, creator, created range, favorites), sort, offset paging. */
  list: workspaceProcedure
    .input(listNotesInputSchema)
    .query(({ ctx, input }) => ctx.domain.notes.list(ctx.service, input)),

  /**
   * "Use a template": the note takes the template's header title; the body is copied server-side only for a
   * never-stored note (`bodyCopied`), otherwise insert `template.content` into the open editor.
   */
  applyTemplate: workspaceProcedure.input(applyNoteTemplateInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.notes.applyTemplate(svc, input));
    return { ...result, seq };
  }),
});

export const noteTemplatesRouter = router({
  create: workspaceProcedure.input(createNoteTemplateInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.noteTemplates.create(svc, input));
    return { template: result, seq };
  }),

  /** Title (and header title, which follows the title unless given). */
  update: workspaceProcedure.input(updateNoteTemplateInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.noteTemplates.update(svc, input));
    return { template: result, seq };
  }),

  delete: workspaceProcedure.input(z.object({ templateId: uuidSchema })).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.noteTemplates.delete(svc, input.templateId));
    return { id: result.id, seq };
  }),

  get: workspaceProcedure
    .input(noteTemplateIdInputSchema)
    .query(({ ctx, input }) => ctx.domain.noteTemplates.get(ctx.service, input.templateId)),

  list: workspaceProcedure
    .input(listNoteTemplatesInputSchema)
    .query(({ ctx, input }) => ctx.domain.noteTemplates.list(ctx.service, input)),

  /** "Create template from note" (E README §5.7): copies the note's body into a new template. */
  createFromNote: workspaceProcedure.input(createTemplateFromNoteInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.noteTemplates.createFromNote(svc, input));
    return { template: result, seq };
  }),
});

/** For apps/collab: which note / template owns a document, if the caller may open it (null otherwise). */
export const documentsRouter = router({
  owner: workspaceProcedure
    .input(z.object({ documentId: uuidSchema, ...acceptAfterInput }))
    .query(({ ctx, input }) => ctx.domain.documents.owner(ctx.service, input.documentId)),
});
