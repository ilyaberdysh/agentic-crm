// Meetings (BACKLOG 7.04; F README §2.4–2.5, §6; I calls §11): read, list, create ("New meeting" dialog, public API),
// update (manual / API meetings fully; synced meetings only their linked records), delete. Transcript-only call
// recordings (D-20) live in calls/ (slice 10); `rawTranscript` / `speakerLabel` stay here for the public API.
// Participants are matched to members / people / companies by address with record auto-creation (unless the
// workspace creates no records); linked records are the explicitly chosen ones. Access follows the calendar copies (email/access.ts). Every write refreshes the interaction attributes
// of the records involved (before and after) through the single write path.
import {
  type CreateMeetingInput,
  createMeetingInputSchema,
  type ListMeetingsInput,
  type ListMeetingsOutput,
  listMeetingsInputSchema,
  type Meeting,
  type MeetingTimeInput,
  type TranscriptSegment,
  type UpdateMeetingInput,
  updateMeetingInputSchema,
} from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { type MeetingTimes, meetingRecords, meetingTimes, writeParticipants } from '../calendar/ingest.ts';
import { emitMeetingCallsChanged, meetingRecordRefs } from '../calls/common.ts';
import { mapSpeakersOfMeetings } from '../calls/speakers.ts';
import { resolveRecordRefs, toActor } from '../collab/common.ts';
import { actingMemberId } from '../context.ts';
import { meetingAccess } from '../email/access.ts';
import { IngestEffects } from '../email/ingest.ts';
import { rank, toAddress } from '../email/model.ts';
import { RecordResolver } from '../email/records.ts';
import { finishBatch, type StrengthScheduler } from '../email/sync.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import type { Policies } from '../permissions.ts';
import type { Tx } from '../tx.ts';

export interface MeetingDeps {
  policies: Policies;
  scheduleStrength: StrengthScheduler;
}

type MeetingRow = {
  id: string;
  workspace_id: string;
  source: 'calendar' | 'manual' | 'api';
  title: string;
  description: string;
  is_all_day: boolean;
  start_at: string;
  end_at: string;
  start_timezone: string | null;
  end_timezone: string | null;
  start_date: string | null;
  end_date: string | null;
  status: 'confirmed' | 'tentative' | 'cancelled';
  conference_url: string | null;
  created_by: unknown;
  created_at: string;
  updated_at: string;
};

