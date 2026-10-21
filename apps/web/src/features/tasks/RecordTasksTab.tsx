// E3: a record's Tasks tab ("Tasks"): 52 px header "Tasks" + "Add task", then the tasks linked to the
// record grouped by due date (Today / This week / Upcoming / No due date / Completed) as task rows. Empty: "No tasks" /
// "Create your first task to get started." + "New task".
import { Button, Icon, Spinner } from '@agentic-crm/ui';
import type { RecordRef } from '../overlays/model';
import { useCalendar } from './calendar';
import { useTaskList } from './data';
import { openCreateTask } from './TaskDialog';
import { viewGroups } from './TasksPage';
import { TaskTable } from './TaskTable';
import * as s from './tasks.css';

export function RecordTasksTab({ recordRef }: { recordRef: RecordRef }) {
  const calendar = useCalendar();
  const list = useTaskList({
    timeZone: calendar.timeZone,
    weekStartDay: calendar.weekStart,
    groupBy: 'deadline',
    showCompleted: true,
    filter: { records: { operator: 'is', records: [recordRef] } },
  });
  const groups = viewGroups(list.data, 'deadline');
  const add = () => openCreateTask({ records: [recordRef] });
  return (
    <section data-testid="record-tasks-tab" aria-label="Tasks">
      <div className={s.tabHeader}>
        <h2 className={s.tabTitle}>Tasks</h2>
        <Button variant="secondary" size={28} icon="add" onPress={add}>
          Add task
        </Button>
      </div>
      {list.isPending ? (
        <div className={s.empty}>
          <Spinner size={16} />
        </div>
      ) : groups.length === 0 ? (
        <div className={s.empty} data-testid="record-tasks-empty">
          <Icon icon="tasks" size={20} />
          <span className={s.emptyTitle}>No tasks</span>
          <span className={s.emptyText}>Create your first task to get started.</span>
          <Button variant="secondary" size={28} icon="add" onPress={add}>
            New task
          </Button>
        </div>
      ) : (
        <TaskTable groups={groups} showHead={false} compact />
      )}
    </section>
  );
}
