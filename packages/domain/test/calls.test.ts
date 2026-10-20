// Calls (BACKLOG 10.09–10.11, 10.15; acceptance 2 and 3 data side): the mymeet import stores speakers and utterances
// and queues processing; processing maps speakers by email, writes long + concise summaries, completes the call,
// fires call-recording.created (webhooks, workflow trigger) and invalidates the Calls list and the records' Calls
// tabs; consecutive segments of one speaker form one block; the Calls list filters, searches, groups by date and
// shows favourites.
import { cfg } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { describe, expect, it } from 'vitest';
import { buildBlocks, createDomain, formatClock } from '../src/index.ts';
import { callFixture, calls, jobs, llm, queued, transcript } from './calls-fixtures.ts';
import { addMember, changeRows, lastChangeId } from './collab-fixtures.ts';
import { iso } from './email-fixtures.ts';
import { database, expectCode, newId, domain as plain, storage } from './support/harness.ts';
import { buildWorkflow } from './workflows-fixtures.ts';

describe('import and processing (acceptance 2)', () => {
  it('queues processing, then completes with summaries, mapped speakers and live invalidations', async () => {
    const f = await callFixture();
    const before = await lastChangeId(f.workspaceId);
    const recordingId = newId();
    const created = await queued.meetings.recordings.create(f.ctx, {
      id: recordingId,
      meetingId: f.meetingId,
      transcript: transcript(f),
    });
    expect(created.status).toBe('processing');
    expect(jobs.take('calls.process').map((j) => j.data)).toEqual([{ workspaceId: f.workspaceId, recordingId }]);

    // The Calls list and the linked / participant records' Calls tabs are invalidated at once (X-27).
    const onCreate = await changeRows(f.workspaceId, before);
    const listRow = onCreate.find((r) => r.resource === 'call-recording-list');
    expect(listRow?.resource_id).toBe(f.meetingId);
    expect((listRow?.scope.entityInstanceIds as string[]).sort()).toEqual(
      [f.initech, f.janePersonId, f.northwind].sort(),
    );
    expect(onCreate.some((r) => r.resource === 'meeting' && r.resource_id === f.meetingId)).toBe(true);

    // Listed while processing ("Analyzing call data...").
    const pending = await queued.calls.list(f.ctx, {});
    expect(pending.items.map((i) => [i.id, i.status, i.summaryStatus])).toEqual([
      [recordingId, 'processing', 'queued'],
    ]);

    const mid = await lastChangeId(f.workspaceId);
    const result = await queued.calls.process(f.workspaceId, recordingId);
    expect(result).toMatchObject({ status: 'completed', summaryStatus: 'completed' });
    const detail = await queued.calls.get(f.ctx, recordingId);
    expect(detail).toMatchObject({
      status: 'completed',
      summaryStatus: 'completed',
      conciseSummaryStatus: 'completed',
      title: 'Discovery call — Northwind',
      segmentCount: 7,
      transcriptDurationSeconds: 50,
      durationSeconds: 1800,
      processingError: null,
    });
    expect(detail.summary).toContain('Discovery call — Northwind');
    expect(detail.conciseSummary).toContain('next steps agreed');
    // The summaries request names members by their member name (X-28) and carries the copy-format transcript.
    const request = llm.callsFor('call-summary').at(-1);
    expect(request?.model).toBe('claude-sonnet-5-5');
    expect(request?.outputSchema).toMatchObject({ required: ['summary', 'concise_summary'] });
    expect(request?.messages[0]?.content).toContain('[0:16] Ada Lovelace: Great, let us plan a two-week pilot.');
    expect(request?.messages[0]?.content).not.toContain(f.adaEmail);

    const onDone = await changeRows(f.workspaceId, mid);
    expect(onDone.some((r) => r.resource === 'call-recording' && r.resource_id === recordingId)).toBe(true);
    expect(
      onDone.some(
        (r) => r.resource === 'call-recording-list' && (r.scope.entityInstanceIds as string[]).includes(f.northwind),
      ),
    ).toBe(true);
    // Processing twice is a no-op.
    expect((await queued.calls.process(f.workspaceId, recordingId)).status).toBeNull();
    // The record Calls tab (record filter) shows the concise summary.
    const tab = await calls.calls.list(f.ctx, {
      filters: [
        { field: 'record', operator: 'eq', value: { entityDefinitionId: 'companies', entityInstanceId: f.northwind } },
      ],
      groupBy: 'none',
    });
    expect(tab.items.map((i) => [i.id, i.conciseSummary])).toEqual([[recordingId, detail.conciseSummary]]);
  });

  it('inline without jobs; replays the same transcript; summaries fail softly without an LLM', async () => {
    const f = await callFixture('Inline call');
    const first = await calls.meetings.recordings.create(f.ctx, {
      id: newId(),
      meetingId: f.meetingId,
      transcript: transcript(f),
    });
    expect(first.status).toBe('completed');
    // A retried import of the identical transcript answers the first recording.
    const replay = await calls.meetings.recordings.create(f.ctx, {
      id: newId(),
      meetingId: f.meetingId,
      transcript: transcript(f),
    });
    expect(replay.id).toBe(first.id);
    expect(await calls.meetings.recordings.list(f.ctx, f.meetingId)).toHaveLength(1);

    // No LLM configured (the plain test domain): the call completes, the summaries are failed.
    const other = await plain.meetings.recordings.create(f.ctx, {
      id: newId(),
      meetingId: f.meetingId,
      transcript: transcript(f).slice(0, 2),
    });
    expect(other.status).toBe('completed');
    expect(await plain.calls.get(f.ctx, other.id)).toMatchObject({
      summary: null,
      summaryStatus: 'failed',
      processingError: 'AI_NOT_CONFIGURED',
    });

    // Provider errors are retried by the job; the last attempt fails the summaries but completes the call.
    const flaky = await queued.meetings.recordings.create(f.ctx, {
      id: newId(),
      meetingId: f.meetingId,
      transcript: transcript(f).slice(2, 5),
    });
    jobs.take();
    llm.when((r) => r.purpose === 'call-summary', { error: new Error('overloaded') }, { times: 2 });
    await expect(queued.calls.process(f.workspaceId, flaky.id, { final: false })).rejects.toThrow('overloaded');
    expect((await queued.calls.get(f.ctx, flaky.id)).status).toBe('processing');
    await queued.calls.process(f.workspaceId, flaky.id, { final: true });
    expect(await queued.calls.get(f.ctx, flaky.id)).toMatchObject({
      status: 'completed',
      summaryStatus: 'failed',
      processingError: 'LLM_ERROR: overloaded',
    });

    // Segments that end before they start are refused; deleted calls disappear.
    await expectCode(
      calls.meetings.recordings.create(f.ctx, {
        id: newId(),
        meetingId: f.meetingId,
        transcript: [{ speech: 'x', startTime: 5, endTime: 1, speaker: { name: 'A' } }],
      }),
      'VALIDATION_ERROR',
      400,
    );
    await calls.calls.delete(f.ctx, first.id);
    await expectCode(calls.calls.get(f.ctx, first.id), 'NOT_FOUND', 404);
  });
});

