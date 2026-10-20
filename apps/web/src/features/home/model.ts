// Home page model (B-shell/home.md §2.1, §2.4): the greeting by local time of day and the Tasks block's due labels.
// Pure and unit-tested.
import type { PartOfDay } from '@agentic-crm/contracts';
import { localDateOf } from '@agentic-crm/contracts';

/** Morning before 12:00, afternoon before 18:00, evening otherwise — in the viewer's zone. */
export function partOfDayIn(now: Date | number, timeZone: string): PartOfDay {
  let hour: number;
  try {
    hour = Number(
      new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date(now)),
    );
  } catch {
    hour = new Date(now).getHours();
  }
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}

/** "Good morning, Ada." (no name: "Good morning."). */
export function greetingText(part: PartOfDay, firstName: string): string {
  return firstName ? `Good ${part}, ${firstName}.` : `Good ${part}.`;
}

export type DueTone = 'overdue' | 'today' | 'later';

/** The right-hand label of a task row: "Yesterday", "Today", "Tomorrow", "In 2 days" (null = no deadline). */
export function homeDueLabel(
  deadlineAt: string | null,
  now: Date | number,
  timeZone: string,
): { text: string; tone: DueTone } | null {
  if (!deadlineAt) return null;
  const diff = daysBetween(localDateOf(now, timeZone), localDateOf(deadlineAt, timeZone));
  if (diff < 0) return { text: diff === -1 ? 'Yesterday' : `${-diff} days ago`, tone: 'overdue' };
  if (diff === 0) return { text: 'Today', tone: 'today' };
  if (diff === 1) return { text: 'Tomorrow', tone: 'later' };
  return { text: `In ${diff} days`, tone: 'later' };
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
