// Meetings (slice 7a; BACKLOG 7.04; specs F README §2.4–2.5, §6, I calls §11; public /v2/meetings). Meetings come
// from synced calendars (one meeting per iCalUID across mailboxes), from the record page "New meeting" dialog and
// from the public API; participants are matched to people / companies / members by email, linked records are the
// explicitly chosen ones. Transcript-only call recordings hang off a meeting (slice 10 builds on them).
import { z } from 'zod';
import { recordRefInputSchema, recordRefSchema } from './collab.ts';
import { acceptAfterSchema, actorSchema, timestampSchema, uuidSchema } from './common.ts';
import { emailAccessSchema } from './email.ts';

export const meetingParticipantStatusSchema = z.enum(['accepted', 'tentative', 'declined', 'pending']);
export type MeetingParticipantStatus = z.infer<typeof meetingParticipantStatusSchema>;

export const meetingStatusSchema = z.enum(['confirmed', 'tentative', 'cancelled']);

/** Non-all-day: `datetime` (+ IANA timezone); all-day: `date` (end exclusive). */
export const meetingTimeSchema = z.union([
  z.object({ datetime: timestampSchema, timezone: z.string().max(100).nullable().optional() }),
  z.object({ date: z.iso.date() }),
]);
export type MeetingTimeInput = z.infer<typeof meetingTimeSchema>;

export const meetingParticipantSchema = z.object({
  id: uuidSchema,
  emailAddress: z.string().nullable(),
  name: z.string().nullable(),
  isOrganizer: z.boolean(),
  status: meetingParticipantStatusSchema,
  memberId: uuidSchema.nullable(),
  personId: uuidSchema.nullable(),
  companyId: uuidSchema.nullable(),
});
export type MeetingParticipant = z.infer<typeof meetingParticipantSchema>;

export const meetingSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  source: z.enum(['calendar', 'manual', 'api']),
  /** What the viewer may see (synced meetings follow the mailbox visibility; manual / API meetings are public). */
  access: emailAccessSchema,
  /** null below subject-line access. */
  title: z.string().nullable(),
  /** Full access only. */
  description: z.string().nullable(),
  isAllDay: z.boolean(),
  start: z.object({ at: timestampSchema, timezone: z.string().nullable(), date: z.string().nullable() }),
  end: z.object({ at: timestampSchema, timezone: z.string().nullable(), date: z.string().nullable() }),
  status: meetingStatusSchema,
  conferenceUrl: z.string().nullable(),
  participants: z.array(meetingParticipantSchema),
  linkedRecords: z.array(recordRefSchema),
  /** Synced calendar copies (mailbox + owner). */
  calendarCopies: z.array(z.object({ mailboxId: uuidSchema, memberId: uuidSchema })),
  callRecordingIds: z.array(uuidSchema),
  /** Title and time are read-only for synced meetings (the modal renders them disabled). */
  isReadOnly: z.boolean(),
  createdBy: actorSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Meeting = z.infer<typeof meetingSchema>;

export const meetingParticipantInputSchema = z
  .object({
    emailAddress: z.string().trim().min(3).max(320).optional(),
    name: z.string().min(1).max(500).optional(),
    /** A workspace member (their address is used when emailAddress is omitted). */
    memberId: uuidSchema.optional(),
    isOrganizer: z.boolean().default(false),
    status: meetingParticipantStatusSchema.default('accepted'),
  })
  .refine((p) => p.emailAddress || p.name || p.memberId, 'A participant needs an email address, a name or a member');
export type MeetingParticipantInput = z.input<typeof meetingParticipantInputSchema>;

export const createMeetingInputSchema = z.object({
  /** Client-minted (I3); replays return the meeting. */
  id: uuidSchema,
  title: z.string().max(1000),
  description: z.string().max(10_000).default(''),
  start: meetingTimeSchema,
  end: meetingTimeSchema,
  isAllDay: z.boolean().default(false),
  participants: z.array(meetingParticipantInputSchema).max(500).default([]),
  linkedRecords: z.array(recordRefInputSchema).max(50).default([]),
});
export type CreateMeetingInput = z.input<typeof createMeetingInputSchema>;

export const updateMeetingInputSchema = z.object({
  meetingId: uuidSchema,
  title: z.string().max(1000).optional(),
  description: z.string().max(10_000).optional(),
  start: meetingTimeSchema.optional(),
  end: meetingTimeSchema.optional(),
  isAllDay: z.boolean().optional(),
  participants: z.array(meetingParticipantInputSchema).max(500).optional(),
  linkedRecords: z.array(recordRefInputSchema).max(50).optional(),
  /** replace (default, PUT) or append (PATCH) linked records. */
  linkedRecordsMode: z.enum(['replace', 'append']).default('replace'),
});
export type UpdateMeetingInput = z.input<typeof updateMeetingInputSchema>;

export const meetingIdInputSchema = z.object({ meetingId: uuidSchema, acceptAfter: acceptAfterSchema });

export const listMeetingsInputSchema = z.object({
  /** Meetings of a record: participants' people / companies and explicitly linked records. */
  record: recordRefInputSchema.optional(),
  /** Meetings whose participants include any of these addresses (OR with `record`). */
  participants: z.array(z.string().max(320)).max(50).optional(),
  /** Meetings that end at or after `from` and start before `to`. */
  from: timestampSchema.optional(),
  to: timestampSchema.optional(),
  /** Only meetings the caller attends (Home widget, `meetings/mrl`). */
  mine: z.boolean().default(false),
  sort: z.enum(['start_asc', 'start_desc']).default('start_asc'),
  cursor: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  acceptAfter: acceptAfterSchema,
});
export type ListMeetingsInput = z.input<typeof listMeetingsInputSchema>;

export const listMeetingsOutputSchema = z.object({
  meetings: z.array(meetingSchema),
  nextCursor: z.string().nullable(),
});
export type ListMeetingsOutput = z.infer<typeof listMeetingsOutputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Call recordings (transcript-only, D-20)

export const transcriptSegmentInputSchema = z.object({
  speech: z.string().max(100_000),
  startTime: z.number().min(0),
  endTime: z.number().min(0),
  speaker: z.object({ name: z.string().min(1).max(500), emailAddress: z.string().max(320).optional() }),
});

export const createCallRecordingInputSchema = z.object({
  id: uuidSchema,
  meetingId: uuidSchema,
  videoUrl: z.url().max(4000).optional(),
  transcript: z.array(transcriptSegmentInputSchema).max(4000).default([]),
});
export type CreateCallRecordingInput = z.input<typeof createCallRecordingInputSchema>;

export const transcriptSegmentSchema = z.object({
  speech: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  speaker: z.object({ name: z.string(), emailAddress: z.string().nullable(), participantId: uuidSchema.nullable() }),
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const callRecordingSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  meetingId: uuidSchema,
  status: z.enum(['processing', 'completed', 'failed']),
  videoUrl: z.string().nullable(),
  createdBy: actorSchema,
  createdAt: timestampSchema,
});
export type CallRecording = z.infer<typeof callRecordingSchema>;

export const callTranscriptSchema = z.object({
  segments: z.array(transcriptSegmentSchema),
  /** `[hh:mm:ss] <speaker>: <text>` lines, consecutive segments of one speaker merged (I calls §11.1). */
  rawTranscript: z.string(),
});
export type CallTranscript = z.infer<typeof callTranscriptSchema>;
