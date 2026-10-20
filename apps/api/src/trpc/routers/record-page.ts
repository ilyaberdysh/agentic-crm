// Record page support (BACKLOG 3.04, 3.07, 3.08, 3.10, 3.11): the activity timeline (contract E2), page layouts,
// record states (merged-away / deleted / not found) and related-item counters, plus the member's calendar
// preferences (X-09 / X-10). Thin adapters over the domain.
import {
  getLayoutInputSchema,
  listTimelineInputSchema,
  recordStateInputSchema,
  relatedCountsInputSchema,
  saveLayoutInputSchema,
  updateMemberPreferencesInputSchema,
} from '@agentic-crm/contracts';
import { acceptAfterOnly, withSeq } from '../mutation';
import { router, workspaceProcedure } from '../trpc';

export const timelineRouter = router({
  /**
   * `{entityDefinitionId, entityInstanceId, filters?: EventCategory[], mode?: 'past'|'upcoming', before?, after?,
   * limit?, disableGrouping?}` → `{events: TimelineItem[], nextBefore, nextAfter}`.
   */
  list: workspaceProcedure
    .input(listTimelineInputSchema)
    .query(({ ctx, input }) => ctx.domain.timeline.list(ctx.service, input)),
});

export const layoutsRouter = router({
  /** The object's record-page layout (created with Attio's defaults on first read). */
  get: workspaceProcedure
    .input(getLayoutInputSchema)
    .query(({ ctx, input }) => ctx.domain.layouts.get(ctx.service, input)),

  /** "Save changes": the full element list; `expectedVersion` → 409 VERSION_CONFLICT on a concurrent save. */
  save: workspaceProcedure.input(saveLayoutInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.layouts.save(svc, input));
    return { layout: result, seq };
  }),
});

export const recordPageRouter = router({
  /** live | merged (with the live record to go to) | deleted | not-found. */
  state: workspaceProcedure
    .input(recordStateInputSchema)
    .query(({ ctx, input }) => ctx.domain.recordPage.state(ctx.service, input)),

  /** Lists / notes / tasks / open tasks / comments / files per record (merge cards, tab badges). */
  relatedCounts: workspaceProcedure
    .input(relatedCountsInputSchema)
    .query(({ ctx, input }) => ctx.domain.recordPage.relatedCounts(ctx.service, input)),
});

export const preferencesRouter = router({
  get: workspaceProcedure.input(acceptAfterOnly).query(({ ctx }) => ctx.domain.preferences.get(ctx.service)),

  update: workspaceProcedure.input(updateMemberPreferencesInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.preferences.update(svc, input));
    return { preferences: result, seq };
  }),
});
