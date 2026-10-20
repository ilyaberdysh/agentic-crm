// Insights on a call (BACKLOG 10.14; I calls §3.6, §11.5) and template previews (§4.2): choosing a published template
// creates an insight from its active snapshot (status queued → executing → completed | failed); "Update" creates a
// new one from the latest snapshot; a preview renders the editor's draft against a call. Generation runs outside the
// write transactions (LLM) in a job, or inline when the process has no job queue. Each generation is workspace spend
// in the credits ledger (ai/credits), attributed to the member who asked (none for default templates applied by
// processing); its credits are stored on the insight / preview.
import type {
  CallInsight,
  CallJobStatus,
  GenerateCallInsightInput,
  InsightSectionResult,
  InsightTemplatePreview,
  PreviewInsightTemplateInput,
} from '@agentic-crm/contracts';
import { generateCallInsightInputSchema, previewInsightTemplateInputSchema } from '@agentic-crm/contracts';
import type { Database } from '@agentic-crm/db';
import { creditOps } from '../ai/credits/ledger.ts';
import { type LlmUsage, notConfigured, workspaceModelFor } from '../ai/llm.ts';
import { toActor } from '../collab/common.ts';
import { actingMemberId, systemContext } from '../context.ts';
import { conflict, DomainError } from '../errors.ts';
import { newId } from '../ids.ts';
import { JOB_NAMES } from '../jobs/queue.ts';
import { runInWorkspace, type Tx } from '../tx.ts';
import { type CallsDeps, loadCall, type RecordingRow } from './common.ts';
import { CALL_CREDIT_SOURCES, CALL_PURPOSES } from './llm.ts';
import { type CallContext, insightsRequest, parseInsights, type SectionSpec } from './prompts.ts';
import { loadTranscript } from './read.ts';
import {
  activeSnapshotOf,
  assertComplete,
  loadTemplate,
  previewViews,
  snapshotSections,
  templateNotFound,
} from './templates.ts';

export type GenerationKind = 'insight' | 'preview';

type InsightRow = {
  id: string;
  recording_id: string;
  template_id: string;
  snapshot_id: string;
  status: CallJobStatus;
  sections: unknown;
  error: string | null;
  credit_cost: number;
  created_by: unknown;
  created_at: string;
  completed_at: string | null;
};

export async function insightViews(tx: Tx, rows: InsightRow[]): Promise<CallInsight[]> {
  if (rows.length === 0) return [];
  const recordings = await tx.db
    .selectFrom('call_recordings')
    .select(['id', 'meeting_id'])
    .where(
      'id',
      'in',
      rows.map((r) => r.recording_id),
    )
    .execute();
  const meetingOf = new Map(recordings.map((r) => [r.id, r.meeting_id]));
  const actives = await tx.db
    .selectFrom('insight_template_snapshots')
    .select(['template_id', 'id'])
    .where(
      'template_id',
      'in',
      rows.map((r) => r.template_id),
    )
    .where('status', '=', 'active')
    .execute();
  const activeOf = new Map(actives.map((a) => [a.template_id, a.id]));
  return rows.map((r) => {
    const terminal = r.status === 'completed' || r.status === 'failed';
    const active = activeOf.get(r.template_id);
    return {
      id: r.id,
      recordingId: r.recording_id,
      meetingId: meetingOf.get(r.recording_id) ?? r.recording_id,
      templateId: r.template_id,
      snapshotId: r.snapshot_id,
      status: r.status,
      sections: (r.sections ?? []) as InsightSectionResult[],
      error: r.error,
      creditCost: r.credit_cost,
      isOutdated: terminal && active !== undefined && active !== r.snapshot_id,
      createdBy: toActor(r.created_by),
      createdAt: r.created_at,
      completedAt: r.completed_at,
    };
  });
}

export async function insightsOf(tx: Tx, recordingIds: string[]): Promise<CallInsight[]> {
  if (recordingIds.length === 0) return [];
  const rows = await tx.db
    .selectFrom('call_insights')
    .selectAll()
    .where('recording_id', 'in', recordingIds)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  return insightViews(tx, rows as InsightRow[]);
}

function emitInsight(tx: Tx, recording: { id: string; meeting_id: string }, insightId: string, templateId: string) {
  tx.emit('call-insight-list', recording.id, { meetingId: recording.meeting_id, insightIds: [insightId] });
  // Statistics (total insights → "can delete") of the template.
  tx.emit('insight-template', templateId, { templateId });
}

