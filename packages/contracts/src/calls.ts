// Calls (slice 10; BACKLOG 10.09–10.15; specs I calls §2–6, §11; decisions slice10-contracts.md, slice10-calls.md).
// Call recordings imported from mymeet through /v2 (transcript-only), their speakers and utterances, summaries,
// the Calls list, insight templates (sections, snapshots, presets, previews) and insights generated on a call.
import { z } from 'zod';
import { recordRefInputSchema, recordRefSchema } from './collab.ts';
import { acceptAfterSchema, actorSchema, rankSchema, timestampSchema, uuidSchema } from './common.ts';
import { createdBuckets } from './dates.ts';
import { emailAccessSchema } from './email.ts';
import { meetingSchema } from './meetings.ts';

/** Recording remains processing until transcript-derived work (such as summaries) finishes. */
export const callRecordingStatusSchema = z.enum(['processing', 'completed', 'failed']);
export type CallRecordingStatus = z.infer<typeof callRecordingStatusSchema>;

/** Status of an asynchronous AI step (summaries, insights, previews); null = never requested. */
export const callJobStatusSchema = z.enum(['queued', 'executing', 'completed', 'failed']);
export type CallJobStatus = z.infer<typeof callJobStatusSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Speakers and transcript

/**
 * How a speaker renders (X-28): `member` — a workspace member (member name + avatar, never the raw email);
 * `person` — a person record of a participant (record chip); `participant` — a participant without member / person;
 * `unknown` — no participant matched, the provided name.
 */
export const callSpeakerKindSchema = z.enum(['member', 'person', 'participant', 'unknown']);

export const callSpeakerSchema = z.object({
  /** The first speaker row of the merged group (speakers mapped to the same participant / member merge). */
  id: uuidSchema,
  /** Display name: member name, person record name, participant name, else the name the importer gave. */
  name: z.string(),
  /** The name the importer sent. */
  providedName: z.string(),
  emailAddress: z.string().nullable(),
  kind: callSpeakerKindSchema,
  participantId: uuidSchema.nullable(),
  memberId: uuidSchema.nullable(),
  person: recordRefSchema.nullable(),
  isOrganizer: z.boolean(),
  /** Every speaker row merged into this one (including `id`). Utterances reference the merged id. */
  speakerIds: z.array(uuidSchema),
});
export type CallSpeaker = z.infer<typeof callSpeakerSchema>;

export const callSpeakerStatsSchema = callSpeakerSchema.extend({
  talkTimeSeconds: z.number(),
  /** Percent of the total talk time, one decimal. */
  talkShare: z.number(),
  /** The speaker's utterance ranges (seconds), for the 4 px timeline. */
  segments: z.array(z.object({ start: z.number(), end: z.number() })),
});
export type CallSpeakerStats = z.infer<typeof callSpeakerStatsSchema>;

export const callUtteranceSchema = z.object({
  /** Position in the imported transcript (stable id within the recording). */
  index: z.number().int(),
  /** Merged speaker id (see callSpeakerSchema.speakerIds). */
  speakerId: uuidSchema.nullable(),
  text: z.string(),
  start: z.number(),
  end: z.number(),
});
export type CallUtterance = z.infer<typeof callUtteranceSchema>;

/**
 * A rendered speaker block (acceptance 3): consecutive utterances of one speaker; a new block after a speaker change
 * or more than 20 s of silence; a new paragraph inside a block after a pause of more than 2 s.
 */
export const transcriptBlockSchema = z.object({
  speakerId: uuidSchema.nullable(),
  start: z.number(),
  end: z.number(),
  paragraphs: z.array(z.object({ start: z.number(), end: z.number(), utteranceIndexes: z.array(z.number().int()) })),
});
export type TranscriptBlock = z.infer<typeof transcriptBlockSchema>;

export const callTimeRangeSchema = z
  .object({ start: z.number().min(0), end: z.number().min(0) })
  .refine((r) => r.start < r.end, 'start must be before end');

export const callTranscriptInputSchema = z.object({
  recordingId: uuidSchema,
  /** A `?start=&end=` range link: answers which utterances it covers (the rest renders dimmed). */
  range: callTimeRangeSchema.optional(),
  /** Only the utterances (and blocks) overlapping `range`. */
  rangeOnly: z.boolean().default(false),
  acceptAfter: acceptAfterSchema,
});
export type CallTranscriptInput = z.input<typeof callTranscriptInputSchema>;

