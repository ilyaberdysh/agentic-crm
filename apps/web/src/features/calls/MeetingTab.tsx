// The Meeting tab (I calls §3.8; evidence/I/call-page-meeting.png): Details (time range, conference link), Participants
// (members with their name, "Host", the address and an Attended pill) and Linked records (add with "+", remove on hover).
// Participants and linked records are the meeting modal's own sections.

import { localDateOf } from '@agentic-crm/contracts';
import { Icon, toast } from '@agentic-crm/ui';
import { errorEnvelopeOf } from '../../data/trpc';
import { formatClock, wallParts } from '../email/model';
import { useUpdateMeeting } from '../meetings/data';
import { LinkedRecords, Participants } from '../meetings/MeetingModal';
import * as m from '../meetings/meetings.css';
import { dayLabel, formatDuration, isPast, startDateOf } from '../meetings/model';
import { useNow } from '../meetings/parts';
import { useCalendar } from '../tasks/calendar';
import { useCallPage } from './callContext';
import * as s from './page.css';

export function MeetingTab() {
  const { call } = useCallPage();
  const meeting = call.meeting;
  const { timeZone } = useCalendar();
  const now = useNow();
  const update = useUpdateMeeting();
  const past = isPast(meeting, now);
  const today = localDateOf(now, timeZone);
  const start = wallParts(meeting.start.at, timeZone);
  const end = wallParts(meeting.end.at, timeZone);
  const duration = formatDuration(Date.parse(meeting.end.at) - Date.parse(meeting.start.at));
  const full = meeting.access === 'full-access';
  return (
    <div className={s.meeting} data-testid="meeting-tab">
      <section className={m.section} aria-label="Details" data-testid="meeting-details">
        <div className={m.sectionHead}>Details</div>
        <div className={s.detailsRow} data-testid="meeting-time">
          <Icon icon="clock" size={16} className={s.detailsMuted} />
          <span className={s.detailsDay}>{dayLabel(startDateOf(meeting, timeZone), today)}</span>
          {meeting.isAllDay ? (
            <span className={s.detailsMuted}>All day</span>
          ) : (
            <>
              <span>{formatClock(start)}</span>
              <Icon icon="arrowRight" size={14} className={s.detailsMuted} />
              <span>{formatClock(end)}</span>
              <span className={s.detailsMuted}>({duration})</span>
            </>
          )}
        </div>
        {meeting.conferenceUrl && (
          <div className={s.detailsRow}>
            <Icon icon="link" size={16} className={s.detailsMuted} />
            <a className={s.detailsLink} href={meeting.conferenceUrl} target="_blank" rel="noreferrer">
              {meeting.conferenceUrl}
            </a>
          </div>
        )}
      </section>
      {full && <Participants meeting={meeting} past={past} limit={null} />}
      <LinkedRecords
        meeting={meeting}
        onChange={(linkedRecords, mode) =>
          update.mutate(
            { meetingId: meeting.id, linkedRecords, linkedRecordsMode: mode },
            {
              onError: (e) =>
                toast.error({ title: 'Failed to update the linked records', description: errorEnvelopeOf(e).message }),
            },
          )
        }
      />
    </div>
  );
}
