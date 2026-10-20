// Connection strength (decision C.4 #12 in slice7-contracts.md; A README §4.14). Attio's formula is unknown; ours:
//
//   score(member, record) = Σ weight × 0.5^(age_days / HALF_LIFE_DAYS) over the member's interactions with the record
//                           in the last WINDOW_DAYS days (nothing in the future counts)
//   weights   email the member synced: 1; an email of a two-way exchange (the member's copies of that thread hold
//             both inbound and outbound messages): 3; a meeting the member takes part in (participant or calendar
//             copy, not declined): 5
//   buckets   ≥ 20 Very strong · ≥ 8 Strong · ≥ 3 Good (the decision's "Moderate") · ≥ 1 Weak · > 0 Very weak ·
//             0 = none (values cleared). The labels are the seeded options of `strongest_connection_strength`.
//
// Per-member scores are stored in connection_strengths; the record's strongest_connection_strength (select),
// strongest_connection_user (the member with the highest score) and the legacy numeric score are written through
// the single write path. Recomputed by the worker job `interactions.connection-strength` after ingestion (or inline
// when no job queue is wired) and daily for decay.
import { sql } from '@agentic-crm/db';
import { engineFor } from '../records/engine.ts';
import { type AttrDef, loadDefinitionsByIds } from '../schema/model.ts';
import type { Tx } from '../tx.ts';
import { RECORD_MEETINGS_SQL } from './attributes.ts';

export const HALF_LIFE_DAYS = 60;
export const WINDOW_DAYS = 365;
export const WEIGHTS = { email: 1, twoWayEmail: 3, meeting: 5 } as const;

export const STRENGTH_BUCKETS: { min: number; label: string }[] = [
  { min: 20, label: 'Very strong' },
  { min: 8, label: 'Strong' },
  { min: 3, label: 'Good' },
  { min: 1, label: 'Weak' },
  { min: Number.MIN_VALUE, label: 'Very weak' },
];

export function bucketOf(score: number): string | null {
  if (!(score > 0)) return null;
  return STRENGTH_BUCKETS.find((b) => score >= b.min)?.label ?? null;
}

const DAY_MS = 86_400_000;
const decay = (at: string, now: number) => 0.5 ** (Math.max(0, now - Date.parse(at)) / DAY_MS / HALF_LIFE_DAYS);

export interface MemberStrength {
  memberId: string;
  score: number;
  bucket: string | null;
  emailCount: number;
  meetingCount: number;
  lastInteractionAt: string | null;
}

/** Scores of every member with interactions with `recordId` as of `now`. */
export async function scoreRecord(tx: Tx, recordId: string, now: string): Promise<MemberStrength[]> {
  const nowMs = Date.parse(now);
  const since = new Date(nowMs - WINDOW_DAYS * DAY_MS).toISOString();
  const { rows: emails } = await sql<{ member_id: string; sent_at: string; two_way: boolean }>`
    SELECT c.member_id, m.sent_at,
      EXISTS (
        SELECT 1 FROM email_messages m2 JOIN email_message_copies c2 ON c2.message_id = m2.id
        WHERE m2.thread_id = m.thread_id AND c2.member_id = c.member_id AND c2.deleted_at IS NULL
          AND c2.direction <> c.direction) AS two_way
    FROM email_message_records r
    JOIN email_messages m ON m.id = r.message_id
    JOIN email_message_copies c ON c.message_id = m.id AND c.deleted_at IS NULL
    JOIN mailboxes mb ON mb.id = c.mailbox_id AND mb.archived_at IS NULL
    WHERE r.entity_instance_id = ${recordId}::uuid
      AND m.sent_at > ${since}::timestamptz AND m.sent_at <= ${now}::timestamptz`.execute(tx.db);
  const { rows: meetings } = await sql<{ member_id: string; start_at: string }>`
    SELECT DISTINCT x.member_id, x.start_at FROM (
      SELECT p.member_id, m.start_at, m.id FROM meetings m
      JOIN meeting_participants p ON p.meeting_id = m.id AND p.member_id IS NOT NULL AND p.status <> 'declined'
      WHERE m.id IN (${RECORD_MEETINGS_SQL(recordId)})
      UNION
      SELECT e.member_id, m.start_at, m.id FROM meetings m
      JOIN calendar_events e ON e.meeting_id = m.id AND e.deleted_at IS NULL AND e.self_status <> 'declined'
      WHERE m.id IN (${RECORD_MEETINGS_SQL(recordId)})
    ) x
    WHERE x.start_at > ${since}::timestamptz AND x.start_at <= ${now}::timestamptz`.execute(tx.db);
  const byMember = new Map<string, MemberStrength>();
  const slot = (memberId: string) => {
    let s = byMember.get(memberId);
    if (!s) {
      s = { memberId, score: 0, bucket: null, emailCount: 0, meetingCount: 0, lastInteractionAt: null };
      byMember.set(memberId, s);
    }
    return s;
  };
  const touch = (s: MemberStrength, at: string) => {
    if (!s.lastInteractionAt || at > s.lastInteractionAt) s.lastInteractionAt = at;
  };
  for (const e of emails) {
    const s = slot(e.member_id);
    s.score += (e.two_way ? WEIGHTS.twoWayEmail : WEIGHTS.email) * decay(e.sent_at, nowMs);
    s.emailCount++;
    touch(s, e.sent_at);
  }
  for (const m of meetings) {
    const s = slot(m.member_id);
    s.score += WEIGHTS.meeting * decay(m.start_at, nowMs);
    s.meetingCount++;
    touch(s, m.start_at);
  }
  const out = [...byMember.values()].filter((s) => s.score > 0);
  for (const s of out) {
    s.score = Math.round(s.score * 1000) / 1000;
    s.bucket = bucketOf(s.score);
  }
  return out.sort((a, b) => b.score - a.score || a.memberId.localeCompare(b.memberId));
}

