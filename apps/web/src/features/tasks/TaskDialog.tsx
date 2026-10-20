// Create / edit task dialogs (E README §2.7, §2.7b, §3.3; evidence E/task-create-dialog.png, task-create-nl-date.png,
// task-edit-dialog.png): top-anchored 808 px frame, no dim. Body: the title with @mentions (a record mention links the
// record) and natural-language dates ("tomorrow at 3pm" sets the deadline; the phrase stays in the title). Footer:
// deadline chip (default Today), "Assigned to You", "Add record" / "n linked records"; Create more · Cancel ESC ·
// Save ⏎ (create) or ⋮ Delete · Cancel · Save (edit, with a completion checkbox before the title).
import type { RecordRefInput } from '@agentic-crm/contracts';
import {
  AlertDialog,
  Button,
  DialogHeader,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  PopoverPanel,
  Spinner,
  Switch,
  toast,
} from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Button as AriaButton, Dialog } from 'react-aria-components';
import { errorEnvelopeOf } from '../../data/trpc';
import { useMembers } from '../attributes/data/queries';
import { MemberPicker, RecordPicker } from '../attributes/editors/pickers';
import { memberName } from '../attributes/format/formatValue';
import { MentionInput } from '../comments/mentions/MentionInput';
import { type MentionText, mentionedRecords } from '../comments/mentions/model';
import { useWorkspaceRef } from '../notes/data';
import { openTask } from '../overlays/store';
import { useWorkspace } from '../shell/workspaceContext';
import { type Calendar, useCalendar } from './calendar';
import { DeadlinePicker } from './DeadlinePicker';
import { createTask, deleteTasks, setTaskCompleted, type Task, updateTask, useTask } from './data';
import { type DraftDeadline, deadlineChipLabel, deadlineInput, draftFromDeadline } from './deadline';
import { parseNaturalDate } from './naturalDate';
import { TaskCheckbox } from './TaskCheckbox';
import * as s from './tasks.css';

const EXAMPLES = [
  'Tweet about @Attio',
  'Send thank you note to @Contact for recent lunch',
  'Follow up with @Company next week',
  'Prepare the quarterly review for @Team',
];

let placeholderTurn = 0;

interface Draft {
  content: MentionText;
  deadline: DraftDeadline | null;
  assignees: string[];
  records: RecordRefInput[];
}

/** Records linked explicitly plus those mentioned in the title. */
function linkedRecords(draft: Draft): RecordRefInput[] {
  const out = [...draft.records];
  for (const r of mentionedRecords(draft.content)) {
    if (!out.some((x) => x.entityInstanceId === r.entityInstanceId)) out.push(r);
  }
  return out;
}

/** Applies a natural-language date phrase typed in the title (once per distinct phrase). */
function useNaturalDeadline(calendar: Calendar) {
  const applied = useRef<string | null>(null);
  return (text: string, draft: Draft): Draft => {
    const parsed = parseNaturalDate(text, {
      today: calendar.today(),
      weekStart: calendar.weekStart,
      numericOrder: calendar.numericOrder,
    });
    const key = parsed
      ? `${parsed.start}:${parsed.end}:${parsed.date}:${parsed.time?.hour}:${parsed.time?.minute}`
      : null;
    if (!parsed || key === applied.current) return draft;
    applied.current = key;
    return { ...draft, deadline: { date: parsed.date, time: parsed.time } };
  };
}

// ---- footer chips --------------------------------------------------------------------------------------------------------

function ChipPopover({
  label,
  icon,
  children,
  testId,
}: {
  label: string;
  icon: Parameters<typeof Icon>[0]['icon'];
  children: (close: () => void) => React.ReactNode;
  testId: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <AriaButton ref={ref} className={s.chip} aria-expanded={open} onPress={() => setOpen(true)} data-testid={testId}>
        <Icon icon={icon} size={16} />
        <span className={s.chipText}>{label}</span>
      </AriaButton>
      {open && (
        <PopoverPanel triggerRef={ref} isOpen onOpenChange={setOpen} placement="bottom start" offset={6} padding={0}>
          <Dialog aria-label={label} style={{ outline: 'none' }}>
            {children(() => setOpen(false))}
          </Dialog>
        </PopoverPanel>
      )}
    </>
  );
}

function assigneeLabel(ids: string[], meId: string, members: ReturnType<typeof useMembers>): string {
  if (ids.length === 0) return 'Assign';
  if (ids.length === 1) {
    if (ids[0] === meId) return 'Assigned to You';
    const m = members.find((x) => x.id === ids[0]);
    return `Assigned to ${m ? memberName(m) || m.emailAddress : '1 user'}`;
  }
  return `${ids.length} assignees`;
}