/** Meetings → API views with the viewer's access (deleted or invisible ones are dropped), in `ids` order. */
export async function viewMeetings(tx: Tx, ids: string[]): Promise<Meeting[]> {
  if (ids.length === 0) return [];
  const access = await meetingAccess(tx, ids);
  const visible = ids.filter((id) => (access.get(id)?.access ?? 'none') !== 'none');
  if (visible.length === 0) return [];
  const rows = (await tx.db
    .selectFrom('meetings')
    .selectAll()
    .where('id', 'in', visible)
    .where('deleted_at', 'is', null)
    .execute()) as unknown as MeetingRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const participants = await tx.db
    .selectFrom('meeting_participants')
    .selectAll()
    .where('meeting_id', 'in', visible)
    .orderBy('meeting_id')
    .orderBy('position')
    .execute();
  const linked = await tx.db
    .selectFrom('meeting_records')
    .select(['meeting_id', 'entity_definition_id', 'entity_instance_id'])
    .where('meeting_id', 'in', visible)
    .orderBy('meeting_id')
    .orderBy('position')
    .execute();
  const recordings = await tx.db
    .selectFrom('call_recordings')
    .select(['id', 'meeting_id'])
    .where('meeting_id', 'in', visible)
    .where('deleted_at', 'is', null)
    .orderBy('created_at')
    .execute();
  const out: Meeting[] = [];
  for (const id of visible) {
    const row = byId.get(id);
    if (!row) continue;
    const info = access.get(id) as NonNullable<ReturnType<typeof access.get>>;
    out.push({
      id: row.id,
      workspaceId: row.workspace_id,
      source: row.source,
      access: info.access,
      title: rank(info.access) >= rank('subject-line') ? row.title : null,
      description: info.access === 'full-access' ? row.description : null,
      isAllDay: row.is_all_day,
      start: { at: row.start_at, timezone: row.start_timezone, date: row.start_date },
      end: { at: row.end_at, timezone: row.end_timezone, date: row.end_date },
      status: row.status,
      conferenceUrl: info.access === 'full-access' ? row.conference_url : null,
      participants: participants
        .filter((p) => p.meeting_id === id)
        .map((p) => ({
          id: p.id,
          emailAddress: p.original_email_address ?? p.email_address,
          name: p.name,
          isOrganizer: p.is_organizer,
          status: p.status,
          memberId: p.member_id,
          personId: p.person_id,
          companyId: p.company_id,
        })),
      linkedRecords: linked
        .filter((l) => l.meeting_id === id)
        .map((l) => ({ entityDefinitionId: l.entity_definition_id, entityInstanceId: l.entity_instance_id })),
      calendarCopies: info.copies.map((c) => ({ mailboxId: c.mailboxId, memberId: c.memberId })),
      callRecordingIds: recordings.filter((r) => r.meeting_id === id).map((r) => r.id),
      isReadOnly: row.source === 'calendar',
      createdBy: toActor(row.created_by),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
  return out;
}

function timesOf(start: MeetingTimeInput, end: MeetingTimeInput, isAllDay: boolean): MeetingTimes {
  const conv = (t: MeetingTimeInput) =>
    'date' in t ? { date: t.date } : { dateTime: t.datetime, timeZone: t.timezone ?? null };
  if (isAllDay !== ('date' in start && 'date' in end)) {
    throw badRequest(
      'VALIDATION_ERROR',
      isAllDay
        ? 'All-day meetings take start and end dates'
        : 'Meetings that are not all-day take start and end datetimes',
      { field: 'start' },
    );
  }
  const times = meetingTimes(conv(start), conv(end));
  if (!times) throw badRequest('VALIDATION_ERROR', 'Invalid meeting start or end', { field: 'start' });
  if (times.endAt < times.startAt) {
    throw badRequest('VALIDATION_ERROR', 'The meeting must end after it starts', { field: 'end' });
  }
  return times;
}

async function participantInputs(tx: Tx, list: NonNullable<CreateMeetingInput['participants']>) {
  const out = [];
  for (const p of list) {
    let email = p.emailAddress ?? null;
    if (!email && p.memberId) {
      const member = await tx.db
        .selectFrom('workspace_members')
        .select('email_address')
        .where('id', '=', p.memberId)
        .executeTakeFirst();
      if (!member) throw notFound('Workspace member not found', { member_id: p.memberId });
      email = member.email_address;
    }
    const address = email ? toAddress(email, p.name ?? null) : null;
    if (email && !address)
      throw badRequest('VALIDATION_ERROR', `Invalid email address "${email}"`, { field: 'participants' });
    out.push({
      address,
      name: p.name ?? null,
      memberId: p.memberId ?? null,
      isOrganizer: p.isOrganizer ?? false,
      status: p.status ?? 'accepted',
    });
  }
  return out;
}

async function writeLinkedRecords(
  tx: Tx,
  deps: MeetingDeps,
  meetingId: string,
  records: NonNullable<CreateMeetingInput['linkedRecords']>,
  mode: 'replace' | 'append',
): Promise<void> {
  const refs = await resolveRecordRefs(tx, deps, records, { what: 'linked_record' });
  const current = await tx.db
    .selectFrom('meeting_records')
    .select(['entity_instance_id', 'position'])
    .where('meeting_id', '=', meetingId)
    .execute();
  if (mode === 'replace') {
    const keep = new Set(refs.map((r) => r.entityInstanceId));
    const drop = current.filter((c) => !keep.has(c.entity_instance_id)).map((c) => c.entity_instance_id);
    if (drop.length > 0) {
      await tx.db
        .deleteFrom('meeting_records')
        .where('meeting_id', '=', meetingId)
        .where('entity_instance_id', 'in', drop)
        .execute();
    }
  }
  const existing = new Set(current.map((c) => c.entity_instance_id));
  let position = current.reduce((m, c) => Math.max(m, c.position + 1), 0);
  const fresh = refs.filter((r) => !existing.has(r.entityInstanceId));
  if (fresh.length > 0) {
    await tx.db
      .insertInto('meeting_records')
      .values(
        fresh.map((r) => ({
          meeting_id: meetingId,
          workspace_id: tx.workspaceId,
          entity_definition_id: r.entityDefinitionId,
          entity_instance_id: r.entityInstanceId,
          position: position++,
        })),
      )
      .execute();
  }
}

export async function loadMeeting(tx: Tx, meetingId: string): Promise<MeetingRow> {
  const row = await tx.db
    .selectFrom('meetings')
    .selectAll()
    .where('id', '=', meetingId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  const access = row ? (await meetingAccess(tx, [row.id])).get(row.id) : undefined;
  if (!row || !access || access.access === 'none') throw notFound('Meeting not found', { meeting_id: meetingId });
  return row as unknown as MeetingRow;
}

async function finish(tx: Tx, deps: MeetingDeps, effects: IngestEffects, meetingId: string): Promise<void> {
  await meetingRecords(tx, meetingId, effects);
  await finishBatch(tx, effects, deps.scheduleStrength);
  tx.emit('meeting-list', null, { meetingIds: [meetingId] });
}

const hhmmss = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
};

/** Public speaker label: the email address when one was given (Attio replaces the name, I calls §11.1). */
export const speakerLabel = (s: TranscriptSegment['speaker']) => s.emailAddress ?? s.name;

/** `[hh:mm:ss] speaker: text` lines; consecutive segments of the same speaker merged (I calls §11.1). */
export function rawTranscript(segments: TranscriptSegment[]): string {
  const lines: { start: number; speaker: string; text: string[] }[] = [];
  for (const seg of segments) {
    const speaker = speakerLabel(seg.speaker);
    const last = lines.at(-1);
    if (last && last.speaker === speaker) last.text.push(seg.speech);
    else lines.push({ start: seg.startTime, speaker, text: [seg.speech] });
  }
  return lines.map((l) => `[${hhmmss(l.start)}] ${l.speaker}: ${l.text.join(' ')}`).join('\n');
}

export const meetingOps = {
  async get(tx: Tx, meetingId: string): Promise<Meeting> {
    const [view] = await viewMeetings(tx, [(await loadMeeting(tx, meetingId)).id]);
    if (!view) throw notFound('Meeting not found', { meeting_id: meetingId });
    return view;
  },

  async list(tx: Tx, deps: MeetingDeps, input: ListMeetingsInput): Promise<ListMeetingsOutput> {
    const data = listMeetingsInputSchema.parse(input);
    const conditions = [sql`m.deleted_at IS NULL`];
    const either = [];
    if (data.record) {
      const [ref] = await resolveRecordRefs(tx, deps, [data.record]);
      const id = (ref as { entityInstanceId: string }).entityInstanceId;
      either.push(sql`(EXISTS (SELECT 1 FROM meeting_participants p WHERE p.meeting_id = m.id
          AND (p.person_id = ${id}::uuid OR p.company_id = ${id}::uuid))
        OR EXISTS (SELECT 1 FROM meeting_records r WHERE r.meeting_id = m.id AND r.entity_instance_id = ${id}::uuid))`);
    }
    const emails = (data.participants ?? []).map((e) => toAddress(e)?.email).filter((e): e is string => !!e);
    if (data.participants && data.participants.length > 0) {
      either.push(sql`EXISTS (SELECT 1 FROM meeting_participants p WHERE p.meeting_id = m.id
        AND p.email_address = ANY(${emails}::text[]))`);
    }
    if (either.length > 0) conditions.push(sql`(${sql.join(either, sql` OR `)})`);
    if (data.from) conditions.push(sql`m.end_at >= ${data.from}::timestamptz`);
    if (data.to) conditions.push(sql`m.start_at < ${data.to}::timestamptz`);
    const me = actingMemberId(tx.ctx);
    if (data.mine && me) {
      conditions.push(sql`(EXISTS (SELECT 1 FROM meeting_participants p WHERE p.meeting_id = m.id AND p.member_id = ${me}::uuid)
        OR EXISTS (SELECT 1 FROM calendar_events e WHERE e.meeting_id = m.id AND e.member_id = ${me}::uuid AND e.deleted_at IS NULL))`);
    }
    const order = data.sort === 'start_desc' ? sql.raw('DESC') : sql.raw('ASC');
    const { rows } = await sql<{ id: string }>`
      SELECT m.id FROM meetings m WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY m.start_at ${order}, m.id ${order} LIMIT 5000`.execute(tx.db);
    const access = await meetingAccess(
      tx,
      rows.map((r) => r.id),
    );
    const visible = rows.map((r) => r.id).filter((id) => (access.get(id)?.access ?? 'none') !== 'none');
    let offset = 0;
    if (data.cursor) {
      const parsed = Number.parseInt(Buffer.from(data.cursor, 'base64url').toString('utf8'), 10);
      if (!Number.isInteger(parsed) || parsed < 0)
        throw badRequest('VALIDATION_ERROR', 'Invalid cursor', { field: 'cursor' });
      offset = parsed;
    }
    const page = visible.slice(offset, offset + data.limit);
    return {
      meetings: await viewMeetings(tx, page),
      nextCursor:
        offset + data.limit < visible.length ? Buffer.from(String(offset + data.limit)).toString('base64url') : null,
    };
  },

  async create(tx: Tx, deps: MeetingDeps, input: CreateMeetingInput, source: 'manual' | 'api'): Promise<Meeting> {
    const data = createMeetingInputSchema.parse(input);
    const existing = await tx.db
      .selectFrom('meetings')
      .select(['id', 'deleted_at'])
      .where('id', '=', data.id)
      .executeTakeFirst();
    if (existing) {
      if (existing.deleted_at)
        throw conflict('ID_CONFLICT', 'A meeting with this id already existed', { meeting_id: data.id });
      return meetingOps.get(tx, data.id);
    }
    const times = timesOf(data.start, data.end, data.isAllDay);
    await tx.db
      .insertInto('meetings')
      .values({
        id: data.id,
        workspace_id: tx.workspaceId,
        source,
        title: data.title,
        description: data.description,
        is_all_day: times.isAllDay,
        start_at: times.startAt,
        end_at: times.endAt,
        start_timezone: times.startTimezone,
        end_timezone: times.endTimezone,
        start_date: times.startDate,
        end_date: times.endDate,
        created_by: JSON.stringify(tx.ctx.actor),
      })
      .execute();
    const effects = new IngestEffects();
    const resolver = await RecordResolver.create(tx);
    await writeParticipants(
      tx,
      resolver,
      data.id,
      await participantInputs(tx, data.participants),
      {
        createPeople: resolver.settings.recordCreation !== 'none',
      },
      effects,
    );
    await writeLinkedRecords(tx, deps, data.id, data.linkedRecords, 'replace');
    await finish(tx, deps, effects, data.id);
    return meetingOps.get(tx, data.id);
  },

  async update(tx: Tx, deps: MeetingDeps, input: UpdateMeetingInput): Promise<Meeting> {
    const data = updateMeetingInputSchema.parse(input);
    const row = await loadMeeting(tx, data.meetingId);
    const effects = new IngestEffects();
    await meetingRecords(tx, row.id, effects); // records before the change
    const callRecordsBefore = (await meetingRecordRefs(tx, [row.id])).get(row.id) ?? [];
    const changesDetails =
      data.title !== undefined ||
      data.description !== undefined ||
      data.start !== undefined ||
      data.end !== undefined ||
      data.isAllDay !== undefined ||
      data.participants !== undefined;
    if (changesDetails && row.source === 'calendar') {
      throw badRequest('VALIDATION_ERROR', 'Synced meetings can only change their linked records', {
        meeting_id: row.id,
      });
    }
    const set: Record<string, unknown> = {};
    if (data.title !== undefined) set.title = data.title;
    if (data.description !== undefined) set.description = data.description;
    if (data.start !== undefined || data.end !== undefined || data.isAllDay !== undefined) {
      const isAllDay = data.isAllDay ?? row.is_all_day;
      const start: MeetingTimeInput =
        data.start ??
        (row.is_all_day
          ? { date: row.start_date as string }
          : { datetime: row.start_at, timezone: row.start_timezone });
      const end: MeetingTimeInput =
        data.end ??
        (row.is_all_day ? { date: row.end_date as string } : { datetime: row.end_at, timezone: row.end_timezone });
      const times = timesOf(start, end, isAllDay);
      Object.assign(set, {
        is_all_day: times.isAllDay,
        start_at: times.startAt,
        end_at: times.endAt,
        start_timezone: times.startTimezone,
        end_timezone: times.endTimezone,
        start_date: times.startDate,
        end_date: times.endDate,
      });
    }
    await tx.db
      .updateTable('meetings')
      .set({ ...set, updated_at: tx.now } as never)
      .where('id', '=', row.id)
      .execute();
    if (data.participants !== undefined) {
      const resolver = await RecordResolver.create(tx);
      await writeParticipants(
        tx,
        resolver,
        row.id,
        await participantInputs(tx, data.participants),
        {
          createPeople: resolver.settings.recordCreation !== 'none',
        },
        effects,
      );
      // Speakers of the meeting's call recordings follow the participants (X-28).
      const remapped = await mapSpeakersOfMeetings(tx, [row.id]);
      for (const id of remapped) tx.emit('call-recording', id, { meetingId: row.id });
    }
    if (data.linkedRecords !== undefined) {
      await writeLinkedRecords(tx, deps, row.id, data.linkedRecords, data.linkedRecordsMode);
    }
    await finish(tx, deps, effects, row.id);
    await emitMeetingCallsChanged(tx, row.id, callRecordsBefore);
    return meetingOps.get(tx, row.id);
  },

  async delete(tx: Tx, deps: MeetingDeps, meetingId: string): Promise<{ id: string }> {
    const row = await loadMeeting(tx, meetingId);
    const effects = new IngestEffects();
    await meetingRecords(tx, row.id, effects);
    const callRecordsBefore = (await meetingRecordRefs(tx, [row.id])).get(row.id) ?? [];
    await tx.db
      .updateTable('meetings')
      .set({ deleted_at: tx.now, deleted_by: JSON.stringify(tx.ctx.actor), updated_at: tx.now })
      .where('id', '=', row.id)
      .execute();
    await tx.db
      .updateTable('calendar_events')
      .set({ deleted_at: tx.now })
      .where('meeting_id', '=', row.id)
      .where('deleted_at', 'is', null)
      .execute();
    await finishBatch(tx, effects, deps.scheduleStrength);
    tx.emit('meeting-list', null, { meetingIds: [row.id] });
    await emitMeetingCallsChanged(tx, row.id, callRecordsBefore);
    return { id: row.id };
  },
};
