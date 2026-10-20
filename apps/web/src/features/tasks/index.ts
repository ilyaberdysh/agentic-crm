// Tasks (BACKLOG 3.15). E3 for the record page: <RecordTasksTab recordRef/>; plus the create dialog opener, task rows
// and data hooks for the record overview's tasks section and "Next due task" highlight.
export { type Calendar, useCalendar } from './calendar';
export {
  DEADLINE_GROUP_LABEL,
  deadlineGroups,
  setTaskCompleted,
  type Task,
  taskKeys,
  useTask,
  useTaskList,
} from './data';
export { dueLabel } from './deadline';
export { parseNaturalDate } from './naturalDate';
export { RecordTasksTab } from './RecordTasksTab';
export { TaskCheckbox } from './TaskCheckbox';
export { type CreateTaskDefaults, openCreateTask } from './TaskDialog';
export { TasksPage } from './TasksPage';
export { TaskTable } from './TaskTable';