async function enqueue(tx: Tx, deps: CallsDeps, kind: GenerationKind, id: string): Promise<void> {
  if (!deps.jobs) return;
  await deps.jobs.send(tx, JOB_NAMES.callGenerate, { workspaceId: tx.workspaceId, kind, id }, { singletonKey: id });
}

/**
 * Inserts a queued insight of the template's active snapshot (no checks beyond the template's state); returns its id.
 * Used by `request` and by processing (default templates).
 */
async function insertInsight(
  tx: Tx,
  deps: CallsDeps,
  recording: RecordingRow,
  templateId: string,
  insightId: string,
  payerMemberId: string | null,
): Promise<string> {
  const { snapshotId } = await activeSnapshotOf(tx, templateId);
  await tx.db
    .insertInto('call_insights')
    .values({
      id: insightId,
      workspace_id: tx.workspaceId,
      recording_id: recording.id,
      template_id: templateId,
      snapshot_id: snapshotId,
      status: 'queued',
      requested_by_member_id: payerMemberId,
      created_by: JSON.stringify(tx.ctx.actor),
    })
    .execute();
  await enqueue(tx, deps, 'insight', insightId);
  emitInsight(tx, recording, insightId, templateId);
  return insightId;
}

export const insightOps = {
  /**
   * Choose template / Update (I calls §3.6): a new insight from the template's latest published version. Idempotent by
   * the client-minted id. Checks the AI configuration and the credit budget before queueing.
   */
  async request(
    tx: Tx,
    deps: CallsDeps,
    input: GenerateCallInsightInput,
  ): Promise<{ insight: CallInsight; created: boolean }> {
    const data = generateCallInsightInputSchema.parse(input);
    const insightId = data.insightId ?? newId();
    const { row } = await loadCall(tx, data.recordingId);
    const existing = await tx.db.selectFrom('call_insights').selectAll().where('id', '=', insightId).executeTakeFirst();
    if (existing) {
      if (existing.recording_id !== row.id || existing.template_id !== data.templateId) {
        throw conflict('ID_CONFLICT', 'An insight with this id already exists', {
          call_recording_insight_id: insightId,
        });
      }
      return { insight: (await insightViews(tx, [existing as InsightRow]))[0] as CallInsight, created: false };
    }
    if (!deps.llm.configured) throw notConfigured();
    const payer = actingMemberId(tx.ctx);
    await creditOps.assertAvailable(tx, { memberId: payer, spend: 'workspace' });
    await insertInsight(tx, deps, row, data.templateId, insightId, payer);
    const created = await tx.db
      .selectFrom('call_insights')
      .selectAll()
      .where('id', '=', insightId)
      .executeTakeFirstOrThrow();
    return { insight: (await insightViews(tx, [created as InsightRow]))[0] as CallInsight, created: true };
  },

  async list(tx: Tx, recordingId: string): Promise<CallInsight[]> {
    const { row } = await loadCall(tx, recordingId);
    return insightsOf(tx, [row.id]);
  },

  /** "Generate preview": the draft against a call (idempotent by the client-minted preview id). */
  async preview(
    tx: Tx,
    deps: CallsDeps,
    input: PreviewInsightTemplateInput,
  ): Promise<{ preview: InsightTemplatePreview; created: boolean }> {
    const data = previewInsightTemplateInputSchema.parse(input);
    const template = await loadTemplate(tx, data.templateId);
    const existing = await tx.db
      .selectFrom('insight_template_previews')
      .selectAll()
      .where('id', '=', data.previewId)
      .executeTakeFirst();
    if (existing) {
      if (existing.template_id !== template.id || existing.recording_id !== data.recordingId) {
        throw conflict('ID_CONFLICT', 'A preview with this id already exists');
      }
      return { preview: (await previewViews(tx, [existing]))[0] as InsightTemplatePreview, created: false };
    }
    const { row: recording } = await loadCall(tx, data.recordingId);
    const draft = await tx.db
      .selectFrom('insight_template_snapshots')
      .select(['id', 'last_touched_at'])
      .where('template_id', '=', template.id)
      .where('status', '=', 'draft')
      .executeTakeFirst();
    if (!draft) throw templateNotFound(template.id);
    await assertComplete(tx, draft.id, 'preview');
    if (!deps.llm.configured) throw notConfigured();
    const payer = actingMemberId(tx.ctx);
    await creditOps.assertAvailable(tx, { memberId: payer, spend: 'workspace' });
    const created = await tx.db
      .insertInto('insight_template_previews')
      .values({
        id: data.previewId,
        workspace_id: tx.workspaceId,
        template_id: template.id,
        snapshot_id: draft.id,
        recording_id: recording.id,
        status: 'queued',
        draft_touched_at: draft.last_touched_at,
        requested_by_member_id: payer,
        created_by: JSON.stringify(tx.ctx.actor),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await enqueue(tx, deps, 'preview', created.id);
    tx.emit('insight-template', template.id, { templateId: template.id, previewIds: [created.id] });
    return { preview: (await previewViews(tx, [created]))[0] as InsightTemplatePreview, created: true };
  },
};

/**
 * Default templates (I calls §4.4, §5.1): when a call completes, every member taking part whose default template is
 * published gets an insight of it (one per template), paid by the workspace. Returns the queued insight ids.
 */
export async function applyDefaultTemplates(tx: Tx, deps: CallsDeps, recording: RecordingRow): Promise<string[]> {
  if (!deps.llm.configured) return [];
  const templates = await tx.db
    .selectFrom('meeting_participants as p')
    .innerJoin('member_call_settings as s', 's.member_id', 'p.member_id')
    .innerJoin('insight_templates as t', 't.id', 's.default_insight_template_id')
    .select('t.id')
    .distinct()
    .where('p.meeting_id', '=', recording.meeting_id)
    .where('t.deleted_at', 'is', null)
    .where('t.status', '=', 'enabled')
    .where('t.archived_at', 'is', null)
    .execute();
  const ids: string[] = [];
  for (const { id: templateId } of templates) {
    const already = await tx.db
      .selectFrom('call_insights')
      .select('id')
      .where('recording_id', '=', recording.id)
      .where('template_id', '=', templateId)
      .executeTakeFirst();
    if (already) continue;
    try {
      await creditOps.assertAvailable(tx, { memberId: null, spend: 'workspace' });
    } catch {
      break;
    }
    ids.push(await insertInsight(tx, deps, recording, templateId, newId(), null));
  }
  return ids;
}

async function callContextFor(tx: Tx, recording: RecordingRow): Promise<{ context: CallContext; empty: boolean }> {
  const loaded = await loadTranscript(tx, recording.id);
  return {
    context: await callContext(tx, recording, loaded.text, loaded.speakers),
    empty: loaded.utterances.length === 0,
  };
}

/** Prompt context of a call: meeting title / time and participant names (members by name, X-28). */
export async function callContext(
  tx: Tx,
  recording: RecordingRow,
  transcript: string,
  speakers: { name: string }[],
): Promise<CallContext> {
  const meeting = await tx.db
    .selectFrom('meetings')
    .select(['title', 'start_at', 'end_at'])
    .where('id', '=', recording.meeting_id)
    .executeTakeFirst();
  const participants = await tx.db
    .selectFrom('meeting_participants as p')
    .leftJoin('workspace_members as m', 'm.id', 'p.member_id')
    .select(['p.name', 'p.email_address', 'm.first_name', 'm.last_name'])
    .where('p.meeting_id', '=', recording.meeting_id)
    .orderBy('p.position')
    .execute();
  const names = participants.map(
    (p) => `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.name || p.email_address || 'Unknown',
  );
  for (const s of speakers) if (!names.includes(s.name)) names.push(s.name);
  const length =
    meeting && Date.parse(meeting.end_at) > Date.parse(meeting.start_at)
      ? (Date.parse(meeting.end_at) - Date.parse(meeting.start_at)) / 1000
      : recording.duration_seconds;
  return {
    title: meeting?.title ?? '',
    startAt: meeting?.start_at ?? recording.created_at,
    durationSeconds: Number(length),
    participants: names,
    transcript,
  };
}

const TABLE = { insight: 'call_insights', preview: 'insight_template_previews' } as const;

/**
 * Runs one generation (worker job `calls.generate`, or inline). `final` = the last attempt: provider errors then
 * fail the insight instead of being retried. Returns the resulting status (null when there was nothing to do).
 */
export async function runGeneration(
  database: Database,
  deps: CallsDeps,
  workspaceId: string,
  kind: GenerationKind,
  id: string,
  options: { final: boolean; signal?: AbortSignal },
): Promise<CallJobStatus | null> {
  const ctx = systemContext(workspaceId, kind === 'insight' ? 'call-insights' : 'insight-template-preview');
  const table = TABLE[kind];
  type Claim = {
    recording: RecordingRow;
    templateId: string;
    sections: SectionSpec[];
    context: CallContext;
    payer: string | null;
    model: string;
  };
  const finish = (
    status: 'completed' | 'failed',
    values: {
      sections?: InsightSectionResult[];
      error?: string | null;
      usage?: LlmUsage | null;
    },
  ) =>
    runInWorkspace(database, ctx, async (tx) => {
      const row = await tx.db.selectFrom(table).selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!row || (row.status !== 'queued' && row.status !== 'executing')) return null;
      await tx.db
        .updateTable(table)
        .set({
          status,
          sections: JSON.stringify(values.sections ?? []),
          error: values.error ?? null,
          completed_at: tx.now,
          ...(kind === 'insight' && values.usage
            ? { input_tokens: values.usage.inputTokens, output_tokens: values.usage.outputTokens }
            : {}),
        } as never)
        .where('id', '=', id)
        .execute();
      if (values.usage) {
        const charged = await creditOps.charge(tx, {
          source: kind === 'insight' ? CALL_CREDIT_SOURCES.insight : CALL_CREDIT_SOURCES.preview,
          memberId: row.requested_by_member_id,
          spend: 'workspace',
          usage: values.usage,
          ref: { type: kind === 'insight' ? 'call-recording-insight' : 'insight-template-preview', id },
        });
        await tx.db
          .updateTable(table)
          .set({ credit_cost: charged.credits } as never)
          .where('id', '=', id)
          .execute();
      }
      const recording = await tx.db
        .selectFrom('call_recordings')
        .select(['id', 'meeting_id'])
        .where('id', '=', row.recording_id)
        .executeTakeFirstOrThrow();
      if (kind === 'insight') emitInsight(tx, recording, id, row.template_id);
      else tx.emit('insight-template', row.template_id, { templateId: row.template_id, previewIds: [id] });
      return status;
    });

  const claim = await runInWorkspace(database, ctx, async (tx): Promise<Claim | 'gone' | null> => {
    const row = await tx.db.selectFrom(table).selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!row || (row.status !== 'queued' && row.status !== 'executing')) return null;
    const recording = await tx.db
      .selectFrom('call_recordings')
      .selectAll()
      .where('id', '=', row.recording_id)
      .executeTakeFirst();
    if (!recording || recording.deleted_at) return 'gone';
    const sections = ((await snapshotSections(tx, [row.snapshot_id])).get(row.snapshot_id) ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      type: s.type,
      prompt: s.prompt,
    }));
    const { context } = await callContextFor(tx, recording as RecordingRow);
    const model = await workspaceModelFor(tx, kind === 'insight' ? CALL_PURPOSES.insights : CALL_PURPOSES.preview);
    await tx.db
      .updateTable(table)
      .set({ status: 'executing' } as never)
      .where('id', '=', id)
      .execute();
    if (kind === 'insight') emitInsight(tx, recording, id, row.template_id);
    else tx.emit('insight-template', row.template_id, { templateId: row.template_id, previewIds: [id] });
    return {
      recording: recording as RecordingRow,
      templateId: row.template_id,
      sections,
      context,
      payer: row.requested_by_member_id,
      model,
    };
  });
  if (claim === null) return null;
  if (claim === 'gone') return finish('failed', { error: 'The call recording was deleted' });
  if (claim.sections.length === 0) return finish('completed', { sections: [] });
  if (!deps.llm.configured) return finish('failed', { error: 'AI_NOT_CONFIGURED' });
  const request = insightsRequest(claim.context, claim.sections, kind, claim.model);
  let answer: Awaited<ReturnType<CallsDeps['llm']['complete']>>;
  try {
    answer = await deps.llm.complete({ ...request, ...(options.signal ? { signal: options.signal } : {}) });
  } catch (err) {
    if (!options.final && !(err instanceof DomainError && err.code === 'AI_NOT_CONFIGURED')) throw err;
    return finish('failed', { error: failureLabel(err) });
  }
  if (answer.refused) return finish('failed', { error: 'AI_REFUSED', usage: answer.usage });
  const sections = parseInsights(answer.json, claim.sections);
  if (!sections) {
    if (!options.final) throw new Error('The model answer could not be parsed');
    return finish('failed', { error: 'The model answer could not be read', usage: answer.usage });
  }
  return finish('completed', { sections, usage: answer.usage });
}

/** How a failed AI step is recorded: the domain code (and message) or `LLM_ERROR: <message>`. */
export function failureLabel(err: unknown): string {
  if (err instanceof DomainError) return err.code === 'AI_NOT_CONFIGURED' ? err.code : `${err.code}: ${err.message}`;
  return `LLM_ERROR: ${String((err as Error)?.message ?? err).slice(0, 500)}`;
}

export { templateNotFound };
