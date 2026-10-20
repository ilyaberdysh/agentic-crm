// Transcript reads of a call (Transcript and Speakers tabs; prompt input of the AI steps): utterances in time order
// with merged speaker ids, speaker blocks, the copy-format text and talk-time statistics.
import type { CallSpeaker, CallSpeakerStats, CallTranscriptView, TranscriptBlock } from '@agentic-crm/contracts';
import type { Tx } from '../tx.ts';
import { loadSpeakers } from './speakers.ts';
import {
  buildBlocks,
  resolveRange,
  sortUtterances,
  speakerStats,
  transcriptText,
  type Utterance,
} from './transcript.ts';

export interface LoadedTranscript {
  speakers: CallSpeaker[];
  utterances: Utterance[];
  blocks: TranscriptBlock[];
  text: string;
  nameOf: (speakerId: string | null) => string;
}

export async function loadTranscript(tx: Tx, recordingId: string): Promise<LoadedTranscript> {
  const speakers = (await loadSpeakers(tx, [recordingId])).get(recordingId) ?? {
    speakers: [],
    mergedId: new Map<string, string>(),
  };
  const rows = await tx.db
    .selectFrom('call_transcript_segments')
    .select(['position', 'speech', 'start_time', 'end_time', 'speaker_id'])
    .where('recording_id', '=', recordingId)
    .orderBy('position')
    .execute();
  const utterances = sortUtterances(
    rows.map((r) => ({
      index: r.position,
      speakerId: r.speaker_id ? (speakers.mergedId.get(r.speaker_id) ?? r.speaker_id) : null,
      text: r.speech,
      start: Number(r.start_time),
      end: Number(r.end_time),
    })),
  );
  const names = new Map(speakers.speakers.map((s) => [s.id, s.name]));
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? 'Unknown') : 'Unknown');
  const blocks = buildBlocks(utterances);
  return { speakers: speakers.speakers, utterances, blocks, text: transcriptText(blocks, utterances, nameOf), nameOf };
}

export function transcriptView(
  recording: { id: string; meetingId: string },
  loaded: LoadedTranscript,
  range: { start: number; end: number } | undefined,
  rangeOnly: boolean,
): CallTranscriptView {
  const resolved = range ? resolveRange(loaded.utterances, range) : null;
  if (range && rangeOnly) {
    const inside = loaded.utterances.filter((u) => u.end > range.start && u.start < range.end);
    const blocks = buildBlocks(inside);
    return {
      recordingId: recording.id,
      meetingId: recording.meetingId,
      speakers: loaded.speakers,
      utterances: inside,
      blocks,
      range: resolved,
      text: transcriptText(blocks, inside, loaded.nameOf),
    };
  }
  return {
    recordingId: recording.id,
    meetingId: recording.meetingId,
    speakers: loaded.speakers,
    utterances: loaded.utterances,
    blocks: loaded.blocks,
    range: resolved,
    text: loaded.text,
  };
}

export function speakersView(loaded: LoadedTranscript): CallSpeakerStats[] {
  return speakerStats(loaded.speakers, loaded.utterances);
}
