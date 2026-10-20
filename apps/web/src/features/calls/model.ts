// Calls view logic (I calls): transcript timestamps, speaker blocks as the page renders them, range links
// (`?start=&end=` dims everything outside), speaker focus, the selection → link / copy text mapping, talk share
// formatting and the 4 px timeline layout, the Calls list date groups, durations, and the insight-template helpers
// (titles, preset filtering, picker lists). Pure and unit-tested; no React, no network.
import type {
  CallListFilter,
  CallListItem,
  CallSpeaker,
  CallUtterance,
  CreatedBucket,
  InsightPreset,
  InsightTemplate,
  TranscriptBlock,
} from '@agentic-crm/contracts';

// ---- time ---------------------------------------------------------------------------------------------------------------

/** `m:ss`, or `h:mm:ss` from one hour (transcript timestamps, I calls). */
export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The duration label of a Calls row (I calls): "30min", "1h 5min", "42 sec" under a minute. */
export function formatCallDuration(seconds: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  if (s < 60) return `${s} sec`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

/** Talk time of the Speakers tab (I calls): "Ns" under a minute, else whole minutes ("1m"). */
export function formatTalkTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s}s` : `${Math.round(s / 60)}m`;
}

/** Share of the talk time: one decimal with a trailing ".0" dropped ("40.1%", "33%"). */
export function formatTalkShare(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)}%`;
}

// ---- range links ----------------------------------------------------------------------------------------------------------

export interface TimeRange {
  start: number;
  end: number;
}

function seconds(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

/** The highlight range of `?start=&end=`: both valid seconds with `start < end`, else none (I calls). */
export function parseRange(start: unknown, end: unknown): TimeRange | null {
  const s = seconds(start);
  const e = seconds(end);
  if (s === null || e === null || s >= e) return null;
  return { start: s, end: e };
}

/** Seconds as they appear in a link: at most 2 decimals, no trailing zeros. */
export function rangeSecondsParam(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** The call URL of a section: `<path>?start=<s>&end=<s>` (the transcript tab). */
export function rangeLink(origin: string, transcriptPath: string, range: TimeRange): string {
  return `${origin}${transcriptPath}?start=${rangeSecondsParam(range.start)}&end=${rangeSecondsParam(range.end)}`;
}

/** An utterance belongs to the range when it overlaps it. */
export function utteranceInRange(u: Pick<CallUtterance, 'start' | 'end'>, range: TimeRange): boolean {
  return u.end > range.start && u.start < range.end;
}

/** The utterance indexes a range covers, in order. */
export function rangeIndexes(utterances: readonly CallUtterance[], range: TimeRange): number[] {
  return utterances.filter((u) => utteranceInRange(u, range)).map((u) => u.index);
}

// ---- transcript blocks ------------------------------------------------------------------------------------------------------

export interface ParagraphView {
  start: number;
  end: number;
  utterances: Array<CallUtterance & { dimmed: boolean }>;
}

export interface BlockView {
  key: string;
  speakerId: string | null;
  speaker: CallSpeaker | null;
  /** The speaker's name as the copy format writes it. */
  speakerName: string;
  start: number;
  end: number;
  paragraphs: ParagraphView[];
  /** Outside the focused speaker or entirely outside the range link. */
  dimmed: boolean;
}

export interface TranscriptViewInput {
  speakers: readonly CallSpeaker[];
  utterances: readonly CallUtterance[];
  blocks: readonly TranscriptBlock[];
}

/**
 * The blocks as the Transcript tab renders them: a block per run of one speaker (the server breaks on a speaker
 * change or > 20 s of silence, paragraphs on pauses > 2 s), each utterance flagged dimmed when a range link is active
 * and the utterance is outside it, or when speaker focus is on another speaker.
 */
export function blockViews(
  input: TranscriptViewInput,
  options: { range?: TimeRange | null; focusSpeakerId?: string | null } = {},
): BlockView[] {
  const byIndex = new Map(input.utterances.map((u) => [u.index, u]));
  const speakers = new Map(input.speakers.map((s) => [s.id, s]));
  const range = options.range ?? null;
  const focus = options.focusSpeakerId ?? null;
  return input.blocks.map((block, i) => {
    const speaker = block.speakerId ? (speakers.get(block.speakerId) ?? null) : null;
    const offFocus = focus !== null && block.speakerId !== focus;
    const paragraphs = block.paragraphs.map((p) => ({
      start: p.start,
      end: p.end,
      utterances: p.utteranceIndexes.flatMap((index) => {
        const u = byIndex.get(index);
        if (!u) return [];
        const outside = range !== null && !utteranceInRange(u, range);
        return [{ ...u, dimmed: offFocus || outside }];
      }),
    }));
    return {
      key: `${i}:${block.start}`,
      speakerId: block.speakerId,
      speaker,
      speakerName: speaker?.name ?? 'Unknown',
      start: block.start,
      end: block.end,
      paragraphs,
      dimmed: paragraphs.every((p) => p.utterances.every((u) => u.dimmed)),
    };
  });
}

/** The block (by start time) a timestamp button belongs to, as a range link target. */
export function blockRange(block: Pick<BlockView, 'start' | 'end'>): TimeRange {
  return { start: block.start, end: block.end };
}

// ---- selection ---------------------------------------------------------------------------------------------------------------

/** The time range of a text selection: first utterance start to last utterance end (`Copy link to section`). */
export function selectionRange(selected: ReadonlyArray<Pick<CallUtterance, 'start' | 'end'>>): TimeRange | null {
  if (selected.length === 0) return null;
  const start = Math.min(...selected.map((u) => u.start));
  const end = Math.max(...selected.map((u) => u.end));
  return start < end ? { start, end } : { start, end: start + 1 };
}

/**
 * The transcript copy format restricted to the selected utterances (I calls): `[m:ss] Speaker: text` per block,
 * further paragraphs on their own lines; a selection that starts in the middle of a block omits the first prefix.
 */
export function selectionText(blocks: readonly BlockView[], selected: ReadonlySet<number>): string {
  const lines: string[] = [];
  for (const block of blocks) {
    const first = block.paragraphs[0]?.utterances[0];
    const paragraphs = block.paragraphs
      .map((p) =>
        p.utterances
          .filter((u) => selected.has(u.index))
          .map((u) => u.text.trim())
          .filter(Boolean)
          .join(' '),
      )
      .filter(Boolean);
    if (paragraphs.length === 0) continue;
    const startsMidBlock = first !== undefined && !selected.has(first.index);
    const prefix =
      lines.length === 0 && startsMidBlock ? '' : `[${formatTimestamp(block.start)}] ${block.speakerName}: `;
    lines.push(`${prefix}${paragraphs[0]}`, ...paragraphs.slice(1));
  }
  return lines.join('\n');
}

// ---- dates on cards ---------------------------------------------------------------------------------------------------------------

function zoned(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, ...options }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(date);
  }
}

