// Slice-10 calls services wired for createDomain(): call recordings (the meetings.recordings write path used by
// /v2), processing, the Calls list and call page reads, insights, insight templates and member call settings.
// Every method is one workspace transaction (I1) except the AI steps, which call the LLM between a claim and a
// finish transaction (calls.process / calls.generate jobs, or inline after the write when no job queue is wired).
import type {
  CallTranscriptInput,
  CreateCallRecordingInput,
  CreateInsightSectionInput,
  CreateInsightTemplateInput,
  GenerateCallInsightInput,
  ListCallsInput,
  ListInsightTemplatesInput,
  PreviewInsightTemplateInput,
  UpdateCallSettingsInput,
  UpdateInsightSectionInput,
  UpdateInsightTemplateInput,
} from '@agentic-crm/contracts';
import { callTranscriptInputSchema } from '@agentic-crm/contracts';
import type { Database } from '@agentic-crm/db';
import type { LlmClient } from '../ai/llm.ts';
import type { ServiceContext } from '../context.ts';
import type { JobQueue } from '../jobs/queue.ts';
import type { Policies } from '../permissions.ts';
import { runInWorkspace, type Tx } from '../tx.ts';
import { type CallsDeps, loadCall } from './common.ts';
import { type GenerationKind, insightOps, runGeneration } from './insights.ts';
import { callListOps, callSettingsOps } from './list.ts';
import { INSIGHT_PRESETS } from './presets.ts';
import { processRecording } from './processing.ts';
import { loadTranscript, speakersView, transcriptView } from './read.ts';
import { recordingOps } from './recordings.ts';
import { templateOps } from './templates.ts';

export { CALL_PURPOSES, callsFakeReply, fakeCallsLlm, withCallsFakeReplies } from './llm.ts';
export { INSIGHT_PRESETS } from './presets.ts';
export { BLOCK_GAP_SECONDS, buildBlocks, formatClock, PARAGRAPH_GAP_SECONDS } from './transcript.ts';

export interface CallsWiring {
  database: Database;
  policies: Policies;
  jobs?: JobQueue | undefined;
  /** The AI layer's LLM client (createDomain's `llm`): not configured → summaries fail, insights refuse. */
  llm: LlmClient;
}

