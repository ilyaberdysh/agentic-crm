// Plain text with positioned mentions (contracts `mentionSchema`;  task input, comment composer):
// keeping mention ranges valid while the text is edited, inserting a picked mention in place of "@query", and the
// "@query" being typed before the caret.
import type { Mention } from '@agentic-crm/contracts';

export interface MentionText {
  text: string;
  mentions: Mention[];
}

export const EMPTY_MENTION_TEXT: MentionText = { text: '', mentions: [] };

/**
 * New text after an edit: mentions before the changed span stay, those after it shift, those it touched are
 * dropped (their characters stay as plain text).
 */
export function applyTextEdit(prev: MentionText, nextText: string): MentionText {
  const a = prev.text;
  const b = nextText;
  if (a === b) return prev;
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const delta = endB - endA;
  const mentions: Mention[] = [];
  for (const m of prev.mentions) {
    const mEnd = m.start + m.length;
    if (mEnd <= start) mentions.push(m);
    else if (m.start >= endA) mentions.push({ ...m, start: m.start + delta });
  }
  return { text: b, mentions: mentions.filter((m) => b.slice(m.start, m.start + m.length).startsWith('@')) };
}

/** The mention ending at `caret` (Backspace removes it whole). */
export function mentionEndingAt(value: MentionText, caret: number): Mention | null {
  return value.mentions.find((m) => m.start + m.length === caret) ?? null;
}

/** The mention starting at `caret` (Delete removes it whole). */
export function mentionStartingAt(value: MentionText, caret: number): Mention | null {
  return value.mentions.find((m) => m.start === caret) ?? null;
}

export function removeMention(value: MentionText, mention: Mention): MentionText {
  const text = value.text.slice(0, mention.start) + value.text.slice(mention.start + mention.length);
  return {
    text,
    mentions: value.mentions
      .filter((m) => m !== mention)
      .map((m) => (m.start > mention.start ? { ...m, start: m.start - mention.length } : m)),
  };
}

/** "@query" right before the caret (outside existing mentions), or null. */
export function activeQuery(value: MentionText, caret: number): { start: number; query: string } | null {
  const before = value.text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s|\(|\[/.test(before[at - 1] as string)) return null;
  if (value.mentions.some((m) => at >= m.start && at < m.start + m.length)) return null;
  const query = before.slice(at + 1);
  if (query.length > 40 || /\n/.test(query) || /\s{2}/.test(query) || query.split(' ').length > 3) return null;
  return { start: at, query };
}

export type MentionTarget =
  | { kind: 'workspace-member'; memberId: string; label: string }
  | { kind: 'record'; entityDefinitionId: string; entityInstanceId: string; label: string };

/** Replaces "@query" (from `start` to the caret) with "@Label " and records the mention. */
export function insertMention(
  value: MentionText,
  start: number,
  caret: number,
  target: MentionTarget,
): { value: MentionText; caret: number } {
  const token = `@${target.label}`;
  const text = `${value.text.slice(0, start)}${token} ${value.text.slice(caret)}`;
  const delta = token.length + 1 - (caret - start);
  const shifted = value.mentions.map((m) => (m.start >= caret ? { ...m, start: m.start + delta } : m));
  const mention: Mention =
    target.kind === 'workspace-member'
      ? { kind: 'workspace-member', start, length: token.length, memberId: target.memberId }
      : {
          kind: 'record',
          start,
          length: token.length,
          entityDefinitionId: target.entityDefinitionId,
          entityInstanceId: target.entityInstanceId,
        };
  return {
    value: { text, mentions: [...shifted, mention].sort((x, y) => x.start - y.start) },
    caret: start + token.length + 1,
  };
}

/** Text split into plain and mention segments, for rendering. */
export function segments(value: MentionText): { text: string; mention: Mention | null }[] {
  const out: { text: string; mention: Mention | null }[] = [];
  let at = 0;
  for (const m of [...value.mentions].sort((x, y) => x.start - y.start)) {
    if (m.start < at) continue;
    if (m.start > at) out.push({ text: value.text.slice(at, m.start), mention: null });
    out.push({ text: value.text.slice(m.start, m.start + m.length), mention: m });
    at = m.start + m.length;
  }
  if (at < value.text.length) out.push({ text: value.text.slice(at), mention: null });
  return out;
}

/** Records mentioned in the text (a task links them;  "Smart parsing"). */
export function mentionedRecords(value: MentionText): { entityDefinitionId: string; entityInstanceId: string }[] {
  const seen = new Set<string>();
  const out: { entityDefinitionId: string; entityInstanceId: string }[] = [];
  for (const m of value.mentions) {
    if (m.kind !== 'record' || seen.has(m.entityInstanceId)) continue;
    seen.add(m.entityInstanceId);
    out.push({ entityDefinitionId: m.entityDefinitionId, entityInstanceId: m.entityInstanceId });
  }
  return out;
}
