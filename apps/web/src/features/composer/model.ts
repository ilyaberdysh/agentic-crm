// Pure logic of the composer: what makes a draft empty, signature blocks in the body, recipient
// parsing and the copy of the mass-send and review states. No React, no network.
import type { Block } from '@agentic-crm/editor';
import { isEmptyBlocks, textBlock } from '@agentic-crm/editor';

// ---- body and signature -----------------------------------------------------------------------------------------

/** The signature's blocks as the body ends with them (compared by type, indent and text), else -1. */
export function signatureStart(body: readonly Block[], signature: readonly Block[]): number {
  if (signature.length === 0 || body.length < signature.length) return -1;
  const start = body.length - signature.length;
  const same = signature.every((s, i) => {
    const b = body[start + i];
    return b !== undefined && b.type === s.type && b.indent === s.indent && b.text === s.text;
  });
  return same ? start : -1;
}

/** The body without a trailing signature (and the blank paragraph that separates them). */
export function stripSignature(body: readonly Block[], signature: readonly Block[]): Block[] {
  const start = signatureStart(body, signature);
  if (start < 0) return [...body];
  let end = start;
  while (end > 0 && isEmptyBlocks([body[end - 1] as Block]) && body[end - 1]?.type !== 'image-embed') end--;
  return body.slice(0, Math.max(end, 0));
}

/** The body with `signature` as its tail (a replaced previous one is removed first); null = no signature. */
export function withSignature(
  body: readonly Block[],
  previous: readonly Block[] | null,
  signature: readonly Block[] | null,
): Block[] {
  const base = previous ? stripSignature(body, previous) : [...body];
  if (!signature || signature.length === 0) return base.length > 0 ? base : [textBlock('unstyled', '')];
  // A blank paragraph separates the message from the signature; an empty body keeps one for the caret.
  return [...(base.length > 0 ? base : [textBlock('unstyled', '')]), textBlock('unstyled', ''), ...signature];
}

export interface DraftLike {
  subject: { text: string };
  body: readonly Block[];
  to: readonly unknown[];
  cc: readonly unknown[];
  bcc: readonly unknown[];
  attachments: readonly unknown[];
}

/** A draft with nothing in it: closing it deletes it (F composer). The signature does not count. */
export function isDraftEmpty(draft: DraftLike, signature: readonly Block[] | null = null): boolean {
  const body = signature ? stripSignature(draft.body, signature) : draft.body;
  return (
    draft.subject.text.trim() === '' &&
    isEmptyBlocks(body) &&
    draft.to.length === 0 &&
    draft.cc.length === 0 &&
    draft.bcc.length === 0 &&
    draft.attachments.length === 0
  );
}

// ---- previews ---------------------------------------------------------------------------------------------------

interface VariableLike {
  start: number;
  field?: string | null;
  label?: string;
  path: readonly { attributeDefinitionId: string }[];
}

/** `{{first_name}}`-style token of a variable (Drafts list and template cards, F composer). */
export function variableToken(v: VariableLike): string {
  const raw = v.field ?? v.label?.split('›').at(-1) ?? v.path.at(-1)?.attributeDefinitionId ?? '';
  return raw
    .trim()
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

/** Subject text with each variable placeholder shown as its `{{token}}` ("[seed] Test subject for {{first_name}}"). */
export function previewSubject(text: string, variables: readonly VariableLike[] | undefined): string {
  const byStart = new Map((variables ?? []).map((v) => [v.start, v]));
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const v = byStart.get(i);
    out += v && text[i] === '_' ? `{{${variableToken(v)}}}` : text[i];
  }
  return out;
}

// ---- recipients ---------------------------------------------------------------------------------------------------

export interface RecipientLike {
  emailAddress: string;
  name?: string | null;
  record?: { entityDefinitionId: string; entityInstanceId: string } | null;
}

