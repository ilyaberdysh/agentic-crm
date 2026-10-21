// Prompts of the calls AI steps. The system prompts are stable (prompt
// caching); everything call-specific is in the user message. Answers are structured outputs (`outputSchema`).
import type { InsightSectionResult, InsightSectionType } from '@agentic-crm/contracts';
import type { LlmRequest } from '../ai/llm.ts';
import { CALL_PURPOSES, TAGS } from './llm.ts';

/** Transcripts longer than this are cut in the middle (a 3-hour call is ~200k characters). */
export const MAX_TRANSCRIPT_CHARS = 400_000;

export interface CallContext {
  title: string;
  /** ISO start of the meeting. */
  startAt: string;
  durationSeconds: number;
  participants: string[];
  /** Copy-format transcript (transcript.ts transcriptText). */
  transcript: string;
}

function clip(text: string): string {
  if (text.length <= MAX_TRANSCRIPT_CHARS) return text;
  const half = Math.floor(MAX_TRANSCRIPT_CHARS / 2);
  return `${text.slice(0, half)}\n[… middle of the transcript omitted …]\n${text.slice(-half)}`;
}

function callBlock(call: CallContext): string {
  const minutes = Math.max(1, Math.round(call.durationSeconds / 60));
  return [
    `<${TAGS.title}>${call.title || 'Untitled call'}</${TAGS.title}>`,
    `Date: ${call.startAt.slice(0, 16).replace('T', ' ')} UTC · about ${minutes} min`,
    `Participants: ${call.participants.length > 0 ? call.participants.join(', ') : 'unknown'}`,
    '',
    `<${TAGS.transcript}>`,
    clip(call.transcript),
    `</${TAGS.transcript}>`,
  ].join('\n');
}

const LANGUAGE_RULE =
  'Write in the language most of the transcript is spoken in, unless the instructions ask for another language.';

const SUMMARIES_SYSTEM = [
  'You summarise business calls recorded and transcribed by a meeting assistant, for the CRM of the team that held',
  'the call. Be factual: use only what the transcript says, never invent names, numbers or commitments.',
  LANGUAGE_RULE,
  'Return two summaries. "summary": one or two short paragraphs (at most 120 words) covering the purpose of the',
  'call, what was discussed and decided, and the agreed next steps with owners. "concise_summary": one telegraphic',
  'line of at most 160 characters for a timeline card (no "In this call").',
].join(' ');

const SUMMARIES_SCHEMA = {
  type: 'object',
  properties: { summary: { type: 'string' }, concise_summary: { type: 'string' } },
  required: ['summary', 'concise_summary'],
  additionalProperties: false,
};

/** One request for both summaries (long for the call page, concise for record pages and cards). */
export function summariesRequest(call: CallContext, model: string): LlmRequest {
  return {
    purpose: CALL_PURPOSES.summaries,
    model,
    system: SUMMARIES_SYSTEM,
    messages: [{ role: 'user', content: callBlock(call) }],
    outputSchema: SUMMARIES_SCHEMA,
    maxTokens: 4000,
  };
}

/** The summaries of a structured answer; a missing concise summary falls back to the summary's first sentence. */
export function parseSummaries(json: unknown): { summary: string; concise: string } | null {
  const value = (json ?? {}) as { summary?: unknown; concise_summary?: unknown };
  const summary = typeof value.summary === 'string' ? value.summary.trim() : '';
  if (!summary) return null;
  let concise = typeof value.concise_summary === 'string' ? value.concise_summary.trim() : '';
  if (!concise) {
    const first = summary.split(/(?<=[.!?])\s/)[0] ?? summary;
    concise = first.length > 160 ? `${first.slice(0, 157)}…` : first;
  }
  return { summary, concise };
}

export interface SectionSpec {
  id: string;
  title: string;
  type: InsightSectionType;
  prompt: string;
}

const INSIGHTS_SYSTEM = [
  'You extract structured insights from business call transcripts for a CRM. The user message holds the call and a',
  'list of sections, each with an id, a title, a format and instructions. Answer every section, in order, with its',
  'id: format "text" → "content" (plain text, "items" empty); format "list" → "items" (short entries, one fact',
  'each; "content" empty). Use only what the transcript supports; when nothing relevant was said, leave the section',
  'empty rather than guessing. Plain text only, no Markdown.',
  LANGUAGE_RULE,
].join(' ');

const INSIGHTS_SCHEMA = {
  type: 'object',
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          content: { type: 'string' },
          items: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'content', 'items'],
        additionalProperties: false,
      },
    },
  },
  required: ['sections'],
  additionalProperties: false,
};

/** Insights of a template version applied to a call (call page) or to a preview call (template editor). */
export function insightsRequest(
  call: CallContext,
  sections: SectionSpec[],
  kind: 'insight' | 'preview',
  model: string,
): LlmRequest {
  const spec = sections.map((s) => ({
    id: s.id,
    title: s.title,
    format: s.type === 'list' ? 'list' : 'text',
    instructions: s.prompt,
  }));
  return {
    purpose: kind === 'insight' ? CALL_PURPOSES.insights : CALL_PURPOSES.preview,
    model,
    system: INSIGHTS_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `${callBlock(call)}\n\n<${TAGS.sections}>${JSON.stringify(spec)}</${TAGS.sections}>`,
      },
    ],
    outputSchema: INSIGHTS_SCHEMA,
    maxTokens: 8000,
  };
}

/** One result per section from a structured answer (sections the model skipped come back empty); null = unusable. */
export function parseInsights(json: unknown, sections: SectionSpec[]): InsightSectionResult[] | null {
  const list = (json as { sections?: unknown } | null)?.sections;
  if (!Array.isArray(list)) return null;
  const answers = list.filter((s): s is Record<string, unknown> => !!s && typeof s === 'object');
  const byId = new Map(answers.filter((s) => typeof s.id === 'string').map((s) => [s.id as string, s]));
  return sections.map((s, i) => {
    const answer = byId.get(s.id) ?? answers[i] ?? {};
    const items = Array.isArray(answer.items)
      ? answer.items.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
      : [];
    const content = typeof answer.content === 'string' ? answer.content.trim() : '';
    return s.type === 'list'
      ? { sectionId: s.id, title: s.title, type: s.type, content: null, items }
      : { sectionId: s.id, title: s.title, type: s.type, content: content || items.join('\n'), items: [] };
  });
}
