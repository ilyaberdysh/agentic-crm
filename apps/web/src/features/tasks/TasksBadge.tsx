// Sidebar "Tasks" count (E README §2.6 "Sidebar badge"; components.md Badge 16 px primary): my incomplete tasks due by
// the end of today in my time zone.
import { Badge } from '@agentic-crm/ui';
import { useCalendar } from './calendar';
import { useDueTaskCount } from './data';

export function TasksBadge() {
  const calendar = useCalendar();
  const count = useDueTaskCount(calendar.timeZone).data?.count ?? 0;
  if (count === 0) return null;
  return (
    <Badge variant="primary" size={16} data-testid="tasks-badge">
      {count}
    </Badge>
  );
}
