// Relative comment times use labels such as "less than a minute ago" and "about 6 hours ago": the
// usual distance-in-words thresholds.
export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  const minutes = seconds / 60;
  if (seconds < 30) return 'less than a minute ago';
  if (minutes < 1.5) return '1 minute ago';
  if (minutes < 44.5) return `${Math.round(minutes)} minutes ago`;
  if (minutes < 89.5) return 'about 1 hour ago';
  const hours = minutes / 60;
  if (hours < 23.5) return `about ${Math.round(hours)} hours ago`;
  if (hours < 41.5) return '1 day ago';
  const days = hours / 24;
  if (days < 29.5) return `${Math.round(days)} days ago`;
  if (days < 44.5) return 'about 1 month ago';
  if (days < 59.5) return 'about 2 months ago';
  const months = days / 30;
  if (months < 11.5) return `${Math.round(months)} months ago`;
  const years = days / 365.25;
  const whole = Math.floor(years);
  const rest = years - whole;
  if (whole < 1) return 'about 1 year ago';
  if (rest < 0.25) return `about ${whole} year${whole === 1 ? '' : 's'} ago`;
  if (rest < 0.75) return `over ${whole} year${whole === 1 ? '' : 's'} ago`;
  return `almost ${whole + 1} years ago`;
}
