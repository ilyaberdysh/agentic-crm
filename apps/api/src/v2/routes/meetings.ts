// Meetings and call recordings (F README §6; I calls §6.5, §11; BACKLOG 7.04 acceptance 5, 10.09–10.10): list (linked
// record and / or participant filters combined with OR, time window, sort, cursor), create (participants create
// people / companies per the workspace record creation), get, PATCH (append linked records), PUT (replace linked
// records), delete; and transcript-only call recordings — the mymeet import path (create with ≤ 4,000 segments →
// `processing`, then `completed` once speakers and summaries are processed and `call-recording.created` fired;
// list, get with transcript, delete, the deprecated transcript endpoint). Thin adapters over domain.meetings (I5).
import type { CallRecording, Meeting, MeetingTimeInput } from '@agentic-crm/contracts';
import {
  createCallRecordingBody,
  createCallRecordingPathParams,
  createMeetingBody,
  deleteCallRecordingPathParams,
  getCallRecordingPathParams,
  getCallRecordingTranscriptPathParams,
  getCallRecordingTranscriptQuery,
  getMeetingPathParams,
  listCallRecordingsPathParams,
  listCallRecordingsQuery,
  listMeetingsQuery,
  replaceMeetingBody,
  updateMeetingBody,
  v2Operations,
} from '@agentic-crm/contracts/v2';
import { newId, speakerLabel } from '@agentic-crm/domain';
import { slugOf } from '../collab-mappers';
import type { V2Context } from '../context';
import { publicErrors, withHints } from '../errors';
import { publicActor, publicTimestamp } from '../mappers';
import { params, parseInput, type RouteSpec } from '../route';

const DEFAULT_LIMIT = 50;
/** Body limit of a call recording import (≤ 4,000 transcript segments). */
export const CALL_RECORDING_BODY_LIMIT = 16 * 1024 * 1024;

const meetingNotFound = (id: string) => publicErrors.notFound(`Meeting with ID "${id}" not found.`);
const recordingNotFound = (id: string) => publicErrors.notFound(`Call recording with ID "${id}" not found.`);

function meetingId(raw: Record<string, string>): string {
  const parsed = getMeetingPathParams.safeParse(raw);
  if (!parsed.success) throw meetingNotFound(raw.meeting_id ?? '');
  return parsed.data.meeting_id.toLowerCase();
}

function recordingIds(raw: Record<string, string>): { meetingId: string; recordingId: string } {
  const parsed = getCallRecordingPathParams.safeParse(raw);
  if (!parsed.success) {
    if (!getMeetingPathParams.safeParse(raw).success) throw meetingNotFound(raw.meeting_id ?? '');
    throw recordingNotFound(raw.call_recording_id ?? '');
  }
  return { meetingId: parsed.data.meeting_id.toLowerCase(), recordingId: parsed.data.call_recording_id.toLowerCase() };
}

/** Domain 404s of a meeting call → the public API's messages. */
async function onMeeting<T>(id: string, fn: () => Promise<T>, recordingId?: string): Promise<T> {
  try {
    return await withHints({}, fn);
  } catch (err) {
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode === 404 && /meeting/i.test(e.message ?? '')) throw meetingNotFound(id);
    if (e.statusCode === 404 && recordingId && /recording/i.test(e.message ?? '')) throw recordingNotFound(recordingId);
    throw err;
  }
}

const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

/** Offset (minutes) of an IANA zone at a UTC instant; unknown zones read as UTC. */
function zoneOffsetMinutes(timeZone: string, at: number): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(at));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return Math.round((local - at) / 60_000);
  } catch {
    return 0;
  }
}

/**
 * A public start / end → the domain's time. Datetimes without an offset are read in the given IANA timezone
 * (invalid timezones as UTC), as the public API documents.
 */
function toTime(
  value: { datetime: string; timezone?: string | null | undefined } | { date: string },
): MeetingTimeInput {
  if ('date' in value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date)) throw publicErrors.validation(`Invalid date "${value.date}".`);
    return { date: value.date };
  }
  let instant: number;
  if (HAS_OFFSET.test(value.datetime)) instant = Date.parse(value.datetime);
  else {
    const naive = Date.parse(`${value.datetime}Z`);
    instant = Number.isNaN(naive) ? Number.NaN : naive - zoneOffsetMinutes(value.timezone ?? 'UTC', naive) * 60_000;
  }
  if (Number.isNaN(instant)) throw publicErrors.validation(`Invalid datetime "${value.datetime}".`);
  return { datetime: new Date(instant).toISOString(), timezone: value.timezone ?? null };
}

