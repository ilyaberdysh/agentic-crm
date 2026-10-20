// Composer text with inline tokens (ask-agentic §2, §10): the plain text keeps "@<name>" for a mention of a record, an
// object or a member and "/<title>" for an inserted prompt; `tokens` mark those ranges and are sent as annotations on
// the text part ({type, start, length, …}). Editing keeps ranges valid: tokens before the edit stay, those after shift,
// touched ones dissolve into plain text. Pure functions (unit-tested); the React input is AskInput.tsx.
import type { AiAnnotation } from '@agentic-crm/contracts';

export type AskToken =
  | { kind: 'record'; start: number; length: number; entityDefinitionId: string; entityInstanceId: string }
  | { kind: 'object'; start: number; length: number; entityDefinitionId: string }
  | { kind: 'member'; start: number; length: number; memberId: string }
  | { kind: 'prompt'; start: number; length: number; promptId: string };

export type AskTokenTarget =
  | { kind: 'record'; entityDefinitionId: string; entityInstanceId: string; label: string }
  | { kind: 'object'; entityDefinitionId: string; label: string }
  | { kind: 'member'; memberId: string; label: string }
  | { kind: 'prompt'; promptId: string; label: string };

export interface ComposerText {
  text: string;
  tokens: AskToken[];
}

export const EMPTY_COMPOSER: ComposerText = { text: '', tokens: [] };

/** The character a token's text starts with. */
export const triggerOf = (kind: AskToken['kind']): '@' | '/' => (kind === 'prompt' ? '/' : '@');

/**
 * New text after an edit: tokens before the changed span stay, those after it shift, those it touched are dropped
 * (their characters stay as plain text).
 */
export function applyTextEdit(prev: ComposerText, nextText: string): ComposerText {
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
  const tokens: AskToken[] = [];
  for (const t of prev.tokens) {
    const end = t.start + t.length;
    if (end <= start) tokens.push(t);
    else if (t.start >= endA) tokens.push({ ...t, start: t.start + delta });
  }
  return {
    text: b,
    tokens: tokens.filter((t) => b.slice(t.start, t.start + t.length).startsWith(triggerOf(t.kind))),
  };
}

export function tokenEndingAt(value: ComposerText, caret: number): AskToken | null {
  return value.tokens.find((t) => t.start + t.length === caret) ?? null;
}

export function tokenStartingAt(value: ComposerText, caret: number): AskToken | null {
  return value.tokens.find((t) => t.start === caret) ?? null;
}

export function removeToken(value: ComposerText, token: AskToken): ComposerText {
  const text = value.text.slice(0, token.start) + value.text.slice(token.start + token.length);
  return {
    text,
    tokens: value.tokens
      .filter((t) => t !== token)
      .map((t) => (t.start > token.start ? { ...t, start: t.start - token.length } : t)),
  };
}

export interface ActiveQuery {
  trigger: '@' | '/';
  /** Index of the trigger character. */
  start: number;
  query: string;
}

