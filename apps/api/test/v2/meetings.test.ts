// /v2 contract tests for meetings and call recordings (BACKLOG 7.04, acceptance 5; I calls §11.1 — the flow mymeet
// imports use: create a meeting, attach a transcript-only recording, read it back). Every 200 is checked against
// Attio's OpenAPI schema and the generated Zod schema of the operation.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from '../support/harness';
import { expectError, expectOk, type V2Fixture, v2Fixture } from './support';

let h: Harness;
let f: V2Fixture;
let companyId: string;
let meetingId: string;
const TS_9 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z$/;
const JANE = 'jane.cooper@northwind.example.com';
const WADE = 'wade.warren@northwind.example.com';

beforeAll(async () => {
  h = await startHarness({}, { publicApi: { rateLimits: { readsPerSecond: 5000, writesPerSecond: 5000 } } });
  f = await v2Fixture(h, 'meetings');
  const company = expectOk(
    'createRecord',
    await f.call('POST', '/objects/companies/records', {
      body: { data: { values: { name: 'Northwind Robotics', domains: ['northwind-robotics.io'] } } },
    }),
  );
  companyId = company.data.id.record_id;
});
afterAll(async () => {
  await h?.close();
});

describe('meetings', () => {
  it('creates a meeting with participants and linked records; participants create people', async () => {
    const member = await f.h.domain.members.get(
      { workspaceId: f.workspaceId, actor: { type: 'system', id: null } },
      f.memberId,
    );
    const created = expectOk(
      'createMeeting',
      await f.call('POST', '/meetings', {
        body: {
          data: {
            title: 'Discovery call — Northwind',
            description: 'Scope the pilot',
            start: { datetime: '2026-10-09T17:00:00', timezone: 'Europe/Moscow' },
            end: { datetime: '2026-10-09T14:30:00Z', timezone: 'Europe/Moscow' },
            is_all_day: false,
            participants: [
              { email_address: member.emailAddress, is_organizer: true, status: 'accepted' },
              { email_address: JANE, is_organizer: 'false', status: 'accepted' },
              { email_address: WADE, is_organizer: false, status: 'tentative' },
            ],
            linked_records: [{ object: 'companies', record_id: companyId }],
          },
        },
      }),
    );
    const meeting = created.data;
    meetingId = meeting.id.meeting_id;
    expect(meeting).toMatchObject({
      id: { workspace_id: f.workspaceId },
      title: 'Discovery call — Northwind',
      description: 'Scope the pilot',
      is_all_day: false,
      // 17:00 in Moscow (UTC+3) is 14:00 UTC.
      start: { datetime: '2026-10-09T14:00:00.000Z', timezone: 'Europe/Moscow' },
      end: { datetime: '2026-10-09T14:30:00.000Z', timezone: 'Europe/Moscow' },
      participants: [
        { email_address: member.emailAddress, is_organizer: true, status: 'accepted', name: null },
        { email_address: JANE, is_organizer: false, status: 'accepted', name: null },
        { email_address: WADE, is_organizer: false, status: 'tentative', name: null },
      ],
      linked_records: [{ object_slug: 'companies', record_id: companyId }],
      created_by_actor: { type: 'api-token', id: f.tokenId },
    });
    expect(meeting.created_at).toMatch(TS_9);
    // People were created for the external participants.
    const people = expectOk(
      'queryRecords',
      await f.call('POST', '/objects/people/records/query', {
        body: { filter: { email_addresses: JANE } },
      }),
    );
    expect(people.data).toHaveLength(1);
    expectOk('getMeeting', await f.call('GET', `/meetings/${meetingId}`));
  });

  it('all-day meetings take dates; invalid bodies are validation errors', async () => {
    const created = expectOk(
      'createMeeting',
      await f.call('POST', '/meetings', {
        body: {
          data: {
            title: 'Offsite',
            description: '',
            start: { date: '2026-11-02' },
            end: { date: '2026-11-04' },
            is_all_day: true,
            participants: [],
          },
        },
      }),
    );
    expect(created.data).toMatchObject({
      is_all_day: true,
      start: { date: '2026-11-02' },
      end: { date: '2026-11-04' },
    });
    const mixed = await f.call('POST', '/meetings', {
      body: {
        data: {
          title: 'Bad',
          description: '',
          start: { date: '2026-11-02' },
          end: { date: '2026-11-04' },
          is_all_day: false,
          participants: [],
        },
      },
    });
    // Attio's spec declares this 400 with `statusCode` (camelCase); every other error, ours included, uses status_code.
    const camel = { deviation: 'createMeeting 400 declares statusCode instead of status_code' };
    expectError('createMeeting', mixed, 400, 'validation_type', camel);
    const missing = await f.call('POST', '/meetings', { body: { data: { title: 'x' } } });
    expectError('createMeeting', missing, 400, 'validation_type', camel);
    const nameless = await f.call('POST', '/meetings', {
      body: {
        data: {
          title: 'x',
          description: '',
          start: { datetime: '2026-11-02T10:00:00Z' },
          end: { datetime: '2026-11-02T11:00:00Z' },
          is_all_day: false,
          participants: [{ is_organizer: false, status: 'pending' }],
        },
      },
    });
    expectError('createMeeting', nameless, 400, 'validation_type', camel);
  });

  it('lists with linked record / participant filters (OR), time window, sort and cursor', async () => {
    const all = expectOk('listMeetings', await f.call('GET', '/meetings'));
    expect(all.data.map((m: { title: string }) => m.title)).toEqual(['Discovery call — Northwind', 'Offsite']);
    expect(all.pagination.next_cursor).toBeNull();
    const desc = expectOk('listMeetings', await f.call('GET', '/meetings', { query: { sort: 'start_desc' } }));
    expect(desc.data.map((m: { title: string }) => m.title)).toEqual(['Offsite', 'Discovery call — Northwind']);
    const byRecord = expectOk(
      'listMeetings',
      await f.call('GET', '/meetings', { query: { linked_object: 'companies', linked_record_id: companyId } }),
    );
    expect(byRecord.data.map((m: { id: { meeting_id: string } }) => m.id.meeting_id)).toEqual([meetingId]);
    const byParticipant = expectOk('listMeetings', await f.call('GET', '/meetings', { query: { participants: WADE } }));
    expect(byParticipant.data).toHaveLength(1);
    const windowed = expectOk(
      'listMeetings',
      await f.call('GET', '/meetings', {
        query: { ends_from: '2026-11-01T00:00:00Z', starts_before: '2026-12-01T00:00:00Z' },
      }),
    );
    expect(windowed.data.map((m: { title: string }) => m.title)).toEqual(['Offsite']);
    const first = expectOk('listMeetings', await f.call('GET', '/meetings', { query: { limit: '1' } }));
    expect(first.data).toHaveLength(1);
    const next = expectOk(
      'listMeetings',
      await f.call('GET', '/meetings', { query: { limit: '1', cursor: first.pagination.next_cursor } }),
    );
    expect(next.data[0].title).toBe('Offsite');
    expect(next.pagination.next_cursor).toBeNull();
    expectError(
      'listMeetings',
      await f.call('GET', '/meetings', { query: { linked_object: 'companies' } }),
      400,
      'validation_type',
      { deviation: 'listMeetings declares no 400' },
    );
  });

  it('PATCH appends and PUT replaces linked records; 404 for unknown meetings', async () => {
    const person = expectOk(
      'createRecord',
      await f.call('POST', '/objects/people/records', {
        body: { data: { values: { email_addresses: ['pat@initech.io'] } } },
      }),
    );
    const patched = expectOk(
      'updateMeeting',
      await f.call('PATCH', `/meetings/${meetingId}`, {
        body: { data: { linked_records: [{ object: 'people', record_id: person.data.id.record_id }] } },
      }),
    );
    expect(patched.data.linked_records.map((r: { object_slug: string }) => r.object_slug)).toEqual([
      'companies',
      'people',
    ]);
    const replaced = expectOk(
      'replaceMeeting',
      await f.call('PUT', `/meetings/${meetingId}`, {
        body: { data: { linked_records: [{ object: 'people', record_id: person.data.id.record_id }] } },
      }),
    );
    expect(replaced.data.linked_records).toEqual([
      { object_slug: 'people', object_id: expect.any(String), record_id: person.data.id.record_id },
    ]);
    const missing = '0190aaaa-0000-7000-8000-000000000000';
    const error = expectError('getMeeting', await f.call('GET', `/meetings/${missing}`), 404, 'not_found');
    expect(error.message).toBe(`Meeting with ID "${missing}" not found.`);
    expectError(
      'updateMeeting',
      await f.call('PATCH', `/meetings/${meetingId}`, { body: { data: { title: 'x', linked_records: [] } } }),
      400,
      'validation_type',
    );
  });

  it('requires the meeting scopes', async () => {
    const token = await f.mint(['record_permission:read']);
    const denied = await f.call('GET', '/meetings', { token });
    expect(denied.status).toBe(403);
  });
});

