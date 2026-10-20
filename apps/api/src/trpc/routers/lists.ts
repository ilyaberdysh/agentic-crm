// Lists, entries and kanban boards (BACKLOG §4; slice4-contracts.md procedure names). Thin adapters over
// domain.lists / domain.entries / domain.kanban, which check list access levels themselves (J permissions §2).
// List attributes, options and statuses are schema.attributes / options / statuses with entityDefinitionId = listId;
// entry values are records.* / values.*; views and snapshots over entries are views.* / snapshots.*.
import {
  addEntriesInputSchema,
  checkDuplicatesInputSchema,
  createListInputSchema,
  deleteListInputSchema,
  duplicateListInputSchema,
  entriesForRecordInputSchema,
  getEntryInputSchema,
  kanbanColumnChunkInputSchema,
  kanbanColumnsInputSchema,
  kanbanMoveInputSchema,
  kanbanTimeInStageInputSchema,
  listListsInputSchema,
  listRefInputSchema,
  removeEntriesInputSchema,
  setListAccessInputSchema,
  updateListInputSchema,
} from '@agentic-crm/contracts';
import { withSeq } from '../mutation';
import { router, workspaceProcedure } from '../trpc';

export const listsRouter = router({
  /** Sidebar order; `scope: 'all'` (admins, settings → Lists) includes lists the caller cannot open. */
  list: workspaceProcedure
    .input(listListsInputSchema)
    .query(({ ctx, input }) => ctx.domain.lists.list(ctx.service, input)),

  /** One list (403 "No access to this list" without read access, except for admins). */
  get: workspaceProcedure.input(listRefInputSchema).query(({ ctx, input }) => ctx.domain.lists.get(ctx.service, input)),

  /** Start from scratch: list + system attributes + grants + "All entries table" view. Idempotent per `id`. */
  create: workspaceProcedure.input(createListInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.lists.create(svc, input));
    return { ...result, seq };
  }),

  /** Rename, icon, api slug, parent objects (Full access); sidebar rank (`sortOrder`). */
  update: workspaceProcedure.input(updateListInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.lists.update(svc, input));
    return { list: result, seq };
  }),

  /** Copy with new ids for everything (X-02); entries only with `includeEntries`. */
  duplicate: workspaceProcedure.input(duplicateListInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.lists.duplicate(svc, input));
    return { list: result, seq };
  }),

  delete: workspaceProcedure.input(deleteListInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.lists.delete(svc, input));
    return { ...result, seq };
  }),

  /** Workspace level and member overrides (`scope: null` removes one). */
  setAccess: workspaceProcedure.input(setListAccessInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.lists.setAccess(svc, input));
    return { list: result, seq };
  }),
});

export const entriesRouter = router({
  /** Add records (Add-to-list form, bulk add): `{entries, duplicates, celebrate, seq}`. */
  add: workspaceProcedure.input(addEntriesInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.entries.add(svc, input));
    return { ...result, seq };
  }),

  /** "Checking for duplicate entries": records that already have entries, with those entries. */
  checkDuplicates: workspaceProcedure
    .input(checkDuplicatesInputSchema)
    .query(({ ctx, input }) => ctx.domain.entries.checkDuplicates(ctx.service, input)),

  /** Remove from list (entries and their list attribute data). */
  remove: workspaceProcedure.input(removeEntriesInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.entries.remove(svc, input));
    return { ...result, seq };
  }),

  get: workspaceProcedure
    .input(getEntryInputSchema)
    .query(({ ctx, input }) => ctx.domain.entries.get(ctx.service, input)),

  /** A record's entries across readable lists (record page Lists section). */
  forRecord: workspaceProcedure
    .input(entriesForRecordInputSchema)
    .query(({ ctx, input }) => ctx.domain.entries.forRecord(ctx.service, input)),
});

export const kanbanRouter = router({
  /** Board columns: `{stages, columns: [{stageId, snapshotId, total, firstIds, aggregate}]}`. */
  columns: workspaceProcedure
    .input(kanbanColumnsInputSchema)
    .query(({ ctx, input }) => ctx.domain.kanban.columns(ctx.service, input)),

  /** More ids of one column's snapshot. */
  columnChunk: workspaceProcedure
    .input(kanbanColumnChunkInputSchema)
    .query(({ ctx, input }) => ctx.domain.kanban.columnChunk(ctx.service, input)),

  /** Drag and drop: writes the stage value (on the parent record when grouped through parent_record). */
  move: workspaceProcedure.input(kanbanMoveInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.kanban.move(svc, input));
    return { ...result, seq };
  }),

  /** Time-in-stage chips for cards. */
  timeInStage: workspaceProcedure
    .input(kanbanTimeInStageInputSchema)
    .query(({ ctx, input }) => ctx.domain.kanban.timeInStage(ctx.service, input)),
});