/** Recomputes connection strength of people / company records and writes the record attributes. */
export async function recomputeConnectionStrength(
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
  const unique = [...new Map(records.map((r) => [r.entityInstanceId, r])).values()];
  const live = await tx.db
    .selectFrom('entity_instances')
    .select('id')
    .where(
      'id',
      'in',
      unique.map((r) => r.entityInstanceId),
    )
    .where('archived_at', 'is', null)
    .where('merged_at', 'is', null)
    .execute();
  const liveIds = new Set(live.map((r) => r.id));
  const targets = unique.filter((r) => {
    const type = defs.get(r.entityDefinitionId)?.entityType;
    return liveIds.has(r.entityInstanceId) && (type === 'person-record' || type === 'company-record');
  });
  await engine.lock(targets.map((t) => t.entityInstanceId));
  for (const target of targets) {
    const def = defs.get(target.entityDefinitionId);
    if (!def) continue;
    const scores = await scoreRecord(tx, target.entityInstanceId, now);
    await tx.db.deleteFrom('connection_strengths').where('entity_instance_id', '=', target.entityInstanceId).execute();
    if (scores.length > 0) {
      await tx.db
        .insertInto('connection_strengths')
        .values(
          scores.map((s) => ({
            workspace_id: tx.workspaceId,
            member_id: s.memberId,
            entity_instance_id: target.entityInstanceId,
            entity_definition_id: def.id,
            score: s.score,
            bucket: s.bucket ?? 'none',
            email_count: s.emailCount,
            meeting_count: s.meetingCount,
            last_interaction_at: s.lastInteractionAt,
            computed_at: tx.now,
          })),
        )
        .execute();
    }
    const strongest = scores[0] ?? null;
    const select = def.attrs.find(
      (a) => a.systemAttributeType === 'strongest-connection-strength-enum' && !a.isArchived,
    );
    const user = def.attrs.find((a) => a.systemAttributeType === 'strongest-connection-user' && !a.isArchived);
    const legacy = def.attrs.find((a) => a.systemAttributeType === 'strongest-connection-strength' && !a.isArchived);
    await engine.asSystem(async () => {
      if (select) {
        const optionId = strongest?.bucket ? await optionIdOf(tx, select, strongest.bucket) : null;
        await engine.setAttribute(
          def,
          target.entityInstanceId,
          select,
          optionId ? [{ value: { selectOptionId: optionId } }] : [],
        );
      }
      if (user) {
        await engine.setAttribute(
          def,
          target.entityInstanceId,
          user,
          strongest
            ? [{ value: { referencedActorType: 'workspace-member', referencedActorId: strongest.memberId } }]
            : [],
        );
      }
      if (legacy) {
        await engine.setAttribute(def, target.entityInstanceId, legacy, strongest ? [{ value: strongest.score }] : []);
      }
    });
  }
}

async function optionIdOf(tx: Tx, attr: AttrDef, title: string): Promise<string | null> {
  const row = await tx.db
    .selectFrom('select_options')
    .select('id')
    .where('attribute_id', '=', attr.id)
    .where('title', '=', title)
    .where('is_archived', '=', false)
    .executeTakeFirst();
  return row?.id ?? null;
}

/** Every people / company record with a stored score (daily decay recompute). */
export async function recordsWithStrength(
  tx: Tx,
  limit = 5000,
): Promise<{ entityDefinitionId: string; entityInstanceId: string }[]> {
  const rows = await tx.db
    .selectFrom('connection_strengths')
    .select(['entity_definition_id', 'entity_instance_id'])
    .distinct()
    .limit(limit)
    .execute();
  return rows.map((r) => ({ entityDefinitionId: r.entity_definition_id, entityInstanceId: r.entity_instance_id }));
}
