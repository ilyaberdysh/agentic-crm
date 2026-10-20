// Speakers of imported transcripts (X-28; I calls §6.1, §11.2, §3.7): one speaker per distinct address (else per
// name) of a recording, mapped to a meeting participant by email; the member behind the participant (or the address)
// renders with the member's name and avatar — never the raw email, unlike Attio; person participants render as
// their record; unknown speakers keep the name the importer sent. Speakers mapped to the same participant / member
// merge into one (the first by appearance), as Attio's Speakers tab does.
import type { CallSpeaker } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { recordLabels } from '../collab/common.ts';
import { toAddress } from '../email/model.ts';
import { loadDefinition } from '../schema/model.ts';
import type { Tx } from '../tx.ts';

/** Identity of a speaker inside one transcript: the normalised address, else the name. */
export function speakerKey(name: string, email: string | null): string {
  return email ? `email:${email}` : `name:${name.trim()}`;
}

/** Normalised address of an imported speaker, or null. */
export function speakerEmail(raw: string | null | undefined): string | null {
  return raw ? (toAddress(raw)?.email ?? null) : null;
}

/**
 * (Re)maps the speakers of the recordings to the meeting's participants by email (automatic mapping) and to the
 * member behind them; also keeps the segments' slice-7 participant_id in step. Returns whether anything changed.
 */
export async function mapSpeakers(tx: Tx, recordingIds: string[]): Promise<boolean> {
  if (recordingIds.length === 0) return false;
  const { rows: speakers } = await sql<{
    id: string;
    recording_id: string;
    email_address: string | null;
    participant_id: string | null;
    member_id: string | null;
    meeting_id: string;
  }>`
    SELECT s.id, s.recording_id, s.email_address, s.participant_id, s.member_id, r.meeting_id
    FROM call_speakers s JOIN call_recordings r ON r.id = s.recording_id
    WHERE s.recording_id = ANY(${recordingIds}::uuid[])`.execute(tx.db);
  if (speakers.length === 0) return false;
  const meetingIds = [...new Set(speakers.map((s) => s.meeting_id))];
  const participants = await tx.db
    .selectFrom('meeting_participants')
    .select(['id', 'meeting_id', 'email_address', 'member_id', 'position'])
    .where('meeting_id', 'in', meetingIds)
    .orderBy('position')
    .execute();
  const byMeetingEmail = new Map<string, { id: string; member_id: string | null }>();
  for (const p of participants) {
    const key = `${p.meeting_id}:${p.email_address}`;
    if (p.email_address && !byMeetingEmail.has(key)) byMeetingEmail.set(key, p);
  }
  const emails = [...new Set(speakers.map((s) => s.email_address).filter((e): e is string => !!e))];
  const members =
    emails.length === 0
      ? []
      : (
          await sql<{ id: string; email: string }>`
            SELECT id, lower(email_address) AS email FROM workspace_members
            WHERE lower(email_address) = ANY(${emails}::text[]) AND removed_at IS NULL`.execute(tx.db)
        ).rows;
  const memberByEmail = new Map(members.map((m) => [m.email, m.id]));
  let changed = false;
  for (const s of speakers) {
    const participant = s.email_address ? byMeetingEmail.get(`${s.meeting_id}:${s.email_address}`) : undefined;
    const participantId = participant?.id ?? null;
    const memberId = participant?.member_id ?? (s.email_address ? (memberByEmail.get(s.email_address) ?? null) : null);
    if (participantId === s.participant_id && memberId === s.member_id) continue;
    changed = true;
    await tx.db
      .updateTable('call_speakers')
      .set({ participant_id: participantId, member_id: memberId })
      .where('id', '=', s.id)
      .execute();
    await tx.db
      .updateTable('call_transcript_segments')
      .set({ participant_id: participantId })
      .where('recording_id', '=', s.recording_id)
      .where('speaker_id', '=', s.id)
      .execute();
  }
  return changed;
}

