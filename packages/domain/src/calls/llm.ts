// The calls AI steps on the AI layer's one LLM module (packages/domain/src/ai/llm.ts): purposes, prompt tags and
// deterministic fake replies for tests. Summaries and insights use structured outputs (`outputSchema`), the
// workspace's bulk model (`workspaceModelFor`) and the credits ledger (ai/credits, 'workspace' spend).
import { FakeLlm, type LlmPurpose, type LlmRequest, lastUserText } from '../ai/llm.ts';

/** LLM purposes of the calls features (bulk tier). */
export const CALL_PURPOSES = {
  summaries: 'call-summary',
  insights: 'call-insight',
  preview: 'call-insight-preview',
} as const satisfies Record<string, LlmPurpose>;

/** Ledger sources of the calls spend. */
export const CALL_CREDIT_SOURCES = {
  summaries: 'call-summary',
  insight: 'call-insight',
  preview: 'insight-template-preview',
} as const;

/** Tags the calls prompts use to delimit parts of the user message. */
export const TAGS = {
  title: 'call_title',
  transcript: 'transcript',
  sections: 'sections',
} as const;

/** Text between `<tag>` and `</tag>` (first occurrence), trimmed; null when absent. */
export function tagged(text: string, tag: string): string | null {
  const open = text.indexOf(`<${tag}>`);
  if (open < 0) return null;
  const from = open + tag.length + 2;
  const close = text.indexOf(`</${tag}>`, from);
  return (close < 0 ? text.slice(from) : text.slice(from, close)).trim();
}

/** Deterministic answers of the calls purposes, derived from the request (title, sections). */
export function callsFakeReply(request: LlmRequest): unknown {
  const prompt = lastUserText(request);
  const title = tagged(prompt, TAGS.title) ?? 'the call';
  if (request.purpose === CALL_PURPOSES.summaries) {
    return {
      summary: `${title}: the participants walked through the agenda, agreed on next steps and owners, and scheduled a follow-up.`,
      concise_summary: `${title}: next steps agreed`,
    };
  }
  const sections = JSON.parse(tagged(prompt, TAGS.sections) ?? '[]') as { id: string; format: string }[];
  return {
    sections: sections.map((s, i) =>
      s.format === 'list'
        ? { id: s.id, content: '', items: [`Point ${i + 1}.1`, `Point ${i + 1}.2`] }
        : { id: s.id, content: `Answer ${i + 1}`, items: [] },
    ),
  };
}

const CALL_PURPOSE_SET = new Set<string>(Object.values(CALL_PURPOSES));

/** Registers the deterministic calls replies on a FakeLlm (tests; rules added later take precedence). */
export function withCallsFakeReplies(fake: FakeLlm): FakeLlm {
  return fake.when(
    (r) => CALL_PURPOSE_SET.has(r.purpose),
    (r) => ({ json: callsFakeReply(r) }),
  );
}

/** A FakeLlm answering the calls purposes deterministically (and everything else like the plain FakeLlm). */
export function fakeCallsLlm(): FakeLlm {
  return withCallsFakeReplies(new FakeLlm());
}