const meetingPerson = (
  m: { participants: { emailAddress: string | null; personId: string | null }[] },
  email: string,
) => m.participants.find((p) => p.emailAddress === email)?.personId ?? null;

describe('speakers (X-28) and transcript blocks (acceptance 3)', () => {
  it('maps speakers by email: members by member name, people as records, unknown keep their name', async () => {
    const f = await callFixture('Speakers call');
    const recording = await calls.meetings.recordings.create(f.ctx, {
      id: newId(),
      meetingId: f.meetingId,
      transcript: transcript(f),
    });
    const view = await calls.calls.transcript(f.ctx, { recordingId: recording.id });
    const meeting = await calls.meetings.get(f.ctx, f.meetingId);
    const janeParticipant = meeting.participants.find((p) => p.emailAddress === f.jane);
    expect(view.speakers.map((s) => [s.kind, s.name, s.providedName, s.memberId !== null])).toEqual([
      ['member', 'Ada Lovelace', 'ada', true],
      ['person', 'Jane Cooper', 'Jane C.', false],
      ['unknown', 'Wade', 'Wade', false],
    ]);
    const [ada, jane, wade] = view.speakers;
    expect(ada).toMatchObject({ memberId: f.memberId, isOrganizer: true, emailAddress: f.adaEmail });
    expect(jane).toMatchObject({
      participantId: janeParticipant?.id,
      person: { entityInstanceId: f.janePersonId },
      emailAddress: f.jane,
    });

    // Consecutive segments of one speaker → one block; a 3 s pause → a new paragraph; 25 s of silence → a new block.
    expect(view.blocks.map((b) => [b.speakerId, b.paragraphs.map((p) => p.utteranceIndexes)])).toEqual([
      [ada?.id, [[0]]],
      [jane?.id, [[1, 2], [3]]],
      [ada?.id, [[4]]],
      [ada?.id, [[5]]],
      [wade?.id, [[6]]],
    ]);
    expect(view.text.split('\n')).toEqual([
      '[0:00] Ada Lovelace: Hi Jane, thanks for joining.',
      '[0:03] Jane Cooper: Happy to be here. We spend hours writing meeting notes by hand.',
      'Our budget for this is approved for Q4.',
      '[0:16] Ada Lovelace: Great, let us plan a two-week pilot.',
      '[0:45] Ada Lovelace: I will send the proposal tomorrow.',
      '[0:49] Wade: Sounds good to me.',
    ]);
    // Range link `?start=4&end=13`: the utterances it covers (the rest renders dimmed).
    const ranged = await calls.calls.transcript(f.ctx, { recordingId: recording.id, range: { start: 4, end: 13 } });
    expect(ranged.range).toEqual({ start: 4, end: 13, firstIndex: 1, lastIndex: 3 });
    expect(ranged.utterances).toHaveLength(7);
    const only = await calls.calls.transcript(f.ctx, {
      recordingId: recording.id,
      range: { start: 4, end: 13 },
      rangeOnly: true,
    });
    expect(only.utterances.map((u) => u.index)).toEqual([1, 2, 3]);

    // Speakers tab: talk time and share (one decimal).
    const stats = await calls.calls.speakers(f.ctx, recording.id);
    expect(stats.map((s) => [s.name, s.talkTimeSeconds, s.talkShare])).toEqual([
      ['Ada Lovelace', 10, 53.6],
      ['Jane Cooper', 7.66, 41.1],
      ['Wade', 1, 5.4],
    ]);
    expect(stats[1]?.segments).toEqual([
      { start: 3.5, end: 5 },
      { start: 5.84, end: 9 },
      { start: 12, end: 15 },
    ]);

    // A manual mapping onto Jane's participant merges Wade into Jane (Speakers tab merge rule).
    await sql`UPDATE call_speakers SET manual_participant_id = ${janeParticipant?.id}::uuid
      WHERE id = ${wade?.id}::uuid`.execute(database.kysely);
    const merged = await calls.calls.transcript(f.ctx, { recordingId: recording.id });
    expect(merged.speakers.map((s) => [s.name, s.speakerIds.length])).toEqual([
      ['Ada Lovelace', 1],
      ['Jane Cooper', 2],
    ]);
    expect(merged.utterances.at(-1)?.speakerId).toBe(jane?.id);

    // The public API keeps segments as imported, with the speaker named by email when given.
    const publicView = await calls.meetings.recordings.get(f.ctx, f.meetingId, recording.id);
    expect(publicView.transcript.segments.map((s) => s.speaker.emailAddress)).toEqual([
      f.adaEmail,
      f.jane,
      f.jane,
      f.jane,
      f.adaEmail,
      f.adaEmail,
      null,
    ]);
  });

  it('remaps speakers when the meeting participants change', async () => {
    const f = await callFixture('Remap call');
    const patEmail = `pat@initech-${f.tag}.com`;
    const recording = await calls.meetings.recordings.create(f.ctx, {
      id: newId(),
      meetingId: f.meetingId,
      transcript: [{ speech: 'Hello', startTime: 0, endTime: 1, speaker: { name: 'Pat', emailAddress: patEmail } }],
    });
    expect((await calls.calls.transcript(f.ctx, { recordingId: recording.id })).speakers[0]?.kind).toBe('unknown');
    const before = await lastChangeId(f.workspaceId);
    await calls.meetings.update(f.ctx, {
      meetingId: f.meetingId,
      participants: [
        { memberId: f.memberId, isOrganizer: true },
        { emailAddress: f.jane, name: 'Jane Cooper' },
        { emailAddress: patEmail, name: 'Pat Smith' },
      ],
    });
    const after = (await calls.calls.transcript(f.ctx, { recordingId: recording.id })).speakers[0];
    expect(after).toMatchObject({ kind: 'person', name: 'Pat Smith' });
    // The call and the Calls tabs of the meeting's records (Pat's new person among them) are invalidated.
    const rows = await changeRows(f.workspaceId, before);
    const pat = meetingPerson(await calls.meetings.get(f.ctx, f.meetingId), patEmail);
    expect(rows.some((r) => r.resource === 'call-recording' && r.resource_id === recording.id)).toBe(true);
    expect(
      rows.some(
        (r) => r.resource === 'call-recording-list' && (r.scope.entityInstanceIds as string[]).includes(pat as string),
      ),
    ).toBe(true);
  });

  it('block rule (pure)', () => {
    const u = (index: number, speakerId: string | null, start: number, end: number) => ({
      index,
      speakerId,
      text: `t${index}`,
      start,
      end,
    });
    expect(
      buildBlocks([u(0, 'a', 0, 1), u(1, 'a', 1.2, 2), u(2, null, 2, 3), u(3, null, 3.1, 4), u(4, 'a', 30, 31)]).map(
        (b) => [b.speakerId, b.paragraphs.length, b.start, b.end],
      ),
    ).toEqual([
      ['a', 1, 0, 2],
      [null, 1, 2, 4],
      ['a', 1, 30, 31],
    ]);
    expect([formatClock(5), formatClock(65.9), formatClock(3725)]).toEqual(['0:05', '1:05', '1:02:05']);
  });
});

