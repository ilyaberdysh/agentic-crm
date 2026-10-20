// Google Calendar for the connector (7.09): `events.list` on the primary calendar with recurring series expanded into
// instances (singleEvents) and `syncToken` incremental sync; events → the connector's CalendarChange shape.
//   - one meeting per iCalUID across mailboxes: an instance of a recurring series gets `<iCalUID>#<original start in
//     UTC>`, which every attendee's calendar computes alike
//   - cancelled events, and events that turned private / non-meeting, become deletions
//   - private events are never synced (Attio: "Private Google Calendar events are not synced"), nor working-location,
//     focus-time, out-of-office and birthday entries
import type {
  CalendarChange,
  ConnectorAttendee,
  ConnectorEvent,
  ConnectorEventTime,
  ConnectorMailbox,
} from '../types.ts';
import { googleRequest } from './http.ts';
import { htmlToText } from './mime.ts';
import type { ResolvedGoogleSettings } from './settings.ts';
import type { GoogleTokens } from './tokens.ts';

interface GCalTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GCalEvent {
  id: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  description?: string;
  location?: string;
  start?: GCalTime;
  end?: GCalTime;
  iCalUID?: string;
  recurringEventId?: string;
  originalStartTime?: GCalTime;
  attendees?: {
    email?: string;
    displayName?: string;
    organizer?: boolean;
    self?: boolean;
    resource?: boolean;
    responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  }[];
  organizer?: { email?: string; displayName?: string; self?: boolean };
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  visibility?: 'default' | 'public' | 'private' | 'confidential';
  eventType?: string;
}

export interface GCalPage {
  items?: GCalEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export class CalendarApi {
  constructor(
    private readonly settings: ResolvedGoogleSettings,
    private readonly tokens: GoogleTokens,
  ) {}

  /**
   * events.list on the primary calendar. The full sync passes the time window; incremental calls pass the sync token
   * (Google forbids the window with it). The other parameters stay identical between both, as Google requires.
   */
  list(
    mailbox: ConnectorMailbox,
    query: { syncToken?: string; pageToken?: string; timeMin?: string; timeMax?: string; maxResults: number },
  ): Promise<GCalPage> {
    return this.tokens.call(mailbox, (token) =>
      googleRequest<GCalPage>(this.settings, {
        url: `${this.settings.endpoints.calendar}/calendars/primary/events`,
        token,
        query: {
          singleEvents: 'true',
          showDeleted: 'true',
          maxResults: query.maxResults,
          pageToken: query.pageToken,
          syncToken: query.syncToken,
          timeMin: query.syncToken ? undefined : query.timeMin,
          timeMax: query.syncToken ? undefined : query.timeMax,
        },
      }),
    );
  }
}

const SKIPPED_EVENT_TYPES = new Set(['workingLocation', 'focusTime', 'outOfOffice', 'birthday']);

function toTime(t: GCalTime | undefined): ConnectorEventTime | null {
  if (!t) return null;
  if (t.dateTime) return { dateTime: t.dateTime, timeZone: t.timeZone ?? null };
  if (t.date) return { date: t.date };
  return null;
}

/** The meeting key of an event: its iCalUID, plus the original start for an instance of a recurring series. */
export function eventKey(e: GCalEvent): string {
  const uid = e.iCalUID ?? `${e.id}@google.com`;
  if (!e.recurringEventId || !e.originalStartTime) return uid;
  const original = e.originalStartTime.dateTime
    ? new Date(e.originalStartTime.dateTime).toISOString()
    : (e.originalStartTime.date ?? e.id);
  return `${uid}#${original}`;
}

function conferenceUrl(e: GCalEvent): string | null {
  if (e.hangoutLink) return e.hangoutLink;
  const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video' && p.uri);
  return video?.uri ?? null;
}

const STATUS: Record<string, ConnectorAttendee['status']> = {
  accepted: 'accepted',
  tentative: 'tentative',
  declined: 'declined',
  needsAction: 'pending',
};

/** Whether an event belongs in the CRM at all (private and non-meeting entries do not). */
export const isSyncable = (e: GCalEvent) =>
  e.visibility !== 'private' && e.visibility !== 'confidential' && !SKIPPED_EVENT_TYPES.has(e.eventType ?? 'default');

/** A Google event as the connector boundary's event; null when it has no usable start / end. */
export function toConnectorEvent(e: GCalEvent): ConnectorEvent | null {
  const start = toTime(e.start);
  const end = toTime(e.end);
  if (!start || !end) return null;
  const attendees: ConnectorAttendee[] = (e.attendees ?? [])
    .filter((a) => a.email && !a.resource)
    .map((a) => ({
      emailAddress: a.email as string,
      name: a.displayName?.trim() || null,
      status: STATUS[a.responseStatus ?? 'needsAction'] ?? 'pending',
      isOrganizer: a.organizer === true || (!!e.organizer?.email && a.email === e.organizer.email),
    }));
  // Events without a guest list (or whose organizer is not listed) still have their organizer as a participant.
  if (
    e.organizer?.email &&
    !attendees.some((a) => a.emailAddress.toLowerCase() === e.organizer?.email?.toLowerCase())
  ) {
    attendees.unshift({
      emailAddress: e.organizer.email,
      name: e.organizer.displayName?.trim() || null,
      status: 'accepted',
      isOrganizer: true,
    });
  }
  const description = e.description ?? '';
  return {
    providerEventId: e.id,
    icalUid: eventKey(e),
    title: e.summary ?? '',
    description: /<[a-z][^>]*>/i.test(description) ? htmlToText(description) : description,
    start,
    end,
    status: e.status === 'tentative' ? 'tentative' : e.status === 'cancelled' ? 'cancelled' : 'confirmed',
    conferenceUrl: conferenceUrl(e),
    location: e.location?.trim() || null,
    attendees,
  };
}

/** One page of Google events → calendar changes. The full sync skips removed events (nothing to delete yet). */
export function toCalendarChanges(items: GCalEvent[], options: { initial: boolean }): CalendarChange[] {
  const changes: CalendarChange[] = [];
  for (const e of items) {
    const event = e.status === 'cancelled' || !isSyncable(e) ? null : toConnectorEvent(e);
    if (event) changes.push({ type: 'upsert', event });
    else if (!options.initial) changes.push({ type: 'delete', providerEventId: e.id });
  }
  return changes;
}