describe('call recordings (transcript-only)', () => {
  let recordingId: string;

  it('creates a transcript-only recording that is processing until summaries are done', async () => {
    const created = expectOk(
      'createCallRecording',
      await f.call('POST', `/meetings/${meetingId}/call_recordings`, {
        body: {
          data: {
            transcript: [
              { speech: 'Hi Jane.', start_time: 2, end_time: 3.5, speaker: { name: 'Ada' } },
              { speech: 'Hello!', start_time: 4, end_time: 5, speaker: { name: 'Jane Cooper', email_address: JANE } },
              {
                speech: 'Shall we start?',
                start_time: 5.2,
                end_time: 7,
                speaker: { name: 'Jane Cooper', email_address: JANE },
              },
            ],
          },
        },
      }),
    );
    recordingId = created.data.id.call_recording_id;
    expect(created.data).toMatchObject({
      id: { workspace_id: f.workspaceId, meeting_id: meetingId },
      status: 'processing',
      created_by_actor: { type: 'api-token', id: f.tokenId },
    });
    expect(created.data.web_url).toContain(`/calls/${meetingId}/${recordingId}`);
    // The worker's calls.process job (run here directly) completes it.
    await f.h.domain.calls.process(f.workspaceId, recordingId);
  });

  it('validates the import: https video URLs only, at most 4,000 segments; large bodies are accepted', async () => {
    const path = `/meetings/${meetingId}/call_recordings`;
    const segment = (i: number) => ({
      speech: `Segment ${i} `.padEnd(400, 'lorem ipsum '),
      start_time: i * 2,
      end_time: i * 2 + 1.5,
      speaker: { name: i % 2 ? 'Jane Cooper' : 'Ada', ...(i % 2 ? { email_address: JANE } : {}) },
    });
    const http = await f.call('POST', path, {
      body: { data: { video_url: 'http://example.com/a.mp4', transcript: [segment(0)] } },
    });
    expect(expectError('createCallRecording', http, 400, 'validation_type').message).toBe(
      'Invalid video URL protocol. Only https is supported',
    );
    const tooMany = await f.call('POST', path, {
      body: { data: { transcript: Array.from({ length: 4001 }, (_, i) => segment(i)) } },
    });
    expectError('createCallRecording', tooMany, 400, 'validation_type');
    const big = { data: { transcript: Array.from({ length: 4000 }, (_, i) => segment(i)) } };
    expect(JSON.stringify(big).length).toBeGreaterThan(1024 * 1024);
    const created = expectOk('createCallRecording', await f.call('POST', path, { body: big }));
    expect(created.data.status).toBe('processing');
    // A retried import of the same transcript answers the same recording.
    const replay = expectOk('createCallRecording', await f.call('POST', path, { body: big }));
    expect(replay.data.id.call_recording_id).toBe(created.data.id.call_recording_id);
    expect((await f.call('DELETE', `${path}/${created.data.id.call_recording_id}`)).status).toBe(204);
  });

  it('reads the recording with its transcript (speaker names become emails; same-speaker lines merge)', async () => {
    const got = expectOk(
      'getCallRecording',
      await f.call('GET', `/meetings/${meetingId}/call_recordings/${recordingId}`),
    );
    expect(got.data).toMatchObject({ video_url: null, status: 'completed' });
    expect(got.data.transcript.segments.map((s: { speaker: { name: string } }) => s.speaker.name)).toEqual([
      'Ada',
      JANE,
      JANE,
    ]);
    expect(got.data.transcript.raw_transcript).toBe(
      `[00:00:02] Ada: Hi Jane.\n[00:00:04] ${JANE}: Hello! Shall we start?`,
    );
    const transcript = expectOk(
      'getCallRecordingTranscript',
      await f.call('GET', `/meetings/${meetingId}/call_recordings/${recordingId}/transcript`),
    );
    expect(transcript.data.transcript).toHaveLength(3);
    expect(transcript.data.raw_transcript).toBe(got.data.transcript.raw_transcript);
    const listed = expectOk('listCallRecordings', await f.call('GET', `/meetings/${meetingId}/call_recordings`));
    expect(listed.data.map((r: { id: { call_recording_id: string } }) => r.id.call_recording_id)).toEqual([
      recordingId,
    ]);
    expect(listed.pagination.next_cursor).toBeNull();
  });

  it('deletes a recording (204) and then the meeting', async () => {
    const deleted = await f.call('DELETE', `/meetings/${meetingId}/call_recordings/${recordingId}`);
    expect(deleted.status).toBe(204);
    expectError(
      'getCallRecording',
      await f.call('GET', `/meetings/${meetingId}/call_recordings/${recordingId}`),
      404,
      'not_found',
    );
    expectOk('deleteMeeting', await f.call('DELETE', `/meetings/${meetingId}`));
    expectError('getMeeting', await f.call('GET', `/meetings/${meetingId}`), 404, 'not_found');
    expectError(
      'createCallRecording',
      await f.call('POST', `/meetings/${meetingId}/call_recordings`, { body: { data: { transcript: [] } } }),
      404,
      'not_found',
    );
  });
});
