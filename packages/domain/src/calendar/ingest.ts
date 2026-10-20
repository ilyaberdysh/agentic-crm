// Calendar ingestion (BACKLOG 7.04): applies a page of connector calendar changes in the caller's transaction. One
// meeting per iCalUID across mailboxes; each mailbox keeps its calendar_events copy. The latest synced copy wins for
// title / time / status; participants are upserted by address (ids stay stable for transcript speaker mapping) and
// matched to members / people / companies with record auto-creation (mode all or selective: calendar participants
// are created; none: matching only). A meeting whose last copy is deleted is deleted.
import type { MeetingParticipantStatus } from '@agentic-crm/contracts';
import type { CalendarChange, ConnectorEvent, ConnectorEventTime } from '../connectors/types.ts';
import { type IngestEffects, type IngestMailbox } from '../email/ingest.ts';
import { type Address, toAddress } from '../email/model.ts';
import { RecordResolver } from '../email/records.ts';
import { newId } from '../ids.ts';
import type { Tx } from '../tx.ts';
import { normalizeTimestamp } from '../values/normalize.ts';

export interface MeetingTimes {
  isAllDay: boolean;
  startAt: string;
  endAt: string;
  startTimezone: string | null;
  endTimezone: string | null;
  startDate: string | null;
  endDate: string | null;
}

/** Connector / API times → stored columns (all-day: dates at 00:00 UTC, end exclusive). */
export function meetingTimes(start: ConnectorEventTime, end: ConnectorEventTime): MeetingTimes | null {
  if ('date' in start && 'date' in end) {
    return {
      isAllDay: true,
      startAt: `${start.date}T00:00:00.000000Z`,
      endAt: `${end.date}T00:00:00.000000Z`,
      startTimezone: null,
      endTimezone: null,
      startDate: start.date,
      endDate: end.date,
    };
  }
  if ('dateTime' in start && 'dateTime' in end) {
    const startAt = normalizeTimestamp(start.dateTime);
    const endAt = normalizeTimestamp(end.dateTime);
    if (!startAt || !endAt) return null;
    return {
      isAllDay: false,
      startAt,
      endAt,
      startTimezone: start.timeZone ?? null,
      endTimezone: end.timeZone ?? null,
      startDate: null,
      endDate: null,
    };
  }
  return null;
}

export interface ParticipantInput {
  address: Address | null;
  name: string | null;
  memberId: string | null;
  isOrganizer: boolean;
  status: MeetingParticipantStatus;
}

/**
 * Replaces a meeting's participants with `inputs` (matched by address, then by name for address-less ones): rows
 * keep their ids when the address stays. Returns the records the participants point at (old and new).
 */
export async function writeParticipants(
  tx: Tx,
  resolver: RecordResolver,
  meetingId: string,
  inputs: ParticipantInput[],
  options: { createPeople: boolean },
  effects: IngestEffects,
): Promise<void> {
  const current = await tx.db
    .selectFrom('meeting_participants')
    .selectAll()
    .where('meeting_id', '=', meetingId)
    .orderBy('position')
    .execute();
  for (const row of current) {
    if (row.person_id) effects.addRecord(resolver.peopleId, row.person_id);
    if (row.company_id) effects.addRecord(resolver.companiesId, row.company_id);
  }
  const keyOf = (email: string | null, name: string | null) => (email ? `e:${email}` : `n:${name ?? ''}`);
  const byKey = new Map(current.map((r) => [keyOf(r.email_address, r.name), r]));
  const seen = new Set<string>();
  let position = 0;
  for (const input of inputs) {
    const key = keyOf(input.address?.email ?? null, input.address?.name ?? input.name);
    if (seen.has(key)) continue;
    seen.add(key);
    const match = input.address
      ? await resolver.match(input.address, { createPerson: options.createPeople })
      : { memberId: null, personId: null, companyId: null };
    const values = {
      position: position++,
      email_address: input.address?.email ?? null,
      original_email_address: input.address?.original ?? null,
      domain: input.address?.domain ?? null,
      name: input.address?.name ?? input.name,
      is_organizer: input.isOrganizer,
      status: input.status,
      member_id: input.memberId ?? match.memberId,
      person_id: match.personId,
      company_id: match.companyId,
    };
    const existing = byKey.get(key);
    if (existing) {
      await tx.db.updateTable('meeting_participants').set(values).where('id', '=', existing.id).execute();
    } else {
      await tx.db
        .insertInto('meeting_participants')
        .values({ id: newId(), workspace_id: tx.workspaceId, meeting_id: meetingId, ...values })
        .execute();
    }
    if (match.personId) effects.addRecord(resolver.peopleId, match.personId);
    if (match.companyId) effects.addRecord(resolver.companiesId, match.companyId);
  }
  const stale = current.filter((r) => !seen.has(keyOf(r.email_address, r.name))).map((r) => r.id);
  if (stale.length > 0) {
    await tx.db
      .updateTable('call_transcript_segments')
      .set({ participant_id: null })
      .where('participant_id', 'in', stale)
      .execute();
    await tx.db.deleteFrom('meeting_participants').where('id', 'in', stale).execute();
  }
}

