// Pure transcript helpers (I calls §3.5, §3.7, §11.4; acceptance 3 data side): speaker blocks and paragraphs, the
// copy / prompt text format, range links and talk-time statistics. No database access.
import type { CallSpeaker, CallSpeakerStats, TranscriptBlock } from '@agentic-crm/contracts';

export interface Utterance {
  index: number;
  /** Merged speaker id (null = unknown speaker). */
  speakerId: string | null;
  text: string;
  start: number;
  end: number;
}

/**
 * Silence that starts a new block even when the same speaker continues.
 */
export const BLOCK_GAP_SECONDS = 20;
/**
 * Pause that starts a new paragraph inside a block. Each utterance extends to the next one's start and splits
 * at > 0.25 s, which in practice never splits consecutive segments (§11.4: a 0.84 s gap rendered as one running
 * paragraph); our rule keeps that and only breaks at real pauses.
 */
export const PARAGRAPH_GAP_SECONDS = 2;

/** Time order (start, then import position). */
export function sortUtterances<T extends Utterance>(utterances: T[]): T[] {
  return [...utterances].sort((a, b) => a.start - b.start || a.index - b.index);
}

/**
 * Speaker blocks: consecutive utterances of one speaker form one block (acceptance 3); a new block starts when the
 * speaker changes or after more than 20 s of silence; inside a block a pause of more than 2 s starts a paragraph.
 */
export function buildBlocks(sorted: Utterance[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  let lastEnd = Number.NEGATIVE_INFINITY;
  for (const u of sorted) {
    const block = blocks.at(-1);
    const gap = u.start - lastEnd;
    if (!block || block.speakerId !== u.speakerId || gap > BLOCK_GAP_SECONDS) {
      blocks.push({
        speakerId: u.speakerId,
        start: u.start,
        end: u.end,
        paragraphs: [{ start: u.start, end: u.end, utteranceIndexes: [u.index] }],
      });
    } else {
      const paragraph = block.paragraphs.at(-1) as TranscriptBlock['paragraphs'][number];
      if (gap > PARAGRAPH_GAP_SECONDS) {
        block.paragraphs.push({ start: u.start, end: u.end, utteranceIndexes: [u.index] });
      } else {
        paragraph.utteranceIndexes.push(u.index);
        paragraph.end = Math.max(paragraph.end, u.end);
      }
      block.end = Math.max(block.end, u.end);
    }
    lastEnd = Math.max(lastEnd, u.end);
  }
  return blocks;
}

/** `m:ss`, or `h:mm:ss` from one hour (transcript timestamps, I calls §3.5). */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * The copy format (I calls §3.5 "Copy transcript"): one entry per block `[m:ss] Speaker: paragraph`, further
 * paragraphs on the following lines; unknown speakers read "Unknown". The LLM prompts use the same text.
 */
export function transcriptText(
  blocks: TranscriptBlock[],
  utterances: Utterance[],
  nameOf: (speakerId: string | null) => string,
): string {
  const byIndex = new Map(utterances.map((u) => [u.index, u]));
  const paragraphText = (p: TranscriptBlock['paragraphs'][number]) =>
    p.utteranceIndexes
      .map((i) => byIndex.get(i)?.text.trim() ?? '')
      .filter(Boolean)
      .join(' ');
  return blocks
    .map((b) => {
      const [first, ...rest] = b.paragraphs.map(paragraphText);
      return [`[${formatClock(b.start)}] ${nameOf(b.speakerId)}: ${first ?? ''}`, ...rest].join('\n');
    })
    .join('\n');
}

/** The utterances a `?start=&end=` range covers (overlap), as first / last index in time order; null for none. */
export function resolveRange(
  sorted: Utterance[],
  range: { start: number; end: number },
): { start: number; end: number; firstIndex: number; lastIndex: number } | null {
  const inside = sorted.filter((u) => u.end > range.start && u.start < range.end);
  const first = inside[0];
  const last = inside.at(-1);
  if (!first || !last) return null;
  return { start: range.start, end: range.end, firstIndex: first.index, lastIndex: last.index };
}

/** Talk time and share per (merged) speaker, plus their utterance ranges (Speakers tab, I calls §3.7). */
export function speakerStats(speakers: CallSpeaker[], sorted: Utterance[]): CallSpeakerStats[] {
  const talk = new Map<string, number>();
  const segments = new Map<string, { start: number; end: number }[]>();
  let total = 0;
  for (const u of sorted) {
    if (!u.speakerId) continue;
    const length = Math.max(0, u.end - u.start);
    total += length;
    talk.set(u.speakerId, (talk.get(u.speakerId) ?? 0) + length);
    segments.set(u.speakerId, [...(segments.get(u.speakerId) ?? []), { start: u.start, end: u.end }]);
  }
  return speakers.map((s) => {
    const seconds = talk.get(s.id) ?? 0;
    return {
      ...s,
      talkTimeSeconds: Math.round(seconds * 1000) / 1000,
      talkShare: total > 0 ? Math.round((seconds / total) * 1000) / 10 : 0,
      segments: segments.get(s.id) ?? [],
    };
  });
}
