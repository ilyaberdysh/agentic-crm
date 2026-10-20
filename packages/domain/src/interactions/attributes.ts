// Interaction attributes (BACKLOG 7.05; A README §4.14, attribute-types §3.16): the read-only system attributes
// first / last / next × any / calendar / email interaction on people and companies, recomputed from the stored
// emails and meetings and written through the single write path (engine, system privileges) — values history and
// change_log come for free, and the attributes filter / sort like any other.
//
//   email     messages associated with the record that still have a live copy; first = earliest, last = latest
//             (sent at or before now); owner = the member whose copy it is (outbound copies first)
//   calendar  meetings of the record (participants' people / companies, linked records), not cancelled;
//             first / last = earliest / latest start at or before now; next = earliest start after now
//   any       first = earliest of email / calendar, last = latest, next = next calendar (there is no "next email")
// Value: {interactionType: 'email' | 'meeting', interactedAt, interactionHeaderId (message / meeting id),
// ownerMembershipId, mailboxId}.
import type { ValueInput } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { engineFor } from '../records/engine.ts';
import { type AttrDef, type DefInfo, loadDefinitionsByIds } from '../schema/model.ts';
import type { Tx } from '../tx.ts';

export interface Interaction {
  type: 'email' | 'meeting';
  at: string;
  headerId: string;
  ownerMemberId: string | null;
  mailboxId: string | null;
}

/** System attribute type → which interaction it holds. */
const SLOTS = {
  'first-interaction': 'first',
  'last-interaction': 'last',
  'next-interaction': 'next',
  'first-calendar-interaction': 'firstCalendar',
  'last-calendar-interaction': 'lastCalendar',
  'next-calendar-interaction': 'nextCalendar',
  'first-email-interaction': 'firstEmail',
  'last-email-interaction': 'lastEmail',
} as const;
type Slot = (typeof SLOTS)[keyof typeof SLOTS];

const INTERACTION_TYPES = new Set(['person-record', 'company-record']);

export interface RecordInteractions {
  firstEmail: Interaction | null;
  lastEmail: Interaction | null;
  firstCalendar: Interaction | null;
  lastCalendar: Interaction | null;
  nextCalendar: Interaction | null;
  first: Interaction | null;
  last: Interaction | null;
  next: Interaction | null;
}

interface EmailRow {
  id: string;
  sent_at: string;
  member_id: string;
  mailbox_id: string;
}

interface MeetingRow {
  id: string;
  start_at: string;
  member_id: string | null;
  mailbox_id: string | null;
}

/** Meetings of a record: participants' people / companies and linked records (not deleted, not cancelled). */
export const RECORD_MEETINGS_SQL = (recordId: string) => sql`
  SELECT m.id FROM meetings m
  WHERE m.deleted_at IS NULL AND m.status <> 'cancelled' AND (
    EXISTS (SELECT 1 FROM meeting_participants p WHERE p.meeting_id = m.id
            AND (p.person_id = ${recordId}::uuid OR p.company_id = ${recordId}::uuid))
    OR EXISTS (SELECT 1 FROM meeting_records r WHERE r.meeting_id = m.id AND r.entity_instance_id = ${recordId}::uuid))`;

async function emailBounds(
  tx: Tx,
  recordId: string,
  now: string,
): Promise<{ first: EmailRow | null; last: EmailRow | null }> {
  const pick = async (order: 'asc' | 'desc') => {
    const { rows } = await sql<EmailRow>`
      SELECT m.id, m.sent_at, c.member_id, c.mailbox_id
      FROM email_message_records r
      JOIN email_messages m ON m.id = r.message_id
      JOIN LATERAL (
        SELECT c.member_id, c.mailbox_id FROM email_message_copies c
        JOIN mailboxes mb ON mb.id = c.mailbox_id AND mb.archived_at IS NULL
        WHERE c.message_id = m.id AND c.deleted_at IS NULL
        ORDER BY (c.direction = 'outbound') DESC, c.synced_at, c.id LIMIT 1
      ) c ON true
      WHERE r.entity_instance_id = ${recordId}::uuid AND m.sent_at <= ${now}::timestamptz
      ORDER BY m.sent_at ${sql.raw(order)}, m.id ${sql.raw(order)} LIMIT 1`.execute(tx.db);
    return rows[0] ?? null;
  };
  return { first: await pick('asc'), last: await pick('desc') };
}

async function meetingAt(
  tx: Tx,
  recordId: string,
  now: string,
  which: 'first' | 'last' | 'next',
): Promise<MeetingRow | null> {
  const condition = which === 'next' ? sql`m.start_at > ${now}::timestamptz` : sql`m.start_at <= ${now}::timestamptz`;
  const order = which === 'last' ? sql.raw('DESC') : sql.raw('ASC');
  const { rows } = await sql<MeetingRow>`
    SELECT m.id, m.start_at,
      coalesce(
        (SELECT p.member_id FROM meeting_participants p WHERE p.meeting_id = m.id AND p.member_id IS NOT NULL
         ORDER BY p.is_organizer DESC, p.position LIMIT 1),
        (SELECT e.member_id FROM calendar_events e WHERE e.meeting_id = m.id AND e.deleted_at IS NULL
         ORDER BY e.synced_at LIMIT 1)) AS member_id,
      (SELECT e.mailbox_id FROM calendar_events e WHERE e.meeting_id = m.id AND e.deleted_at IS NULL
       ORDER BY e.synced_at LIMIT 1) AS mailbox_id
    FROM meetings m
    WHERE m.id IN (${RECORD_MEETINGS_SQL(recordId)}) AND ${condition}
    ORDER BY m.start_at ${order}, m.id ${order} LIMIT 1`.execute(tx.db);
  return rows[0] ?? null;
}