export const callTranscriptViewSchema = z.object({
  recordingId: uuidSchema,
  meetingId: uuidSchema,
  speakers: z.array(callSpeakerSchema),
  /** In time order. */
  utterances: z.array(callUtteranceSchema),
  blocks: z.array(transcriptBlockSchema),
  /** The range link resolved to utterances: first / last index inside it (null when it covers none). */
  range: z
    .object({ start: z.number(), end: z.number(), firstIndex: z.number().int(), lastIndex: z.number().int() })
    .nullable(),
  /** Copy format: one line per block `[m:ss] Speaker: text`, paragraphs on following lines (I calls §3.5). */
  text: z.string(),
});
export type CallTranscriptView = z.infer<typeof callTranscriptViewSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Calls list and call detail

export const callParticipantSchema = z.object({
  id: uuidSchema,
  name: z.string().nullable(),
  emailAddress: z.string().nullable(),
  isOrganizer: z.boolean(),
  memberId: uuidSchema.nullable(),
  personId: uuidSchema.nullable(),
  companyId: uuidSchema.nullable(),
});

export const callListItemSchema = z.object({
  id: uuidSchema,
  meetingId: uuidSchema,
  /** The meeting's access for the viewer; content (summaries, transcript) needs full access. */
  access: emailAccessSchema,
  title: z.string().nullable(),
  status: callRecordingStatusSchema,
  summaryStatus: callJobStatusSchema.nullable(),
  conciseSummary: z.string().nullable(),
  conciseSummaryStatus: callJobStatusSchema.nullable(),
  startAt: timestampSchema,
  endAt: timestampSchema,
  isAllDay: z.boolean(),
  /** Meeting length (end − start); the transcript length when the meeting has no length. */
  durationSeconds: z.number(),
  /** The meeting's linked records (Record column, record Calls tab). */
  linkedRecords: z.array(recordRefSchema),
  participants: z.array(callParticipantSchema),
  isFavorite: z.boolean(),
  /** Date bucket of the meeting start (B.24) when grouped by date. */
  dateGroup: z.enum(createdBuckets).nullable(),
  createdBy: actorSchema,
  createdAt: timestampSchema,
});
export type CallListItem = z.infer<typeof callListItemSchema>;

const filterMode = z.enum(['must', 'must-not']).default('must');

/** Calls list filters (I calls §2.2, §6.3), appended to the date-group bounds. */
export const callListFilterSchema = z.discriminatedUnion('field', [
  /** Meetings linked to the record or with the record as participant (person / company). */
  z.object({ field: z.literal('record'), mode: filterMode, operator: z.literal('eq'), value: recordRefInputSchema }),
  /** A member or a person record taking part. */
  z.object({
    field: z.literal('participants'),
    mode: filterMode,
    operator: z.literal('eq'),
    value: z.union([z.object({ memberId: uuidSchema }), recordRefInputSchema]),
  }),
  /** A member of the team takes part. */
  z.object({
    field: z.literal('participants-teams'),
    mode: filterMode,
    operator: z.literal('contains'),
    value: z.object({ teamId: uuidSchema }),
  }),
  z.object({
    field: z.literal('status'),
    mode: filterMode,
    operator: z.literal('eq'),
    value: callRecordingStatusSchema,
  }),
  z.object({
    field: z.literal('meeting-start-at'),
    mode: filterMode,
    operator: z.enum(['lt', 'lte', 'gt', 'gte']),
    value: timestampSchema,
  }),
]);
export type CallListFilter = z.input<typeof callListFilterSchema>;

export const listCallsInputSchema = z.object({
  filters: z.array(callListFilterSchema).max(50).default([]),
  /** `?query=`: meeting title or transcript text (case-insensitive substring). */
  query: z.string().max(500).optional(),
  sort: z
    .object({ field: z.literal('meeting-start-at'), direction: z.enum(['asc', 'desc']) })
    .default({ field: 'meeting-start-at', direction: 'desc' }),
  groupBy: z.enum(['meeting-date', 'none']).default('meeting-date'),
  /** IANA zone of the date groups (default: the member's preference, else UTC). */
  timeZone: z.string().max(100).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(500).default(100),
  /** Favourites strip: the member's favourite calls (only without filters and query). */
  includeFavorites: z.boolean().default(false),
  acceptAfter: acceptAfterSchema,
});
export type ListCallsInput = z.input<typeof listCallsInputSchema>;

export const listCallsOutputSchema = z.object({
  items: z.array(callListItemSchema),
  /** Non-empty date groups over the whole result, in display order (Group by Date). */
  groups: z.array(z.object({ key: z.enum(createdBuckets), count: z.number().int() })),
  total: z.number().int(),
  nextCursor: z.string().nullable(),
  /** Favourite calls in favourites order; null unless requested and no filter / query is active. */
  favorites: z.array(callListItemSchema).nullable(),
});
export type ListCallsOutput = z.infer<typeof listCallsOutputSchema>;

export const insightSectionResultSchema = z.object({
  sectionId: uuidSchema,
  title: z.string(),
  type: z.enum(['plaintext', 'list']),
  /** plaintext sections; '' = nothing relevant mentioned. */
  content: z.string().nullable(),
  /** list sections, in order. */
  items: z.array(z.string()),
});
export type InsightSectionResult = z.infer<typeof insightSectionResultSchema>;

