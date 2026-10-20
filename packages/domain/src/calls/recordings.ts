// Call recordings write path (BACKLOG 10.09; I calls §6.1, §6.5, §11.1–11.2, §11.7): the mymeet import creates a
// transcript-only recording on a meeting with up to 4,000 segments (speaker name + email + times). One transaction
// stores the recording (status `processing`), its speakers (mapped to participants by email), the utterances and the
// search text, enqueues the processing job and invalidates the Calls list and the records' Calls tabs (X-27).
// Reads for the public API (/v2 get, list, transcript) and delete live here too.
import { createHash } from 'node:crypto';
import {
  type CallRecording,
  type CallTranscript,
  type CreateCallRecordingInput,
  createCallRecordingInputSchema,
  type TranscriptSegment,
} from '@agentic-crm/contracts';
import { toActor } from '../collab/common.ts';
import { badRequest, conflict } from '../errors.ts';
import { newId } from '../ids.ts';
import { JOB_NAMES } from '../jobs/queue.ts';
import { loadMeeting, rawTranscript } from '../meetings/service.ts';
import type { Tx } from '../tx.ts';
import { type CallsDeps, callNotFound, emitCallsChanged, loadCall, type RecordingRow } from './common.ts';
import { mapSpeakers, speakerEmail, speakerKey } from './speakers.ts';

/** Segments per insert statement (10 parameters each, well under Postgres' 65,535). */
const INSERT_CHUNK = 1000;

export function toRecording(r: RecordingRow): CallRecording {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    meetingId: r.meeting_id,
    status: r.status,
    videoUrl: r.video_url,
    createdBy: toActor(r.created_by),
    createdAt: r.created_at,
  };
}

/** sha256 of the transcript as imported (a retried import of the same transcript is a replay). */
export function transcriptHash(transcript: { speech: string; startTime: number; endTime: number; speaker: unknown }[]) {
  return createHash('sha256')
    .update(JSON.stringify(transcript.map((s) => [s.speech, s.startTime, s.endTime, s.speaker])))
    .digest('hex');
}

export async function enqueueProcessing(tx: Tx, deps: CallsDeps, recordingId: string): Promise<void> {
  if (!deps.jobs) return;
  await deps.jobs.send(
    tx,
    JOB_NAMES.callProcess,
    { workspaceId: tx.workspaceId, recordingId },
    { singletonKey: recordingId },
  );
}

