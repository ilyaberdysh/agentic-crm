// Meetings (BACKLOG 7.04): calendar ingestion (one meeting per iCalUID across mailboxes, participants matched and
// created, cancellations and deletions), manual meetings (create / update / delete, linked records append / replace),
// read-only synced meetings, visibility through calendar copies, timeline meeting events (past and upcoming) and
// transcript-only call recordings (raw transcript, speaker mapping).
import { describe, expect, it } from 'vitest';
import { rawTranscript } from '../src/index.ts';
import { emailFixture, injectEvent, iso, memberWithMailbox, plainMember, recordsByValue } from './email-fixtures.ts';
import { domain, expectCode, newId } from './support/harness.ts';

describe('calendar ingestion', () => {
  it('one meeting per iCalUID across mailboxes; participants matched to members and records', async () => {
    const f = await emailFixture({ recordCreation: 'selective' });
    const bob = await memberWithMailbox(f, 'Bob');
    const jane = `jane@northwind-${f.tag}.com`;
    const event = {
      icalUid: `kickoff-${f.tag}`,
      title: 'Kickoff',
      description: 'Plan the pilot',
      start: { dateTime: iso(-2), timeZone: 'Europe/Moscow' },
      end: { dateTime: iso(-1), timeZone: 'Europe/Moscow' },
      attendees: [
        { emailAddress: f.ada.address, status: 'accepted' as const, isOrganizer: true },
        { emailAddress: bob.address, status: 'accepted' as const },
        { emailAddress: jane, name: 'Jane Cooper', status: 'tentative' as const },
      ],
    };
    const first = await injectEvent(f.ada, { ...event, providerEventId: 'ada-ev' });
    expect(first.sync).toMatchObject({ events: 1 });
    await injectEvent(bob, { ...event, providerEventId: 'bob-ev', title: 'Kickoff (updated)' });
    // Selective mode: calendar participants create records.
    const [person] = await recordsByValue(f, 'people', jane);
    const [company] = await recordsByValue(f, 'companies', `northwind-${f.tag}.com`);
    expect(person).toBeDefined();
    expect(company).toBeDefined();
    const { meetings } = await domain.meetings.list(f.ctx, {
      record: { entityDefinitionId: 'people', entityInstanceId: person as string },
    });
    expect(meetings).toHaveLength(1);
    const meeting = meetings[0];
    expect(meeting).toMatchObject({
      source: 'calendar',
      title: 'Kickoff (updated)',
      isReadOnly: true,
      status: 'confirmed',
      start: { timezone: 'Europe/Moscow' },
    });
    expect(meeting?.calendarCopies).toHaveLength(2);
    expect(meeting?.participants.map((p) => [p.emailAddress, p.memberId !== null, p.personId, p.isOrganizer])).toEqual([
      [f.ada.address, true, null, true],
      [bob.address, true, null, false],
      [jane, false, person, false],
    ]);
    // The company's meetings include it too (participants' companies).
    const byCompany = await domain.meetings.list(f.ctx, {
      record: { entityDefinitionId: 'companies', entityInstanceId: company as string },
    });
    expect(byCompany.meetings.map((m) => m.id)).toEqual([meeting?.id]);
    // Synced meetings: details are read-only, linked records are not.
    await expectCode(
      domain.meetings.update(f.ctx, { meetingId: meeting?.id as string, title: 'Renamed' }),
      'VALIDATION_ERROR',
      400,
    );
    // Removing one copy keeps the meeting; removing the last deletes it.
    await domain.connectors.test.remove(f.ctx, {
      mailboxId: f.ada.mailboxId,
      kind: 'event',
      providerId: 'ada-ev',
      syncNow: true,
    });
    expect((await domain.meetings.get(f.ctx, meeting?.id as string)).calendarCopies).toHaveLength(1);
    await domain.connectors.test.remove(bob.ctx, {
      mailboxId: bob.mailboxId,
      kind: 'event',
      providerId: 'bob-ev',
      syncNow: true,
    });
    await expectCode(domain.meetings.get(f.ctx, meeting?.id as string), 'NOT_FOUND', 404);
  });

  it('metadata-only calendars hide the title from others; attendees always see it', async () => {
    const f = await emailFixture({ recordCreation: 'none' });
    await domain.mailboxes.update(f.ctx, { mailboxId: f.ada.mailboxId, defaultVisibility: 'metadata-only' });
    const cara = await plainMember(f, 'Cara');
    const dan = await plainMember(f, 'Dan');
    const members = await domain.members.list(f.ctx);
    const danEmail = members.find((m) => m.id === dan.memberId)?.emailAddress as string;
    await injectEvent(f.ada, {
      icalUid: `secret-${f.tag}`,
      title: 'Acquisition talks',
      description: 'Very secret',
      start: { dateTime: iso(5) },
      end: { dateTime: iso(6) },
      attendees: [
        { emailAddress: f.ada.address, status: 'accepted', isOrganizer: true },
        { emailAddress: danEmail, status: 'pending' },
      ],
    });
    const mine = await domain.meetings.list(f.ctx, { mine: true });
    const id = mine.meetings[0]?.id as string;
    expect(mine.meetings[0]).toMatchObject({
      title: 'Acquisition talks',
      description: 'Very secret',
      access: 'full-access',
    });
    expect(await domain.meetings.get(cara.ctx, id)).toMatchObject({
      access: 'metadata-only',
      title: null,
      description: null,
    });
    expect(await domain.meetings.get(dan.ctx, id)).toMatchObject({ access: 'full-access', title: 'Acquisition talks' });
    expect((await domain.meetings.list(cara.ctx, { mine: true })).meetings).toEqual([]);
    expect((await domain.meetings.list(dan.ctx, { mine: true })).meetings.map((m) => m.id)).toEqual([id]);
  });
});

