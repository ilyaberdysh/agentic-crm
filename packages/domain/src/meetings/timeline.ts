// Meeting events of the record activity timeline (F README §2.5; CROSS-DOMAIN B.26; category `calendar`): one event
// per meeting of the record (participants' people / companies and linked records), at its start. Past meetings page
// backwards with the rest of the feed; upcoming ones page forwards ("Upcoming" group). The actor is the member taking
// part (organizer first) and `memberStatus` their response — "attended" / "is attending" / "declined a meeting
// invitation" in the UI. Deleted meetings and meetings the viewer may not see are left out.
import type { Actor, TimelineEvent } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { meetingAccess } from '../email/access.ts';
import type { Tx } from '../tx.ts';

interface Row {
  id: string;
  start_at: string;
  member_id: string | null;
  member_status: 'accepted' | 'tentative' | 'declined' | 'pending' | null;
}

export async function meetingEvents(
  tx: Tx,
  recordId: string,
  window:
    | { mode: 'past'; upTo: string; now: string; limit: number }
    | { mode: 'upcoming'; after: string; now: string; limit: number },
): Promise<TimelineEvent[]> {
  const range =
    window.mode === 'past'
      ? sql`m.start_at <= ${window.now}::timestamptz AND m.start_at <= ${window.upTo}::timestamptz`
      : sql`m.start_at > ${window.now}::timestamptz AND m.start_at >= ${window.after}::timestamptz`;
  const order = window.mode === 'past' ? sql.raw('DESC') : sql.raw('ASC');
  const { rows } = await sql<Row>`
    SELECT m.id, m.start_at, p.member_id, p.status AS member_status
    FROM meetings m
    LEFT JOIN LATERAL (
      SELECT p.member_id, p.status FROM meeting_participants p
      WHERE p.meeting_id = m.id AND p.member_id IS NOT NULL
      ORDER BY p.is_organizer DESC, p.position LIMIT 1
    ) p ON true
    WHERE m.deleted_at IS NULL AND ${range} AND (
      EXISTS (SELECT 1 FROM meeting_participants x WHERE x.meeting_id = m.id
              AND (x.person_id = ${recordId}::uuid OR x.company_id = ${recordId}::uuid))
      OR EXISTS (SELECT 1 FROM meeting_records r WHERE r.meeting_id = m.id AND r.entity_instance_id = ${recordId}::uuid))
    ORDER BY m.start_at ${order}, m.id ${order}
    LIMIT ${window.limit + 50}`.execute(tx.db);
  const access = await meetingAccess(
    tx,
    rows.map((r) => r.id),
  );
  return rows
    .filter((r) => (access.get(r.id)?.access ?? 'none') !== 'none')
    .map((r) => {
      const actor: Actor | null = r.member_id ? { type: 'workspace-member', id: r.member_id } : null;
      return {
        id: `meeting:${r.id}`,
        category: 'calendar' as const,
        occurredAt: r.start_at,
        actor,
        isBackground: false,
        eventType: 'meeting' as const,
        meetingId: r.id,
        memberStatus: r.member_status,
      };
    });
}
