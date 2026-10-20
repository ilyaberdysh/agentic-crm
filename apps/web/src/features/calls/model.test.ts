import type {
  CallSpeaker,
  CallUtterance,
  InsightPreset,
  InsightTemplate,
  TranscriptBlock,
} from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  addFilter,
  barSegments,
  blockViews,
  filterPresets,
  formatActivityDate,
  formatCallDuration,
  formatCardDate,
  formatTalkShare,
  formatTalkTime,
  formatTimestamp,
  groupCalls,
  insightPhase,
  isNotConfiguredError,
  parseRange,
  pickableTemplates,
  quoteSelection,
  rangeIndexes,
  rangeLink,
  recordsOfCall,
  selectionRange,
  selectionText,
  sortPresets,
  summaryLine,
  talkStats,
  templateTitle,
  toListFilters,
  utteranceInRange,
} from './model';

const speaker = (id: string, name: string): CallSpeaker => ({
  id,
  name,
  providedName: name,
  emailAddress: null,
  kind: 'unknown',
  participantId: null,
  memberId: null,
  person: null,
  isOrganizer: false,
  speakerIds: [id],
});

const A = speaker('a', 'Ilya');
const B = speaker('b', 'Jane');

const utt = (index: number, speakerId: string | null, start: number, end: number, text: string): CallUtterance => ({
  index,
  speakerId,
  start,
  end,
  text,
});

// Ilya 2-7, Jane 8-14 + 15-21 (one running paragraph), Ilya 34-41, Jane 41.6-52 then 60-70 (paragraph break at > 2 s).
const utterances = [
  utt(0, 'a', 2, 7, 'Hi Jane.'),
  utt(1, 'b', 8, 14, 'Sure.'),
  utt(2, 'b', 15, 21, 'Wade leads sales.'),
  utt(3, 'a', 34, 41, 'How do you follow up?'),
  utt(4, 'b', 41.6, 52, 'Mostly from memory.'),
  utt(5, 'b', 60, 70, 'Nobody reviews calls.'),
];
const blocks: TranscriptBlock[] = [
  { speakerId: 'a', start: 2, end: 7, paragraphs: [{ start: 2, end: 7, utteranceIndexes: [0] }] },
  { speakerId: 'b', start: 8, end: 21, paragraphs: [{ start: 8, end: 21, utteranceIndexes: [1, 2] }] },
  { speakerId: 'a', start: 34, end: 41, paragraphs: [{ start: 34, end: 41, utteranceIndexes: [3] }] },
  {
    speakerId: 'b',
    start: 41.6,
    end: 70,
    paragraphs: [
      { start: 41.6, end: 52, utteranceIndexes: [4] },
      { start: 60, end: 70, utteranceIndexes: [5] },
    ],
  },
];
const input = { speakers: [A, B], utterances, blocks };

describe('time formats', () => {
  it('formats transcript timestamps as m:ss and h:mm:ss', () => {
    expect(formatTimestamp(0)).toBe('0:00');
    expect(formatTimestamp(2.9)).toBe('0:02');
    expect(formatTimestamp(65)).toBe('1:05');
    expect(formatTimestamp(3725)).toBe('1:02:05');
    expect(formatTimestamp(-4)).toBe('0:00');
    expect(formatTimestamp(Number.NaN)).toBe('0:00');
  });

  it('formats call durations like the Calls list', () => {
    expect(formatCallDuration(1800)).toBe('30min');
    expect(formatCallDuration(42)).toBe('42 sec');
    expect(formatCallDuration(0)).toBe('0 sec');
    expect(formatCallDuration(3900)).toBe('1h 5min');
    expect(formatCallDuration(7200)).toBe('2h');
  });

  it('formats talk time and share', () => {
    expect(formatTalkTime(48)).toBe('48s');
    expect(formatTalkTime(60)).toBe('1m');
    expect(formatTalkTime(89)).toBe('1m');
    expect(formatTalkShare(40.1)).toBe('40.1%');
    expect(formatTalkShare(33)).toBe('33%');
    expect(formatTalkShare(33.04)).toBe('33%');
    expect(formatTalkShare(26.25)).toBe('26.3%');
  });
});

