// Calls list and call detail (BACKLOG 10.11, 10.12 data, 10.15; I calls §2, §3.1, §11.3, §11.6): filters by record,
// participant (member or person) and team, status and meeting time; `query` over the meeting title and the transcript
// text; date groups in the viewer's time zone and week start (B.24, X-10); the favourites strip. Calls follow their
// meeting's visibility; content (summaries, transcript) needs full access to the meeting.
import {
  type CallDetail,
  type CallListItem,
  type CallSettings,
  type CreatedBucket,
  type CreatedBucketRange,
  createdBucketOf,
  createdBucketRanges,
  type EmailAccess,
  isTimeZone,
  type ListCallsInput,
  type ListCallsOutput,
  listCallsInputSchema,
  type UpdateCallSettingsInput,
  updateCallSettingsInputSchema,
  type WeekDay,
  weekStartForLocale,
} from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { memberAudience, requireMember, resolveRecordRefs, toActor } from '../collab/common.ts';
import { actingMemberId } from '../context.ts';
import { meetingAccess } from '../email/access.ts';
import { badRequest } from '../errors.ts';
import { viewMeetings } from '../meetings/service.ts';
import type { Tx } from '../tx.ts';
import { type CallsDeps, loadCall, type RecordingRow } from './common.ts';
import { insightsOf } from './insights.ts';
import { loadSpeakers } from './speakers.ts';
import { loadTemplate } from './templates.ts';

const MAX_RESULTS = 20_000;

async function viewerPreferences(
  tx: Tx,
  explicitZone: string | undefined,
): Promise<{ timeZone: string; weekStart: WeekDay }> {
  const memberId = actingMemberId(tx.ctx);
  const row = memberId
    ? await tx.db
        .selectFrom('member_preferences')
        .select(['time_zone', 'locale', 'week_start_day'])
        .where('member_id', '=', memberId)
        .executeTakeFirst()
    : undefined;
  const zone = explicitZone ?? row?.time_zone ?? 'UTC';
  return {
    timeZone: isTimeZone(zone) ? zone : 'UTC',
    weekStart: (row?.week_start_day ?? weekStartForLocale(row?.locale ?? null)) as WeekDay,
  };
}

async function favoriteIds(tx: Tx): Promise<string[]> {
  const memberId = actingMemberId(tx.ctx);
  if (!memberId) return [];
  const rows = await tx.db
    .selectFrom('favorites')
    .select('target_id')
    .where('member_id', '=', memberId)
    .where('favorite_type', '=', 'call-recording')
    .orderBy('sort_order')
    .orderBy('id')
    .execute();
  return rows.map((r) => r.target_id);
}

/** List items of recordings (in the given order), dropping those whose meeting the viewer cannot see. */
async function callItems(
  tx: Tx,
  rows: RecordingRow[],
  ranges: CreatedBucketRange[] | null,
  favorites?: Set<string>,
): Promise<CallListItem[]> {
  if (rows.length === 0) return [];
  const meetingIds = [...new Set(rows.map((r) => r.meeting_id))];
  const access = await meetingAccess(tx, meetingIds);
  const meetings = await tx.db
    .selectFrom('meetings')
    .select(['id', 'title', 'start_at', 'end_at', 'is_all_day'])
    .where('id', 'in', meetingIds)
    .where('deleted_at', 'is', null)
    .execute();
  const meetingOf = new Map(meetings.map((m) => [m.id, m]));
  const participants = await tx.db
    .selectFrom('meeting_participants')
    .selectAll()
    .where('meeting_id', 'in', meetingIds)
    .orderBy('meeting_id')
    .orderBy('position')
    .execute();
  const linked = await tx.db
    .selectFrom('meeting_records')
    .select(['meeting_id', 'entity_definition_id', 'entity_instance_id'])
    .where('meeting_id', 'in', meetingIds)
    .orderBy('meeting_id')
    .orderBy('position')
    .execute();
  const favs = favorites ?? new Set(await favoriteIds(tx));
  const out: CallListItem[] = [];
  for (const r of rows) {
    const m = meetingOf.get(r.meeting_id);
    const level: EmailAccess = access.get(r.meeting_id)?.access ?? 'none';
    if (!m || level === 'none') continue;
    const full = level === 'full-access';
    const length = (Date.parse(m.end_at) - Date.parse(m.start_at)) / 1000;
    out.push({
      id: r.id,
      meetingId: r.meeting_id,
      access: level,
      title: level === 'metadata-only' ? null : m.title,
      status: r.status,
      summaryStatus: r.summary_status,
      conciseSummary: full ? r.concise_summary : null,
      conciseSummaryStatus: r.concise_summary_status,
      startAt: m.start_at,
      endAt: m.end_at,
      isAllDay: m.is_all_day,
      durationSeconds: length > 0 && !m.is_all_day ? Math.round(length) : Number(r.duration_seconds),
      linkedRecords: linked
        .filter((l) => l.meeting_id === r.meeting_id)
        .map((l) => ({ entityDefinitionId: l.entity_definition_id, entityInstanceId: l.entity_instance_id })),
      participants: participants
        .filter((p) => p.meeting_id === r.meeting_id)
        .map((p) => ({
          id: p.id,
          name: p.name,
          emailAddress: p.original_email_address ?? p.email_address,
          isOrganizer: p.is_organizer,
          memberId: p.member_id,
          personId: p.person_id,
          companyId: p.company_id,
        })),
      isFavorite: favs.has(r.id),
      dateGroup: ranges ? createdBucketOf(m.start_at, ranges) : null,
      createdBy: toActor(r.created_by),
      createdAt: r.created_at,
    });
  }
  return out;
}

