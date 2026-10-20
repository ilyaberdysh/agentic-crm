// Prompts and answer parsing of AI autofill (ai-attributes §2): Summarize record and Classify record see every
// attribute of the record; Prompt completion sees only the variables inserted into its prompt.
import type { AiAutofillType } from '@agentic-crm/contracts';

export interface RecordLine {
  title: string;
  text: string;
}

export interface PromptInput {
  type: AiAutofillType;
  objectNoun: string;
  attributeTitle: string;
  attributeType: string;
  /** Rendered guidance (variables substituted); null when none. */
  guidance: string | null;
  record: RecordLine[];
  options: string[];
  multiple: boolean;
  allowNewOptions: boolean;
}

const recordBlock = (lines: RecordLine[]) =>
  lines.length === 0 ? '(no attribute values)' : lines.map((l) => `- ${l.title}: ${l.text}`).join('\n');

export function buildPrompt(input: PromptInput): { system: string; prompt: string } {
  switch (input.type) {
    case 'summarize-record':
      return {
        system:
          'You write short, factual summaries of CRM records for a sales team. Use only the record data provided. ' +
          'Reply with the summary text only: plain text, at most three sentences, no preamble.',
        prompt: `${input.objectNoun} record:\n${recordBlock(input.record)}\n\nInstructions: ${
          input.guidance?.trim() || `Summarize this ${input.objectNoun.toLowerCase()}.`
        }`,
      };
    case 'classify-record':
      return {
        system:
          'You classify CRM records. Reply with JSON only, in the form {"options": ["<title>", …]}. ' +
          (input.multiple ? 'Choose every option that applies. ' : 'Choose at most one option. ') +
          (input.allowNewOptions
            ? 'Prefer the listed options; you may propose a new short title when none fits.'
            : 'Use only titles from the list; reply {"options": []} when none fits.'),
        prompt: `Attribute: ${input.attributeTitle}\nOptions:\n${input.options.map((o) => `- ${o}`).join('\n') || '(none)'}\n\n${
          input.objectNoun
        } record:\n${recordBlock(input.record)}${input.guidance?.trim() ? `\n\nInstructions: ${input.guidance.trim()}` : ''}`,
      };
    default: {
      const numeric = input.attributeType === 'number' || input.attributeType === 'currency';
      return {
        system:
          'You complete a prompt about a CRM record. ' +
          (numeric
            ? 'Reply with a single number only, without units or currency symbols.'
            : 'Reply with the answer only, no preamble.'),
        prompt: input.guidance?.trim() || '',
      };
    }
  }
}

/** First number in a reply ("about 1,200 employees" → 1200). */
export function parseNumber(text: string): number | null {
  const m = /-?\d[\d,]*(?:\.\d+)?|-?\.\d+/.exec(text.replace(/\s/g, ''));
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Option titles of a classify reply (JSON `{options: […]}`, a JSON array, or one title per line). */
export function parseOptions(text: string): string[] {
  const trimmed = text.trim();
  const json = /\{[\s\S]*\}|\[[\s\S]*\]/.exec(trimmed)?.[0];
  if (json) {
    try {
      const parsed = JSON.parse(json) as unknown;
      const list = Array.isArray(parsed) ? parsed : (parsed as { options?: unknown }).options;
      if (Array.isArray(list))
        return list.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim());
    } catch {
      // fall through to lines
    }
  }
  return trimmed
    .split('\n')
    .map((l) => l.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter((l) => l !== '');
}

/** Plain-text answer (quotes and surrounding whitespace removed). */
export function parseText(text: string): string | null {
  const t = text
    .trim()
    .replace(/^"([\s\S]*)"$/, '$1')
    .trim();
  return t === '' ? null : t.slice(0, 10_000);
}