describe('calls list (10.11)', () => {
  it('filters by record, participant, team and status; searches title and transcript; groups; favourites', async () => {
    const f = await callFixture('Kickoff with Northwind');
    const bob = await addMember(f, 'Bob');
    const team = await calls.teams.create(f.ctx, {
      id: newId(),
      name: `Sales ${f.tag}`,
      memberIds: [f.memberId],
    });
    const a = await calls.meetings.recordings.create(f.ctx, {
      id: newId(),
      meetingId: f.meetingId,
      transcript: transcript(f),
    });
    // A second, older meeting with Bob only and no records.
    const oldMeeting = newId();
    await calls.meetings.create(f.ctx, {
      id: oldMeeting,
      title: 'Internal sync',
      start: { datetime: iso(-24 * 800) },
      end: { datetime: iso(-24 * 800 + 0.5) },
      participants: [{ memberId: bob.memberId, isOrganizer: true }],
    });
    const b = await calls.meetings.recordings.create(f.ctx, {
      id: newId(),
      meetingId: oldMeeting,
      transcript: [{ speech: 'Quarterly roadmap review', startTime: 0, endTime: 4, speaker: { name: 'Bob' } }],
    });
    const ids = async (input: Parameters<typeof calls.calls.list>[1]) =>
      (await calls.calls.list(f.ctx, { groupBy: 'none', ...input })).items.map((i) => i.id);

    expect(await ids({})).toEqual([a.id, b.id]);
    expect(await ids({ sort: { field: 'meeting-start-at', direction: 'asc' } })).toEqual([b.id, a.id]);
    const linked = { entityDefinitionId: 'companies', entityInstanceId: f.initech };
    expect(await ids({ filters: [{ field: 'record', operator: 'eq', value: linked }] })).toEqual([a.id]);
    expect(await ids({ filters: [{ field: 'record', mode: 'must-not', operator: 'eq', value: linked }] })).toEqual([
      b.id,
    ]);
    expect(
      await ids({ filters: [{ field: 'participants', operator: 'eq', value: { memberId: bob.memberId } }] }),
    ).toEqual([b.id]);
    expect(
      await ids({
        filters: [
          {
            field: 'participants',
            operator: 'eq',
            value: { entityDefinitionId: 'people', entityInstanceId: f.janePersonId },
          },
        ],
      }),
    ).toEqual([a.id]);
    expect(
      await ids({ filters: [{ field: 'participants-teams', operator: 'contains', value: { teamId: team.id } }] }),
    ).toEqual([a.id]);
    expect(await ids({ filters: [{ field: 'status', operator: 'eq', value: 'processing' }] })).toEqual([]);
    expect(await ids({ filters: [{ field: 'meeting-start-at', operator: 'lt', value: iso(-24 * 30) }] })).toEqual([
      b.id,
    ]);
    // `?query=`: meeting title or transcript text, case-insensitive; LIKE wildcards are literal.
    expect(await ids({ query: 'northwind' })).toEqual([a.id]);
    expect(await ids({ query: 'ROADMAP' })).toEqual([b.id]);
    expect(await ids({ query: '100%' })).toEqual([]);

    // Date groups (viewer time zone and week start): today's call first, the old one "older".
    const grouped = await calls.calls.list(f.ctx, { timeZone: 'Europe/Moscow' });
    expect(grouped.groups.map((g) => g.count)).toEqual([1, 1]);
    expect(grouped.groups.at(-1)?.key).toBe('older');
    expect(grouped.items.map((i) => [i.id, i.dateGroup])).toEqual([
      [a.id, grouped.groups[0]?.key],
      [b.id, 'older'],
    ]);
    const ascending = await calls.calls.list(f.ctx, { sort: { field: 'meeting-start-at', direction: 'asc' } });
    expect(ascending.groups[0]?.key).toBe('older');

    // Paging.
    const first = await calls.calls.list(f.ctx, { groupBy: 'none', limit: 1 });
    expect(first.total).toBe(2);
    const second = await calls.calls.list(f.ctx, { groupBy: 'none', limit: 1, cursor: first.nextCursor ?? '' });
    expect(second.items.map((i) => i.id)).toEqual([b.id]);
    expect(second.nextCursor).toBeNull();

    // Favourites strip: only without filters / query; item flags.
    await calls.favorites.put(f.ctx, { id: newId(), favoriteType: 'call-recording', targetId: b.id });
    const withFavs = await calls.calls.list(f.ctx, { includeFavorites: true, groupBy: 'none' });
    expect(withFavs.favorites?.map((i) => i.id)).toEqual([b.id]);
    expect(withFavs.items.map((i) => i.isFavorite)).toEqual([false, true]);
    expect((await calls.calls.list(f.ctx, { includeFavorites: true, query: 'x' })).favorites).toBeNull();
    const sidebar = await calls.favorites.list(f.ctx);
    expect(sidebar.favorites.find((x) => x.targetId === b.id)?.target).toMatchObject({
      state: 'ok',
      label: 'Internal sync',
    });

    // Item shape: linked records, participants, duration from the meeting.
    const item = (await calls.calls.list(f.ctx, { groupBy: 'none' })).items[0];
    expect(item).toMatchObject({
      title: 'Kickoff with Northwind',
      access: 'full-access',
      linkedRecords: [{ entityInstanceId: f.initech }],
      durationSeconds: 1800,
    });
    expect(item?.participants.map((p) => p.emailAddress)).toEqual([f.adaEmail, f.jane]);
    // Call cards of meetings (activity meeting card).
    expect((await calls.calls.byMeetings(f.ctx, [f.meetingId, oldMeeting])).map((c) => c.id).sort()).toEqual(
      [a.id, b.id].sort(),
    );
  });
});