/** Every record a meeting is associated with (participants' people / companies and linked records). */
export async function meetingRecords(tx: Tx, meetingId: string, effects: IngestEffects): Promise<void> {
  const resolver = await RecordResolver.create(tx);
  const participants = await tx.db
    .selectFrom('meeting_participants')
    .select(['person_id', 'company_id'])
    .where('meeting_id', '=', meetingId)
    .execute();
  for (const p of participants) {
    if (p.person_id) effects.addRecord(resolver.peopleId, p.person_id);
    if (p.company_id) effects.addRecord(resolver.companiesId, p.company_id);
  }
  const linked = await tx.db
    .selectFrom('meeting_records')
    .select(['entity_definition_id', 'entity_instance_id'])
    .where('meeting_id', '=', meetingId)
    .execute();
  for (const r of linked) effects.addRecord(r.entity_definition_id, r.entity_instance_id);
  effects.meetings.add(meetingId);
}

async function removeEventCopy(tx: Tx, mailboxId: string, providerEventId: string, effects: IngestEffects) {
  const copy = await tx.db
    .updateTable('calendar_events')
    .set({ deleted_at: tx.now })
    .where('mailbox_id', '=', mailboxId)
    .where('provider_event_id', '=', providerEventId)
    .where('deleted_at', 'is', null)
    .returning('meeting_id')
    .executeTakeFirst();
  if (!copy) return;
  effects.deleted++;
  await meetingRecords(tx, copy.meeting_id, effects);
  const live = await tx.db
    .selectFrom('calendar_events')
    .select('id')
    .where('meeting_id', '=', copy.meeting_id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!live) {
    await tx.db
      .updateTable('meetings')
      .set({ deleted_at: tx.now, deleted_by: JSON.stringify(tx.ctx.actor), updated_at: tx.now })
      .where('id', '=', copy.meeting_id)
      .where('source', '=', 'calendar')
      .where('deleted_at', 'is', null)
      .execute();
  }
}

async function ingestEvent(
  tx: Tx,
  resolver: RecordResolver,
  mailbox: IngestMailbox,
  event: ConnectorEvent,
  effects: IngestEffects,
): Promise<void> {
  const times = meetingTimes(event.start, event.end);
  const attendees = (event.attendees ?? []).map((a) => ({ ...a, address: toAddress(a.emailAddress, a.name) }));
  const own = new Set([mailbox.emailAddress, ...mailbox.aliases].map((a) => toAddress(a)?.email));
  const blocked = attendees.some((a) => a.address && !own.has(a.address.email) && resolver.isBlocked(a.address));
  if (!times || blocked) {
    await removeEventCopy(tx, mailbox.id, event.providerEventId, effects);
    effects.skipped++;
    return;
  }
  const copy = await tx.db
    .selectFrom('calendar_events')
    .select(['id', 'meeting_id'])
    .where('mailbox_id', '=', mailbox.id)
    .where('provider_event_id', '=', event.providerEventId)
    .executeTakeFirst();
  let meetingId = copy?.meeting_id ?? null;
  if (meetingId) {
    const alive = await tx.db
      .selectFrom('meetings')
      .select('id')
      .where('id', '=', meetingId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!alive) meetingId = null;
  }
  if (!meetingId) {
    const byUid = await tx.db
      .selectFrom('meetings')
      .select('id')
      .where('ical_uid', '=', event.icalUid)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    meetingId = byUid?.id ?? null;
  }
  const fields = {
    title: event.title ?? '',
    description: event.description ?? '',
    is_all_day: times.isAllDay,
    start_at: times.startAt,
    end_at: times.endAt,
    start_timezone: times.startTimezone,
    end_timezone: times.endTimezone,
    start_date: times.startDate,
    end_date: times.endDate,
    status: event.status ?? 'confirmed',
    conference_url: event.conferenceUrl ?? null,
    location: event.location ?? null,
    updated_at: tx.now,
  };
  if (meetingId) {
    await tx.db.updateTable('meetings').set(fields).where('id', '=', meetingId).execute();
  } else {
    meetingId = newId();
    await tx.db
      .insertInto('meetings')
      .values({
        id: meetingId,
        workspace_id: tx.workspaceId,
        ical_uid: event.icalUid,
        source: 'calendar',
        created_by: JSON.stringify(tx.ctx.actor),
        ...fields,
      })
      .execute();
  }
  const createPeople = resolver.settings.recordCreation !== 'none';
  await writeParticipants(
    tx,
    resolver,
    meetingId,
    attendees.map((a) => ({
      address: a.address,
      name: a.name ?? null,
      memberId: null,
      isOrganizer: a.isOrganizer,
      status: a.status,
    })),
    { createPeople },
    effects,
  );
  const selfStatus = attendees.find((a) => a.address && own.has(a.address.email))?.status ?? 'accepted';
  if (copy) {
    await tx.db
      .updateTable('calendar_events')
      .set({ meeting_id: meetingId, self_status: selfStatus, synced_at: tx.now, deleted_at: null })
      .where('id', '=', copy.id)
      .execute();
  } else {
    await tx.db
      .insertInto('calendar_events')
      .values({
        id: newId(),
        workspace_id: tx.workspaceId,
        meeting_id: meetingId,
        mailbox_id: mailbox.id,
        member_id: mailbox.memberId,
        provider_event_id: event.providerEventId,
        self_status: selfStatus,
      })
      .execute();
  }
  await meetingRecords(tx, meetingId, effects);
  effects.events++;
}

/** Applies a page of calendar changes of one mailbox. */
export async function ingestCalendarChanges(
  tx: Tx,
  mailbox: IngestMailbox,
  changes: CalendarChange[],
  effects: IngestEffects,
): Promise<void> {
  const resolver = await RecordResolver.create(tx);
  for (const change of changes) {
    if (change.type === 'delete') await removeEventCopy(tx, mailbox.id, change.providerEventId, effects);
    else await ingestEvent(tx, resolver, mailbox, change.event, effects);
  }
}