export const callInsightSchema = z.object({
  id: uuidSchema,
  recordingId: uuidSchema,
  meetingId: uuidSchema,
  templateId: uuidSchema,
  snapshotId: uuidSchema,
  status: callJobStatusSchema,
  sections: z.array(insightSectionResultSchema),
  error: z.string().nullable(),
  creditCost: z.number().int(),
  /** The template has published a newer version since ("A new version of this template is available"). */
  isOutdated: z.boolean(),
  createdBy: actorSchema,
  createdAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
});
export type CallInsight = z.infer<typeof callInsightSchema>;

export const callDetailSchema = callListItemSchema.extend({
  meeting: meetingSchema,
  summary: z.string().nullable(),
  processingError: z.string().nullable(),
  processedAt: timestampSchema.nullable(),
  videoUrl: z.string().nullable(),
  segmentCount: z.number().int(),
  transcriptDurationSeconds: z.number(),
  speakers: z.array(callSpeakerSchema),
  /** Newest first. */
  insights: z.array(callInsightSchema),
  /** The viewer's default insight template (pre-selected on the call page). */
  defaultInsightTemplateId: uuidSchema.nullable(),
});
export type CallDetail = z.infer<typeof callDetailSchema>;

export const callIdInputSchema = z.object({ recordingId: uuidSchema, acceptAfter: acceptAfterSchema });
export const callsByMeetingsInputSchema = z.object({
  meetingIds: z.array(uuidSchema).min(1).max(200),
  acceptAfter: acceptAfterSchema,
});

export const generateCallInsightInputSchema = z.object({
  recordingId: uuidSchema,
  templateId: uuidSchema,
  /** Client-minted id of the new insight (idempotent). */
  insightId: uuidSchema.optional(),
});
export type GenerateCallInsightInput = z.input<typeof generateCallInsightInputSchema>;

export const callSettingsSchema = z.object({
  memberId: uuidSchema,
  defaultInsightTemplateId: uuidSchema.nullable(),
});
export type CallSettings = z.infer<typeof callSettingsSchema>;
export const updateCallSettingsInputSchema = z.object({ defaultInsightTemplateId: uuidSchema.nullable() });
export type UpdateCallSettingsInput = z.input<typeof updateCallSettingsInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Insight templates

export const insightSectionTypeSchema = z.enum(['plaintext', 'list']);
export type InsightSectionType = z.infer<typeof insightSectionTypeSchema>;
export const insightTemplateStatusSchema = z.enum(['draft', 'enabled', 'disabled']);

export const insightTemplateSectionSchema = z.object({
  id: uuidSchema,
  snapshotId: uuidSchema,
  type: insightSectionTypeSchema,
  sortOrder: z.string(),
  /** Rich-text documents (doc type `insight-section`) edited collaboratively. */
  titleDocumentId: uuidSchema,
  promptDocumentId: uuidSchema,
  /** Plaintext projections of the two documents. */
  title: z.string(),
  prompt: z.string(),
});
export type InsightTemplateSection = z.infer<typeof insightTemplateSectionSchema>;

export const insightTemplateSnapshotSchema = z.object({
  id: uuidSchema,
  templateId: uuidSchema,
  parentSnapshotId: uuidSchema.nullable(),
  status: z.enum(['draft', 'active', 'superseded', 'discarded']),
  firstTouchedAt: timestampSchema.nullable(),
  lastTouchedAt: timestampSchema.nullable(),
  publishedAt: timestampSchema.nullable(),
  publishedBy: actorSchema.nullable(),
  createdAt: timestampSchema,
  sections: z.array(insightTemplateSectionSchema),
});
export type InsightTemplateSnapshot = z.infer<typeof insightTemplateSnapshotSchema>;

