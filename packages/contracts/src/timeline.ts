// Record activity timeline (contract E2 in slice3-contracts.md; specs D README §3.8, A README §4.14, CROSS-DOMAIN
// B.26). Events are derived from attribute value history, the record lifecycle, list entries, notes, tasks, comments
// and files. Past events page backwards (default 100, grouped); upcoming events page forwards (default 3, ungrouped).
import { z } from 'zod';
import { acceptAfterSchema, actorSchema, idOrSlugSchema, timestampSchema, uuidSchema } from './common.ts';
import { attributeValueSchema } from './values.ts';

/** Filter categories (D §3.8 "Visible events") plus comments and files, which Attio returns but does not render. */
export const eventCategories = [
  'calendar',
  'tasks',
  'notes',
  'activity',
  'updates',
  'lists',
  'comments',
  'files',
] as const;
export const eventCategorySchema = z.enum(eventCategories);
export type EventCategory = z.infer<typeof eventCategorySchema>;

export const timelineEventTypes = [
  'entity-instance-created',
  'attribute-values-updated',
  'merged',
  'list-entry-created',
  'list-entry-deleted',
  'list-attribute-values-updated',
  'note-added',
  'task-added',
  'task-upcoming',
  'task-overdue',
  'task-completed',
  'comment-added',
  'file-added',
  'meeting',
] as const;
export const timelineEventTypeSchema = z.enum(timelineEventTypes);
export type TimelineEventType = z.infer<typeof timelineEventTypeSchema>;

/** Category of each event type (D §3.8 table). */
export const EVENT_CATEGORY: Record<TimelineEventType, EventCategory> = {
  'entity-instance-created': 'updates',
  'attribute-values-updated': 'updates',
  merged: 'updates',
  'list-entry-created': 'lists',
  'list-entry-deleted': 'lists',
  'list-attribute-values-updated': 'lists',
  'note-added': 'notes',
  'task-added': 'tasks',
  'task-upcoming': 'tasks',
  'task-overdue': 'tasks',
  'task-completed': 'tasks',
  'comment-added': 'comments',
  'file-added': 'files',
  meeting: 'calendar',
};

/** One attribute of a change event: the values that became active and the values retired at that moment. */
export const attributeChangeSchema = z.object({
  attributeDefinitionId: uuidSchema,
  added: z.array(attributeValueSchema),
  removed: z.array(attributeValueSchema),
});
export type AttributeChange = z.infer<typeof attributeChangeSchema>;

const base = {
  /** Stable key (also the cursor tie-breaker). */
  id: z.string(),
  category: eventCategorySchema,
  occurredAt: timestampSchema,
  actor: actorSchema.nullable(),
  /** Written by an API token, automation or the system (collapsed into "{n} automation events"). */
  isBackground: z.boolean(),
};
const listRef = z.object({ listId: uuidSchema, entryId: uuidSchema });

export const timelineEventSchema = z.discriminatedUnion('eventType', [
  z.object({ ...base, eventType: z.literal('entity-instance-created') }),
  z.object({ ...base, eventType: z.literal('attribute-values-updated'), changes: z.array(attributeChangeSchema) }),
  /** The record was created by merging these records (D §3.10). */
  z.object({ ...base, eventType: z.literal('merged'), mergedFromIds: z.array(uuidSchema) }),
  z.object({ ...base, eventType: z.literal('list-entry-created'), list: listRef }),
  z.object({ ...base, eventType: z.literal('list-entry-deleted'), list: listRef }),
  z.object({
    ...base,
    eventType: z.literal('list-attribute-values-updated'),
    list: listRef,
    changes: z.array(attributeChangeSchema),
  }),
  z.object({ ...base, eventType: z.literal('note-added'), noteId: uuidSchema }),
  z.object({ ...base, eventType: z.literal('task-added'), taskId: uuidSchema }),
  /** occurredAt = the deadline. */
  z.object({ ...base, eventType: z.literal('task-upcoming'), taskId: uuidSchema }),
  z.object({ ...base, eventType: z.literal('task-overdue'), taskId: uuidSchema }),
  z.object({ ...base, eventType: z.literal('task-completed'), taskId: uuidSchema }),
  z.object({ ...base, eventType: z.literal('comment-added'), commentId: uuidSchema, threadId: uuidSchema }),
  z.object({ ...base, eventType: z.literal('file-added'), fileId: uuidSchema }),
  /**
   * A meeting of the record (participants' people / companies, linked records; F README §2.5). occurredAt = the
   * start; past meetings page backwards, upcoming ones forwards. `memberStatus` = the attending member's response
   * ("attended" / "is attending" / "declined"), `actor` = that member when one takes part.
   */
  z.object({
    ...base,
    eventType: z.literal('meeting'),
    meetingId: uuidSchema,
    memberStatus: z.enum(['accepted', 'tentative', 'declined', 'pending']).nullable(),
  }),
]);
export type TimelineEvent = z.infer<typeof timelineEventSchema>;

/** A feed row: one event, or a run of consecutive background events (toggle row "{n} automation events"). */
export const timelineItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('single'), event: timelineEventSchema }),
  z.object({
    kind: z.literal('group'),
    groupType: z.literal('automation'),
    startedAt: timestampSchema,
    endedAt: timestampSchema,
    events: z.array(timelineEventSchema),
  }),
]);
export type TimelineItem = z.infer<typeof timelineItemSchema>;

export const listTimelineInputSchema = z.object({
  entityDefinitionId: idOrSlugSchema,
  entityInstanceId: uuidSchema,
  /** Visible categories (default: all). An empty list returns no events. */
  filters: z.array(eventCategorySchema).optional(),
  /** past: newest first, before `before` (default now); upcoming: soonest first, after `after` (default now). */
  /** Default: 'upcoming' when only `after` is given, else 'past'. */
  mode: z.enum(['past', 'upcoming']).optional(),
  before: z.string().max(200).optional(),
  after: z.string().max(200).optional(),
  /** Default 100 (past) / 3 (upcoming). */
  limit: z.number().int().min(1).max(500).optional(),
  /** No automation groups and no merging of consecutive changes by the same member. */
  disableGrouping: z.boolean().default(false),
  /** Clock override for tests. */
  now: timestampSchema.optional(),
  acceptAfter: acceptAfterSchema,
});
export type ListTimelineInput = z.input<typeof listTimelineInputSchema>;

export const listTimelineOutputSchema = z.object({
  events: z.array(timelineItemSchema),
  /** Cursor for the next older page (past mode), null when there is none. */
  nextBefore: z.string().nullable(),
  /** Cursor for the next later page (upcoming mode), null when there is none. */
  nextAfter: z.string().nullable(),
});
export type ListTimelineOutput = z.infer<typeof listTimelineOutputSchema>;
