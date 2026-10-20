// Shared pieces of the calls services: wiring dependencies, call loading with the meeting's access, the records a
// call belongs to, and the invalidations every call write emits (X-27: the Calls list and the record Calls tabs
// update live).
import type { EmailAccess, RecordRef } from '@agentic-crm/contracts';
import type { CallRecordingsTable, Selectable } from '@agentic-crm/db';
import type { LlmClient } from '../ai/llm.ts';
import { meetingAccess } from '../email/access.ts';
import { notFound } from '../errors.ts';
import type { JobQueue } from '../jobs/queue.ts';
import type { Policies } from '../permissions.ts';
import { loadDefinition } from '../schema/model.ts';
import type { Tx } from '../tx.ts';

export interface CallsDeps {
  policies: Policies;
  /** Background jobs; without them processing and generation run inline after the write commits. */
  jobs: JobQueue | undefined;
  /** The AI layer's LLM client (ai/llm.ts); credits go through the ledger (ai/credits). */
  llm: LlmClient;
}

export type RecordingRow = Selectable<CallRecordingsTable>;

export const callNotFound = (recordingId: string) =>
  notFound('Call recording not found', { call_recording_id: recordingId });

/**
 * A live recording the viewer may see (its meeting is visible). `content` additionally requires full access to the
 * meeting (transcript, summaries, insights); below it the call reads as not found.
 */
export async function loadCall(
  tx: Tx,
  recordingId: string,
  options: { content?: boolean; lock?: boolean } = {},
): Promise<{ row: RecordingRow; access: EmailAccess }> {
  let query = tx.db
    .selectFrom('call_recordings')
    .selectAll()
    .where('id', '=', recordingId)
    .where('deleted_at', 'is', null);
  if (options.lock) query = query.forUpdate();
  const row = await query.executeTakeFirst();
  if (!row) throw callNotFound(recordingId);
  const access = (await meetingAccess(tx, [row.meeting_id])).get(row.meeting_id)?.access ?? 'none';
  if (access === 'none' || (options.content !== false && access !== 'full-access')) throw callNotFound(recordingId);
  return { row: row as RecordingRow, access };
}

/** The records of meetings: linked records plus the participants' people and companies. */
export async function meetingRecordRefs(tx: Tx, meetingIds: string[]): Promise<Map<string, RecordRef[]>> {
  const out = new Map<string, RecordRef[]>(meetingIds.map((id) => [id, []]));
  if (meetingIds.length === 0) return out;
  const seen = new Set<string>();
  const add = (meetingId: string, ref: RecordRef) => {
    const key = `${meetingId}:${ref.entityInstanceId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.get(meetingId)?.push(ref);
  };
  const linked = await tx.db
    .selectFrom('meeting_records')
    .select(['meeting_id', 'entity_definition_id', 'entity_instance_id'])
    .where('meeting_id', 'in', meetingIds)
    .orderBy('meeting_id')
    .orderBy('position')
    .execute();
  for (const r of linked) {
    add(r.meeting_id, { entityDefinitionId: r.entity_definition_id, entityInstanceId: r.entity_instance_id });
  }
  const participants = await tx.db
    .selectFrom('meeting_participants')
    .select(['meeting_id', 'person_id', 'company_id'])
    .where('meeting_id', 'in', meetingIds)
    .where((eb) => eb.or([eb('person_id', 'is not', null), eb('company_id', 'is not', null)]))
    .execute();
  if (participants.length > 0) {
    const people = (await loadDefinition(tx, 'people')).id;
    const companies = (await loadDefinition(tx, 'companies')).id;
    for (const p of participants) {
      if (p.person_id) add(p.meeting_id, { entityDefinitionId: people, entityInstanceId: p.person_id });
      if (p.company_id) add(p.meeting_id, { entityDefinitionId: companies, entityInstanceId: p.company_id });
    }
  }
  return out;
}

/**
 * Invalidations of call writes: the call itself, the meeting's recordings, the Calls list and the Calls tab of every
 * record of the meeting (scope.entityInstanceIds); `meeting` when the set of recordings changed.
 */
export async function emitCallsChanged(
  tx: Tx,
  calls: { id: string; meetingId: string }[],
  options: { list?: boolean; meeting?: boolean } = {},
): Promise<void> {
  if (calls.length === 0) return;
  const meetingIds = [...new Set(calls.map((c) => c.meetingId))];
  const records = options.list === false ? new Map<string, RecordRef[]>() : await meetingRecordRefs(tx, meetingIds);
  for (const c of calls) tx.emit('call-recording', c.id, { meetingId: c.meetingId });
  if (options.list === false) return;
  for (const meetingId of meetingIds) {
    tx.emit('call-recording-list', meetingId, {
      meetingId,
      recordingIds: calls.filter((c) => c.meetingId === meetingId).map((c) => c.id),
      entityInstanceIds: (records.get(meetingId) ?? []).map((r) => r.entityInstanceId),
    });
    if (options.meeting) tx.emit('meeting', meetingId, { meetingId });
  }
}

/**
 * A meeting changed in a way its calls show (title, time, participants, linked records, deletion): the calls and the
 * Calls list / record Calls tabs of the records before (`before`) and after the change. No-op without recordings.
 */
export async function emitMeetingCallsChanged(tx: Tx, meetingId: string, before: RecordRef[]): Promise<void> {
  const rows = await tx.db
    .selectFrom('call_recordings')
    .select('id')
    .where('meeting_id', '=', meetingId)
    .where('deleted_at', 'is', null)
    .execute();
  if (rows.length === 0) return;
  const after = (await meetingRecordRefs(tx, [meetingId])).get(meetingId) ?? [];
  for (const r of rows) tx.emit('call-recording', r.id, { meetingId });
  tx.emit('call-recording-list', meetingId, {
    meetingId,
    recordingIds: rows.map((r) => r.id),
    entityInstanceIds: [...new Set([...before, ...after].map((r) => r.entityInstanceId))],
  });
}