const fromEmail = (row: EmailRow | null): Interaction | null =>
  row
    ? { type: 'email', at: row.sent_at, headerId: row.id, ownerMemberId: row.member_id, mailboxId: row.mailbox_id }
    : null;
const fromMeeting = (row: MeetingRow | null): Interaction | null =>
  row
    ? { type: 'meeting', at: row.start_at, headerId: row.id, ownerMemberId: row.member_id, mailboxId: row.mailbox_id }
    : null;

const earliest = (a: Interaction | null, b: Interaction | null) => (!a ? b : !b ? a : a.at <= b.at ? a : b);
const latest = (a: Interaction | null, b: Interaction | null) => (!a ? b : !b ? a : a.at >= b.at ? a : b);

/** The interactions of one record as of `now`. */
export async function computeInteractions(tx: Tx, recordId: string, now: string): Promise<RecordInteractions> {
  const email = await emailBounds(tx, recordId, now);
  const firstEmail = fromEmail(email.first);
  const lastEmail = fromEmail(email.last);
  const firstCalendar = fromMeeting(await meetingAt(tx, recordId, now, 'first'));
  const lastCalendar = fromMeeting(await meetingAt(tx, recordId, now, 'last'));
  const nextCalendar = fromMeeting(await meetingAt(tx, recordId, now, 'next'));
  return {
    firstEmail,
    lastEmail,
    firstCalendar,
    lastCalendar,
    nextCalendar,
    first: earliest(firstEmail, firstCalendar),
    last: latest(lastEmail, lastCalendar),
    next: nextCalendar,
  };
}

function toInput(i: Interaction | null): ValueInput[] {
  if (!i) return [];
  return [
    {
      value: {
        interactionType: i.type,
        interactedAt: i.at,
        interactionHeaderId: i.headerId,
        ownerMembershipId: i.ownerMemberId,
        mailboxId: i.mailboxId,
      },
    },
  ];
}

/**
 * Recomputes and writes the interaction attributes of people / company records (others are ignored). Values that did
 * not change keep their rows (the engine skips unchanged values). The caller finalises the engine.
 */
export async function refreshInteractions(
  tx: Tx,
  records: { entityDefinitionId: string; entityInstanceId: string }[],
  now: string = tx.now,
): Promise<void> {
  if (records.length === 0) return;
  const defs = await loadDefinitionsByIds(
    tx,
    records.map((r) => r.entityDefinitionId),
  );
  const engine = engineFor(tx);
  const live = await tx.db
    .selectFrom('entity_instances')
    .select('id')
    .where(
      'id',
      'in',
      records.map((r) => r.entityInstanceId),
    )
    .where('archived_at', 'is', null)
    .where('merged_at', 'is', null)
    .execute();
  const liveIds = new Set(live.map((r) => r.id));
  const targets = records.filter(
    (r) => liveIds.has(r.entityInstanceId) && INTERACTION_TYPES.has(defs.get(r.entityDefinitionId)?.entityType ?? ''),
  );
  await engine.lock(targets.map((t) => t.entityInstanceId));
  for (const target of targets) {
    const def = defs.get(target.entityDefinitionId) as DefInfo;
    const slots = def.attrs.filter(
      (a): a is AttrDef & { systemAttributeType: keyof typeof SLOTS } =>
        a.type === 'interaction' && !a.isArchived && (a.systemAttributeType ?? '') in SLOTS,
    );
    if (slots.length === 0) continue;
    const interactions = await computeInteractions(tx, target.entityInstanceId, now);
    await engine.asSystem(async () => {
      for (const attr of slots) {
        const slot: Slot = SLOTS[attr.systemAttributeType];
        await engine.setAttribute(def, target.entityInstanceId, attr, toInput(interactions[slot]));
      }
    });
  }
}

/**
 * Records whose next (calendar) interaction is now in the past: their meeting moved from "next" to "last", so they
 * need a refresh (periodic job `interactions.refresh-due`).
 */
export async function recordsWithStaleNext(
  tx: Tx,
  now: string,
  limit = 500,
): Promise<{ entityDefinitionId: string; entityInstanceId: string }[]> {
  const { rows } = await sql<{ entity_definition_id: string; instance_id: string }>`
    SELECT DISTINCT v.entity_definition_id, v.instance_id
    FROM attribute_values v
    JOIN attribute_definitions a ON a.id = v.attribute_id
      AND a.system_attribute_type IN ('next-interaction', 'next-calendar-interaction')
    WHERE v.active_until IS NULL AND v.v_ts <= ${now}::timestamptz
    LIMIT ${limit}`.execute(tx.db);
  return rows.map((r) => ({ entityDefinitionId: r.entity_definition_id, entityInstanceId: r.instance_id }));
}
