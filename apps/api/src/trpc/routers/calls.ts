// Calls (slice 10; BACKLOG 10.11, 10.12 data, 10.14, 10.15; slice10-contracts.md procedure names): the Calls list
// (filters, `query`, date groups, favourites strip), the call page (detail, transcript with speaker blocks and range
// links, speakers with talk share), call cards of meetings, insights (choose template / Update) and the member's
// default insight template. Thin adapters over domain.calls (I5).
import {
  callIdInputSchema,
  callsByMeetingsInputSchema,
  callTranscriptInputSchema,
  generateCallInsightInputSchema,
  listCallsInputSchema,
  updateCallSettingsInputSchema,
  uuidSchema,
} from '@agentic-crm/contracts';
import { z } from 'zod';
import { acceptAfterOnly, withSeq } from '../mutation';
import { router, workspaceProcedure } from '../trpc';

export const callsRouter = router({
  list: workspaceProcedure.input(listCallsInputSchema).query(({ ctx, input }) => {
    const { acceptAfter: _, ...query } = input;
    return ctx.domain.calls.list(ctx.service, query);
  }),

  get: workspaceProcedure
    .input(callIdInputSchema)
    .query(({ ctx, input }) => ctx.domain.calls.get(ctx.service, input.recordingId)),

  transcript: workspaceProcedure.input(callTranscriptInputSchema).query(({ ctx, input }) => {
    const { acceptAfter: _, ...query } = input;
    return ctx.domain.calls.transcript(ctx.service, query);
  }),

  speakers: workspaceProcedure
    .input(callIdInputSchema)
    .query(({ ctx, input }) => ctx.domain.calls.speakers(ctx.service, input.recordingId)),

  /** Call cards of meetings (record activity meeting card, meeting panels). */
  byMeetings: workspaceProcedure
    .input(callsByMeetingsInputSchema)
    .query(({ ctx, input }) => ctx.domain.calls.byMeetings(ctx.service, input.meetingIds)),

  /** "Delete recording" (row menu, call menu). */
  delete: workspaceProcedure.input(z.object({ recordingId: uuidSchema })).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.calls.delete(svc, input.recordingId));
    return { ...result, seq };
  }),

  insights: router({
    list: workspaceProcedure
      .input(callIdInputSchema)
      .query(({ ctx, input }) => ctx.domain.calls.insights.list(ctx.service, input.recordingId)),
    /** Choose template / Update: a new insight from the template's latest published version. */
    generate: workspaceProcedure.input(generateCallInsightInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.calls.insights.generate(svc, input));
      return { insight: result, seq };
    }),
  }),

  /** Personal call intelligence settings: the default insights template. */
  settings: router({
    get: workspaceProcedure.input(acceptAfterOnly).query(({ ctx }) => ctx.domain.calls.settings.get(ctx.service)),
    update: workspaceProcedure.input(updateCallSettingsInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.calls.settings.update(svc, input));
      return { settings: result, seq };
    }),
  }),
});