const ADDRESS = /^[^\s@,;<>()[\]"']+@[^\s@,;<>()[\]"']+\.[^\s@,;<>()[\]"']+$/;

export function looksLikeEmail(value: string): boolean {
  return ADDRESS.test(value.trim());
}

/** Text typed or pasted into a recipient field → addresses (comma, semicolon, whitespace or `Name <a@b.c>`). */
export function parseAddresses(text: string): { valid: RecipientLike[]; invalid: string[] } {
  const valid: RecipientLike[] = [];
  const invalid: string[] = [];
  const named = [...text.matchAll(/([^,;<>\n]*?)\s*<([^<>\s]+)>/g)];
  let rest = text;
  for (const m of named) {
    rest = rest.replace(m[0], ' ');
    const address = (m[2] ?? '').trim();
    const name = (m[1] ?? '').trim().replace(/^["']|["']$/g, '');
    if (looksLikeEmail(address)) valid.push({ emailAddress: address.toLowerCase(), name: name || null });
    else invalid.push(address);
  }
  for (const token of rest.split(/[\s,;]+/).filter(Boolean)) {
    if (looksLikeEmail(token)) valid.push({ emailAddress: token.toLowerCase(), name: null });
    else invalid.push(token);
  }
  return { valid, invalid };
}

/** Adds `incoming` to `list` without duplicates (by address). */
export function addRecipients<T extends RecipientLike>(list: readonly T[], incoming: readonly T[]): T[] {
  const seen = new Set(list.map((r) => r.emailAddress.toLowerCase()));
  const out = [...list];
  for (const r of incoming) {
    const key = r.emailAddress.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export const recipientLabel = (r: Pick<RecipientLike, 'emailAddress' | 'name'>): string => r.name || r.emailAddress;

// ---- copy -------------------------------------------------------------------------------------------------------

/** "Sending email to 1 recipient" / "Sending individual emails to N recipients" (mass mode To row). */
export function massSendLabel(n: number): string {
  return n === 1 ? 'Sending email to 1 recipient' : `Sending individual emails to ${n} recipients`;
}

/** Primary button of the composer: Send email, or Review when variables or mass sending need the review step. */
export function primaryLabel(options: { hasVariables: boolean; isMassSend: boolean; recipients: number }): string {
  if (options.isMassSend)
    return options.recipients === 1 ? 'Review Email (1)' : `Review Emails (${options.recipients})`;
  return options.hasVariables ? 'Review' : 'Send email';
}

/** Review step button: mass sends always count their emails ("Send emails (2)"), a single email is "Send email". */
export const sendEmailsLabel = (n: number, isMassSend = false): string =>
  !isMassSend && n === 1 ? 'Send email' : `Send emails (${n})`;

/** Server issue codes of `email.drafts.review` → what the composer tells the member. */
export function issueText(issue: string): string {
  switch (issue) {
    case 'no-recipients':
      return 'Add at least one recipient';
    case 'no-sender':
      return 'Connect an email account to send from';
    case 'sender-disconnected':
      return 'The sending account is disconnected. Reconnect it in settings.';
    case 'variables-need-mass-send':
      return 'To send emails with variables to several recipients, use mass sending';
    case 'too-many-recipients':
      return 'Please add a maximum of 50 recipients';
    case 'pending-attachments':
      return 'You have pending attachments.';
    case 'no-content':
      return 'This email has no subject and no content';
    case 'unresolved-variables':
      return 'Some variables have no value for a recipient and no fallback';
    default:
      return issue;
  }
}

/** Mass sending needs the recipients capped (documented 50 outside the free plan). */
export const MASS_SEND_MAX = 50;

/** "9th Oct 2026" style day label is not needed here; the Drafts tab shows relative days (see pages). */

/** Upload tile of an attachment card: the extension in capitals, at most four characters ("TXT"). */
export function fileTypeTile(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1) : '';
  return (ext || 'FILE').slice(0, 4).toUpperCase();
}
