// The viewer's calendar for dates on emails and meetings: the member's time zone (preferences, falling back to the
// browser) and week start.
import { type Calendar, useCalendar } from '../tasks';

export function useTimeZone(): string {
  return useCalendar().timeZone;
}

export { type Calendar, useCalendar };