export function createCallServices(wiring: CallsWiring) {
  const { database } = wiring;
  const deps: CallsDeps = {
    policies: wiring.policies,
    jobs: wiring.jobs,
    llm: wiring.llm,
  };
  const run = <T>(ctx: ServiceContext, fn: (tx: Tx) => Promise<T>) => runInWorkspace(database, ctx, fn);

  const generate = (
    workspaceId: string,
    kind: GenerationKind,
    id: string,
    options: { final: boolean; signal?: AbortSignal } = { final: true },
  ) => runGeneration(database, deps, workspaceId, kind, id, options);

  const process = async (
    workspaceId: string,
    recordingId: string,
    options: { final: boolean; signal?: AbortSignal } = { final: true },
  ) => {
    const result = await processRecording(database, deps, workspaceId, recordingId, options);
    // Without a job queue the default-template insights run here too.
    if (!deps.jobs) for (const id of result.insightIds) await generate(workspaceId, 'insight', id);
    return result;
  };

  return {
    /** Call recordings of a meeting (public /v2 and meetings.recordings). */
    meetingRecordings: {
      list: (ctx: ServiceContext, meetingId: string) => run(ctx, (tx) => recordingOps.list(tx, meetingId)),
      get: (ctx: ServiceContext, meetingId: string, recordingId: string) =>
        run(ctx, (tx) => recordingOps.get(tx, meetingId, recordingId)),
      /** Import (mymeet): stores the transcript, then processing runs (job, or inline right here without jobs). */
      create: async (ctx: ServiceContext, input: CreateCallRecordingInput) => {
        const { recording, created } = await run(ctx, (tx) => recordingOps.create(tx, deps, input));
        if (!created || deps.jobs) return recording;
        await process(ctx.workspaceId, recording.id);
        return run(ctx, async (tx) => {
          const [fresh] = (await recordingOps.list(tx, recording.meetingId)).filter((r) => r.id === recording.id);
          return fresh ?? recording;
        });
      },
      delete: (ctx: ServiceContext, meetingId: string, recordingId: string) =>
        run(ctx, async (tx) => ({ id: (await recordingOps.delete(tx, meetingId, recordingId)).id })),
    },

    calls: {
      /** Calls list: filters, `query`, date groups, favourites strip (I calls §2). */
      list: (ctx: ServiceContext, input: ListCallsInput) => run(ctx, (tx) => callListOps.list(tx, deps, input)),
      /** Call page: meeting, summaries, speakers, insights, the viewer's default template. */
      get: (ctx: ServiceContext, recordingId: string) => run(ctx, (tx) => callListOps.get(tx, recordingId)),
      /** Utterances, speaker blocks, copy text; `range` resolves a `?start=&end=` link. */
      transcript: (ctx: ServiceContext, input: CallTranscriptInput) =>
        run(ctx, async (tx) => {
          const data = callTranscriptInputSchema.parse(input);
          const { row } = await loadCall(tx, data.recordingId);
          return transcriptView(
            { id: row.id, meetingId: row.meeting_id },
            await loadTranscript(tx, row.id),
            data.range,
            data.rangeOnly,
          );
        }),
      /** Speakers tab: merged speakers with talk time, share and utterance ranges. */
      speakers: (ctx: ServiceContext, recordingId: string) =>
        run(ctx, async (tx) => {
          const { row } = await loadCall(tx, recordingId);
          return speakersView(await loadTranscript(tx, row.id));
        }),
      /** Call cards of meetings (activity meeting card, meeting panels). */
      byMeetings: (ctx: ServiceContext, meetingIds: string[]) =>
        run(ctx, (tx) => callListOps.byMeetings(tx, meetingIds)),
      /** Row menu / call menu "Delete recording". */
      delete: (ctx: ServiceContext, recordingId: string) =>
        run(ctx, (tx) => recordingOps.delete(tx, null, recordingId)),
      insights: {
        list: (ctx: ServiceContext, recordingId: string) => run(ctx, (tx) => insightOps.list(tx, recordingId)),
        /** Choose template / Update: queues a generation (inline without jobs) and answers the insight. */
        generate: async (ctx: ServiceContext, input: GenerateCallInsightInput) => {
          const { insight, created } = await run(ctx, (tx) => insightOps.request(tx, deps, input));
          if (!created || deps.jobs) return insight;
          await generate(ctx.workspaceId, 'insight', insight.id);
          return run(
            ctx,
            async (tx) => (await insightOps.list(tx, insight.recordingId)).find((i) => i.id === insight.id) ?? insight,
          );
        },
      },
      settings: {
        get: (ctx: ServiceContext) => run(ctx, (tx) => callSettingsOps.get(tx)),
        update: (ctx: ServiceContext, input: UpdateCallSettingsInput) =>
          run(ctx, (tx) => callSettingsOps.update(tx, input)),
      },
      /** Worker (`calls.process`): processing of one recording; `final` = last attempt. */
      process,
      /** Worker (`calls.generate`): one insight or template preview. */
      generate,
    },

    insightTemplates: {
      list: (ctx: ServiceContext, input?: ListInsightTemplatesInput) =>
        run(ctx, (tx) => templateOps.list(tx, input ?? {})),
      get: (ctx: ServiceContext, templateId: string) => run(ctx, (tx) => templateOps.get(tx, templateId)),
      create: (ctx: ServiceContext, input: CreateInsightTemplateInput) =>
        run(ctx, (tx) => templateOps.create(tx, input)),
      update: (ctx: ServiceContext, input: UpdateInsightTemplateInput) =>
        run(ctx, (tx) => templateOps.update(tx, input)),
      delete: (ctx: ServiceContext, templateId: string) => run(ctx, (tx) => templateOps.delete(tx, templateId)),
      duplicate: (ctx: ServiceContext, input: { templateId: string; newTemplateId: string }) =>
        run(ctx, (tx) => templateOps.duplicate(tx, input)),
      publish: (ctx: ServiceContext, templateId: string) => run(ctx, (tx) => templateOps.publish(tx, templateId)),
      discard: (ctx: ServiceContext, templateId: string) => run(ctx, (tx) => templateOps.discard(tx, templateId)),
      /** Our preset gallery (22 presets across 8 use cases). */
      presets: () => INSIGHT_PRESETS,
      applyPreset: (ctx: ServiceContext, input: { templateId: string; presetId: string }) =>
        run(ctx, (tx) => templateOps.applyPreset(tx, input)),
      /** "Generate preview": the draft against a call (inline generation without jobs). */
      preview: async (ctx: ServiceContext, input: PreviewInsightTemplateInput) => {
        const { preview, created } = await run(ctx, (tx) => insightOps.preview(tx, deps, input));
        if (!created || deps.jobs) return preview;
        await generate(ctx.workspaceId, 'preview', preview.id);
        return run(
          ctx,
          async (tx) =>
            (await templateOps.get(tx, preview.templateId)).previews.find((p) => p.id === preview.id) ?? preview,
        );
      },
      sections: {
        create: (ctx: ServiceContext, input: CreateInsightSectionInput) =>
          run(ctx, (tx) => templateOps.sections.create(tx, input)),
        update: (ctx: ServiceContext, input: UpdateInsightSectionInput) =>
          run(ctx, (tx) => templateOps.sections.update(tx, input)),
        delete: (ctx: ServiceContext, sectionId: string) =>
          run(ctx, (tx) => templateOps.sections.delete(tx, sectionId)),
        duplicate: (ctx: ServiceContext, input: { sectionId: string; newSectionId: string }) =>
          run(ctx, (tx) => templateOps.sections.duplicate(tx, input)),
        move: (ctx: ServiceContext, input: { sectionId: string; direction: 'up' | 'down' }) =>
          run(ctx, (tx) => templateOps.sections.move(tx, input)),
      },
    },
  };
}

export type CallServices = ReturnType<typeof createCallServices>;