async function recordingRows(tx: Tx, ids: string[]): Promise<RecordingRow[]> {
  if (ids.length === 0) return [];
  const rows = (await tx.db
    .selectFrom('call_recordings')
    .selectAll()
    .where('id', 'in', ids)
    .where('deleted_at', 'is', null)
    .execute()) as RecordingRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is RecordingRow => !!r);
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset)).toString('base64url');
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const n = Number.parseInt(Buffer.from(cursor, 'base64url').toString('utf8'), 10);
  if (!Number.isInteger(n) || n < 0) throw badRequest('VALIDATION_ERROR', 'Invalid cursor', { field: 'cursor' });
  return n;
}

export const callListOps = {
  async list(tx: Tx, deps: CallsDeps, input: ListCallsInput): Promise<ListCallsOutput> {
    const data = listCallsInputSchema.parse(input);
    const conditions = [sql`r.deleted_at IS NULL`, sql`m.deleted_at IS NULL`];
    for (const f of data.filters) {
      let cond: ReturnType<typeof sql>;
      switch (f.field) {
        case 'record': {
          const [ref] = await resolveRecordRefs(tx, deps, [f.value], { what: 'record' });
          const id = (ref as { entityInstanceId: string }).entityInstanceId;
          cond = sql`(EXISTS (SELECT 1 FROM meeting_participants p WHERE p.meeting_id = m.id
              AND (p.person_id = ${id}::uuid OR p.company_id = ${id}::uuid))
            OR EXISTS (SELECT 1 FROM meeting_records x WHERE x.meeting_id = m.id AND x.entity_instance_id = ${id}::uuid))`;
          break;
        }
        case 'participants': {
          if ('memberId' in f.value) {
            cond = sql`EXISTS (SELECT 1 FROM meeting_participants p WHERE p.meeting_id = m.id
              AND p.member_id = ${f.value.memberId}::uuid)`;
          } else {
            const [ref] = await resolveRecordRefs(tx, deps, [f.value], { what: 'participant' });
            const id = (ref as { entityInstanceId: string }).entityInstanceId;
            cond = sql`EXISTS (SELECT 1 FROM meeting_participants p WHERE p.meeting_id = m.id
              AND (p.person_id = ${id}::uuid OR p.company_id = ${id}::uuid))`;
          }
          break;
        }
        case 'participants-teams':
          cond = sql`EXISTS (SELECT 1 FROM meeting_participants p
            JOIN workspace_team_memberships t ON t.member_id = p.member_id
            WHERE p.meeting_id = m.id AND t.team_id = ${f.value.teamId}::uuid)`;
          break;
        case 'status':
          cond = sql`r.status = ${f.value}`;
          break;
        case 'meeting-start-at': {
          const op = { lt: '<', lte: '<=', gt: '>', gte: '>=' }[f.operator];
          cond = sql`m.start_at ${sql.raw(op)} ${f.value}::timestamptz`;
          break;
        }
      }
      conditions.push(f.mode === 'must-not' ? sql`NOT ${cond}` : cond);
    }
    const query = data.query?.trim() ?? '';
    const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const order = data.sort.direction === 'asc' ? sql.raw('ASC') : sql.raw('DESC');
    const { rows } = await sql<{
      id: string;
      meeting_id: string;
      start_at: string;
      title_match: boolean;
      text_match: boolean;
    }>`
      SELECT r.id, r.meeting_id, m.start_at,
             ${query ? sql`m.title ILIKE ${pattern}` : sql`true`} AS title_match,
             ${query ? sql`r.transcript_text ILIKE ${pattern}` : sql`true`} AS text_match
      FROM call_recordings r JOIN meetings m ON m.id = r.meeting_id
      WHERE ${sql.join(conditions, sql` AND `)}
        ${query ? sql`AND (m.title ILIKE ${pattern} OR r.transcript_text ILIKE ${pattern})` : sql``}
      ORDER BY m.start_at ${order}, r.created_at ${order}, r.id ${order}
      LIMIT ${MAX_RESULTS}`.execute(tx.db);
    const access = await meetingAccess(tx, [...new Set(rows.map((r) => r.meeting_id))]);
    // A title match needs the title (subject-line access); a transcript match needs the content (full access).
    const visible = rows.filter((r) => {
      const level = access.get(r.meeting_id)?.access ?? 'none';
      if (level === 'none') return false;
      if (!query) return true;
      return (r.title_match && level !== 'metadata-only') || (r.text_match && level === 'full-access');
    });
    const prefs = data.groupBy === 'meeting-date' ? await viewerPreferences(tx, data.timeZone) : null;
    const ranges = prefs ? createdBucketRanges(new Date(), prefs.timeZone, prefs.weekStart) : null;
    const favorites = await favoriteIds(tx);
    const favSet = new Set(favorites);
    let ordered = visible.map((r) => r.id);
    const groups: ListCallsOutput['groups'] = [];
    if (ranges) {
      // Group order follows the sort (newest bucket first when descending); items keep their order inside groups.
      const bucketOf = new Map(visible.map((r) => [r.id, createdBucketOf(r.start_at, ranges)]));
      const keys = ranges.map((x) => x.key);
      if (data.sort.direction === 'asc') keys.reverse();
      const next: string[] = [];
      for (const key of keys) {
        const ids = ordered.filter((id) => bucketOf.get(id) === key);
        if (ids.length === 0) continue;
        groups.push({ key: key as CreatedBucket, count: ids.length });
        next.push(...ids);
      }
      ordered = next;
    }
    const offset = decodeCursor(data.cursor);
    const page = ordered.slice(offset, offset + data.limit);
    const items = await callItems(tx, await recordingRows(tx, page), ranges, favSet);
    const showFavorites = data.includeFavorites && data.filters.length === 0 && !query;
    return {
      items,
      groups,
      total: ordered.length,
      nextCursor: offset + data.limit < ordered.length ? encodeCursor(offset + data.limit) : null,
      favorites: showFavorites ? await callItems(tx, await recordingRows(tx, favorites), ranges, favSet) : null,
    };
  },

  /** Compact call cards of meetings (activity meeting card, meeting panels): newest recording per meeting first. */
  async byMeetings(tx: Tx, meetingIds: string[]): Promise<CallListItem[]> {
    const rows = (await tx.db
      .selectFrom('call_recordings')
      .selectAll()
      .where('meeting_id', 'in', meetingIds)
      .where('deleted_at', 'is', null)
      .orderBy('meeting_id')
      .orderBy('created_at', 'desc')
      .execute()) as RecordingRow[];
    return callItems(tx, rows, null);
  },

  async get(tx: Tx, recordingId: string): Promise<CallDetail> {
    const { row } = await loadCall(tx, recordingId);
    const [item] = await callItems(tx, [row], null);
    const [meeting] = await viewMeetings(tx, [row.meeting_id]);
    if (!item || !meeting) throw new Error('call vanished while reading');
    const speakers = (await loadSpeakers(tx, [row.id])).get(row.id)?.speakers ?? [];
    const settings = await callSettingsOps.get(tx).catch(() => null);
    return {
      ...item,
      meeting,
      summary: row.summary,
      processingError: row.processing_error,
      processedAt: row.processed_at,
      videoUrl: row.video_url,
      segmentCount: row.segment_count,
      transcriptDurationSeconds: Number(row.duration_seconds),
      speakers,
      insights: await insightsOf(tx, [row.id]),
      defaultInsightTemplateId: settings?.defaultInsightTemplateId ?? null,
    };
  },
};