const isoMillis = (iso: string) => new Date(iso).toISOString();

export async function meetingToPublic(v2: V2Context, m: Meeting) {
  const time = (t: Meeting['start']) =>
    m.isAllDay && t.date ? { date: t.date } : { datetime: isoMillis(t.at), timezone: t.timezone };
  const linked = [];
  for (const r of m.linkedRecords) {
    linked.push({
      object_slug: await slugOf(v2, r.entityDefinitionId),
      object_id: r.entityDefinitionId,
      record_id: r.entityInstanceId,
    });
  }
  return {
    id: { workspace_id: m.workspaceId, meeting_id: m.id },
    title: m.title ?? '',
    description: m.description ?? '',
    is_all_day: m.isAllDay,
    start: time(m.start),
    end: time(m.end),
    participants: m.participants.map((p) => ({
      status: p.status,
      is_organizer: p.isOrganizer,
      email_address: p.emailAddress,
      name: p.name,
    })),
    linked_records: linked,
    created_at: publicTimestamp(m.createdAt),
    created_by_actor: publicActor(m.createdBy),
  };
}

function webUrl(v2: V2Context, meetingId: string, recordingId: string): string {
  return `${v2.webUrl.replace(/\/$/, '')}/${v2.identity.workspace.slug}/calls/${meetingId}/${recordingId}`;
}

function recordingToPublic(v2: V2Context, r: CallRecording) {
  return {
    id: { workspace_id: r.workspaceId, meeting_id: r.meetingId, call_recording_id: r.id },
    status: r.status,
    web_url: webUrl(v2, r.meetingId, r.id),
    created_by_actor: publicActor(r.createdBy),
    created_at: publicTimestamp(r.createdAt),
  };
}

async function linkedRecords(v2: V2Context, list: { object: string; record_id: string }[] | undefined) {
  const out = [];
  for (const r of list ?? []) {
    const def = await v2.object(r.object);
    out.push({ entityDefinitionId: def.id, entityInstanceId: r.record_id.toLowerCase() });
  }
  return out;
}

/** Opaque offset cursor. */
const encodeCursor = (offset: number) => Buffer.from(JSON.stringify({ offset })).toString('base64url');
function decodeCursor(raw: string | undefined): number {
  if (!raw) return 0;
  try {
    const { offset } = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { offset: unknown };
    if (typeof offset === 'number' && Number.isInteger(offset) && offset >= 0) return offset;
  } catch {
    // fall through
  }
  throw publicErrors.validation('The cursor is invalid.');
}

function timestampParam(value: string | null | undefined, name: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw publicErrors.validation(`${name} must be a valid timestamp.`);
  return new Date(t).toISOString();
}