function DraftChips({ draft, setDraft, calendar }: { draft: Draft; setDraft: (d: Draft) => void; calendar: Calendar }) {
  const { workspace } = useWorkspace();
  const members = useMembers();
  const linked = linkedRecords(draft);
  return (
    <>
      <ChipPopover
        label={deadlineChipLabel(draft.deadline, calendar.today(), calendar.locale)}
        icon="calendar"
        testId="task-deadline-chip"
      >
        {(close) => (
          <DeadlinePicker
            value={draft.deadline}
            calendar={calendar}
            onChange={(deadline) => {
              setDraft({ ...draft, deadline });
              close();
            }}
          />
        )}
      </ChipPopover>
      <ChipPopover
        label={assigneeLabel(draft.assignees, workspace.membership.id, members)}
        icon="mention"
        testId="task-assignee-chip"
      >
        {() => (
          <div style={{ width: 300 }}>
            <MemberPicker
              multiple
              selectedIds={draft.assignees}
              placeholder="Find a user..."
              label="Assignees"
              onSelect={(m, isSelected) =>
                setDraft({
                  ...draft,
                  assignees: isSelected ? draft.assignees.filter((id) => id !== m.id) : [...draft.assignees, m.id],
                })
              }
            />
          </div>
        )}
      </ChipPopover>
      <ChipPopover
        label={linked.length === 0 ? 'Add record' : `${linked.length} linked record${linked.length === 1 ? '' : 's'}`}
        icon="linkRecord"
        testId="task-records-chip"
      >
        {() => (
          <div style={{ width: 320 }}>
            <RecordPicker
              entityDefinitionIds={null}
              multiple
              selected={linked.map((r) => ({
                entityDefinitionId: String(r.entityDefinitionId),
                entityInstanceId: r.entityInstanceId,
              }))}
              placeholder="Search..."
              onSelect={(r, isSelected) =>
                setDraft({
                  ...draft,
                  records: isSelected
                    ? draft.records.filter((x) => x.entityInstanceId !== r.entityInstanceId)
                    : [...draft.records, r],
                  // Unlinking a mentioned record also drops its mention token.
                  content: isSelected
                    ? {
                        ...draft.content,
                        mentions: draft.content.mentions.filter(
                          (m) => !(m.kind === 'record' && m.entityInstanceId === r.entityInstanceId),
                        ),
                      }
                    : draft.content,
                })
              }
            />
          </div>
        )}
      </ChipPopover>
    </>
  );
}

// ---- create --------------------------------------------------------------------------------------------------------------

export interface CreateTaskDefaults {
  records?: RecordRefInput[];
  /** null = no deadline; omitted = today. */
  deadline?: DraftDeadline | null;
  title?: string;
}

type CreateListener = () => void;
let createState: { open: boolean; defaults: CreateTaskDefaults; nonce: number } = {
  open: false,
  defaults: {},
  nonce: 0,
};
const createListeners = new Set<CreateListener>();
function setCreate(next: typeof createState) {
  createState = next;
  for (const l of createListeners) l();
}

/** Opens "Create task" (the `t` shortcut, "+ New task", a record's "Add task"). */
export function openCreateTask(defaults: CreateTaskDefaults = {}): void {
  setCreate({ open: true, defaults, nonce: createState.nonce + 1 });
}

export function closeCreateTask(): void {
  setCreate({ ...createState, open: false });
}

function useCreateState() {
  return useSyncExternalStore(
    (l) => {
      createListeners.add(l);
      return () => createListeners.delete(l);
    },
    () => createState,
    () => createState,
  );
}

/** Mounted once by the overlay host. */
export function CreateTaskHost() {
  const state = useCreateState();
  if (!state.open) return null;
  return <CreateTaskDialog key={state.nonce} defaults={state.defaults} onClose={closeCreateTask} />;
}

function initialDraft(defaults: CreateTaskDefaults, meId: string, today: string): Draft {
  return {
    content: { text: defaults.title ?? '', mentions: [] },
    deadline: defaults.deadline === undefined ? { date: today, time: null } : defaults.deadline,
    assignees: [meId],
    records: defaults.records ?? [],
  };
}