/** Remaps the speakers of every live recording of the meetings (after participants changed). */
export async function mapSpeakersOfMeetings(tx: Tx, meetingIds: string[]): Promise<string[]> {
  if (meetingIds.length === 0) return [];
  const rows = await tx.db
    .selectFrom('call_recordings')
    .select('id')
    .where('meeting_id', 'in', meetingIds)
    .where('deleted_at', 'is', null)
    .execute();
  const ids = rows.map((r) => r.id);
  return (await mapSpeakers(tx, ids)) ? ids : [];
}

export interface RecordingSpeakers {
  /** Merged speakers in order of first appearance. */
  speakers: CallSpeaker[];
  /** Speaker row id → merged speaker id. */
  mergedId: Map<string, string>;
}

/** The display speakers of recordings (see the header). */
export async function loadSpeakers(tx: Tx, recordingIds: string[]): Promise<Map<string, RecordingSpeakers>> {
  const out = new Map<string, RecordingSpeakers>(
    recordingIds.map((id) => [id, { speakers: [], mergedId: new Map<string, string>() }]),
  );
  if (recordingIds.length === 0) return out;
  const { rows } = await sql<{
    id: string;
    recording_id: string;
    name: string;
    email_address: string | null;
    participant_id: string | null;
    member_id: string | null;
    p_name: string | null;
    p_member_id: string | null;
    p_person_id: string | null;
    p_is_organizer: boolean | null;
    first_name: string | null;
    last_name: string | null;
    member_email: string | null;
  }>`
    SELECT s.id, s.recording_id, s.name, s.email_address,
           coalesce(s.manual_participant_id, s.participant_id) AS participant_id, s.member_id,
           p.name AS p_name, p.member_id AS p_member_id, p.person_id AS p_person_id, p.is_organizer AS p_is_organizer,
           m.first_name, m.last_name, m.email_address AS member_email
    FROM call_speakers s
    LEFT JOIN meeting_participants p ON p.id = coalesce(s.manual_participant_id, s.participant_id)
    LEFT JOIN workspace_members m ON m.id = coalesce(p.member_id, s.member_id)
    WHERE s.recording_id = ANY(${recordingIds}::uuid[])
    ORDER BY s.recording_id, s.position`.execute(tx.db);
  const personIds = [...new Set(rows.map((r) => r.p_person_id).filter((id): id is string => !!id))];
  let peopleDefId: string | null = null;
  let labels = new Map<string, string | null>();
  if (personIds.length > 0) {
    peopleDefId = (await loadDefinition(tx, 'people')).id;
    const defId = peopleDefId;
    labels = await recordLabels(
      tx,
      personIds.map((id) => ({ entityDefinitionId: defId, entityInstanceId: id })),
    );
  }
  for (const r of rows) {
    const entry = out.get(r.recording_id) as RecordingSpeakers;
    const memberId = r.p_member_id ?? r.member_id;
    const groupKey = r.participant_id ?? (memberId ? `member:${memberId}` : null);
    const existing = groupKey
      ? entry.speakers.find((s) => (s.participantId ?? (s.memberId ? `member:${s.memberId}` : null)) === groupKey)
      : undefined;
    if (existing) {
      existing.speakerIds.push(r.id);
      entry.mergedId.set(r.id, existing.id);
      continue;
    }
    const memberName = memberId ? `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || r.member_email : null;
    const personLabel = r.p_person_id ? (labels.get(r.p_person_id) ?? null) : null;
    let kind: CallSpeaker['kind'];
    let name: string;
    if (memberId) {
      kind = 'member';
      name = memberName ?? r.name;
    } else if (r.p_person_id) {
      kind = 'person';
      name = personLabel?.trim() || r.p_name || r.name;
    } else if (r.participant_id) {
      kind = 'participant';
      name = r.p_name || r.name;
    } else {
      kind = 'unknown';
      name = r.name;
    }
    entry.speakers.push({
      id: r.id,
      name,
      providedName: r.name,
      emailAddress: r.email_address,
      kind,
      participantId: r.participant_id,
      memberId,
      person:
        r.p_person_id && peopleDefId ? { entityDefinitionId: peopleDefId, entityInstanceId: r.p_person_id } : null,
      isOrganizer: r.p_is_organizer ?? false,
      speakerIds: [r.id],
    });
    entry.mergedId.set(r.id, r.id);
  }
  return out;
}
