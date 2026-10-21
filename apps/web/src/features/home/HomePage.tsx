// Home (BACKLOG 5.07, 7.04, 10.01): the greeting, the Ask AI block, the Meetings widget, the
// Tasks block (up to 5 tasks assigned to me, ordered today → tomorrow → overdue → later → no date; checkbox, title,
// due label; the row opens the task) and recently updated records. One `home.summary` query feeds it.

import type { HomeSummary } from '@agentic-crm/contracts';
import { Button, IconButton, Skeleton, Tooltip } from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useObjects } from '../../data/objects';
import { firstName } from '../../data/session';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { HomeAsk } from '../ask/HomeAsk';
import { RecordAvatar, recordKind } from '../attributes/ui/primitives';
import { HomeMeetings } from '../meetings';
import { openTask } from '../overlays/store';
import { recordUrl } from '../record/paths';
import { PageHeader } from '../shell/PageHeader';
import * as shell from '../shell/shell.css';
import { useWorkspace } from '../shell/workspaceContext';
import { openCreateTask } from '../tasks';
import { useCalendar } from '../tasks/calendar';
import { setTaskCompleted, type Task } from '../tasks/data';
import { TaskCheckbox } from '../tasks/TaskCheckbox';
import { useHomeSummary } from './data';
import * as s from './home.css';
import { greetingText, homeDueLabel, partOfDayIn } from './model';

export { greetingText as greeting } from './model';

/** Re-evaluates every minute: "Good afternoon" turns into "Good evening" while the page is open. */
function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function HomePage() {
  useDocumentTitle('Home');
  const { me } = useWorkspace();
  const summary = useHomeSummary();
  const { timeZone } = useCalendar();
  const now = useNow();
  const name = summary.data?.greeting.firstName || firstName(me);
  return (
    <>
      <PageHeader crumbs={[{ label: 'Home', icon: 'home' }]} />
      <div className={shell.content}>
        <div className={s.column} data-testid="home">
          <h1 className={s.greeting} data-testid="home-greeting">
            {greetingText(partOfDayIn(now, timeZone), name)}
          </h1>
          <HomeAsk />
          <HomeMeetings />
          <TasksBlock summary={summary.data} isPending={summary.isPending} isError={summary.isError} now={now} />
          <RecentRecords summary={summary.data} />
        </div>
      </div>
    </>
  );
}

// ---- tasks ---------------------------------------------------------------------------------------------------------------

function TasksBlock({
  summary,
  isPending,
  isError,
  now,
}: {
  summary: HomeSummary | undefined;
  isPending: boolean;
  isError: boolean;
  now: number;
}) {
  const { workspace, href } = useWorkspace();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { timeZone } = useCalendar();
  const ws = useMemo(() => ({ id: workspace.id, slug: workspace.slug }), [workspace.id, workspace.slug]);
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const items = summary?.tasks.items ?? [];
  const total = summary?.tasks.total ?? 0;

  const complete = async (task: Task, completed: boolean) => {
    setDone((d) => new Set(completed ? [...d, task.id] : [...d].filter((id) => id !== task.id)));
    const ok = await setTaskCompleted(client, ws, task, completed, workspace.membership.id);
    if (!ok) setDone((d) => new Set([...d].filter((id) => id !== task.id)));
  };

  return (
    <section className={s.block} aria-label="Tasks" data-testid="home-tasks">
      <div className={s.blockHeader}>
        <h2 className={s.blockTitle}>Tasks</h2>
        {summary && <span className={s.blockCount}>{total}</span>}
        <div className={s.blockActions}>
          <button type="button" className={s.viewAll} onClick={() => void navigate({ href: href('tasks') })}>
            View all
          </button>
          {total > 0 && (
            <Tooltip content="New task" shortcut={['t']} placement="bottom">
              <IconButton icon="add" variant="ghost" size={20} aria-label="New task" onPress={() => openCreateTask()} />
            </Tooltip>
          )}
        </div>
      </div>
      {isPending && (
        <div className={s.rows}>
          {[160, 220, 120].map((w) => (
            <div key={w} className={s.skeletonRow}>
              <Skeleton shape="circle" width={16} />
              <Skeleton width={w} height={10} />
            </div>
          ))}
        </div>
      )}
      {isError && <div className={s.errorLine}>Failed to load tasks</div>}
      {summary && items.length === 0 && (
        <div className={s.emptyTasks} data-testid="home-tasks-empty">
          <div className={s.emptyTitle}>Stay on top of work</div>
          <div className={s.emptyBody}>Create tasks for yourself or your team to track next steps</div>
          <Button variant="secondary" size={28} icon="add" onPress={() => openCreateTask()}>
            New task
          </Button>
        </div>
      )}
      {items.length > 0 && (
        <div className={s.rows}>
          {items.map(({ task }) => {
            const label = homeDueLabel(task.deadlineAt, now, timeZone);
            const isDone = done.has(task.id);
            return (
              <div
                key={task.id}
                role="button"
                tabIndex={0}
                className={s.row}
                data-testid="home-task"
                data-done={isDone || undefined}
                onClick={() => openTask(task.id)}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    openTask(task.id);
                  }
                }}
              >
                <TaskCheckbox
                  checked={isDone}
                  label={`Mark "${task.content.text}" as done`}
                  onChange={(next) => void complete(task as Task, next)}
                />
                <span className={s.rowTitle}>{task.content.text}</span>
                {label && (
                  <span className={s.due} data-tone={label.tone} data-testid="home-task-due">
                    {label.text}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---- recent records --------------------------------------------------------------------------------------------------------

function RecentRecords({ summary }: { summary: HomeSummary | undefined }) {
  const { workspace, href } = useWorkspace();
  const navigate = useNavigate();
  const objects = useObjects(workspace).data ?? [];
  const records = summary?.recentRecords ?? [];
  if (records.length === 0) return null;
  return (
    <section className={s.block} aria-label="Recent records" data-testid="home-recent">
      <div className={s.blockHeader}>
        <h2 className={s.blockTitle}>Recent records</h2>
      </div>
      <div className={s.rows}>
        {records.map((record) => {
          const object = objects.find((o) => o.id === record.entityDefinitionId);
          return (
            <button
              key={record.entityInstanceId}
              type="button"
              className={s.row}
              data-testid="home-recent-record"
              onClick={() => object && void navigate({ href: recordUrl(href, object, record.entityInstanceId) })}
            >
              <RecordAvatar kind={recordKind(object)} size={20} />
              <span className={s.rowTitle}>{record.title ?? 'Untitled record'}</span>
              {record.subtitle && <span className={s.rowSecondary}>{record.subtitle}</span>}
              <span className={s.rowSecondary}>{object?.singularNoun}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