export const meetingRoutes: RouteSpec[] = [
  {
    method: 'GET',
    url: '/meetings',
    operationId: 'listMeetings',
    scopes: v2Operations.listMeetings.scopes,
    async handler(v2, request) {
      const query = parseInput(listMeetingsQuery, request.query, 'query parameters');
      if (Boolean(query.linked_object) !== Boolean(query.linked_record_id)) {
        throw publicErrors.validation('linked_object and linked_record_id must be provided together.');
      }
      const record =
        query.linked_object && query.linked_record_id
          ? { entityDefinitionId: (await v2.object(query.linked_object)).id, entityInstanceId: query.linked_record_id }
          : undefined;
      const participants = (query.participants ?? '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      const from = timestampParam(query.ends_from, 'ends_from');
      const to = timestampParam(query.starts_before, 'starts_before');
      const limit = query.limit ?? DEFAULT_LIMIT;
      const offset = decodeCursor(query.cursor);
      // The domain pages with its own cursor; /v2 keeps an offset cursor over the same ordered list.
      const all: Meeting[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await withHints({ object: query.linked_object, recordId: query.linked_record_id }, () =>
          v2.domain.meetings.list(v2.ctx, {
            ...(record ? { record } : {}),
            ...(participants.length > 0 ? { participants } : {}),
            ...(from ? { from } : {}),
            ...(to ? { to } : {}),
            sort: query.sort ?? 'start_asc',
            limit: 200,
            ...(cursor ? { cursor } : {}),
          }),
        );
        all.push(...page.meetings);
        if (!page.nextCursor || all.length >= offset + limit + 1) break;
        cursor = page.nextCursor;
      }
      const slice = all.slice(offset, offset + limit);
      return {
        data: await Promise.all(slice.map((m) => meetingToPublic(v2, m))),
        pagination: { next_cursor: all.length > offset + limit ? encodeCursor(offset + limit) : null },
      };
    },
  },
  {
    method: 'POST',
    url: '/meetings',
    operationId: 'createMeeting',
    scopes: v2Operations.createMeeting.scopes,
    async handler(v2, request) {
      const { data } = parseInput(createMeetingBody, request.body, 'request body');
      const isAllDay = data.is_all_day;
      const start = toTime(data.start);
      const end = toTime(data.end);
      if (isAllDay !== ('date' in start && 'date' in end)) {
        throw publicErrors.validation(
          isAllDay
            ? 'All-day meetings must use the date format for start and end.'
            : 'Meetings that are not all-day must use the datetime format for start and end.',
        );
      }
      const participants = data.participants.map((p, i) => {
        if (!p.email_address && !p.name) {
          throw publicErrors.validation(`participants.${i}: an email_address or a name is required.`);
        }
        return {
          ...(p.email_address ? { emailAddress: p.email_address } : {}),
          ...(p.name ? { name: p.name } : {}),
          isOrganizer: p.is_organizer === true || p.is_organizer === 'true',
          status: p.status,
        };
      });
      const meeting = await withHints({}, async () =>
        v2.domain.meetings.create(
          v2.ctx,
          {
            id: newId(),
            title: data.title,
            description: data.description,
            start,
            end,
            isAllDay,
            participants,
            linkedRecords: await linkedRecords(v2, data.linked_records),
          },
          { source: 'api' },
        ),
      );
      return { data: await meetingToPublic(v2, meeting) };
    },
  },
  {
    method: 'GET',
    url: '/meetings/:meeting_id',
    operationId: 'getMeeting',
    scopes: v2Operations.getMeeting.scopes,
    async handler(v2, request) {
      const id = meetingId(params(request));
      const meeting = await onMeeting(id, () => v2.domain.meetings.get(v2.ctx, id));
      return { data: await meetingToPublic(v2, meeting) };
    },
  },
  ...(['PATCH', 'PUT'] as const).map(
    (method): RouteSpec => ({
      method,
      url: '/meetings/:meeting_id',
      operationId: method === 'PATCH' ? 'updateMeeting' : 'replaceMeeting',
      scopes: method === 'PATCH' ? v2Operations.updateMeeting.scopes : v2Operations.replaceMeeting.scopes,
      async handler(v2, request) {
        const id = meetingId(params(request));
        const { data } = parseInput(
          method === 'PATCH' ? updateMeetingBody : replaceMeetingBody,
          request.body,
          'request body',
        );
        await onMeeting(id, () => v2.domain.meetings.get(v2.ctx, id));
        const records = await linkedRecords(v2, data.linked_records);
        const meeting = await onMeeting(id, () =>
          v2.domain.meetings.update(v2.ctx, {
            meetingId: id,
            linkedRecords: records,
            linkedRecordsMode: method === 'PATCH' ? 'append' : 'replace',
          }),
        );
        return { data: await meetingToPublic(v2, meeting) };
      },
    }),
  ),
  {
    method: 'DELETE',
    url: '/meetings/:meeting_id',
    operationId: 'deleteMeeting',
    scopes: v2Operations.deleteMeeting.scopes,
    async handler(v2, request) {
      const id = meetingId(params(request));
      await onMeeting(id, () => v2.domain.meetings.delete(v2.ctx, id));
      return {};
    },
  },
  {
    method: 'GET',
    url: '/meetings/:meeting_id/call_recordings',
    operationId: 'listCallRecordings',
    scopes: v2Operations.listCallRecordings.scopes,
    async handler(v2, request) {
      const raw = params(request);
      if (!listCallRecordingsPathParams.safeParse(raw).success) throw meetingNotFound(raw.meeting_id ?? '');
      const id = meetingId(raw);
      const query = parseInput(listCallRecordingsQuery, request.query, 'query parameters');
      const limit = Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_LIMIT), 1), 200);
      const offset = decodeCursor(query.cursor);
      const all = await onMeeting(id, () => v2.domain.meetings.recordings.list(v2.ctx, id));
      return {
        data: all.slice(offset, offset + limit).map((r) => recordingToPublic(v2, r)),
        pagination: { next_cursor: all.length > offset + limit ? encodeCursor(offset + limit) : null },
      };
    },
  },
  {
    method: 'POST',
    url: '/meetings/:meeting_id/call_recordings',
    operationId: 'createCallRecording',
    scopes: v2Operations.createCallRecording.scopes,
    // 4,000 segments of long speech exceed the default 1 MiB.
    bodyLimit: CALL_RECORDING_BODY_LIMIT,
    async handler(v2, request) {
      const raw = params(request);
      if (!createCallRecordingPathParams.safeParse(raw).success) throw meetingNotFound(raw.meeting_id ?? '');
      const id = meetingId(raw);
      const { data } = parseInput(createCallRecordingBody, request.body, 'request body');
      if (data.video_url !== undefined) {
        let url: URL | null = null;
        try {
          url = new URL(data.video_url);
        } catch {
          throw publicErrors.validation('Invalid video URL.');
        }
        if (url.protocol !== 'https:')
          throw publicErrors.validation('Invalid video URL protocol. Only https is supported');
      }
      for (const [i, seg] of (data.transcript ?? []).entries()) {
        if (seg.end_time < seg.start_time) {
          throw publicErrors.validation(`transcript.${i}: end_time must not be before start_time.`);
        }
      }
      const recording = await onMeeting(id, () =>
        v2.domain.meetings.recordings.create(v2.ctx, {
          id: newId(),
          meetingId: id,
          ...(data.video_url ? { videoUrl: data.video_url } : {}),
          transcript: (data.transcript ?? []).map((seg) => ({
            speech: seg.speech,
            startTime: seg.start_time,
            endTime: seg.end_time,
            speaker: {
              name: seg.speaker.name,
              ...(seg.speaker.email_address ? { emailAddress: seg.speaker.email_address } : {}),
            },
          })),
        }),
      );
      return { data: recordingToPublic(v2, recording) };
    },
  },
  {
    method: 'GET',
    url: '/meetings/:meeting_id/call_recordings/:call_recording_id',
    operationId: 'getCallRecording',
    scopes: v2Operations.getCallRecording.scopes,
    async handler(v2, request) {
      const ids = recordingIds(params(request));
      const recording = await onMeeting(
        ids.meetingId,
        () => v2.domain.meetings.recordings.get(v2.ctx, ids.meetingId, ids.recordingId),
        ids.recordingId,
      );
      return {
        data: {
          ...recordingToPublic(v2, recording),
          video_url: recording.videoUrl,
          transcript: {
            segments: recording.transcript.segments.map((s) => ({
              speech: s.speech,
              start_time: s.startTime,
              end_time: s.endTime,
              speaker: { name: speakerLabel(s.speaker) },
            })),
            raw_transcript: recording.transcript.rawTranscript,
          },
        },
      };
    },
  },
  {
    method: 'DELETE',
    url: '/meetings/:meeting_id/call_recordings/:call_recording_id',
    operationId: 'deleteCallRecording',
    scopes: v2Operations.deleteCallRecording.scopes,
    async handler(v2, request, reply) {
      const raw = params(request);
      if (!deleteCallRecordingPathParams.safeParse(raw).success) recordingIds(raw);
      const ids = recordingIds(raw);
      await onMeeting(
        ids.meetingId,
        () => v2.domain.meetings.recordings.delete(v2.ctx, ids.meetingId, ids.recordingId),
        ids.recordingId,
      );
      return reply.status(204).send();
    },
  },
  {
    method: 'GET',
    url: '/meetings/:meeting_id/call_recordings/:call_recording_id/transcript',
    operationId: 'getCallRecordingTranscript',
    scopes: v2Operations.getCallRecordingTranscript.scopes,
    async handler(v2, request) {
      const raw = params(request);
      if (!getCallRecordingTranscriptPathParams.safeParse(raw).success) recordingIds(raw);
      const ids = recordingIds(raw);
      parseInput(getCallRecordingTranscriptQuery, request.query, 'query parameters');
      const recording = await onMeeting(
        ids.meetingId,
        () => v2.domain.meetings.recordings.get(v2.ctx, ids.meetingId, ids.recordingId),
        ids.recordingId,
      );
      return {
        data: {
          id: { workspace_id: recording.workspaceId, meeting_id: recording.meetingId, call_recording_id: recording.id },
          transcript: recording.transcript.segments.map((s) => ({
            speech: s.speech,
            start_time: s.startTime,
            end_time: s.endTime,
            speaker: { name: speakerLabel(s.speaker) },
          })),
          raw_transcript: recording.transcript.rawTranscript,
          web_url: webUrl(v2, recording.meetingId, recording.id),
        },
        pagination: { next_cursor: null },
      };
    },
  },
];
