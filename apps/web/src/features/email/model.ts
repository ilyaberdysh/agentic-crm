// Email view logic: what a thread row and the email modal show at each
// access level, "via N mailboxes", dates, participants, reply / forward recipients and the sandboxed HTML document of
// a message body. Pure and unit-tested.
import type { EmailAccess, EmailParticipant } from '@agentic-crm/contracts';
import { localDateOf } from '@agentic-crm/contracts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** Wall-clock parts of an instant in a time zone (falls back to UTC for an unknown zone). */
export function wallParts(iso: string | number | Date, timeZone: string): Wall {
  const date = new Date(iso);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    }).formatToParts(date);
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute') };
}

/** "5:07 PM" */
export function formatClock(w: Pick<Wall, 'hour' | 'minute'>): string {
  const h12 = w.hour % 12 === 0 ? 12 : w.hour % 12;
  return `${h12}:${String(w.minute).padStart(2, '0')} ${w.hour < 12 ? 'AM' : 'PM'}`;
}

/** 1 → "1st", 2 → "2nd", 11 → "11th", 23 → "23rd". */
export function ordinalDay(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * The date at the right of a thread row is the time for today ("5:07 PM"), "Yesterday, 5:07 PM", then the day
 * and month within the year ("8 Oct") and with the year for older mail ("10 Jul 2025").
 */
export function formatThreadDate(iso: string, now: Date | number, timeZone: string): string {
  const w = wallParts(iso, timeZone);
  const diff = dayDiff(localDateOf(iso, timeZone), localDateOf(now, timeZone));
  if (diff === 0) return formatClock(w);
  if (diff === 1) return `Yesterday, ${formatClock(w)}`;
  const nowYear = wallParts(now, timeZone).year;
  const base = `${w.day} ${MONTHS[w.month - 1]}`;
  return w.year === nowYear ? base : `${base} ${w.year}`;
}

/** The timestamp of a message in the email modal: "9th Oct 2026 5:07 PM". */
export function formatMessageTimestamp(iso: string, timeZone: string): string {
  const w = wallParts(iso, timeZone);
  return `${ordinalDay(w.day)} ${MONTHS[w.month - 1]} ${w.year} ${formatClock(w)}`;
}

/** Tab counts cap at "99+" (Da). */
export function formatCount(n: number): string {
  return n > 99 ? '99+' : String(n);
}

/** "28 bytes", "1.5 KB", "3 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const units = ['KB', 'MB', 'GB'] as const;
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

// ---- access ----------------------------------------------------------------------------------------------------

export const ACCESS_LEVEL_LABEL: Record<EmailAccess, string> = {
  none: 'No access',
  'metadata-only': 'Metadata only',
  'subject-line': 'Subject line',
  'full-access': 'Full access',
};

/** "Workspace Access" levels, from least to most access. */
export const ACCESS_SELECT_LEVELS = ['none', 'metadata-only', 'subject-line', 'full-access'] as const;
export type AccessSelectLevel = (typeof ACCESS_SELECT_LEVELS)[number];

export interface ThreadDisplay {
  /** The subject, or the "Private subject line" label below subject-line access. */
  subject: string;
  isPrivateSubject: boolean;
  /** Full access only. */
  snippet: string | null;
  /** The viewer cannot read the content (subject-line and below): "No access to this email content". */
  isRestricted: boolean;
}

export const PRIVATE_SUBJECT = 'Private subject line';
export const NO_SUBJECT = '(no subject)';

/** Access → what a row shows: full → everything; subject-line → subject, no snippet; metadata-only → label only. */
export function threadDisplay(thread: {
  access: EmailAccess;
  subject: string | null;
  snippet: string | null;
}): ThreadDisplay {
  const showSubject = thread.access === 'full-access' || thread.access === 'subject-line';
  const subject = showSubject && thread.subject !== null ? thread.subject.trim() || NO_SUBJECT : PRIVATE_SUBJECT;
  return {
    subject,
    isPrivateSubject: !showSubject || thread.subject === null,
    snippet: thread.access === 'full-access' ? thread.snippet?.trim() || null : null,
    isRestricted: thread.access !== 'full-access',
  };
}

// ---- participants ------------------------------------------------------------------------------------------------

/** "via <owner name>" / "via N mailboxes" (the same message synced by several members, F). */
export function viaLabel(mailboxCount: number, ownerNames: readonly string[]): string | null {
  if (mailboxCount > 1) return `via ${mailboxCount} mailboxes`;
  const name = ownerNames[0];
  return name ? `via ${name}` : null;
}

export const participantName = (p: Pick<EmailParticipant, 'name' | 'emailAddress'>): string =>
  p.name?.trim() || p.emailAddress;

/** The sender of a message (role `from`), else the first participant. */
export function senderOf<T extends Pick<EmailParticipant, 'role'>>(participants: readonly T[]): T | null {
  return participants.find((p) => p.role === 'from') ?? participants[0] ?? null;
}

/** Distinct (by address) participants in display order: from, to, cc, bcc; reply-to is not a participant line. */
export function distinctParticipants(participants: readonly EmailParticipant[]): EmailParticipant[] {
  const seen = new Set<string>();
  const out: EmailParticipant[] = [];
  for (const p of participants) {
    if (p.role === 'reply-to') continue;
    const key = p.emailAddress.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** The grey participants line of a row: the first names and "+N" for the rest. */
export function participantsSummary(
  participants: readonly EmailParticipant[],
  max = 3,
): { names: string[]; extra: number } {
  const all = distinctParticipants(participants);
  return { names: all.slice(0, max).map(participantName), extra: Math.max(0, all.length - max) };
}

/** "to Ada Tester, Jane Cooper" — the recipients under a sender's name. */
export function recipientsLabel(participants: readonly EmailParticipant[], viewerMemberId: string | null): string {
  const recipients = distinctParticipants(participants).filter((p) => p.role === 'to' || p.role === 'cc');
  if (recipients.length === 0) {
    const bcc = distinctParticipants(participants).filter((p) => p.role === 'bcc');
    return bcc.length > 0 ? `to ${bcc.map((p) => participantName(p)).join(', ')} (bcc)` : 'to nobody';
  }
  const names = recipients.map((p) => (viewerMemberId && p.memberId === viewerMemberId ? 'me' : participantName(p)));
  const shown = names.slice(0, 3).join(', ');
  return names.length > 3 ? `to ${shown} +${names.length - 3}` : `to ${shown}`;
}

export const ROLE_LABEL: Record<EmailParticipant['role'], string> = {
  from: 'From',
  'reply-to': 'Reply-To',
  to: 'To',
  cc: 'Cc',
  bcc: 'Bcc',
};

// ---- reply, reply all, forward -----------------------------------------------------------------------------------

export type ReplyKind = 'reply' | 'reply-all' | 'forward';

export interface ComposeTarget {
  to: EmailParticipant[];
  cc: EmailParticipant[];
  subject: string;
}

/** "Re: Pilot" / "Fwd: Pilot" (an existing prefix is not stacked). */
export function replySubject(subject: string | null, kind: ReplyKind): string {
  const base = (subject ?? '').trim();
  const prefix = kind === 'forward' ? 'Fwd:' : 'Re:';
  const pattern = kind === 'forward' ? /^(fwd?|fw):\s*/i : /^re:\s*/i;
  return pattern.test(base) ? base.replace(pattern, `${prefix} `) : `${prefix} ${base}`.trim();
}

/** A multi-participant message offers "Reply all": anyone besides the sender and the viewer. */
export function canReplyAll(participants: readonly EmailParticipant[], viewerMemberId: string | null): boolean {
  const others = distinctParticipants(participants).filter(
    (p) => p.role !== 'bcc' && !(viewerMemberId && p.memberId === viewerMemberId),
  );
  return others.length > 1;
}

/**
 * Recipients of a reply: the sender (or reply-to) unless it is the viewer, in which case the original recipients;
 * "Reply all" adds every other to / cc participant; forward starts empty.
 */
export function composeTarget(
  participants: readonly EmailParticipant[],
  subject: string | null,
  kind: ReplyKind,
  viewerMemberId: string | null,
): ComposeTarget {
  const base: ComposeTarget = { to: [], cc: [], subject: replySubject(subject, kind) };
  if (kind === 'forward') return base;
  const isViewer = (p: EmailParticipant) => Boolean(viewerMemberId) && p.memberId === viewerMemberId;
  const from = participants.find((p) => p.role === 'from');
  const replyTo = participants.filter((p) => p.role === 'reply-to');
  const originalTo = participants.filter((p) => p.role === 'to');
  const to: EmailParticipant[] = [];
  if (from && isViewer(from)) to.push(...originalTo);
  else if (replyTo.length > 0) to.push(...replyTo);
  else if (from) to.push(from);
  const cc: EmailParticipant[] = [];
  if (kind === 'reply-all') {
    if (from && !isViewer(from)) to.push(...originalTo.filter((p) => !isViewer(p)));
    cc.push(...participants.filter((p) => p.role === 'cc' && !isViewer(p)));
  }
  const taken = new Set<string>();
  const dedupe = (list: EmailParticipant[]) =>
    list.filter((p) => {
      const key = p.emailAddress.toLowerCase();
      if (taken.has(key)) return false;
      taken.add(key);
      return true;
    });
  return { ...base, to: dedupe(to), cc: dedupe(cc) };
}

// ---- the sandboxed body ------------------------------------------------------------------------------------------

/**
 * The document of a message body (`iframe srcdoc`). The frame is sandboxed without scripts (so the parent can read
 * and measure the document); this adds the second layer: a CSP that blocks everything but inline styles, images and
 * fonts, links opening in a new tab, and neutral base styles on a white page (mail is designed for white).
 */
export function buildEmailSrcdoc(html: string): string {
  const csp = [
    "default-src 'none'",
    'img-src data: https: http: cid:',
    "style-src 'unsafe-inline'",
    'font-src data: https:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<base target="_blank">',
    '<style>',
    'html{color-scheme:light;background:#fff}',
    'body{display:flow-root;margin:0;padding:0 2px;color:#1f2328;background:#fff;font:14px/20px -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;word-wrap:break-word;overflow-wrap:anywhere}',
    'img{max-width:100%;height:auto}',
    'a{color:#2563eb}',
    'blockquote{margin:8px 0;padding-left:12px;border-left:2px solid #d0d7de;color:#57606a}',
    'pre{white-space:pre-wrap}',
    'table{max-width:100%}',
    '</style></head><body>',
    html,
    '</body></html>',
  ].join('');
}

/** Message text without HTML as a document (the fallback when a message has no HTML body). */
export function textToHtml(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<pre style="margin:0;font:inherit;white-space:pre-wrap">${escaped}</pre>`;
}
