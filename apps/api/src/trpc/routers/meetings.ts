// Meetings (BACKLOG 7.04; F README §2.4–2.5; slice7-contracts.md procedure names): list (a record's meetings, a
// calendar range, the caller's own), get, create ("New meeting"), update (manual meetings fully, synced meetings their
// linked records), delete, and transcript-only call recordings. Timeline meeting events come through
// `timeline.list` (category `calendar`). Thin adapters over domain.meetings (I5).
import {
  createCallRecordingInputSchema,
  createMeetingInputSchema,
  listMeetingsInputSchema,
  meetingIdInputSchema,
  updateMeetingInputSchema,
  uuidSchema,
} from '@agentic-crm/contracts';
import { z } from 'zod';
import { acceptAfterInput, withSeq } from '../mutation';
import { router, workspaceProcedure } from '../trpc';

export const meetingsRouter = router({
  list: workspaceProcedure.input(listMeetingsInputSchema).query(({ ctx, input }) => {
    const { acceptAfter: _, ...query } = input;
    return ctx.domain.meetings.list(ctx.service, query);
  }),

  get: workspaceProcedure
    .input(meetingIdInputSchema)
    .query(({ ctx, input }) => ctx.domain.meetings.get(ctx.service, input.meetingId)),

  /** "New meeting" dialog: client-minted id, participants (members / addresses), linked records. */
  create: workspaceProcedure.input(createMeetingInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) =>
      ctx.domain.meetings.create(svc, input, { source: 'manual' }),
    );
    return { meeting: result, seq };
  }),

  update: workspaceProcedure.input(updateMeetingInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.meetings.update(svc, input));
    return { meeting: result, seq };
  }),

  delete: workspaceProcedure.input(z.object({ meetingId: uuidSchema })).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.meetings.delete(svc, input.meetingId));
    return { ...result, seq };
  }),

  /** Transcript-only call recordings (slice 10 builds the call pages on these). */
  recordings: router({
    list: workspaceProcedure
      .input(meetingIdInputSchema)
      .query(({ ctx, input }) => ctx.domain.meetings.recordings.list(ctx.service, input.meetingId)),
    get: workspaceProcedure
      .input(z.object({ meetingId: uuidSchema, recordingId: uuidSchema, ...acceptAfterInput }))
      .query(({ ctx, input }) => ctx.domain.meetings.recordings.get(ctx.service, input.meetingId, input.recordingId)),
    create: workspaceProcedure.input(createCallRecordingInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.meetings.recordings.create(svc, input));
      return { recording: result, seq };
    }),
    delete: workspaceProcedure
      .input(z.object({ meetingId: uuidSchema, recordingId: uuidSchema }))
      .mutation(async ({ ctx, input }) => {
        const { result, seq } = await withSeq(ctx.service, (svc) =>
          ctx.domain.meetings.recordings.delete(svc, input.meetingId, input.recordingId),
        );
        return { ...result, seq };
      }),
  }),
});