export function CreateTaskDialog({ defaults, onClose }: { defaults: CreateTaskDefaults; onClose: () => void }) {
  const ws = useWorkspaceRef();
  const client = useQueryClient();
  const { workspace } = useWorkspace();
  const calendar = useCalendar();
  const [draft, setDraft] = useState<Draft>(() => initialDraft(defaults, workspace.membership.id, calendar.today()));
  const [createMore, setCreateMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const naturalDeadline = useNaturalDeadline(calendar);
  // A different example each time the dialog opens (E README §2.7 "rotating example placeholder").
  const placeholder = useMemo(() => EXAMPLES[placeholderTurn++ % EXAMPLES.length] as string, []);

  const save = async () => {
    if (saving) return;
    if (!draft.content.text.trim()) {
      toast.error({ title: 'A task needs a title' });
      return;
    }
    setSaving(true);
    try {
      const task = await createTask(client, ws, {
        content: draft.content,
        deadline: deadlineInput(draft.deadline, calendar.timeZone),
        assigneeMemberIds: draft.assignees,
        linkedRecords: linkedRecords(draft),
      });
      toast({ title: 'Task created', action: { label: 'View task', onAction: () => openTask(task.id) } });
      if (createMore) {
        setDraft(initialDraft(defaults, workspace.membership.id, calendar.today()));
        setResetKey((k) => k + 1);
      } else onClose();
    } catch (error) {
      toast.error({ title: 'Failed to create the task', description: errorEnvelopeOf(error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()} size={808} aria-label="Create task" isDismissable>
      <div data-testid="task-dialog" data-mode="create">
        <DialogHeader title="Create task" icon={<Icon icon="tasks" size={16} />} onClose={onClose} />
        <div className={s.dialogBody}>
          <MentionInput
            key={resetKey}
            value={draft.content}
            onChange={(content) => setDraft((d) => naturalDeadline(content.text, { ...d, content }))}
            placeholder={placeholder}
            aria-label="Task title"
            autoFocus
            onSubmit={() => void save()}
            data-testid="task-title-input"
          />
        </div>
        <div className={s.footer}>
          <DraftChips draft={draft} setDraft={setDraft} calendar={calendar} />
          <span className={s.footerSpacer} />
          <Switch isSelected={createMore} onChange={setCreateMore} className={s.createMore}>
            Create more
          </Switch>
          <Button variant="secondary" size={28} shortcut={['esc']} onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size={28} shortcut={['enter']} isPending={saving} onPress={() => void save()}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---- edit ----------------------------------------------------------------------------------------------------------------

export function EditTaskDialog({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const task = useTask(taskId);
  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()} size={808} aria-label="Edit task" isDismissable>
      <div data-testid="task-dialog" data-mode="edit">
        <DialogHeader title="Edit task" icon={<Icon icon="tasks" size={16} />} onClose={onClose} />
        {task.data ? (
          <EditTaskBody key={task.data.id} task={task.data} onClose={onClose} />
        ) : (
          <div className={s.dialogBody} style={{ justifyContent: 'center', minHeight: 48 }}>
            {task.isError ? <span>Task not found</span> : <Spinner size={16} />}
          </div>
        )}
      </div>
    </Modal>
  );
}

function EditTaskBody({ task, onClose }: { task: Task; onClose: () => void }) {
  const ws = useWorkspaceRef();
  const client = useQueryClient();
  const { workspace } = useWorkspace();
  const calendar = useCalendar();
  const [draft, setDraft] = useState<Draft>(() => ({
    content: { text: task.content.text, mentions: task.content.mentions },
    deadline: draftFromDeadline(task.deadlineAt, task.deadlineHasTime, calendar.timeZone),
    assignees: task.assigneeMemberIds,
    records: task.linkedRecords,
  }));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const naturalDeadline = useNaturalDeadline(calendar);

  const save = async () => {
    if (!draft.content.text.trim()) {
      toast.error({ title: 'A task needs a title' });
      return;
    }
    setSaving(true);
    try {
      await updateTask(client, ws, {
        taskId: task.id,
        content: draft.content,
        deadline: deadlineInput(draft.deadline, calendar.timeZone),
        assigneeMemberIds: draft.assignees,
        linkedRecords: linkedRecords(draft),
      });
      onClose();
    } catch (error) {
      toast.error({ title: 'Failed to save the task', description: errorEnvelopeOf(error).message });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await deleteTasks(client, ws, [task.id]);
      toast({ title: 'Task deleted' });
      onClose();
    } catch (error) {
      toast.error({ title: 'Failed to delete the task', description: errorEnvelopeOf(error).message });
    }
  };

  return (
    <>
      <div className={s.dialogBody}>
        <TaskCheckbox
          className={s.dialogCheck}
          checked={task.isCompleted}
          label={task.isCompleted ? 'Mark as not done' : 'Mark as done'}
          onChange={(next) => void setTaskCompleted(client, ws, task, next, workspace.membership.id)}
        />
        <MentionInput
          value={draft.content}
          onChange={(content) => setDraft((d) => naturalDeadline(content.text, { ...d, content }))}
          aria-label="Task title"
          autoFocus
          onSubmit={() => void save()}
          data-testid="task-title-input"
        />
      </div>
      <div className={s.footer}>
        <DraftChips draft={draft} setDraft={setDraft} calendar={calendar} />
        <span className={s.footerSpacer} />
        <MenuTrigger>
          <IconButton icon="moreVertical" aria-label="Task options" variant="secondary" size={28} />
          <Menu aria-label="Task options" placement="bottom end" width={180} onAction={() => setConfirmDelete(true)}>
            <MenuItem id="delete" icon="delete" variant="danger">
              Delete
            </MenuItem>
          </Menu>
        </MenuTrigger>
        <Button variant="secondary" size={28} shortcut={['esc']} onPress={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size={28} shortcut={['enter']} isPending={saving} onPress={() => void save()}>
          Save
        </Button>
      </div>
      <AlertDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete task"
        description="Are you sure you want to delete this task?"
        confirmLabel="Delete"
        onConfirm={() => void remove()}
      />
    </>
  );
}