describe('manual meetings', () => {
  it('create / update / delete with participants and linked records', async () => {
    const f = await emailFixture({ recordCreation: 'all' });
    const dealCompany = newId();
    await domain.records.create(f.ctx, {
      entityDefinitionId: 'companies',
      entityInstanceId: dealCompany,
      values: { name: [{ value: 'Globex' }] },
    });
    const other = newId();
    await domain.records.create(f.ctx, {
      entityDefinitionId: 'companies',
      entityInstanceId: other,
      values: { name: [{ value: 'Initech' }] },
    });
    const id = newId();
    const created = await domain.meetings.create(f.ctx, {
      id,
      title: 'Demo',
      description: 'Product demo',
      start: { datetime: iso(24), timezone: 'UTC' },
      end: { datetime: iso(25), timezone: 'UTC' },
      participants: [
        { memberId: f.memberId, isOrganizer: true },
        { emailAddress: `buyer@globex-${f.tag}.com`, name: 'Bea Buyer' },
      ],
      linkedRecords: [{ entityDefinitionId: 'companies', entityInstanceId: dealCompany }],
    });
    expect(created).toMatchObject({ source: 'manual', title: 'Demo', isReadOnly: false, access: 'full-access' });
    expect(created.linkedRecords).toEqual([{ entityDefinitionId: f.companies, entityInstanceId: dealCompany }]);
    expect(created.participants[1]?.personId).not.toBeNull();
    // Idempotent create.
    expect(
      (await domain.meetings.create(f.ctx, { id, title: 'x', start: { datetime: iso(1) }, end: { datetime: iso(2) } }))
        .title,
    ).toBe('Demo');
    const appended = await domain.meetings.update(f.ctx, {
      meetingId: id,
      linkedRecords: [{ entityDefinitionId: 'companies', entityInstanceId: other }],
      linkedRecordsMode: 'append',
    });
    expect(appended.linkedRecords.map((r) => r.entityInstanceId)).toEqual([dealCompany, other]);
    const replaced = await domain.meetings.update(f.ctx, {
      meetingId: id,
      title: 'Demo v2',
      start: { date: '2027-01-10' },
      end: { date: '2027-01-11' },
      isAllDay: true,
      linkedRecords: [{ entityDefinitionId: 'companies', entityInstanceId: other }],
    });
    expect(replaced).toMatchObject({
      title: 'Demo v2',
      isAllDay: true,
      start: { date: '2027-01-10', at: '2027-01-10T00:00:00.000000Z' },
    });
    expect(replaced.linkedRecords.map((r) => r.entityInstanceId)).toEqual([other]);
    await expectCode(
      domain.meetings.update(f.ctx, { meetingId: id, start: { datetime: iso(1) }, end: { datetime: iso(2) } }),
      'VALIDATION_ERROR',
      400,
    );
    await expectCode(
      domain.meetings.create(f.ctx, {
        id: newId(),
        title: 'Backwards',
        start: { datetime: iso(2) },
        end: { datetime: iso(1) },
      }),
      'VALIDATION_ERROR',
      400,
    );
    await domain.meetings.delete(f.ctx, id);
    await expectCode(domain.meetings.get(f.ctx, id), 'NOT_FOUND', 404);
  });

  it('timeline: past meetings in the feed, upcoming ones in the upcoming page', async () => {
    const f = await emailFixture({ recordCreation: 'all' });
    const company = newId();
    await domain.records.create(f.ctx, {
      entityDefinitionId: 'companies',
      entityInstanceId: company,
      values: { name: [{ value: 'Umbrella' }] },
    });
    const past = newId();
    const future = newId();
    for (const [id, offset] of [
      [past, -30],
      [future, 30],
    ] as const) {
      await domain.meetings.create(f.ctx, {
        id,
        title: id === past ? 'Retro' : 'Planning',
        start: { datetime: iso(offset) },
        end: { datetime: iso(offset + 1) },
        participants: [{ memberId: f.memberId, isOrganizer: true, status: 'accepted' }],
        linkedRecords: [{ entityDefinitionId: 'companies', entityInstanceId: company }],
      });
    }
    const record = { entityDefinitionId: 'companies', entityInstanceId: company };
    const feed = await domain.timeline.list(f.ctx, { ...record, filters: ['calendar'] });
    expect(feed.events).toEqual([
      {
        kind: 'single',
        event: expect.objectContaining({
          eventType: 'meeting',
          category: 'calendar',
          meetingId: past,
          memberStatus: 'accepted',
          actor: { type: 'workspace-member', id: f.memberId },
        }),
      },
    ]);
    const upcoming = await domain.timeline.list(f.ctx, { ...record, mode: 'upcoming' });
    expect(
      upcoming.events.map((e) => (e.kind === 'single' && e.event.eventType === 'meeting' ? e.event.meetingId : null)),
    ).toEqual([future]);
  });
});