export const recordingOps = {
  /**
   * Creates a recording (idempotent by id; a second import of the identical transcript into the same meeting answers
   * the first recording). `created` tells the caller whether processing must run.
   */
  async create(
    tx: Tx,
    deps: CallsDeps,
    input: CreateCallRecordingInput,
  ): Promise<{ recording: CallRecording; created: boolean }> {
    const data = createCallRecordingInputSchema.parse(input);
    const meeting = await loadMeeting(tx, data.meetingId);
    const existing = await tx.db.selectFrom('call_recordings').selectAll().where('id', '=', data.id).executeTakeFirst();
    if (existing) {
      if (existing.meeting_id !== meeting.id || existing.deleted_at) {
        throw conflict('ID_CONFLICT', 'A recording with this id already exists', { call_recording_id: data.id });
      }
      return { recording: toRecording(existing as RecordingRow), created: false };
    }
    for (const [i, seg] of data.transcript.entries()) {
      if (seg.endTime < seg.startTime) {
        throw badRequest('VALIDATION_ERROR', 'A transcript segment must end after it starts', {
          field: `transcript.${i}`,
        });
      }
    }
    const hash = data.transcript.length > 0 ? transcriptHash(data.transcript) : null;
    if (hash) {
      const replay = await tx.db
        .selectFrom('call_recordings')
        .selectAll()
        .where('meeting_id', '=', meeting.id)
        .where('transcript_hash', '=', hash)
        .where('deleted_at', 'is', null)
        .orderBy('created_at')
        .executeTakeFirst();
      if (replay) return { recording: toRecording(replay as RecordingRow), created: false };
    }
    const row = await tx.db
      .insertInto('call_recordings')
      .values({
        id: data.id,
        workspace_id: tx.workspaceId,
        meeting_id: meeting.id,
        // Processing (speakers, summaries) completes it; the webhook fires then (I calls §6.5).
        status: 'processing',
        video_url: data.videoUrl ?? null,
        summary_status: 'queued',
        concise_summary_status: 'queued',
        transcript_text: data.transcript.map((s) => s.speech).join('\n'),
        transcript_hash: hash,
        segment_count: data.transcript.length,
        duration_seconds: data.transcript.reduce((m, s) => Math.max(m, s.endTime), 0),
        created_by: JSON.stringify(tx.ctx.actor),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Speakers: one per address, else per name, in order of first appearance.
    const speakerIds = new Map<string, string>();
    const speakers: { id: string; name: string; email: string | null; position: number }[] = [];
    const segments = data.transcript.map((seg, position) => {
      const email = speakerEmail(seg.speaker.emailAddress);
      const key = speakerKey(seg.speaker.name, email);
      let speakerId = speakerIds.get(key);
      if (!speakerId) {
        speakerId = newId();
        speakerIds.set(key, speakerId);
        speakers.push({ id: speakerId, name: seg.speaker.name.trim(), email, position: speakers.length });
      }
      return {
        recording_id: row.id,
        workspace_id: tx.workspaceId,
        position,
        speech: seg.speech,
        start_time: seg.startTime,
        end_time: seg.endTime,
        speaker_name: seg.speaker.name,
        speaker_email: email,
        participant_id: null,
        speaker_id: speakerId,
      };
    });
    if (speakers.length > 0) {
      await tx.db
        .insertInto('call_speakers')
        .values(
          speakers.map((s) => ({
            id: s.id,
            workspace_id: tx.workspaceId,
            recording_id: row.id,
            position: s.position,
            name: s.name,
            email_address: s.email,
          })),
        )
        .execute();
    }
    for (let i = 0; i < segments.length; i += INSERT_CHUNK) {
      await tx.db
        .insertInto('call_transcript_segments')
        .values(segments.slice(i, i + INSERT_CHUNK))
        .execute();
    }
    await mapSpeakers(tx, [row.id]);
    await enqueueProcessing(tx, deps, row.id);
    await emitCallsChanged(tx, [{ id: row.id, meetingId: meeting.id }], { meeting: true });
    return { recording: toRecording(row as RecordingRow), created: true };
  },

  async list(tx: Tx, meetingId: string): Promise<CallRecording[]> {
    const meeting = await loadMeeting(tx, meetingId);
    const rows = await tx.db
      .selectFrom('call_recordings')
      .selectAll()
      .where('meeting_id', '=', meeting.id)
      .where('deleted_at', 'is', null)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows.map((r) => toRecording(r as RecordingRow));
  },

  /** A recording with its transcript as imported (public API shape: segments in import order). */
  async get(tx: Tx, meetingId: string, recordingId: string): Promise<CallRecording & { transcript: CallTranscript }> {
    const meeting = await loadMeeting(tx, meetingId);
    const row = await tx.db
      .selectFrom('call_recordings')
      .selectAll()
      .where('id', '=', recordingId)
      .where('meeting_id', '=', meeting.id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) throw callNotFound(recordingId);
    const segments = await tx.db
      .selectFrom('call_transcript_segments')
      .selectAll()
      .where('recording_id', '=', row.id)
      .orderBy('position')
      .execute();
    const view: TranscriptSegment[] = segments.map((s) => ({
      speech: s.speech,
      startTime: Number(s.start_time),
      endTime: Number(s.end_time),
      speaker: { name: s.speaker_name, emailAddress: s.speaker_email, participantId: s.participant_id },
    }));
    return { ...toRecording(row as RecordingRow), transcript: { segments: view, rawTranscript: rawTranscript(view) } };
  },

  async delete(tx: Tx, meetingId: string | null, recordingId: string): Promise<{ id: string; meetingId: string }> {
    const { row } = await loadCall(tx, recordingId, { content: false });
    if (meetingId !== null) {
      const meeting = await loadMeeting(tx, meetingId);
      if (row.meeting_id !== meeting.id) throw callNotFound(recordingId);
    }
    await tx.db
      .updateTable('call_recordings')
      .set({ deleted_at: tx.now, deleted_by: JSON.stringify(tx.ctx.actor), updated_at: tx.now })
      .where('id', '=', row.id)
      .execute();
    await emitCallsChanged(tx, [{ id: row.id, meetingId: row.meeting_id }], { meeting: true });
    return { id: row.id, meetingId: row.meeting_id };
  },
};