/** "@query" or "/query" right before the caret (outside existing tokens), or null. */
export function activeQuery(value: ComposerText, caret: number): ActiveQuery | null {
  const before = value.text.slice(0, caret);
  let at = -1;
  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i];
    if (ch === '\n') break;
    if (ch === '@' || ch === '/') {
      at = i;
      break;
    }
  }
  if (at < 0) return null;
  const trigger = before[at] as '@' | '/';
  if (at > 0 && !/[\s([]/.test(before[at - 1] as string)) return null;
  if (value.tokens.some((t) => at >= t.start && at < t.start + t.length)) return null;
  const query = before.slice(at + 1);
  const maxWords = trigger === '@' ? 3 : 4;
  if (query.length > 40 || /\s{2}/.test(query) || query.split(' ').length > maxWords) return null;
  return { trigger, start: at, query };
}

/** Replaces the typed "@query" / "/query" (from `start` to the caret) with the token's text and a space. */
export function insertToken(
  value: ComposerText,
  start: number,
  caret: number,
  target: AskTokenTarget,
): { value: ComposerText; caret: number } {
  const trigger = triggerOf(target.kind);
  const label = target.label.replace(/\s+/g, ' ').trim();
  const token = `${trigger}${label}`;
  const text = `${value.text.slice(0, start)}${token} ${value.text.slice(caret)}`;
  const delta = token.length + 1 - (caret - start);
  const shifted = value.tokens.map((t) => (t.start >= caret ? { ...t, start: t.start + delta } : t));
  let created: AskToken;
  switch (target.kind) {
    case 'record':
      created = {
        kind: 'record',
        start,
        length: token.length,
        entityDefinitionId: target.entityDefinitionId,
        entityInstanceId: target.entityInstanceId,
      };
      break;
    case 'object':
      created = { kind: 'object', start, length: token.length, entityDefinitionId: target.entityDefinitionId };
      break;
    case 'member':
      created = { kind: 'member', start, length: token.length, memberId: target.memberId };
      break;
    case 'prompt':
      created = { kind: 'prompt', start, length: token.length, promptId: target.promptId };
      break;
  }
  return {
    value: { text, tokens: [...shifted, created].sort((x, y) => x.start - y.start) },
    caret: start + token.length + 1,
  };
}

/** Inserts a token at the caret without a typed query (the "Insert prompt" button). */
export function insertTokenAtCaret(
  value: ComposerText,
  caret: number,
  target: AskTokenTarget,
): { value: ComposerText; caret: number } {
  const before = value.text.slice(0, caret);
  const needsSpace = before.length > 0 && !/\s$/.test(before);
  const prefix = needsSpace ? ' ' : '';
  const withSpace = prefix ? applyTextEdit(value, `${before}${prefix}${value.text.slice(caret)}`) : value;
  const at = caret + prefix.length;
  return insertToken(withSpace, at, at, target);
}

/** Text split into plain and token segments, for rendering. */
export function segments(value: ComposerText): { text: string; token: AskToken | null }[] {
  const out: { text: string; token: AskToken | null }[] = [];
  let at = 0;
  for (const t of [...value.tokens].sort((x, y) => x.start - y.start)) {
    if (t.start < at) continue;
    if (t.start > at) out.push({ text: value.text.slice(at, t.start), token: null });
    out.push({ text: value.text.slice(t.start, t.start + t.length), token: t });
    at = t.start + t.length;
  }
  if (at < value.text.length) out.push({ text: value.text.slice(at), token: null });
  return out;
}

/** Annotations of the text part (`ai.turns.send`), for the text trimmed of surrounding whitespace. */
export function toSendable(value: ComposerText): { content: string; annotations: AiAnnotation[] } {
  const lead = value.text.length - value.text.trimStart().length;
  const content = value.text.trim();
  const annotations: AiAnnotation[] = [];
  for (const t of value.tokens) {
    const start = t.start - lead;
    if (start < 0 || start + t.length > content.length) continue;
    switch (t.kind) {
      case 'record':
        annotations.push({
          type: 'entity-instance',
          start,
          length: t.length,
          entityDefinitionId: t.entityDefinitionId,
          entityInstanceId: t.entityInstanceId,
        });
        break;
      case 'object':
        annotations.push({
          type: 'entity-definition',
          start,
          length: t.length,
          entityDefinitionId: t.entityDefinitionId,
        });
        break;
      case 'member':
        annotations.push({ type: 'workspace-member', start, length: t.length, memberId: t.memberId });
        break;
      case 'prompt':
        annotations.push({ type: 'prompt', start, length: t.length, promptId: t.promptId });
        break;
    }
  }
  return { content, annotations };
}

/** Annotated text of a stored user turn as composer tokens (rendering a sent message with its chips). */
export function fromAnnotations(content: string, annotations: readonly AiAnnotation[]): ComposerText {
  const tokens: AskToken[] = [];
  for (const a of annotations) {
    switch (a.type) {
      case 'entity-instance':
        tokens.push({
          kind: 'record',
          start: a.start,
          length: a.length,
          entityDefinitionId: a.entityDefinitionId,
          entityInstanceId: a.entityInstanceId,
        });
        break;
      case 'entity-definition':
        tokens.push({ kind: 'object', start: a.start, length: a.length, entityDefinitionId: a.entityDefinitionId });
        break;
      case 'workspace-member':
        tokens.push({ kind: 'member', start: a.start, length: a.length, memberId: a.memberId });
        break;
      case 'prompt':
        tokens.push({ kind: 'prompt', start: a.start, length: a.length, promptId: a.promptId });
        break;
    }
  }
  return { text: content, tokens: tokens.sort((x, y) => x.start - y.start) };
}

/** Case-insensitive match: substring first, then in-order characters ("dbf" finds "Daily brief"). */
export function fuzzyMatch(query: string, title: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const t = title.toLowerCase();
  if (t.includes(q)) return true;
  let at = 0;
  for (const ch of q) {
    at = t.indexOf(ch, at);
    if (at === -1) return false;
    at++;
  }
  return true;
}