describe('call recordings (transcript-only)', () => {
  it('stores segments, maps speakers to participants and builds the raw transcript', async () => {
    const f = await emailFixture({ recordCreation: 'all' });
    const meetingId = newId();
    await domain.meetings.create(f.ctx, {
      id: meetingId,
      title: 'Discovery call',
      start: { datetime: iso(-3) },
      end: { datetime: iso(-2.5) },
      participants: [
        { memberId: f.memberId, isOrganizer: true },
        { emailAddress: `jane@northwind-${f.tag}.com`, name: 'Jane' },
      ],
    });
    const recordingId = newId();
    const created = await domain.meetings.recordings.create(f.ctx, {
      id: recordingId,
      meetingId,
      transcript: [
        {
          speech: 'Hello!',
          startTime: 2,
          endTime: 3,
          speaker: { name: 'Jane', emailAddress: `jane@northwind-${f.tag}.com` },
        },
        {
          speech: 'How are you?',
          startTime: 3.5,
          endTime: 5,
          speaker: { name: 'Jane', emailAddress: `jane@northwind-${f.tag}.com` },
        },
        { speech: 'Great.', startTime: 3725, endTime: 3727, speaker: { name: 'Ada' } },
      ],
    });
    expect(created).toMatchObject({ status: 'completed', videoUrl: null, meetingId });
    const full = await domain.meetings.recordings.get(f.ctx, meetingId, recordingId);
    expect(full.transcript.rawTranscript).toBe(
      `[00:00:02] jane@northwind-${f.tag}.com: Hello! How are you?\n[01:02:05] Ada: Great.`,
    );
    const meeting = await domain.meetings.get(f.ctx, meetingId);
    const jane = meeting.participants.find((p) => p.emailAddress === `jane@northwind-${f.tag}.com`);
    expect(full.transcript.segments[0]?.speaker.participantId).toBe(jane?.id);
    expect(full.transcript.segments[2]?.speaker.participantId).toBeNull();
    expect(meeting.callRecordingIds).toEqual([recordingId]);
    expect(await domain.meetings.recordings.list(f.ctx, meetingId)).toHaveLength(1);
    await domain.meetings.recordings.delete(f.ctx, meetingId, recordingId);
    expect(await domain.meetings.recordings.list(f.ctx, meetingId)).toEqual([]);
    expect(rawTranscript([])).toBe('');
  });
});
