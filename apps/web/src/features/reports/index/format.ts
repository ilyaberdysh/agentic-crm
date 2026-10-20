// Dates of the dashboards screens: "Oct 9th 2026" (Settings → Dashboards, absolute), "9th Oct 2026 1:46 PM" (row menu
// footer "Created by …") and "about 15 hours ago" (Settings → report rows, relative). Pure; the zone is the viewer's.

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

interface Parts {
  day: number;
  month: string;
  year: string;
  time: string;
}

function parts(iso: string, timeZone: string): Parts | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const f = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  });
  const get = (type: string) => f.formatToParts(date).find((p) => p.type === type)?.value ?? '';
  const period = get('dayPeriod').toUpperCase();
  return {
    day: Number(get('day')),
    month: get('month'),
    year: get('year'),
    time: `${get('hour')}:${get('minute')} ${period}`,
  };
}

/** "Oct 9th 2026" */
export function formatAbsoluteDate(iso: string, timeZone: string): string {
  const p = parts(iso, timeZone);
  return p ? `${p.month} ${ordinal(p.day)} ${p.year}` : '';
}

/** "9th Oct 2026 1:46 PM" */
export function formatCreatedAt(iso: string, timeZone: string): string {
  const p = parts(iso, timeZone);
  return p ? `${ordinal(p.day)} ${p.month} ${p.year} ${p.time}` : '';
}

const MINUTE = 60_000;

/**
 * "less than a minute ago", "5 minutes ago", "about 1 hour ago", "about 15 hours ago", "1 day ago", "12 days ago",
 * "about 1 month ago", "3 months ago", "about 1 year ago", "over 2 years ago" (the wording of date-fns'
 * `formatDistanceToNow` with a suffix, which the settings tables use).
 */
export function formatDistanceAgo(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const ms = Math.max(0, now - then);
  const minutes = Math.round(ms / MINUTE);
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  let text: string;
  if (minutes < 1) text = 'less than a minute';
  else if (minutes < 2) text = '1 minute';
  else if (minutes < 45) text = plural(minutes, 'minute');
  else if (minutes < 90) text = 'about 1 hour';
  else if (minutes < 1440) text = `about ${plural(Math.round(minutes / 60), 'hour')}`;
  else if (minutes < 2520) text = '1 day';
  else if (minutes < 43_200) text = plural(Math.round(minutes / 1440), 'day');
  else if (minutes < 86_400) text = 'about 1 month';
  else if (minutes < 525_600) text = plural(Math.round(minutes / 43_200), 'month');
  else {
    const months = Math.round(minutes / 43_200);
    const years = Math.floor(months / 12);
    const rest = months % 12;
    if (rest < 3) text = `about ${plural(years, 'year')}`;
    else if (rest < 9) text = `over ${plural(years, 'year')}`;
    else text = `almost ${plural(years + 1, 'year')}`;
  }
  return `${text} ago`;
}