describe('call-recording.created (webhook + workflow trigger)', () => {
  it('fires once processing completed, with the importer as actor; starts workflows', async () => {
    const hooks = createDomain({ database, storage, llm });
    const f = await callFixture('Webhook call');
    const webhook = await hooks.webhooks.create(f.ctx, {
      targetUrl: 'https://hooks.example.com/calls',
      subscriptions: [{ eventType: 'call-recording.created', filter: null }],
    });

    // A live workflow on the trigger.
    const { domain: wf, settle } = await import('./workflows-fixtures.ts');
    const triggerId = newId();
    const { workflowId } = await buildWorkflow(
      f,
      [
        { id: triggerId, slug: 'on-call-recording-created' },
        {
          slug: 'create-task',
          config: {
            content: cfg.text('Follow up on the call'),
            assignees: { type: 'array', items: [{ type: 'actor', actorId: f.memberId }] },
          },
        },
      ],
      [[0, 'done', 1]],
      'Call follow-up',
    );
    await wf.workflows.publish(f.ctx, { workflowId });

    const recording = await hooks.meetings.recordings.create(f.ctx, {
      id: newId(),
      meetingId: f.meetingId,
      transcript: transcript(f),
    });
    expect(recording.status).toBe('completed');

    // Fan out (global, like the worker) and read this webhook's delivery: delivering is not this test's business
    // (deliverDue is global too and would race the webhooks suite's own sender).
    const deadline = Date.now() + 45_000;
    let deliveries = await hooks.webhooks.deliveries(f.ctx, { webhookId: webhook.id });
    while (deliveries.length === 0 && Date.now() < deadline) {
      await hooks.webhooks.fanOut();
      deliveries = await hooks.webhooks.deliveries(f.ctx, { webhookId: webhook.id });
      if (deliveries.length === 0) await new Promise((r) => setTimeout(r, 50));
    }
    expect(deliveries.map((d) => d.eventType)).toEqual(['call-recording.created']);
    expect(deliveries[0]?.payload).toEqual({
      webhook_id: webhook.id,
      events: [
        {
          event_type: 'call-recording.created',
          id: { workspace_id: f.workspaceId, meeting_id: f.meetingId, call_recording_id: recording.id },
          actor: { type: 'workspace-member', id: f.memberId },
        },
      ],
    });

    const runs = await settle(f, workflowId, 1);
    expect(runs.map((r) => r.status)).toEqual(['completed']);
    const run = await wf.workflows.runs.get(f.ctx, { runId: runs[0]?.id as string });
    const trigger = run.executions.find((e) => e.blockId === triggerId);
    expect(trigger?.outputs?.call_recording).toEqual({ meeting_id: f.meetingId, call_recording_id: recording.id });
  });
});
