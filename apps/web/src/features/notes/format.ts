// Dates as the notes index shows them (E README §2.1: relative "Today" on cards and rows) and the creation-date bucket
// labels ("Created today" …; B.24 buckets in the viewer's zone and week start).
import { type CreatedBucket, localDateOf } from '@agentic-crm/contracts';

export function relativeDay(iso: string, timeZone: string, locale = 'en-US', now: number = Date.now()): string {
  const day = localDateOf(iso, timeZone);
  const today = localDateOf(now, timeZone);
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}

export const CREATED_BUCKET_LABEL: Record<CreatedBucket, string> = {
  today: 'Created today',
  'this-week': 'Created this week',
  'last-week': 'Created last week',
  'earlier-this-month': 'Created earlier this month',
  'last-month': 'Created last month',
  'earlier-this-year': 'Created earlier this year',
  'last-year': 'Created last year',
  older: 'Created over a year ago',
};
