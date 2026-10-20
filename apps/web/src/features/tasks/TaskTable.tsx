// Task table (E README §2.6; evidence E/tasks-page.png): 32 px header (Task · Due date · Record · Assigned to), 32 px
// group rows with counts, 52 px rows — round checkbox, title, due label (red overdue / orange soon / grey later),
// first linked record, assignee chips, hover ⋮ (Select · Delete task). Completed rows fade to 50 %. ⌘-click toggles a
// row into the selection, ⇧-click selects a range; a plain click opens the edit dialog.
import { AlertDialog, Avatar, Icon, IconButton, Menu, MenuItem, MenuTrigger, toast } from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { errorEnvelopeOf } from '../../data/trpc';
import { useMembers } from '../attributes/data/queries';
import { memberName } from '../attributes/format/formatValue';
import { RecordChip } from '../attributes/ui/primitives';
import { useWorkspaceRef } from '../notes/data';
import { count as countStyle } from '../notes/notesPage.css';
import { openTask } from '../overlays/store';
import { useWorkspace } from '../shell/workspaceContext';
import { useCalendar } from './calendar';
import { deleteTasks, setTaskCompleted, type Task } from './data';
import { dueLabel } from './deadline';
import { TaskCheckbox } from './TaskCheckbox';
import * as s from './tasks.css';

export interface TaskGroupView {
  key: string;
  label: ReactNode;
  tasks: Task[];
}

export interface TaskSelection {
  selected: Set<string>;
  toggle: (taskId: string) => void;
  range: (taskId: string) => void;
}

export function TaskTableHead({ compact = false }: { compact?: boolean }) {
  const cell = (icon: Parameters<typeof Icon>[0]['icon'] | null, label: string) => (
    <span className={s.headCell} role="columnheader">
      {icon && <Icon icon={icon} size={14} />}
      {label}
    </span>
  );
  return (
    <div className={`${s.columns} ${compact ? s.columnsCompact : ''} ${s.head}`} role="row">
      {cell(null, 'Task')}
      {cell('calendar', 'Due date')}
      {cell('record', 'Record')}
      {cell('mention', 'Assigned to')}
    </div>
  );
}

function AssigneeChip({ memberId }: { memberId: string }) {
  const members = useMembers();
  const member = members.find((m) => m.id === memberId);
  const name = member ? memberName(member) || member.emailAddress : 'Unknown member';
  return (
    <span className={s.assignee}>
      <Avatar name={name} seed={memberId} size={16} kind="member" />
      <span className={s.assigneeName}>{name}</span>
    </span>
  );
}

function TaskRow({
  task,
  selection,
  compact,
  onSelectMode,
}: {
  task: Task;
  selection?: TaskSelection;
  compact?: boolean;
  onSelectMode?: (taskId: string) => void;
}) {
  const ws = useWorkspaceRef();
  const client = useQueryClient();
  const { workspace } = useWorkspace();
  const calendar = useCalendar();
  const [confirm, setConfirm] = useState(false);
  const due = dueLabel(task.deadlineAt, Date.now(), calendar.timeZone, calendar.locale);
  const record = task.linkedRecords[0];
  const isSelected = selection?.selected.has(task.id) ?? false;
  const fade = task.isCompleted ? s.fade : '';
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div
      role="row"
      tabIndex={0}
      aria-selected={isSelected}
      className={`${s.columns} ${compact ? s.columnsCompact : ''} ${s.row}`}
      data-selected={isSelected || undefined}
      data-completed={task.isCompleted || undefined}
      data-testid="task-row"
      data-task-id={task.id}
      onClick={(e) => {
        if (selection && (e.metaKey || e.ctrlKey)) selection.toggle(task.id);
        else if (selection && e.shiftKey) selection.range(task.id);
        else if (selection && selection.selected.size > 0) selection.toggle(task.id);
        else openTask(task.id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) openTask(task.id);
      }}
    >
      <span className={s.cell} role="cell">
        <TaskCheckbox
          checked={task.isCompleted}
          label={task.isCompleted ? 'Mark as not done' : 'Mark as done'}
          onChange={(next) => void setTaskCompleted(client, ws, task, next, workspace.membership.id)}
        />
        <span className={`${s.title} ${fade}`}>{task.content.text}</span>
      </span>
      <span className={`${s.cell} ${fade}`} role="cell">
        {due && (
          <span className={s.due[due.tone]} title={task.deadlineAt ?? undefined}>
            {due.text}
          </span>
        )}
      </span>
      <span className={`${s.cell} ${fade}`} role="cell" onClick={stop} onKeyDown={stop}>
        {record && (
          <RecordChip entityDefinitionId={record.entityDefinitionId} entityInstanceId={record.entityInstanceId} />
        )}
      </span>
      <span className={`${s.cell} ${fade}`} role="cell">
        {task.assigneeMemberIds.slice(0, 2).map((id) => (
          <AssigneeChip key={id} memberId={id} />
        ))}
        {task.assigneeMemberIds.length > 2 && <span>+{task.assigneeMemberIds.length - 2}</span>}
      </span>
      <span className={s.rowMenu} onClick={stop} onKeyDown={stop}>
        <MenuTrigger>
          <IconButton icon="moreVertical" aria-label="Task options" size={20} />
          <Menu
            aria-label="Task options"
            placement="bottom end"
            width={180}
            onAction={(key) => {
              if (key === 'select') onSelectMode?.(task.id);
              if (key === 'delete') setConfirm(true);
            }}
          >
            {onSelectMode ? (
              <MenuItem id="select" icon="checkCircle">
                Select
              </MenuItem>
            ) : null}
            <MenuItem id="delete" icon="delete" variant="danger">
              Delete task
            </MenuItem>
          </Menu>
        </MenuTrigger>
      </span>
      <AlertDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title="Delete task"
        description="Are you sure you want to delete this task?"
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await deleteTasks(client, ws, [task.id]);
            toast({ title: 'Task deleted' });
          } catch (error) {
            toast.error({ title: 'Failed to delete the task', description: errorEnvelopeOf(error).message });
          }
        }}
      />
    </div>
  );
}

export function TaskTable({
  groups,
  selection,
  showHead = true,
  compact = false,
  onSelectMode,
}: {
  groups: TaskGroupView[];
  selection?: TaskSelection;
  showHead?: boolean;
  compact?: boolean;
  onSelectMode?: (taskId: string) => void;
}) {
  return (
    <div className={s.table} role="table" aria-label="Tasks" data-testid="task-table">
      {showHead && <TaskTableHead compact={compact} />}
      {groups.map((g) => (
        <div key={g.key} role="rowgroup" data-testid="task-group" data-group={g.key}>
          <div className={s.groupRow}>
            {g.label}
            <span className={countStyle}>{g.tasks.length}</span>
          </div>
          {g.tasks.map((t) => (
            <TaskRow key={t.id} task={t} selection={selection} compact={compact} onSelectMode={onSelectMode} />
          ))}
        </div>
      ))}
    </div>
  );
}
