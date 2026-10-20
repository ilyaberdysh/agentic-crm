// Small display formatters of the views feature (locale: the user's, X-11).
import type { Actor, WorkspaceMember } from '@agentic-crm/contracts';

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
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

/** "9th Oct 2026 4:43 PM" (view options footer, C1 §3.1). */
export function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const month = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(d);
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
  return `${ordinal(d.getDate())} ${month} ${d.getFullYear()} ${time}`;
}

export function memberName(member: Pick<WorkspaceMember, 'firstName' | 'lastName' | 'emailAddress'>): string {
  const name = `${member.firstName} ${member.lastName}`.trim();
  return name || member.emailAddress;
}

/** Display name of an actor ("Created by …"). */
export function actorName(actor: Actor, members: readonly WorkspaceMember[] | undefined): string {
  if (actor.type === 'workspace-member') {
    const m = members?.find((x) => x.id === actor.id);
    return m ? memberName(m) : 'Workspace member';
  }
  if (actor.type === 'system') return 'System';
  if (actor.type === 'api-token') return 'API';
  if (actor.type === 'workflow') return 'Workflow';
  return actor.type;
}

/** Fuzzy match: every query character appears in order (view search, C1 §3.1). */
export function fuzzyMatch(text: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return false;
}

/** Locale-formatted number for pill values ("50 000" in ru-RU, "50,000" in en-US). */
export function formatNumber(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 20 }).format(value);
}