describe('card dates', () => {
  const call = { startAt: '2026-10-09T14:00:00Z', endAt: '2026-10-09T14:30:00Z', isAllDay: false };
  it('formats the date chip of a Calls card in the viewer’s zone', () => {
    expect(formatCardDate(call, 'Europe/Moscow')).toBe('Friday, October 9 5:00 PM - 5:30 PM');
    expect(formatCardDate(call, 'UTC')).toBe('Friday, October 9 2:00 PM - 2:30 PM');
    expect(formatCardDate({ ...call, isAllDay: true }, 'UTC')).toBe('Friday, October 9');
  });

  it('formats the activity meeting card with a relative day', () => {
    const now = Date.parse('2026-10-10T09:00:00Z');
    expect(formatActivityDate(call, 'Europe/Moscow', now)).toBe('Yesterday, 5:00 PM - 5:30 PM');
    expect(formatActivityDate(call, 'Europe/Moscow', Date.parse('2026-10-09T20:00:00Z'))).toBe(
      'Today, 5:00 PM - 5:30 PM',
    );
    expect(formatActivityDate(call, 'Europe/Moscow', Date.parse('2026-10-20T09:00:00Z'))).toBe(
      'Oct 9, 5:00 PM - 5:30 PM',
    );
  });
});

describe('range links', () => {
  it('accepts a range only when both numbers are valid and start < end', () => {
    expect(parseRange('12.5', '40')).toEqual({ start: 12.5, end: 40 });
    expect(parseRange(12, 40)).toEqual({ start: 12, end: 40 });
    expect(parseRange('40', '12')).toBeNull();
    expect(parseRange('12', '12')).toBeNull();
    expect(parseRange('abc', '12')).toBeNull();
    expect(parseRange(undefined, '12')).toBeNull();
    expect(parseRange('-3', '12')).toBeNull();
    expect(parseRange('', '12')).toBeNull();
  });

  it('builds the link of a section with trimmed decimals', () => {
    expect(rangeLink('https://crm.test', '/mymeet/calls/m/r/transcript', { start: 41.6, end: 70 })).toBe(
      'https://crm.test/mymeet/calls/m/r/transcript?start=41.6&end=70',
    );
    expect(rangeLink('', '/x', { start: 2.123456, end: 7 })).toBe('/x?start=2.12&end=7');
  });

  it('covers the utterances that overlap the range', () => {
    expect(utteranceInRange(utterances[2] as CallUtterance, { start: 15, end: 21 })).toBe(true);
    expect(utteranceInRange(utterances[1] as CallUtterance, { start: 15, end: 21 })).toBe(false);
    expect(rangeIndexes(utterances, { start: 34, end: 52 })).toEqual([3, 4]);
    expect(rangeIndexes(utterances, { start: 100, end: 120 })).toEqual([]);
  });
});

describe('transcript blocks', () => {
  it('renders consecutive segments of one speaker as one block and one running paragraph', () => {
    const views = blockViews(input);
    expect(views).toHaveLength(4);
    const jane = views[1];
    expect(jane?.speakerName).toBe('Jane');
    expect(jane?.paragraphs).toHaveLength(1);
    expect(jane?.paragraphs[0]?.utterances.map((u) => u.text)).toEqual(['Sure.', 'Wade leads sales.']);
    expect(views[3]?.paragraphs).toHaveLength(2);
  });

  it('names a speaker without a match "Unknown"', () => {
    const views = blockViews({
      speakers: [],
      utterances: [utt(0, null, 0, 3, 'Hello')],
      blocks: [{ speakerId: null, start: 0, end: 3, paragraphs: [{ start: 0, end: 3, utteranceIndexes: [0] }] }],
    });
    expect(views[0]?.speakerName).toBe('Unknown');
  });

  it('dims utterances outside a range link, and whole blocks that are entirely outside', () => {
    const views = blockViews(input, { range: { start: 34, end: 52 } });
    expect(views.map((b) => b.dimmed)).toEqual([true, true, false, false]);
    const last = views[3];
    expect(last?.paragraphs[0]?.utterances[0]?.dimmed).toBe(false);
    expect(last?.paragraphs[1]?.utterances[0]?.dimmed).toBe(true);
  });

  it('dims the other speakers while one is in focus', () => {
    const views = blockViews(input, { focusSpeakerId: 'b' });
    expect(views.map((b) => b.dimmed)).toEqual([true, false, true, false]);
    expect(blockViews(input, { focusSpeakerId: null }).some((b) => b.dimmed)).toBe(false);
  });
});

describe('selection', () => {
  it('maps a selection to first start and last end', () => {
    expect(selectionRange([utterances[1] as CallUtterance, utterances[2] as CallUtterance])).toEqual({
      start: 8,
      end: 21,
    });
    expect(selectionRange([])).toBeNull();
  });

  it('copies in the transcript format, omitting the prefix when the selection starts mid-block', () => {
    const views = blockViews(input);
    expect(selectionText(views, new Set([0]))).toBe('[0:02] Ilya: Hi Jane.');
    expect(selectionText(views, new Set([1, 2, 3]))).toBe(
      '[0:08] Jane: Sure. Wade leads sales.\n[0:34] Ilya: How do you follow up?',
    );
    // starts at the second segment of Jane's block: no prefix on the first line
    expect(selectionText(views, new Set([2, 3]))).toBe('Wade leads sales.\n[0:34] Ilya: How do you follow up?');
    // further paragraphs of a block go on their own lines
    expect(selectionText(views, new Set([4, 5]))).toBe('[0:41] Jane: Mostly from memory.\nNobody reviews calls.');
    expect(selectionText(views, new Set())).toBe('');
  });
});

