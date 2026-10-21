// Overview tab (BACKLOG 3.03): Highlights, the Activity card (3 newest events, people before
// automations, "View all" → Activity), then Emails / Notes / Tasks sections in the order of their tabs, each with a
// count, "View all" and "+". Notes show up to 3 rows (title + preview + time), Tasks up to 3 open tasks (checkbox,
// title, assignee, due chip); completing a task here is optimistic.
import { Avatar, Icon, IconButton, Skeleton, toast } from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, errorEnvelopeOf, inWorkspace } from '../../../data/trpc';
import { formatRelativeTime } from '../../attributes/format/formatValue';
import { useWorkspace } from '../../shell/workspaceContext';
import { ActorAvatar, capitalize, EventSentence, TaskAssignees } from '../activity/events';
import { previewEvents } from '../activity/model';
import {
  openNote,
  openTask,
  openWindow,
  threadDisplay,
  useComposeEmail,
  useNewNote,
  useNewTask,
  useRecordThreadPreview,
} from '../adapters';
import { useRecordPage } from '../context';
import {
  recordKeys,
  type TaskRow,
  usePastTimeline,
  useRecordNotes,
  useRecordOpenTasks,
  useRelatedCounts,
} from '../data';
import { Highlights } from './Highlights';
import * as s from './overview.css';
import { SummaryCard } from './SummaryCard';

export function OverviewTab() {
  const { layout } = useRecordPage();
  // An Emails tab without sources (count "-") has no Overview section.
  const sections = layout.tabs.filter(
    (t) => (t.kind === 'emails' && t.children.length > 0) || t.kind === 'notes' || t.kind === 'tasks',
  );
  return (
    <div className={s.overview} data-testid="overview-tab">
      <Highlights widgets={layout.widgets} />
      {layout.tabs.some((t) => t.kind === 'activity') && <ActivityPreview />}
      {sections.map((t) =>
        t.kind === 'emails' ? (
          <EmailsSection key={t.element.elementId} slug={t.slug} />
        ) : t.kind === 'notes' ? (
          <NotesSection key={t.element.elementId} slug={t.slug} />
        ) : (
          <TasksSection key={t.element.elementId} slug={t.slug} />
        ),
      )}
      <SummaryCard />
    </div>
  );
}

function SectionHeader({
  title,
  count,
  onViewAll,
  onAdd,
  addLabel,
}: {
  title: string;
  count?: number;
  onViewAll?: () => void;
  onAdd?: () => void;
  addLabel?: string;
}) {
  return (
    <div className={s.sectionHeader}>
      <h3 className={s.sectionTitle}>
        {title}
        {count !== undefined && <span className={s.count}>{count}</span>}
      </h3>
      <span className={s.sectionActions}>
        {onViewAll && (
          <button type="button" className={s.viewAll} onClick={onViewAll}>
            View all
          </button>
        )}
        {onAdd && <IconButton icon="add" variant="ghost" size={20} aria-label={addLabel ?? 'Add'} onPress={onAdd} />}
      </span>
    </div>
  );
}