export const callSettingsOps = {
  async get(tx: Tx): Promise<CallSettings> {
    const memberId = requireMember(tx);
    const row = await tx.db
      .selectFrom('member_call_settings as s')
      .leftJoin('insight_templates as t', 't.id', 's.default_insight_template_id')
      .select(['s.default_insight_template_id', 't.deleted_at', 't.archived_at'])
      .where('s.member_id', '=', memberId)
      .executeTakeFirst();
    const usable = row?.default_insight_template_id && !row.deleted_at && !row.archived_at;
    return { memberId, defaultInsightTemplateId: usable ? (row?.default_insight_template_id ?? null) : null };
  },

  /** "Default insights template" (I calls §5.1): a published template, or none. */
  async update(tx: Tx, input: UpdateCallSettingsInput): Promise<CallSettings> {
    const data = updateCallSettingsInputSchema.parse(input);
    const memberId = requireMember(tx);
    if (data.defaultInsightTemplateId) {
      const template = await loadTemplate(tx, data.defaultInsightTemplateId);
      if (template.status !== 'enabled') {
        throw badRequest('VALIDATION_ERROR', 'Only published templates can be the default', {
          conversation_insight_template_id: template.id,
        });
      }
    }
    await tx.db
      .insertInto('member_call_settings')
      .values({
        member_id: memberId,
        workspace_id: tx.workspaceId,
        default_insight_template_id: data.defaultInsightTemplateId,
        updated_at: tx.now,
      })
      .onConflict((oc) =>
        oc.column('member_id').doUpdateSet({
          default_insight_template_id: data.defaultInsightTemplateId,
          updated_at: tx.now,
        }),
      )
      .execute();
    tx.emit('member-call-settings', memberId, { memberId }, await memberAudience(tx, memberId));
    return callSettingsOps.get(tx);
  },
};