const TIME_OPTIONS: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true };

/** "5:00 PM - 5:30 PM" (the time range of a meeting in the viewer's zone). */
export function formatTimeRange(startAt: string, endAt: string, timeZone: string): string {
  return `${zoned(new Date(startAt), timeZone, TIME_OPTIONS)} - ${zoned(new Date(endAt), timeZone, TIME_OPTIONS)}`;
}

/** The date chip of a Calls card: "Friday, October 9 5:00 PM - 5:30 PM" (record Calls tab, I calls). */
export function formatCardDate(call: { startAt: string; endAt: string; isAllDay: boolean }, timeZone: string): string {
  const day = zoned(new Date(call.startAt), timeZone, { weekday: 'long', month: 'long', day: 'numeric' });
  return call.isAllDay ? day : `${day} ${formatTimeRange(call.startAt, call.endAt, timeZone)}`;
}

/** The meeting card of the Activity feed: "Yesterday, 5:00 PM - 5:30 PM" (relative day, I calls). */
export function formatActivityDate(
  call: { startAt: string; endAt: string; isAllDay: boolean },
  timeZone: string,
  now: number = Date.now(),
): string {
  const day = (ms: number) => zoned(new Date(ms), timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' });
  const diff = Math.round(
    (Date.parse(`${isoDay(day(now))}T00:00:00Z`) - Date.parse(`${isoDay(day(Date.parse(call.startAt)))}T00:00:00Z`)) /
      86_400_000,
  );
  const label =
    diff === 0
      ? 'Today'
      : diff === 1
        ? 'Yesterday'
        : diff === -1
          ? 'Tomorrow'
          : zoned(new Date(call.startAt), timeZone, { month: 'short', day: 'numeric' });
  return call.isAllDay ? label : `${label}, ${formatTimeRange(call.startAt, call.endAt, timeZone)}`;
}

/** "10/09/2026" (en-US numeric) → "2026-10-09". */
function isoDay(us: string): string {
  const [m, d, y] = us.split('/');
  return `${y}-${m}-${d}`;
}

/** The selected transcript as a Markdown quote for the Ask AI composer (at most 1,500 characters). */
export function quoteSelection(text: string, max = 1500): string {
  const clipped = text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
  return clipped
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

// ---- speakers --------------------------------------------------------------------------------------------------------------------

export interface BarSegment {
  /** Percent of the bar width. */
  left: number;
  width: number;
  start: number;
  end: number;
}

/** The 4 px timeline of a speaker: segments as percentages of the call's length (min width 0.4 % so they stay visible). */
export function barSegments(segments: ReadonlyArray<{ start: number; end: number }>, total: number): BarSegment[] {
  if (!(total > 0)) return [];
  return segments.map((s) => {
    const left = Math.min(100, Math.max(0, (s.start / total) * 100));
    const width = Math.min(100 - left, Math.max(0.4, ((s.end - s.start) / total) * 100));
    return { left, width, start: s.start, end: s.end };
  });
}

/** Talk share of every speaker from utterances: percent of the total talk time (one decimal), seconds, segments. */
export function talkStats(
  utterances: readonly CallUtterance[],
  speakerIds: readonly string[],
): Map<string, { seconds: number; share: number; segments: Array<{ start: number; end: number }> }> {
  const out = new Map<string, { seconds: number; share: number; segments: Array<{ start: number; end: number }> }>();
  for (const id of speakerIds) out.set(id, { seconds: 0, share: 0, segments: [] });
  let total = 0;
  for (const u of utterances) {
    if (!u.speakerId) continue;
    const length = Math.max(0, u.end - u.start);
    const entry = out.get(u.speakerId);
    if (!entry) continue;
    total += length;
    entry.seconds += length;
    entry.segments.push({ start: u.start, end: u.end });
  }
  for (const entry of out.values()) entry.share = total > 0 ? Math.round((entry.seconds / total) * 1000) / 10 : 0;
  return out;
}

/** The end of the timeline: the last utterance end, else the transcript length. */
export function timelineEnd(utterances: ReadonlyArray<Pick<CallUtterance, 'end'>>, fallback = 0): number {
  return utterances.reduce((max, u) => Math.max(max, u.end), fallback);
}

// ---- Calls list ------------------------------------------------------------------------------------------------------------------

/** Group labels for Calls list buckets, such as "This month" and "Over a year ago". */
export const CALL_GROUP_LABEL: Record<CreatedBucket, string> = {
  today: 'Today',
  'this-week': 'This week',
  'last-week': 'Last week',
  'earlier-this-month': 'This month',
  'last-month': 'Last month',
  'earlier-this-year': 'This year',
  'last-year': 'Last year',
  older: 'Over a year ago',
};

export interface CallGroup<T> {
  key: CreatedBucket | 'all';
  label: string;
  /** The group's size over the whole result (items beyond the loaded pages included). */
  count: number;
  items: T[];
}

/**
 * Date groups of the list: the server's non-empty groups in display order, each with the loaded items of its bucket;
 * "None" is a single group. Groups without loaded items are dropped (their rows arrive with the next page).
 */
export function groupCalls<T extends { dateGroup: CreatedBucket | null }>(
  items: readonly T[],
  groups: ReadonlyArray<{ key: CreatedBucket; count: number }>,
  groupBy: 'meeting-date' | 'none',
): CallGroup<T>[] {
  if (groupBy === 'none')
    return items.length > 0 ? [{ key: 'all', label: 'All calls', count: items.length, items: [...items] }] : [];
  return groups
    .map((g) => ({
      key: g.key,
      label: CALL_GROUP_LABEL[g.key],
      count: g.count,
      items: items.filter((i) => i.dateGroup === g.key),
    }))
    .filter((g) => g.items.length > 0);
}

/** A filter of the Calls list as the browser keeps it (I calls: record, participant, participant › teams). */
export type StoredFilter =
  | {
      id: string;
      field: 'record';
      mode: 'must' | 'must-not';
      value: { entityDefinitionId: string; entityInstanceId: string };
    }
  | {
      id: string;
      field: 'participants';
      mode: 'must' | 'must-not';
      value: { memberId: string } | { entityDefinitionId: string; entityInstanceId: string };
    }
  | { id: string; field: 'participants-teams'; mode: 'must'; value: { teamId: string } };

/** The `calls.list` filters of the stored ones (operators: `is` / `is not` → eq, teams → contains). */
export function toListFilters(filters: readonly StoredFilter[]): CallListFilter[] {
  return filters.map((f): CallListFilter => {
    switch (f.field) {
      case 'record':
        return { field: 'record', mode: f.mode, operator: 'eq', value: f.value };
      case 'participants':
        return { field: 'participants', mode: f.mode, operator: 'eq', value: f.value };
      case 'participants-teams':
        return { field: 'participants-teams', mode: 'must', operator: 'contains', value: f.value };
    }
  });
}

/** The stable identity of a filter (the same value twice is one chip). */
export function filterKey(f: StoredFilter): string {
  return `${f.field}:${JSON.stringify(f.value)}`;
}

/** Adds a filter unless the same field and value is already there. */
export function addFilter(filters: readonly StoredFilter[], next: StoredFilter): StoredFilter[] {
  return filters.some((f) => filterKey(f) === filterKey(next)) ? [...filters] : [...filters, next];
}

export interface RecordRefLite {
  entityDefinitionId: string;
  entityInstanceId: string;
}

/** The records shown in the Record column: the meeting's linked records, else its participants' companies. */
export function recordsOfCall(
  call: Pick<CallListItem, 'linkedRecords' | 'participants'>,
  companyDefinitionId: string | null,
): RecordRefLite[] {
  if (call.linkedRecords.length > 0)
    return call.linkedRecords.map((r) => ({
      entityDefinitionId: r.entityDefinitionId,
      entityInstanceId: r.entityInstanceId,
    }));
  if (!companyDefinitionId) return [];
  const seen = new Set<string>();
  const out: RecordRefLite[] = [];
  for (const p of call.participants) {
    if (!p.companyId || seen.has(p.companyId)) continue;
    seen.add(p.companyId);
    out.push({ entityDefinitionId: companyDefinitionId, entityInstanceId: p.companyId });
  }
  return out;
}

/** Summary line of a card: the concise summary, else the state of the summary. */
export function summaryLine(call: Pick<CallListItem, 'conciseSummary' | 'summaryStatus' | 'status'>): {
  text: string;
  state: 'ready' | 'pending' | 'empty';
} {
  if (call.conciseSummary) return { text: call.conciseSummary, state: 'ready' };
  if (call.status === 'processing' || call.summaryStatus === 'queued' || call.summaryStatus === 'executing')
    return { text: 'Analyzing call data...', state: 'pending' };
  return { text: 'This call recording has no summary', state: 'empty' };
}

// ---- insights and templates ----------------------------------------------------------------------------------------------

export const UNTITLED_TEMPLATE = 'Untitled Template';

export function templateTitle(t: Pick<InsightTemplate, 'title' | 'aiTitle'>): string {
  return t.title?.trim() || t.aiTitle?.trim() || UNTITLED_TEMPLATE;
}

/** What the insight picker lists: published, not archived templates (with an active version). */
export function pickableTemplates(templates: readonly InsightTemplate[], query = ''): InsightTemplate[] {
  const q = query.trim().toLowerCase();
  return templates.filter(
    (t) =>
      t.status === 'enabled' &&
      !t.isArchived &&
      !t.isTransient &&
      t.activeSnapshotId !== null &&
      (q === '' || templateTitle(t).toLowerCase().includes(q) || (t.aiTitle ?? '').toLowerCase().includes(q)),
  );
}

export const PRESET_CATEGORY_ORDER = [
  'general',
  'sales',
  'success',
  'product',
  'marketing',
  'recruiting',
  'fundraising',
  'investing',
] as const;
export type PresetCategory = (typeof PRESET_CATEGORY_ORDER)[number];

export const PRESET_CATEGORY_LABEL: Record<PresetCategory, string> = {
  general: 'General',
  sales: 'Sales',
  success: 'Success',
  product: 'Product',
  marketing: 'Marketing',
  recruiting: 'Recruiting',
  fundraising: 'Fundraising',
  investing: 'Investing',
};

/** The gallery's list: checked categories (any of them) and a search over title and description, in catalog order. */
export function filterPresets(
  presets: readonly InsightPreset[],
  options: { categories?: ReadonlySet<string> | readonly string[]; query?: string },
): InsightPreset[] {
  const categories = new Set(options.categories ?? []);
  const q = (options.query ?? '').trim().toLowerCase();
  return presets.filter(
    (p) =>
      (categories.size === 0 || p.categories.some((c) => categories.has(c))) &&
      (q === '' || p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)),
  );
}

/** The gallery lists presets alphabetically by title. */
export function sortPresets(presets: readonly InsightPreset[]): InsightPreset[] {
  return [...presets].sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }));
}

export type InsightPhase = 'analyzing' | 'ready' | 'failed' | 'not-configured';

/** The state of an insight (or preview) on screen: generating, ready, failed, or AI not configured. */
export function insightPhase(insight: { status: string; error: string | null }): InsightPhase {
  if (insight.status === 'queued' || insight.status === 'executing') return 'analyzing';
  if (insight.status === 'failed') return insight.error?.startsWith('AI_NOT_CONFIGURED') ? 'not-configured' : 'failed';
  return 'ready';
}

/** Whether a processing error (summaries) means AI is not set up for the workspace. */
export function isNotConfiguredError(error: string | null | undefined): boolean {
  return typeof error === 'string' && error.startsWith('AI_NOT_CONFIGURED');
}
