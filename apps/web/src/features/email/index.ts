// Synced email on the client (slice 7; F README §2.2–2.3). Public surface:
//   <RecordEmailsTab/>                    the record page's Emails tab (threads, Filters, Manage access)
//   useRecordThreadPreview(record, n)     the first n threads + the total (Overview section, tab count)
//   threadDisplay / formatThreadDate …    what a thread row shows at each access level
//   composeForRecord(…)                   "Compose email" on a record (the person's primary address)
// Importing this module registers the email modal (`?modal=email&id=<messageId>`) with the overlay host.
import { registerWindowContent } from '../overlays';
import { EmailModal } from './EmailModal';

registerWindowContent('email', EmailModal, { fit: true, dimmed: true });

export { composeForRecord } from './compose';
export { type ThreadSummary, useRecordThreadPreview } from './data';
export { RecordEmailsTab, type RecordEmailsTabProps } from './EmailsTab';
export {
  formatCount,
  formatMessageTimestamp,
  formatThreadDate,
  participantName,
  senderOf,
  threadDisplay,
  viaLabel,
} from './model';
