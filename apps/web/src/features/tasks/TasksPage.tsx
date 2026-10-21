// Tasks page `/$ws/tasks`:
// "Sorted by Due date" (Due date · Assignee · Creation date; ascending / descending) | Filter chips (Assignee ▸,
// Record is / is not, Created by ▸) … View settings (Group by Due date · Assignee · Creation date · Created by; Show
// completed tasks) · "+ New task". Due-date groups are computed in the viewer's zone and week start with overdue
// tasks inside "Today". Bulk: ⋮ › Select or ⌘-click, ⇧-click ranges, ⌘A all; the floating toolbar deletes or
// completes the selection.
import type { ListTasksInput, RecordRefInput, TaskGroupBy } from '@agentic-crm/contracts';
import {
  AlertDialog,
  Avatar,
  Button,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
  PopoverPanel,
  Submenu,
  Switch,
  toast,
} from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button as AriaButton, Dialog } from 'react-aria-components';
import { errorEnvelopeOf } from '../../data/trpc';
import { isTypingTarget } from '../../lib/shortcuts';
import { usePersistentState } from '../../lib/storage';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { AskButton } from '../ask/AskButton';
import { useMembers, useRecordTitle } from '../attributes/data/queries';
import { MemberPicker, RecordPicker } from '../attributes/editors/pickers';
import { memberName } from '../attributes/format/formatValue';
import { useWorkspaceRef } from '../notes/data';
import { CREATED_BUCKET_LABEL } from '../notes/format';
import { IndexState } from '../notes/indexParts';
import * as notesStyles from '../notes/notesPage.css';
import { HelpButton, PageHeader } from '../shell/PageHeader';
import { useCalendar } from './calendar';
import {
  bulkSetCompleted,
  DEADLINE_GROUP_LABEL,
  deadlineGroups,
  deleteTasks,
  type Task,
  type TaskList,
  useTaskList,
} from './data';
import { openCreateTask } from './TaskDialog';
import { type TaskGroupView, type TaskSelection, TaskTable } from './TaskTable';
import * as s from './tasks.css';

type SortField = 'deadline' | 'assignee' | 'created-at';
type IsOrNot = 'is' | 'is-not';

interface Filters {
  assignee?: { operator: IsOrNot; memberIds: string[] };
  record?: { operator: IsOrNot; records: RecordRefInput[] };
  createdBy?: string[];
}

const SORT_LABEL: Record<SortField, string> = {
  deadline: 'Due date',
  assignee: 'Assignee',
  'created-at': 'Creation date',
};
const GROUP_LABEL: Record<Exclude<TaskGroupBy, 'none'>, string> = {
  deadline: 'Due date',
  assignee: 'Assignee',
  'created-at': 'Creation date',
  'created-by': 'Created by',
};

function MemberGroupLabel({ memberId, fallback }: { memberId: string | null; fallback: string }) {
  const members = useMembers();
  const m = memberId ? members.find((x) => x.id === memberId) : undefined;
  if (!m) return <>{fallback}</>;
  const name = memberName(m) || m.emailAddress;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Avatar name={name} seed={m.id} size={16} kind="member" />
      {name}
    </span>
  );
}

/** Display groups of a list for the chosen grouping. */
export function viewGroups(list: TaskList | undefined, groupBy: TaskGroupBy): TaskGroupView[] {
  if (!list) return [];
  if (groupBy === 'deadline') {
    return deadlineGroups(list).map((g) => ({ key: g.key, label: DEADLINE_GROUP_LABEL[g.key], tasks: g.tasks }));
  }
  return list.groups.map((g) => ({
    key: g.key,
    label:
      groupBy === 'created-at' ? (
        (CREATED_BUCKET_LABEL[g.key as keyof typeof CREATED_BUCKET_LABEL] ?? g.key)
      ) : groupBy === 'none' ? (
        'All tasks'
      ) : (
        <MemberGroupLabel memberId={g.memberId} fallback={groupBy === 'assignee' ? 'No assignee' : 'Unknown'} />
      ),
    tasks: g.tasks,
  }));
}