describe('Ask AI quote', () => {
  it('quotes the selection line by line and clips long ones', () => {
    expect(quoteSelection('[0:44] Wade: Hi\nHello')).toBe('> [0:44] Wade: Hi\n> Hello');
    const long = quoteSelection('x'.repeat(2000));
    expect(long.length).toBeLessThan(1510);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('talk share', () => {
  it('computes seconds, share (one decimal) and segments per speaker', () => {
    const stats = talkStats(utterances, ['a', 'b']);
    // Ilya 5 + 7 = 12 s; Jane 6 + 6 + 10.4 + 10 = 32.4 s; total 44.4 s
    expect(stats.get('a')?.seconds).toBeCloseTo(12, 5);
    expect(stats.get('b')?.seconds).toBeCloseTo(32.4, 5);
    expect(stats.get('a')?.share).toBe(27);
    expect(stats.get('b')?.share).toBe(73);
    expect(stats.get('b')?.segments).toHaveLength(4);
  });

  it('is zero for a call without speech', () => {
    expect(talkStats([], ['a']).get('a')).toEqual({ seconds: 0, share: 0, segments: [] });
  });

  it('lays out the 4 px timeline as percentages of the call', () => {
    const bar = barSegments([{ start: 10, end: 20 }], 100);
    expect(bar).toEqual([{ left: 10, width: 10, start: 10, end: 20 }]);
    expect(barSegments([{ start: 99.9, end: 100 }], 100)[0]?.width).toBeCloseTo(0.1, 5);
    expect(barSegments([{ start: 0, end: 0.01 }], 100)[0]?.width).toBe(0.4);
    expect(barSegments([{ start: 1, end: 2 }], 0)).toEqual([]);
  });
});

describe('calls list groups', () => {
  const item = (id: string, dateGroup: 'today' | 'last-week' | 'older' | null) => ({ id, dateGroup });
  it('groups items by the server buckets in display order and drops groups without loaded items', () => {
    const groups = groupCalls(
      [item('1', 'today'), item('2', 'today'), item('3', 'older')],
      [
        { key: 'today', count: 2 },
        { key: 'last-week', count: 4 },
        { key: 'older', count: 1 },
      ],
      'meeting-date',
    );
    expect(groups.map((g) => [g.label, g.count, g.items.length])).toEqual([
      ['Today', 2, 2],
      ['Over a year ago', 1, 1],
    ]);
  });

  it('puts everything in one group when not grouped', () => {
    const groups = groupCalls([item('1', null), item('2', null)], [], 'none');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toHaveLength(2);
    expect(groupCalls([], [], 'none')).toEqual([]);
  });
});

describe('list filters', () => {
  it('maps stored filters to the server shape and does not add one twice', () => {
    const record = {
      id: '1',
      field: 'record',
      mode: 'must',
      value: { entityDefinitionId: 'companies', entityInstanceId: 'c1' },
    } as const;
    const member = { id: '2', field: 'participants', mode: 'must-not', value: { memberId: 'm1' } } as const;
    const team = { id: '3', field: 'participants-teams', mode: 'must', value: { teamId: 't1' } } as const;
    expect(toListFilters([record, member, team])).toEqual([
      { field: 'record', mode: 'must', operator: 'eq', value: record.value },
      { field: 'participants', mode: 'must-not', operator: 'eq', value: member.value },
      { field: 'participants-teams', mode: 'must', operator: 'contains', value: team.value },
    ]);
    expect(addFilter([record], { ...record, id: 'other' })).toHaveLength(1);
    expect(addFilter([record], member)).toHaveLength(2);
  });
});

describe('call cards', () => {
  const participant = (companyId: string | null) => ({
    id: Math.random().toString(),
    name: null,
    emailAddress: null,
    isOrganizer: false,
    memberId: null,
    personId: null,
    companyId,
  });
  it('shows linked records, else the participants’ companies once each', () => {
    const linked = { entityDefinitionId: 'd', entityInstanceId: 'r1', objectSlug: 'x' } as never;
    expect(recordsOfCall({ linkedRecords: [linked], participants: [] }, 'companies')).toEqual([
      { entityDefinitionId: 'd', entityInstanceId: 'r1' },
    ]);
    expect(
      recordsOfCall(
        { linkedRecords: [], participants: [participant('c1'), participant('c1'), participant('c2')] },
        'companies',
      ),
    ).toEqual([
      { entityDefinitionId: 'companies', entityInstanceId: 'c1' },
      { entityDefinitionId: 'companies', entityInstanceId: 'c2' },
    ]);
    expect(recordsOfCall({ linkedRecords: [], participants: [participant('c1')] }, null)).toEqual([]);
  });

  it('summarises the state of the summary', () => {
    expect(summaryLine({ conciseSummary: 'Pilot agreed', summaryStatus: 'completed', status: 'completed' })).toEqual({
      text: 'Pilot agreed',
      state: 'ready',
    });
    expect(summaryLine({ conciseSummary: null, summaryStatus: 'executing', status: 'processing' }).state).toBe(
      'pending',
    );
    expect(summaryLine({ conciseSummary: null, summaryStatus: 'failed', status: 'completed' }).state).toBe('empty');
  });
});

describe('insight templates', () => {
  const template = (over: Partial<InsightTemplate>): InsightTemplate =>
    ({
      id: 't',
      title: null,
      aiTitle: null,
      status: 'enabled',
      isTransient: false,
      isArchived: false,
      activeSnapshotId: 's',
      ...over,
    }) as InsightTemplate;

  it('titles templates like the list does', () => {
    expect(templateTitle(template({ title: 'BANT' }))).toBe('BANT');
    expect(templateTitle(template({ aiTitle: 'Sales Discovery' }))).toBe('Sales Discovery');
    expect(templateTitle(template({}))).toBe('Untitled Template');
    expect(templateTitle(template({ title: '  ', aiTitle: 'AI' }))).toBe('AI');
  });

  it('lists only published, active templates in the picker, filtered by title', () => {
    const list = [
      template({ id: '1', title: 'BANT' }),
      template({ id: '2', title: 'MEDDPICC' }),
      template({ id: '3', title: 'Draft one', status: 'draft', activeSnapshotId: null }),
      template({ id: '4', title: 'Archived', isArchived: true, status: 'disabled' }),
    ];
    expect(pickableTemplates(list).map((t) => t.id)).toEqual(['1', '2']);
    expect(pickableTemplates(list, 'med').map((t) => t.id)).toEqual(['2']);
    expect(pickableTemplates(list, 'zzz')).toEqual([]);
  });

  it('filters presets by category and search', () => {
    const preset = (id: string, title: string, categories: string[], description = ''): InsightPreset =>
      ({ id, title, description, categories, sections: [] }) as unknown as InsightPreset;
    const presets = [
      preset('bant', 'BANT', ['sales'], 'Budget and authority'),
      preset('screen', 'Candidate Screen', ['recruiting']),
      preset('demo', 'Product Demo', ['success', 'product', 'sales']),
    ];
    expect(filterPresets(presets, {}).map((p) => p.id)).toEqual(['bant', 'screen', 'demo']);
    expect(filterPresets(presets, { categories: new Set(['sales']) }).map((p) => p.id)).toEqual(['bant', 'demo']);
    expect(filterPresets(presets, { categories: ['sales', 'recruiting'] })).toHaveLength(3);
    expect(filterPresets(presets, { query: 'authority' }).map((p) => p.id)).toEqual(['bant']);
    expect(filterPresets(presets, { categories: ['sales'], query: 'demo' }).map((p) => p.id)).toEqual(['demo']);
  });

  it('lists presets alphabetically', () => {
    const p = (title: string) =>
      ({ id: title, title, description: '', categories: [], sections: [] }) as unknown as InsightPreset;
    expect(
      sortPresets([p('Sales Discovery'), p('BANT'), p('behavioral Interview'), p('AE')]).map((x) => x.title),
    ).toEqual(['AE', 'BANT', 'behavioral Interview', 'Sales Discovery']);
  });

  it('derives the on-screen phase of an insight', () => {
    expect(insightPhase({ status: 'queued', error: null })).toBe('analyzing');
    expect(insightPhase({ status: 'executing', error: null })).toBe('analyzing');
    expect(insightPhase({ status: 'completed', error: null })).toBe('ready');
    expect(insightPhase({ status: 'failed', error: 'LLM_ERROR: x' })).toBe('failed');
    expect(insightPhase({ status: 'failed', error: 'AI_NOT_CONFIGURED' })).toBe('not-configured');
    expect(isNotConfiguredError('AI_NOT_CONFIGURED')).toBe(true);
    expect(isNotConfiguredError(null)).toBe(false);
  });
});