export function ActivityPreview() {
  const { recordRef, object, attributes, layout, goToTab } = useRecordPage();
  const past = usePastTimeline(recordRef, { disableGrouping: true, limit: 25 });
  const events = useMemo(() => previewEvents(past.data?.pages[0]?.events ?? [], 3), [past.data]);
  const activityTab = layout.tabs.find((t) => t.kind === 'activity');
  return (
    <section className={s.section} aria-label="Activity" data-testid="overview-activity">
      <SectionHeader title="Activity" onViewAll={activityTab ? () => goToTab(activityTab.slug) : undefined} />
      <div className={s.rows}>
        {past.isPending
          ? [0, 1, 2].map((i) => (
              <div key={i} className={s.skeletonRow}>
                <Skeleton shape="circle" width={16} height={16} />
                <Skeleton width={220} height={12} />
              </div>
            ))
          : events.length === 0 && <div className={s.row}>No activity yet</div>}
        {events.map((event) => (
          <div key={event.id} className={s.row} data-testid="overview-event">
            <ActorAvatar actor={event.actor} />
            <span className={s.rowSentence}>
              <EventSentence event={event} ctx={{ object, attributes }} />
            </span>
            <span className={s.rowTime} title={new Date(event.occurredAt).toLocaleString()}>
              {formatRelativeTime(event.occurredAt)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function EmailsSection({ slug }: { slug: string }) {
  const { recordRef, goToTab } = useRecordPage();
  const threads = useRecordThreadPreview(recordRef, 3);
  const compose = useComposeEmail();
  const total = threads.data?.total ?? 0;
  const list = threads.data?.threads ?? [];
  return (
    <section className={s.section} aria-label="Emails" data-testid="overview-emails">
      <SectionHeader
        title="Emails"
        count={total}
        onViewAll={total > 0 ? () => goToTab(slug) : undefined}
        addLabel="Compose email"
        onAdd={compose}
      />
      {list.length > 0 && (
        <div className={s.rows}>
          {list.slice(0, 3).map((t) => {
            const display = threadDisplay(t);
            const sender = t.participants.find((p) => p.role === 'from') ?? t.participants[0];
            const senderName = sender ? sender.name?.trim() || sender.emailAddress : '?';
            return (
              <div
                key={t.threadId}
                className={s.row}
                data-interactive=""
                data-testid="overview-email"
                data-thread-id={t.threadId}
                onClick={() => openWindow('email', t.displayMessageId, {})}
              >
                <Avatar
                  name={senderName}
                  kind={sender?.memberId ? 'member' : 'person'}
                  size={16}
                  seed={sender?.emailAddress}
                />
                <span className={s.rowSentence}>
                  <span
                    className={s.rowTitle}
                    style={display.isPrivateSubject ? { fontWeight: 400, fontStyle: 'italic' } : undefined}
                  >
                    {display.subject}
                  </span>
                  <span className={s.rowPreview}>
                    {display.isRestricted ? 'No access to this email content' : (display.snippet ?? '')}
                  </span>
                </span>
                <span className={s.rowTime}>{formatRelativeTime(t.lastMessageAt)}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function NotesSection({ slug }: { slug: string }) {
  const { recordRef, goToTab } = useRecordPage();
  const counts = useRelatedCounts(recordRef);
  const notes = useRecordNotes(recordRef, 3);
  const newNote = useNewNote();
  const count = counts.data?.notes ?? notes.data?.total ?? 0;
  const list = notes.data?.notes ?? [];
  return (
    <section className={s.section} aria-label="Notes" data-testid="overview-notes">
      <SectionHeader
        title="Notes"
        count={count}
        onViewAll={count > 0 ? () => goToTab(slug) : undefined}
        addLabel="New note"
        onAdd={() => newNote(recordRef)}
      />
      {list.length > 0 && (
        <div className={s.rows}>
          {list.slice(0, 3).map((n) => (
            <div
              key={n.id}
              className={s.row}
              data-interactive=""
              data-testid="overview-note"
              onClick={() => openNote(n.id)}
            >
              <ActorAvatar actor={n.createdBy} />
              <span className={s.rowSentence}>
                <span className={s.rowTitle}>{n.title || 'Untitled note'}</span>
                <span className={s.rowPreview}>{firstLine(n.content?.plaintext)}</span>
              </span>
              <span className={s.rowTime}>{formatRelativeTime(n.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function firstLine(text: string | null | undefined): string {
  return text?.trim().split('\n').find(Boolean) ?? '';
}

export function TasksSection({ slug }: { slug: string }) {
  const { recordRef, goToTab } = useRecordPage();
  const tasks = useRecordOpenTasks(recordRef);
  const newTask = useNewTask();
  const list = tasks.data?.tasks ?? [];
  const count = tasks.data?.total ?? 0;
  return (
    <section className={s.section} aria-label="Tasks" data-testid="overview-tasks">
      <SectionHeader
        title="Tasks"
        count={count}
        onViewAll={count > 0 ? () => goToTab(slug) : undefined}
        addLabel="New task"
        onAdd={() => newTask(recordRef)}
      />
      {list.length > 0 && (
        <div className={s.rows}>
          {list.slice(0, Math.min(count, 3)).map((t) => (
            <TaskLine key={t.id} task={t} />
          ))}
        </div>
      )}
    </section>
  );
}

function TaskLine({ task }: { task: TaskRow }) {
  const { workspace } = useWorkspace();
  const { recordRef } = useRecordPage();
  const client = useQueryClient();
  const key = [...recordKeys.tasks(workspace.id, recordRef.entityDefinitionId, recordRef.entityInstanceId), 'open'];
  const overdue = task.deadlineAt ? Date.parse(task.deadlineAt) < Date.now() : false;
  const complete = async () => {
    // Optimistic: the row goes at once and comes back on error.
    const prev = client.getQueryData<{ tasks: TaskRow[]; total: number }>(key);
    if (prev) client.setQueryData(key, { tasks: prev.tasks.filter((t) => t.id !== task.id), total: prev.total - 1 });
    try {
      await api.tasks.setCompleted.mutate({ taskId: task.id, completed: true }, inWorkspace(workspace));
    } catch (error) {
      if (prev) client.setQueryData(key, prev);
      toast.error({ title: 'Failed to complete task', description: errorEnvelopeOf(error).message });
    }
  };
  return (
    <div className={s.row} data-testid="overview-task">
      <button
        type="button"
        className={s.taskCheck}
        aria-label={`Complete task ${task.content.text}`}
        onClick={() => void complete()}
      />
      <span className={s.rowSentence} onClick={() => openTask(task.id)} style={{ cursor: 'pointer' }}>
        <span className={s.rowTitle} style={{ fontWeight: 400 }}>
          {task.content.text}
        </span>
      </span>
      <span className={s.rowMeta}>
        <TaskAssignees memberIds={task.assigneeMemberIds} />
        {task.deadlineAt && (
          <span className={s.due} data-overdue={overdue || undefined}>
            <Icon icon="attrTimestamp" size={12} />
            {capitalize(formatRelativeTime(task.deadlineAt))}
          </span>
        )}
      </span>
    </div>
  );
}
