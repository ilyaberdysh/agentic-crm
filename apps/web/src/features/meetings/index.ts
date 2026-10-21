// Meetings on the client. Public surface:
// <NewMeetingDialog record/> "Add meeting" of the Activity tab (D)
// <HomeMeetings/> the Home Meetings widget
// useMeetingsById(ids) meetings of timeline events (cached under the meeting's own key)
// timelineVerb / rsvpOf … the event sentence and the status pill
// Importing this module registers the meeting modal (`?modal=meeting&id=<meetingId>`) with the overlay host.
import { registerWindowContent } from '../overlays';
import { MeetingModal } from './MeetingModal';

registerWindowContent('meeting', MeetingModal, { fit: true, dimmed: true });

export { type Meeting, useMeetingsById } from './data';
export { HomeMeetings } from './HomeMeetings';
export {
  isPast,
  participantCountLabel,
  timelineVerb,
  timeRangeLabel,
} from './model';
export { NewMeetingDialog, type NewMeetingDialogProps } from './NewMeetingDialog';
