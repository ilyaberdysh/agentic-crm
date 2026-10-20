// Views (A §4.10, C1 README §3.1–3.2) and query snapshots (internal-api-shapes §3, B.5). Thin adapters over
// domain.views. View writes return the whole view (filter, sorts, columns) so the client can replace its draft.

import type { ActionFlag } from '@agentic-crm/contracts';
import {
  addColumnInputSchema,
  aggregateInputSchema,
  createViewInputSchema,
  listViewsInputSchema,
  querySnapshotInputSchema,
  removeColumnInputSchema,
  resolveSelectionInputSchema,
  setViewFilterInputSchema,
  setViewSortsInputSchema,
  snapshotChunkInputSchema,
  updateColumnInputSchema,
  updateViewInputSchema,
  uuidSchema,
} from '@agentic-crm/contracts';
import { DomainError } from '@agentic-crm/domain';
import { z } from 'zod';
import { acceptAfterInput, withSeq } from '../mutation';
import { assertCan, type PolicyContext } from '../policy';
import { router, workspaceProcedure } from '../trpc';

/** Loads the view and checks `flag` on its object. */
async function viewFor(ctx: PolicyContext, viewId: string, flag: ActionFlag) {
  const view = await ctx.domain.views.get(ctx.service, viewId);
  await assertCan(ctx, view.entityDefinitionId, flag);
  return view;
}

/** Snapshot reads name the snapshot's object; the domain answers SNAPSHOT_NOT_FOUND when they disagree. */
const snapshotOf = { entityDefinitionId: uuidSchema };
const snapshotMismatch = (snapshotId: string) =>
  new DomainError(404, 'SNAPSHOT_NOT_FOUND', 'The snapshot has expired or does not exist', { snapshot_id: snapshotId });

export const viewsRouter = router({
  list: workspaceProcedure.input(listViewsInputSchema.extend(acceptAfterInput)).query(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'read_entity_definition');
    return ctx.domain.views.list(ctx.service, input);
  }),

  get: workspaceProcedure
    .input(z.object({ viewId: uuidSchema, ...acceptAfterInput }))
    .query(({ ctx, input }) => viewFor(ctx, input.viewId, 'read_entity_definition')),

  /** PUT create with filter, sorts and columns in one call (idempotent per id). */
  create: workspaceProcedure.input(createViewInputSchema).mutation(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'create_entity_view');
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.views.create(svc, input));
    return { view: result, seq };
  }),

  /** Title, rank, kanban settings, record column width, archive. */
  update: workspaceProcedure.input(updateViewInputSchema).mutation(async ({ ctx, input }) => {
    await viewFor(ctx, input.viewId, 'update_entity_view');
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.views.update(svc, input));
    return { view: result, seq };
  }),

  delete: workspaceProcedure.input(z.object({ viewId: uuidSchema })).mutation(async ({ ctx, input }) => {
    const view = await viewFor(ctx, input.viewId, 'delete_entity_view');
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.views.delete(svc, input.viewId));
    return { id: result.id, entityDefinitionId: view.entityDefinitionId, seq };
  }),

  /** "Save for everyone": replaces the whole filter (C1 §3.1). */
  setFilter: workspaceProcedure.input(setViewFilterInputSchema).mutation(async ({ ctx, input }) => {
    await viewFor(ctx, input.viewId, 'update_entity_view');
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.views.setFilter(svc, input));
    return { view: result, seq };
  }),

  /** Full-array replace of the sorts (max 5). */
  setSorts: workspaceProcedure.input(setViewSortsInputSchema).mutation(async ({ ctx, input }) => {
    await viewFor(ctx, input.viewId, 'update_entity_view');
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.views.setSorts(svc, input));
    return { view: result, seq };
  }),

  /** Column edits save immediately (C1 §3.2). `addColumn` is idempotent per column id. */
  addColumn: workspaceProcedure.input(addColumnInputSchema).mutation(async ({ ctx, input }) => {
    await viewFor(ctx, input.viewId, 'update_entity_view');
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.views.addColumn(svc, input));
    return { view: result, seq };
  }),

  updateColumn: workspaceProcedure.input(updateColumnInputSchema).mutation(async ({ ctx, input }) => {
    await viewFor(ctx, input.viewId, 'update_entity_view');
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.views.updateColumn(svc, input));
    return { view: result, seq };
  }),

  removeColumn: workspaceProcedure.input(removeColumnInputSchema).mutation(async ({ ctx, input }) => {
    await viewFor(ctx, input.viewId, 'update_entity_view');
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.views.removeColumn(svc, input));
    return { view: result, seq };
  }),
});

export const snapshotsRouter = router({
  /**
   * Materialise (filter, sorts) — or a saved view's, with unsaved drafts overriding — as a frozen snapshot:
   * `{snapshotId, total, ids (first 1000), start, accurateAt}`. It is a mutation-free read, but a POST-style call
   * because the snapshot is created server-side; exposed as a query so it caches and refetches like one.
   */
  query: workspaceProcedure.input(querySnapshotInputSchema).query(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'read_entity_instance');
    return ctx.domain.views.query(ctx.service, input);
  }),

  /** Ids at [start, start + size) of a snapshot (scrolling past the first 1000). */
  chunk: workspaceProcedure
    .input(snapshotChunkInputSchema.extend({ ...snapshotOf, ...acceptAfterInput }))
    .query(async ({ ctx, input }) => {
      await assertCan(ctx, input.entityDefinitionId, 'read_entity_instance');
      const chunk = await ctx.domain.views.chunk(ctx.service, input);
      if (chunk.entityDefinitionId !== input.entityDefinitionId) throw snapshotMismatch(input.snapshotId);
      return chunk;
    }),

  /**
   * Footer calculation over a snapshot (the path starts at the snapshot's object; multi-hop paths aggregate the first
   * related record's value): `{aggregation, value, valueText, total, filled, currencyCode, accurateAt}`.
   */
  aggregate: workspaceProcedure.input(aggregateInputSchema.extend(acceptAfterInput)).query(async ({ ctx, input }) => {
    for (const ref of new Set(input.path.map((hop) => hop.entityDefinitionId))) {
      await assertCan(ctx, ref, 'read_attribute_value');
    }
    const { acceptAfter: _, ...query } = input;
    return ctx.domain.views.aggregate(ctx.service, query);
  }),

  /** Zebra edges over snapshot indices → ids in snapshot order (select-all and bulk actions). */
  resolveSelection: workspaceProcedure
    .input(resolveSelectionInputSchema.extend(snapshotOf))
    .query(async ({ ctx, input }) => {
      await assertCan(ctx, input.entityDefinitionId, 'read_entity_instance');
      const probe = await ctx.domain.views.chunk(ctx.service, { snapshotId: input.snapshotId, start: 0, size: 1 });
      if (probe.entityDefinitionId !== input.entityDefinitionId) throw snapshotMismatch(input.snapshotId);
      return ctx.domain.views.resolveSelection(ctx.service, input);
    }),
});
