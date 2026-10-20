// What an inbox row says and where it leads (notifications.md §2–4): the eyebrow with the actors, the title from the
// type registry with its `{record}` / `{list}` placeholders filled (bold), a snippet of the subject, fallback copy
// for deleted or unreadable subjects, and the target a click opens. Pure: unit-tested without React.
import { NOTIFICATION_TYPES, type NotificationGroup, type NotificationType } from '@agentic-crm/contracts';
import type { IconName } from '@agentic-crm/ui';

export interface TitlePart {
  text: string;
  strong?: boolean;
}

/** "Grace", "Grace and Alan", "Grace and 3 more" (notifications §3 row). */
export function actorsEyebrow(names: readonly string[], total: number): string {
  const first = names[0] ?? 'Someone';
  if (total <= 1 || names.length <= 1) return total > 1 ? `${first} and ${total - 1} more` : first;
  if (total === 2) return `${first} and ${names[1]}`;
  return `${first} and ${total - 1} more`;
}

/** Payload of the newest entry (workflow notifications carry their subject there; slice 8). */
function payloadOf(group: NotificationGroup): Record<string, unknown> {
  return group.entries[0]?.payload ?? {};
}

function subjectNames(group: NotificationGroup): Record<string, string> {
  const s = group.subject;
  if (group.type === 'workflow-run-failed') {
    const title = payloadOf(group).workflowTitle;
    return { workflow: typeof title === 'string' && title ? title : 'Untitled Workflow' };
  }
  if (!s) return {};
  if (s.kind === 'comment' || s.kind === 'note') return { record: s.record?.title ?? 'a record' };
  if (s.kind === 'list') return { list: s.name ?? 'a list' };
  return {};
}

/** The registry title split into plain and bold parts: "Mentioned you in a comment on **[seed] Acme**". */
export function titleParts(group: NotificationGroup): TitlePart[] {
  const info = NOTIFICATION_TYPES[group.type];
  const names = subjectNames(group);
  const parts: TitlePart[] = [];
  for (const piece of info.title.split(/(\{[a-z]+\})/)) {
    const placeholder = /^\{([a-z]+)\}$/.exec(piece);
    if (placeholder) parts.push({ text: names[placeholder[1] as string] ?? 'a record', strong: true });
    else if (piece) parts.push({ text: piece });
  }
  return parts;
}

const UNAVAILABLE: Record<string, string> = {
  comment: "The comment has been deleted or you don't have access to it anymore.",
  note: "The note has been deleted or you don't have access to it anymore.",
  task: "The task has been deleted or you don't have access to it anymore.",
  list: "The list has been deleted or you don't have access to it anymore.",
};

/** A line under the title: the comment text, the task / note title, or the fallback for an unavailable subject. */
export function snippetOf(group: NotificationGroup): { text: string; muted: boolean } | null {
  const s = group.subject;
  if (group.type === 'workflow-run-failed') {
    const message = payloadOf(group).errorMessage;
    return typeof message === 'string' && message ? { text: message, muted: false } : null;
  }
  if (!s) return null;
  if (s.isUnavailable) return { text: UNAVAILABLE[s.kind] ?? 'This notification can no longer be shown.', muted: true };
  switch (s.kind) {
    case 'comment':
      return s.text ? { text: s.text, muted: false } : null;
    case 'note':
      return s.title ? { text: s.title, muted: false } : null;
    case 'task':
      return s.title
        ? {
            text: s.linkedRecordCount > 0 ? `${s.title} · ${s.linkedRecordCount} linked` : s.title,
            muted: false,
          }
        : null;
    case 'list':
      return null;
  }
}

export type NotificationTarget =
  | { kind: 'comment'; commentId: string }
  | { kind: 'note'; noteId: string }
  | { kind: 'task'; taskId: string }
  | { kind: 'list'; listId: string }
  | { kind: 'workflow-run'; workflowId: string; versionId: string; runId: string }
  | null;

/** What a click opens; null when the subject is gone (the row still marks read). */
export function targetOf(group: NotificationGroup): NotificationTarget {
  if (group.type === 'workflow-run-failed') {
    const p = payloadOf(group);
    const [workflowId, versionId, runId] = [p.workflowId, p.workflowVersionId, p.workflowRunId];
    return typeof workflowId === 'string' && typeof versionId === 'string' && typeof runId === 'string'
      ? { kind: 'workflow-run', workflowId, versionId, runId }
      : null;
  }
  const s = group.subject;
  if (!s || s.isUnavailable) return null;
  switch (s.kind) {
    case 'comment':
      return { kind: 'comment', commentId: s.commentId };
    case 'note':
      return { kind: 'note', noteId: s.noteId };
    case 'task':
      return { kind: 'task', taskId: s.taskId };
    case 'list':
      return { kind: 'list', listId: s.listId };
  }
}

/** The 18 px colour badge on the avatar (notifications §2: event badge per type). */
export function badgeIconOf(type: NotificationType): IconName {
  switch (type) {
    case 'comment-mentioned':
      return 'comment';
    case 'comment-replied':
      return 'reply';
    case 'note-mentioned':
      return 'mention';
    case 'task-assigned':
      return 'tasks';
    case 'list-shared':
      return 'list';
    case 'workflow-run-failed':
      return 'workflows';
    default:
      return 'notifications';
  }
}

/** Compact relative time at the right of a row: "now", "5m", "3h", "2d", then the date. */
export function shortAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (seconds < 45) return 'now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
