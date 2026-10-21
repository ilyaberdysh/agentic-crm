// Call processing (BACKLOG 10.10; I calls §6.2, §11.2; slice10-contracts "mymeet import path"): after an import the
// `calls.process` job (or the inline fallback) maps speakers to participants by email, writes the long and concise
// summaries (one bulk LLM call), sets the call `completed`, fires `call-recording.created` (webhooks and the workflow
// trigger) and invalidates the Calls list and the records' Calls tabs. Summary failures do not fail the call: the
// transcript is complete, the summaries read "This call recording has no summary" and the event still fires
// ("transcript and summary are available, or have permanently failed").
import type { CallJobStatus } from '@agentic-crm/contracts';
import type { Database } from '@agentic-crm/db';
import { creditOps } from '../ai/credits/ledger.ts';
import { type LlmUsage, workspaceModelFor } from '../ai/llm.ts';
import { systemContext } from '../context.ts';
import { DomainError } from '../errors.ts';
import { runInWorkspace, type Tx } from '../tx.ts';
import { type CallsDeps, emitCallsChanged, type RecordingRow } from './common.ts';
import { applyDefaultTemplates, callContext, failureLabel } from './insights.ts';
import { CALL_CREDIT_SOURCES, CALL_PURPOSES } from './llm.ts';
import { type CallContext, parseSummaries, summariesRequest } from './prompts.ts';
import { loadTranscript } from './read.ts';
import { mapSpeakers } from './speakers.ts';

export interface ProcessResult {
  /** null = nothing to do (unknown, deleted or already processed). */
  status: 'completed' | null;
  summaryStatus: CallJobStatus | null;
  /** Insights queued for the participants' default templates. */
  insightIds: string[];
}

/** `call-recording.created` (webhooks catalogue): ids + the actor that created the recording (the importer). */
function recordingCreatedEvent(tx: Tx, row: RecordingRow): void {
  tx.event({
    event_type: 'call-recording.created',
    id: { meeting_id: row.meeting_id, call_recording_id: row.id },
    actor: row.created_by,
  });
}

export async function processRecording(
  database: Database,
  deps: CallsDeps,
  workspaceId: string,
  recordingId: string,
  options: { final: boolean; signal?: AbortSignal },
): Promise<ProcessResult> {
  const ctx = systemContext(workspaceId, 'call-processing');
  const none: ProcessResult = { status: null, summaryStatus: null, insightIds: [] };

  const claim = await runInWorkspace(
    database,
    ctx,
    async (
      tx,
    ): Promise<{
      row: RecordingRow;
      context: CallContext;
      empty: boolean;
      model: string;
      credits: string | null;
    } | null> => {
      const row = await tx.db
        .selectFrom('call_recordings')
        .selectAll()
        .where('id', '=', recordingId)
        .forUpdate()
        .executeTakeFirst();
      if (!row || row.deleted_at || row.status !== 'processing') return null;
      await mapSpeakers(tx, [row.id]);
      await tx.db
        .updateTable('call_recordings')
        .set({ summary_status: 'executing', concise_summary_status: 'executing', updated_at: tx.now })
        .where('id', '=', row.id)
        .execute();
      await emitCallsChanged(tx, [{ id: row.id, meetingId: row.meeting_id }], { list: false });
      const loaded = await loadTranscript(tx, row.id);
      // Summaries are workspace spend (ai/credits): a spent pool fails them, the call still completes.
      let credits: string | null = null;
      try {
        await creditOps.assertAvailable(tx, { memberId: null, spend: 'workspace' });
      } catch (err) {
        if (!(err instanceof DomainError) || err.code !== 'CREDITS_EXHAUSTED') throw err;
        credits = 'CREDITS_EXHAUSTED';
      }
      return {
        row: row as RecordingRow,
        context: await callContext(tx, row as RecordingRow, loaded.text, loaded.speakers),
        empty: loaded.utterances.length === 0,
        model: await workspaceModelFor(tx, CALL_PURPOSES.summaries),
        credits,
      };
    },
  );
  if (!claim) return none;

  type Outcome = {
    summary: string | null;
    concise: string | null;
    status: CallJobStatus;
    error: string | null;
    usage: LlmUsage | null;
  };
  const failed = (error: string, usage: LlmUsage | null = null): Outcome => ({
    summary: null,
    concise: null,
    status: 'failed',
    error,
    usage,
  });
  let outcome: Outcome;
  if (claim.empty) {
    // Nothing to summarise when a recording has no transcript.
    outcome = { summary: null, concise: null, status: 'completed', error: null, usage: null };
  } else if (!deps.llm.configured) {
    outcome = failed('AI_NOT_CONFIGURED');
  } else if (claim.credits) {
    outcome = failed(claim.credits);
  } else {
    try {
      const request = summariesRequest(claim.context, claim.model);
      const answer = await deps.llm.complete({ ...request, ...(options.signal ? { signal: options.signal } : {}) });
      const parsed = answer.refused ? null : parseSummaries(answer.json);
      if (answer.refused) outcome = failed('AI_REFUSED', answer.usage);
      else if (!parsed) throw new Error('The model answer had no summary');
      else outcome = { ...parsed, status: 'completed', error: null, usage: answer.usage };
    } catch (err) {
      const notConfigured = err instanceof DomainError && err.code === 'AI_NOT_CONFIGURED';
      if (!options.final && !notConfigured) throw err; // the job retries; the call stays `processing`
      outcome = failed(failureLabel(err));
    }
  }

  return runInWorkspace(database, ctx, async (tx): Promise<ProcessResult> => {
    const row = await tx.db
      .selectFrom('call_recordings')
      .selectAll()
      .where('id', '=', recordingId)
      .forUpdate()
      .executeTakeFirst();
    if (!row || row.deleted_at || row.status !== 'processing') return none;
    const updated = (await tx.db
      .updateTable('call_recordings')
      .set({
        status: 'completed',
        summary: outcome.summary,
        summary_status: outcome.status,
        concise_summary: outcome.concise,
        concise_summary_status: outcome.status,
        processing_error: outcome.error,
        processed_at: tx.now,
        updated_at: tx.now,
      })
      .where('id', '=', row.id)
      .returningAll()
      .executeTakeFirstOrThrow()) as RecordingRow;
    if (outcome.usage) {
      await creditOps.charge(tx, {
        source: CALL_CREDIT_SOURCES.summaries,
        memberId: null,
        spend: 'workspace',
        usage: outcome.usage,
        ref: { type: 'call-recording', id: row.id },
      });
    }
    await emitCallsChanged(tx, [{ id: row.id, meetingId: row.meeting_id }]);
    recordingCreatedEvent(tx, updated);
    const insightIds = await applyDefaultTemplates(tx, deps, updated);
    return { status: 'completed', summaryStatus: outcome.status, insightIds };
  });
}