export const insightTemplateSchema = z.object({
  id: uuidSchema,
  title: z.string().nullable(),
  aiTitle: z.string().nullable(),
  status: insightTemplateStatusSchema,
  isTransient: z.boolean(),
  isArchived: z.boolean(),
  sortOrder: z.string(),
  firstEnabledAt: timestampSchema.nullable(),
  /** Sections of the active (else draft) version. */
  sectionCount: z.number().int(),
  lastPublishedAt: timestampSchema.nullable(),
  activeSnapshotId: uuidSchema.nullable(),
  draftSnapshotId: uuidSchema.nullable(),
  /** "Publish template" (first version) vs "Publish changes". */
  isFirstVersion: z.boolean(),
  /** Publish is enabled (draft touched, or first version). */
  canPublish: z.boolean(),
  /** "Discard changes" is shown (draft has a parent and was touched). */
  hasUnpublishedChanges: z.boolean(),
  totalInsights: z.number().int(),
  /** Templates that have been used cannot be deleted. */
  canDelete: z.boolean(),
  createdBy: actorSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type InsightTemplate = z.infer<typeof insightTemplateSchema>;

export const insightTemplatePreviewSchema = z.object({
  id: uuidSchema,
  templateId: uuidSchema,
  snapshotId: uuidSchema,
  recordingId: uuidSchema,
  meetingId: uuidSchema,
  status: callJobStatusSchema,
  sections: z.array(insightSectionResultSchema),
  error: z.string().nullable(),
  creditCost: z.number().int(),
  /** The draft changed after the preview was requested (Refresh icon). */
  isStale: z.boolean(),
  createdAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
});
export type InsightTemplatePreview = z.infer<typeof insightTemplatePreviewSchema>;

export const insightTemplateDetailSchema = insightTemplateSchema.extend({
  draft: insightTemplateSnapshotSchema.nullable(),
  active: insightTemplateSnapshotSchema.nullable(),
  /** Newest first (at most 20). */
  previews: z.array(insightTemplatePreviewSchema),
});
export type InsightTemplateDetail = z.infer<typeof insightTemplateDetailSchema>;

export const insightPresetCategories = [
  'general',
  'sales',
  'success',
  'product',
  'marketing',
  'recruiting',
  'fundraising',
  'investing',
] as const;
export const insightPresetSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  categories: z.array(z.enum(insightPresetCategories)),
  sections: z.array(z.object({ title: z.string(), type: insightSectionTypeSchema, prompt: z.string() })),
});
export type InsightPreset = z.infer<typeof insightPresetSchema>;

export const listInsightTemplatesInputSchema = z
  .object({
    /** Picker / default-template select: published, not archived templates only. */
    enabledOnly: z.boolean().default(false),
    acceptAfter: acceptAfterSchema,
  })
  .default({ enabledOnly: false });
export type ListInsightTemplatesInput = z.input<typeof listInsightTemplatesInputSchema>;

export const insightTemplateIdInputSchema = z.object({ templateId: uuidSchema, acceptAfter: acceptAfterSchema });

export const createInsightTemplateInputSchema = z.object({
  id: uuidSchema,
  /** Defaults to after the last template. */
  sortOrder: rankSchema.optional(),
  title: z.string().max(200).nullable().optional(),
  /** Start from one of our presets ("Start with a template"). */
  presetId: z.string().max(100).optional(),
});
export type CreateInsightTemplateInput = z.input<typeof createInsightTemplateInputSchema>;

export const updateInsightTemplateInputSchema = z.object({
  templateId: uuidSchema,
  /** Trimmed; '' → null. */
  title: z.string().max(200).nullable().optional(),
  sortOrder: rankSchema.optional(),
  /** Archive (true) / restore (false). */
  archived: z.boolean().optional(),
});
export type UpdateInsightTemplateInput = z.input<typeof updateInsightTemplateInputSchema>;

export const duplicateInsightTemplateInputSchema = z.object({ templateId: uuidSchema, newTemplateId: uuidSchema });
export const applyInsightPresetInputSchema = z.object({ templateId: uuidSchema, presetId: z.string().max(100) });
export type ApplyInsightPresetInput = z.input<typeof applyInsightPresetInputSchema>;

export const previewInsightTemplateInputSchema = z.object({
  templateId: uuidSchema,
  previewId: uuidSchema,
  recordingId: uuidSchema,
});
export type PreviewInsightTemplateInput = z.input<typeof previewInsightTemplateInputSchema>;

/** Section title / prompt as plain text or Markdown (API and tests; the editor writes the documents live). */
const sectionText = z.string().max(20_000);

export const createInsightSectionInputSchema = z.object({
  templateId: uuidSchema,
  sectionId: uuidSchema,
  type: insightSectionTypeSchema.default('plaintext'),
  /** Defaults to after the last section. */
  sortOrder: rankSchema.optional(),
  title: sectionText.optional(),
  prompt: sectionText.optional(),
});
export type CreateInsightSectionInput = z.input<typeof createInsightSectionInputSchema>;

export const updateInsightSectionInputSchema = z.object({
  sectionId: uuidSchema,
  type: insightSectionTypeSchema.optional(),
  sortOrder: rankSchema.optional(),
  title: sectionText.optional(),
  prompt: sectionText.optional(),
});
export type UpdateInsightSectionInput = z.input<typeof updateInsightSectionInputSchema>;

export const insightSectionIdInputSchema = z.object({ sectionId: uuidSchema });
export const duplicateInsightSectionInputSchema = z.object({ sectionId: uuidSchema, newSectionId: uuidSchema });
export const moveInsightSectionInputSchema = z.object({ sectionId: uuidSchema, direction: z.enum(['up', 'down']) });
