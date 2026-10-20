// ISO-8601 duration arithmetic for dynamic defaults ('PT0S') and relative-date filters ('-P0Y0M30DT0H0M0S').
// addIsoDuration works on UTC fields; the zone-aware helpers below apply it to a zone's wall clock.

const DURATION_RE =
  /^(-)?P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

export function isIsoDuration(value: string): boolean {
  return DURATION_RE.test(value) && value !== 'P' && value !== '-P';
}

/** now + duration → ISO timestamp (millisecond precision, UTC). */
export function addIsoDuration(nowIso: string, duration: string): string {
  const m = DURATION_RE.exec(duration);
  if (!m) throw new Error(`Invalid ISO-8601 duration: ${duration}`);
  const sign = m[1] ? -1 : 1;
  const n = (i: number) => Number(m[i] ?? 0) * sign;
  const d = new Date(nowIso);
  const months = Math.trunc(n(2)) * 12 + Math.trunc(n(3));
  if (months) {
    // Calendar months, clamped to the target month's length (Mar 31 − 1 month = Feb 28/29, not Mar 3).
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  const ms = ((n(4) * 7 + n(5)) * 24 * 3600 + n(6) * 3600 + n(7) * 60 + n(8)) * 1000;
  return new Date(d.getTime() + ms).toISOString();
}

/** Floors an ISO timestamp to the start of its hour (relative timestamp filters, C1 §4). */
export function floorToHour(iso: string): string {
  const d = new Date(iso);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

// ---------------------------------------------------------------------------------------------------------------
// Time zones (X-05 relative-date filters are resolved in the viewer's IANA zone).

interface WallClock {
  y: number;
  mo: number; // 1-12
  d: number;
  h: number;
  mi: number;
  s: number;
  ms: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** True for a time zone the runtime knows ('UTC', 'Europe/Moscow', …). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

function wallClock(instant: Date, timeZone: string): WallClock {
  const parts: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return {
    y: parts.year as number,
    mo: parts.month as number,
    d: parts.day as number,
    h: (parts.hour as number) % 24,
    mi: parts.minute as number,
    s: parts.second as number,
    ms: instant.getUTCMilliseconds(),
  };
}

const wallAsUtc = (w: WallClock) => Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s, w.ms);
const fromUtcFields = (t: Date): WallClock => ({
  y: t.getUTCFullYear(),
  mo: t.getUTCMonth() + 1,
  d: t.getUTCDate(),
  h: t.getUTCHours(),
  mi: t.getUTCMinutes(),
  s: t.getUTCSeconds(),
  ms: t.getUTCMilliseconds(),
});

/** The instant of a wall-clock time in a zone (times skipped by a DST change resolve forward). */
function wallToInstant(w: WallClock, timeZone: string): Date {
  const guess = wallAsUtc(w);
  const offset = (t: number) => wallAsUtc(wallClock(new Date(t), timeZone)) - t;
  let instant = guess - offset(guess);
  const second = offset(instant);
  if (guess - second !== instant) instant = guess - second;
  return new Date(instant);
}

/** Local calendar date ('YYYY-MM-DD') of now + duration in the zone (calendar arithmetic on the wall clock). */
export function relativeLocalDate(nowIso: string, duration: string, timeZone: string): string {
  const wall = new Date(wallAsUtc(wallClock(new Date(nowIso), timeZone))).toISOString();
  return addIsoDuration(wall, duration).slice(0, 10);
}

/** now + duration in the zone, floored to the local hour, as a UTC ISO instant (C1 §4 "floored to the hour"). */
export function relativeInstant(nowIso: string, duration: string, timeZone: string): string {
  const wall = new Date(wallAsUtc(wallClock(new Date(nowIso), timeZone))).toISOString();
  const shifted = fromUtcFields(new Date(addIsoDuration(wall, duration)));
  return wallToInstant({ ...shifted, mi: 0, s: 0, ms: 0 }, timeZone).toISOString();
}

/** [start, end) instants of a local calendar day. */
export function localDayBounds(date: string, timeZone: string): { start: string; end: string } {
  const [y, mo, d] = date.slice(0, 10).split('-').map(Number) as [number, number, number];
  const start = wallToInstant({ y, mo, d, h: 0, mi: 0, s: 0, ms: 0 }, timeZone);
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  const end = wallToInstant(
    { y: next.getUTCFullYear(), mo: next.getUTCMonth() + 1, d: next.getUTCDate(), h: 0, mi: 0, s: 0, ms: 0 },
    timeZone,
  );
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Local calendar date of an instant in the zone. */
export function localDate(instantIso: string, timeZone: string): string {
  const w = wallClock(new Date(instantIso), timeZone);
  return `${String(w.y).padStart(4, '0')}-${String(w.mo).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
}

/** The wall clock of an instant in a zone (cron schedules). */
export function zonedWallClock(
  instantIso: string,
  timeZone: string,
): {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
} {
  const w = wallClock(new Date(instantIso), timeZone);
  return { y: w.y, mo: w.mo, d: w.d, h: w.h, mi: w.mi };
}

/** The instant (ISO) of a wall-clock minute in a zone (times skipped by a DST change resolve forward). */
export function zonedInstant(y: number, mo: number, d: number, h: number, mi: number, timeZone: string): string {
  return wallToInstant({ y, mo, d, h, mi, s: 0, ms: 0 }, timeZone).toISOString();
}