function useSelection(
  order: string[],
): TaskSelection & { clear: () => void; selectAll: () => void; add: (id: string) => void } {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  return {
    selected,
    toggle: (id) => {
      anchor.current = id;
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    range: (id) => {
      const from = anchor.current ? order.indexOf(anchor.current) : -1;
      const to = order.indexOf(id);
      if (from < 0 || to < 0) {
        anchor.current = id;
        setSelected((prev) => new Set(prev).add(id));
        return;
      }
      const [a, b] = from < to ? [from, to] : [to, from];
      setSelected((prev) => new Set([...prev, ...order.slice(a, b + 1)]));
    },
    add: (id) => {
      anchor.current = id;
      setSelected((prev) => new Set(prev).add(id));
    },
    clear: () => setSelected(new Set()),
    selectAll: () => setSelected(new Set(order)),
  };
}

// ---- filter chips ------------------------------------------------------------------------------------------------------

function RecordFilterValue({ record }: { record: RecordRefInput }) {
  const { title } = useRecordTitle(String(record.entityDefinitionId), record.entityInstanceId);
  return <>{title || 'Record'}</>;
}

function MemberNames({ ids }: { ids: string[] }) {
  const members = useMembers();
  const names = ids.map((id) => {
    const m = members.find((x) => x.id === id);
    return m ? memberName(m) || m.emailAddress : 'Unknown';
  });
  return <>{names.length > 2 ? `${names.length} members` : names.join(', ')}</>;
}

function FilterChip({
  field,
  operator,
  value,
  onOperator,
  onRemove,
}: {
  field: string;
  operator?: IsOrNot;
  value: React.ReactNode;
  onOperator?: (op: IsOrNot) => void;
  onRemove: () => void;
}) {
  return (
    <div className={s.filterChip} data-testid="task-filter-chip">
      <span className={s.filterSegment}>{field}</span>
      {operator && onOperator ? (
        <MenuTrigger>
          <AriaButton className={`${s.filterSegment} ${s.filterMuted}`}>
            {operator === 'is' ? 'is' : 'is not'}
          </AriaButton>
          <Menu aria-label="Condition" width={140} onAction={(k) => onOperator(k as IsOrNot)}>
            <MenuItem id="is">is</MenuItem>
            <MenuItem id="is-not">is not</MenuItem>
          </Menu>
        </MenuTrigger>
      ) : (
        <span className={`${s.filterSegment} ${s.filterMuted}`}>is</span>
      )}
      <span className={s.filterSegment}>{value}</span>
      <AriaButton className={s.filterSegment} aria-label={`Remove ${field} filter`} onPress={onRemove}>
        <Icon icon="close" size={14} />
      </AriaButton>
    </div>
  );
}

type FilterPicker = { kind: 'assignee' | 'created-by' } | { kind: 'record'; operator: IsOrNot } | null;

function FilterControls({ filters, setFilters }: { filters: Filters; setFilters: (f: Filters) => void }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [picker, setPicker] = useState<FilterPicker>(null);
  const hasAny = Boolean(filters.assignee || filters.record || filters.createdBy);
  return (
    <>
      {filters.assignee && (
        <FilterChip
          field="Assignee"
          operator={filters.assignee.operator}
          value={<MemberNames ids={filters.assignee.memberIds} />}
          onOperator={(operator) =>
            setFilters({
              ...filters,
              assignee: { ...(filters.assignee as NonNullable<Filters['assignee']>), operator },
            })
          }
          onRemove={() => setFilters({ ...filters, assignee: undefined })}
        />
      )}
      {filters.record && (
        <FilterChip
          field="Record"
          operator={filters.record.operator}
          value={filters.record.records[0] ? <RecordFilterValue record={filters.record.records[0]} /> : 'Record'}
          onOperator={(operator) =>
            setFilters({ ...filters, record: { ...(filters.record as NonNullable<Filters['record']>), operator } })
          }
          onRemove={() => setFilters({ ...filters, record: undefined })}
        />
      )}
      {filters.createdBy && (
        <FilterChip
          field="Created by"
          value={<MemberNames ids={filters.createdBy} />}
          onRemove={() => setFilters({ ...filters, createdBy: undefined })}
        />
      )}
      <MenuTrigger>
        <AriaButton
          ref={anchor}
          className={notesStyles.sortButton}
          style={{
            boxShadow: 'none',
            background: 'rgba(0,0,0,.02)',
            border: '1px dashed rgba(0,0,0,.09)',
            color: 'rgba(0,0,0,.5)',
          }}
          aria-label={hasAny ? 'Add filter' : 'Filter'}
          data-testid="tasks-filter"
        >
          <Icon icon={hasAny ? 'add' : 'filter'} size={16} />
          {hasAny ? null : 'Filter'}
        </AriaButton>
        <Menu aria-label="Filter" width={220} placement="bottom start">
          <Submenu label="Assignee" icon="mention">
            <MenuItem id="assignee-is" onAction={() => setPicker({ kind: 'assignee' })}>
              Assignee
            </MenuItem>
            <MenuItem id="assignee-unassigned" isDisabled>
              Teams
            </MenuItem>
          </Submenu>
          <Submenu label="Record" icon="record">
            <MenuItem id="record-is" onAction={() => setPicker({ kind: 'record', operator: 'is' })}>
              is
            </MenuItem>
            <MenuItem id="record-is-not" onAction={() => setPicker({ kind: 'record', operator: 'is-not' })}>
              is not
            </MenuItem>
          </Submenu>
          <MenuItem id="created-by" icon="user" onAction={() => setPicker({ kind: 'created-by' })}>
            Created by
          </MenuItem>
        </Menu>
      </MenuTrigger>
      {picker && (
        <PopoverPanel triggerRef={anchor} isOpen onOpenChange={(o) => !o && setPicker(null)} padding={0} width={300}>
          <Dialog aria-label="Filter value" style={{ outline: 'none' }}>
            {picker.kind === 'record' ? (
              <RecordPicker
                entityDefinitionIds={null}
                selected={[]}
                placeholder="Search..."
                onSelect={(r) => {
                  setFilters({ ...filters, record: { operator: picker.operator, records: [r] } });
                  setPicker(null);
                }}
              />
            ) : (
              <MemberPicker
                selectedIds={
                  picker.kind === 'assignee' ? (filters.assignee?.memberIds ?? []) : (filters.createdBy ?? [])
                }
                placeholder="Find a user..."
                onSelect={(m) => {
                  if (picker.kind === 'assignee') {
                    setFilters({
                      ...filters,
                      assignee: { operator: filters.assignee?.operator ?? 'is', memberIds: [m.id] },
                    });
                  } else setFilters({ ...filters, createdBy: [m.id] });
                  setPicker(null);
                }}
              />
            )}
          </Dialog>
        </PopoverPanel>
      )}
    </>
  );
}

// ---- page --------------------------------------------------------------------------------------------------------------

export function TasksPage() {
  useDocumentTitle('Tasks');
  const ws = useWorkspaceRef();
  const client = useQueryClient();
  const calendar = useCalendar();
  const [sortField, setSortField] = usePersistentState<SortField>('tasks-sort-field', 'deadline');
  const [sortDir, setSortDir] = usePersistentState<'asc' | 'desc'>('tasks-sort-direction', 'asc');
  const [groupBy, setGroupBy] = usePersistentState<TaskGroupBy>('tasks-group-by', 'deadline');
  const [showCompleted, setShowCompleted] = usePersistentState<boolean>('tasks-show-completed', true);
  const [filters, setFilters] = usePersistentState<Filters>('tasks-filters', {});
  const [confirmBulk, setConfirmBulk] = useState(false);

  const params: ListTasksInput = {
    timeZone: calendar.timeZone,
    weekStartDay: calendar.weekStart,
    groupBy,
    sort: { field: sortField, direction: sortDir },
    showCompleted,
    filter: {
      ...(filters.assignee ? { assignees: filters.assignee } : {}),
      ...(filters.record ? { records: filters.record } : {}),
      ...(filters.createdBy ? { createdByMemberIds: filters.createdBy } : {}),
    },
  };
  const list = useTaskList(params);
  const groups = useMemo(() => viewGroups(list.data, groupBy), [list.data, groupBy]);
  const order = useMemo(() => groups.flatMap((g) => g.tasks.map((t: Task) => t.id)), [groups]);
  const selection = useSelection(order);
  const selectedIds = [...selection.selected].filter((id) => order.includes(id));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selection.selected.size > 0) selection.clear();
      // ⌘A selects every task, except while typing or inside a dialog / menu (text selection keeps working).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && !isTypingTarget(e.target) && order.length > 0) {
        e.preventDefault();
        selection.selectAll();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const bulkDelete = async () => {
    const ids = selectedIds;
    try {
      toast({ title: `Deleting ${ids.length} tasks` });
      await deleteTasks(client, ws, ids);
      selection.clear();
      toast({ title: ids.length === 1 ? 'Task deleted' : 'Tasks deleted' });
    } catch (error) {
      toast.error({ title: 'Failed to delete the tasks', description: errorEnvelopeOf(error).message });
    }
  };

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Tasks', icon: 'tasks' }]}
        actions={
          <>
            <HelpButton />
            <AskButton />
          </>
        }
      />
      <div className={notesStyles.page} data-testid="tasks-page">
        <div className={notesStyles.toolbar}>
          <MenuTrigger>
            <AriaButton className={notesStyles.sortButton} data-testid="tasks-sort">
              <Icon icon="sort" size={16} className={notesStyles.muted} />
              <span className={notesStyles.muted}>Sorted by</span>
              {SORT_LABEL[sortField]}
            </AriaButton>
            <Menu
              aria-label="Sort"
              placement="bottom start"
              width={220}
              selectionMode="multiple"
              selectedKeys={[sortField, sortDir]}
              onSelectionChange={(keys) => {
                // Two single-choice groups in one menu: whichever key is new wins in its group.
                for (const key of keys as Set<string>) {
                  if ((key === 'asc' || key === 'desc') && key !== sortDir) setSortDir(key);
                  if ((key === 'deadline' || key === 'assignee' || key === 'created-at') && key !== sortField)
                    setSortField(key);
                }
              }}
            >
              <MenuSection>
                <MenuItem id="deadline" icon="calendar">
                  Due date
                </MenuItem>
                <MenuItem id="assignee" icon="mention">
                  Assignee
                </MenuItem>
                <MenuItem id="created-at" icon="clock">
                  Creation date
                </MenuItem>
              </MenuSection>
              <MenuSeparator />
              <MenuSection>
                <MenuItem id="asc" icon="arrowUp">
                  Ascending
                </MenuItem>
                <MenuItem id="desc" icon="arrowDown">
                  Descending
                </MenuItem>
              </MenuSection>
            </Menu>
          </MenuTrigger>
          <span style={{ width: 1, height: 16, background: 'var(--ar-color-stroke-secondary)', margin: '0 4px' }} />
          <FilterControls filters={filters} setFilters={setFilters} />
          <span className={notesStyles.toolbarSpacer} />
          <MenuTrigger>
            <Button variant="secondary" size={28} icon="viewSettings" data-testid="tasks-view-settings">
              View settings
            </Button>
            <Menu aria-label="View settings" placement="bottom end" width={260}>
              <Submenu
                label="Group by"
                icon="rows"
                trailing={
                  <span className={notesStyles.muted}>{groupBy === 'none' ? 'None' : GROUP_LABEL[groupBy]}</span>
                }
              >
                {(Object.keys(GROUP_LABEL) as (keyof typeof GROUP_LABEL)[]).map((key) => (
                  <MenuItem key={key} id={`group-${key}`} onAction={() => setGroupBy(key)}>
                    {GROUP_LABEL[key]}
                  </MenuItem>
                ))}
              </Submenu>
              <MenuSeparator />
              <MenuItem
                id="completed"
                icon="checkCircle"
                onAction={() => setShowCompleted(!showCompleted)}
                trailing={
                  <Switch isSelected={showCompleted} aria-label="Show completed tasks" onChange={setShowCompleted} />
                }
              >
                Show completed tasks
              </MenuItem>
            </Menu>
          </MenuTrigger>
          <Button variant="primary" size={28} icon="add" onPress={() => openCreateTask()} data-testid="new-task">
            New task
          </Button>
        </div>
        <div className={notesStyles.scroll}>
          {list.isError ? (
            <IndexState error text="Something went wrong trying to load tasks. Refresh the page to try again." />
          ) : list.isPending ? null : groups.length === 0 ? (
            <IndexState title="Tasks" text="No tasks yet! Create your first task to get started." />
          ) : (
            <TaskTable groups={groups} selection={selection} onSelectMode={selection.add} />
          )}
        </div>
      </div>
      {selectedIds.length > 0 && (
        <div className={s.bulkBar} role="toolbar" aria-label="Selected tasks" data-testid="tasks-bulk-bar">
          <span className={s.bulkCount}>
            <span className={s.bulkBadge}>{selectedIds.length}</span>
            Selected
            <IconButton
              icon="close"
              aria-label={`Clear selection, ${selectedIds.length} selected`}
              size={20}
              onPress={selection.clear}
            />
          </span>
          <span className={s.bulkDivider} />
          <Button
            variant="ghost"
            size={28}
            icon="checkCircle"
            onPress={() => {
              void bulkSetCompleted(client, ws, selectedIds, true);
              selection.clear();
            }}
          >
            Mark complete
          </Button>
          <Button variant="secondary-destructive" size={28} icon="delete" onPress={() => setConfirmBulk(true)}>
            Delete tasks
          </Button>
        </div>
      )}
      <AlertDialog
        isOpen={confirmBulk}
        onOpenChange={setConfirmBulk}
        title={`Delete ${selectedIds.length} tasks`}
        description={`Are you sure you want to delete these ${selectedIds.length} tasks?`}
        confirmLabel="Delete"
        onConfirm={() => void bulkDelete()}
      />
    </>
  );
}
