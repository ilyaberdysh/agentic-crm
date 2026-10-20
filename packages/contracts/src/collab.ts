// Notes, note templates, tasks and comments (BACKLOG 3.12, 3.14–3.16; specs E README §2–4; decisions B.10, X-09,
// X-10 in research/architecture/decisions/slice3-contracts.md). Note and template bodies are documents (Yjs, owned by
// apps/collab); these contracts carry the headers plus read-only content projections (markdown / blocks / plaintext).
// Comments and task bodies are plain text with positioned mentions.
import { z } from 'zod';
import { acceptAfterSchema, actorSchema, dateSchema, idOrSlugSchema, timestampSchema, uuidSchema } from './common.ts';

// ---------------------------------------------------------------------------------------------------------------
// Shared pieces

/** A record (or list entry) addressed by its definition (id or api_slug in inputs) and instance id. */
export const recordRefInputSchema = z.object({ entityDefinitionId: idOrSlugSchema, entityInstanceId: uuidSchema });
export type RecordRefInput = z.input<typeof recordRefInputSchema>;
export const recordRefSchema = z.object({ entityDefinitionId: uuidSchema, entityInstanceId: uuidSchema });
export type RecordRef = z.infer<typeof recordRefSchema>;

/** A mention occupying `text.slice(start, start + length)` ("@Name"). */
export const mentionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('workspace-member'),
    start: z.number().int().min(0),
    length: z.number().int().min(1),
    memberId: uuidSchema,
  }),
  z.object({
    kind: z.literal('record'),
    start: z.number().int().min(0),
    length: z.number().int().min(1),
    entityDefinitionId: uuidSchema,
    entityInstanceId: uuidSchema,
  }),
]);
export type Mention = z.infer<typeof mentionSchema>;

/** Inline styles of comments (E README §3.5: Link, Bold, Italic only). */
export const textStyleSchema = z.object({
  start: z.number().int().min(0),
  length: z.number().int().min(1),
  style: z.enum(['bold', 'italic', 'link']),
  href: z.url().max(2048).optional(),
});
export type TextStyle = z.infer<typeof textStyleSchema>;

const withinText = (v: { text: string; mentions?: { start: number; length: number }[] }) =>
  (v.mentions ?? []).every((m) => m.start + m.length <= v.text.length);

/** Plain text with positioned mentions (task bodies). */
export const plainTextContentSchema = z
  .object({ text: z.string().max(2000), mentions: z.array(mentionSchema).max(200).default([]) })
  .refine(withinText, { message: 'A mention lies outside the text', path: ['mentions'] });
export type PlainTextContent = z.infer<typeof plainTextContentSchema>;

/** Comment body: plain text, mentions and B/I/link styles. */
export const commentContentSchema = z
  .object({
    text: z.string().max(20_000),
    mentions: z.array(mentionSchema).max(200).default([]),
    styles: z.array(textStyleSchema).max(500).default([]),
  })
  .refine(withinText, { message: 'A mention lies outside the text', path: ['mentions'] })
  .refine((v) => v.styles.every((s) => s.start + s.length <= v.text.length), {
    message: 'A style lies outside the text',
    path: ['styles'],
  })
  .refine((v) => v.styles.every((s) => (s.style === 'link') === (s.href !== undefined)), {
    message: 'Links need an href (and only links)',
    path: ['styles'],
  });
export type CommentContent = z.infer<typeof commentContentSchema>;

/** Read-only projection of a document body (blocks / markdown written by apps/collab; null until first stored). */
export const documentContentSchema = z.object({
  markdown: z.string().nullable(),
  plaintext: z.string().nullable(),
  /** Flat block list (editor.md §6); shape owned by packages/editor. */
  blocks: z.array(z.unknown()).nullable(),
  updatedAt: timestampSchema.nullable(),
});
export type DocumentContent = z.infer<typeof documentContentSchema>;

const favoriteFields = {
  /** The caller's favorite of this item, if any (favorites are personal). */
  favoriteId: uuidSchema.nullable(),
};

// ---------------------------------------------------------------------------------------------------------------
// Notes (E README §2.1–2.3, §3.1, §4.1)

export const noteSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  title: z.string(),
  documentId: uuidSchema,
  meetingId: uuidSchema.nullable(),
  /** Parent records in order; the first is the primary parent (breadcrumb, public `parent_record_id`). */
  parentRecords: z.array(recordRefSchema),
  createdBy: actorSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  ...favoriteFields,
  /** Present unless the read asked for headers only. */
  content: documentContentSchema.optional(),
});
export type Note = z.infer<typeof noteSchema>;

export const createNoteInputSchema = z.object({
  /** Client-minted UUIDv7 (I3); a replay returns the stored note. */
  id: uuidSchema,
  title: z.string().max(1000).default(''),
  parentRecords: z.array(recordRefInputSchema).min(1).max(20),
  meetingId: uuidSchema.nullable().optional(),
  /** Start from a template: its header title becomes the title (unless given) and its body is copied. */
  templateId: uuidSchema.optional(),
});
export type CreateNoteInput = z.input<typeof createNoteInputSchema>;

export const updateNoteInputSchema = z.object({
  noteId: uuidSchema,
  title: z.string().max(1000).optional(),
  meetingId: uuidSchema.nullable().optional(),
  /** Full replacement of the parent records (at least one). */
  parentRecords: z.array(recordRefInputSchema).min(1).max(20).optional(),
});
export type UpdateNoteInput = z.input<typeof updateNoteInputSchema>;

export const noteIdInputSchema = z.object({ noteId: uuidSchema, acceptAfter: acceptAfterSchema });
export type NoteIdInput = z.input<typeof noteIdInputSchema>;

export const batchGetNotesInputSchema = z.object({
  noteIds: z.array(uuidSchema).min(1).max(200),
  includeContent: z.boolean().default(true),
  acceptAfter: acceptAfterSchema,
});
export type BatchGetNotesInput = z.input<typeof batchGetNotesInputSchema>;

/** Notes index and record Notes tab. Date buckets are ranges on createdAt (contracts dates.ts createdBucketRanges). */
export const listNotesInputSchema = z.object({
  record: recordRefInputSchema.optional(),
  createdByMemberId: uuidSchema.optional(),
  /** Inclusive lower bound. */
  createdFrom: timestampSchema.optional(),
  /** Exclusive upper bound. */
  createdTo: timestampSchema.optional(),
  favoritesOnly: z.boolean().default(false),
  sort: z.enum(['created_at:desc', 'created_at:asc']).default('created_at:desc'),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
  includeContent: z.boolean().default(true),
  acceptAfter: acceptAfterSchema,
});
export type ListNotesInput = z.input<typeof listNotesInputSchema>;
export const listNotesOutputSchema = z.object({ notes: z.array(noteSchema), total: z.number().int() });
export type ListNotesOutput = z.infer<typeof listNotesOutputSchema>;

export const applyNoteTemplateInputSchema = z.object({ noteId: uuidSchema, templateId: uuidSchema });
export type ApplyNoteTemplateInput = z.input<typeof applyNoteTemplateInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Note templates (E README §2.4–2.5, §3.2, §4.2)

export const noteTemplateSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  title: z.string(),
  /** Title given to notes created from the template. */
  headerTitle: z.string(),
  documentId: uuidSchema,
  createdBy: actorSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  ...favoriteFields,
  content: documentContentSchema.optional(),
});
export type NoteTemplate = z.infer<typeof noteTemplateSchema>;

export const applyNoteTemplateOutputSchema = z.object({
  note: noteSchema,
  /** The template body for the editor to insert into the note's Yjs document (E README §3.2 "Use a template"). */
  template: noteTemplateSchema,
  /** True when the server copied the body itself (the note's document had never been stored). */
  bodyCopied: z.boolean(),
});
export type ApplyNoteTemplateOutput = z.infer<typeof applyNoteTemplateOutputSchema>;

export const createNoteTemplateInputSchema = z.object({
  id: uuidSchema,
  title: z.string().max(1000).default(''),
  headerTitle: z.string().max(1000).optional(),
});
export type CreateNoteTemplateInput = z.input<typeof createNoteTemplateInputSchema>;

/** Attio sets title and header title together; an omitted headerTitle follows the title. */
export const updateNoteTemplateInputSchema = z.object({
  templateId: uuidSchema,
  title: z.string().max(1000).optional(),
  headerTitle: z.string().max(1000).optional(),
});
export type UpdateNoteTemplateInput = z.input<typeof updateNoteTemplateInputSchema>;

export const noteTemplateIdInputSchema = z.object({ templateId: uuidSchema, acceptAfter: acceptAfterSchema });
export type NoteTemplateIdInput = z.input<typeof noteTemplateIdInputSchema>;

export const listNoteTemplatesInputSchema = z.object({
  search: z.string().max(200).optional(),
  favoritesOnly: z.boolean().default(false),
  sort: z.enum(['created_at:desc', 'created_at:asc']).default('created_at:desc'),
  limit: z.number().int().min(1).max(500).default(200),
  includeContent: z.boolean().default(true),
  acceptAfter: acceptAfterSchema,
});
export type ListNoteTemplatesInput = z.input<typeof listNoteTemplatesInputSchema>;

/** "Create template from note": header title = the note's title, body copied server-side (new document). */
export const createTemplateFromNoteInputSchema = z.object({ id: uuidSchema, noteId: uuidSchema });
export type CreateTemplateFromNoteInput = z.input<typeof createTemplateFromNoteInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Tasks (E README §2.6–2.7b, §3.3, §4.3; decision X-09)

/**
 * Deadline input (X-09): a date without a time is stored as the end of that day (23:59:59.999) in `timeZone` (the
 * creator's) with deadlineHasTime=false; a typed time is stored as given with deadlineHasTime=true.
 */
export const deadlineInputSchema = z.union([
  z.null(),
  z.object({ kind: z.literal('date'), date: dateSchema, timeZone: z.string().min(1).max(64) }),
  z.object({ kind: z.literal('datetime'), at: timestampSchema }),
]);
export type DeadlineInput = z.input<typeof deadlineInputSchema>;

export const taskSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  content: plainTextContentSchema,
  deadlineAt: timestampSchema.nullable(),
  deadlineHasTime: z.boolean(),
  isCompleted: z.boolean(),
  completedAt: timestampSchema.nullable(),
  completedBy: actorSchema.nullable(),
  /** Workspace member ids in display order. */
  assigneeMemberIds: z.array(uuidSchema),
  linkedRecords: z.array(recordRefSchema),
  createdBy: actorSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Task = z.infer<typeof taskSchema>;

const taskText = plainTextContentSchema.refine((c) => c.text.trim().length > 0, {
  message: 'A task needs a title',
  path: ['text'],
});

export const createTaskInputSchema = z.object({
  id: uuidSchema,
  content: taskText,
  deadline: deadlineInputSchema.default(null),
  assigneeMemberIds: z.array(uuidSchema).max(100).default([]),
  /** Record mentions in the content are linked too (E README §2.7 "Smart parsing"). */
  linkedRecords: z.array(recordRefInputSchema).max(100).default([]),
  isCompleted: z.boolean().default(false),
});
export type CreateTaskInput = z.input<typeof createTaskInputSchema>;

/** Edit dialog save: every given field replaces the stored one. */
export const updateTaskInputSchema = z.object({
  taskId: uuidSchema,
  content: taskText.optional(),
  deadline: deadlineInputSchema.optional(),
  assigneeMemberIds: z.array(uuidSchema).max(100).optional(),
  linkedRecords: z.array(recordRefInputSchema).max(100).optional(),
  isCompleted: z.boolean().optional(),
});
export type UpdateTaskInput = z.input<typeof updateTaskInputSchema>;

export const setTaskCompletedInputSchema = z.object({ taskId: uuidSchema, completed: z.boolean() });
export type SetTaskCompletedInput = z.input<typeof setTaskCompletedInputSchema>;
export const bulkSetTasksCompletedInputSchema = z.object({
  taskIds: z.array(uuidSchema).min(1).max(1000),
  completed: z.boolean(),
});
export type BulkSetTasksCompletedInput = z.input<typeof bulkSetTasksCompletedInputSchema>;
export const taskIdInputSchema = z.object({ taskId: uuidSchema, acceptAfter: acceptAfterSchema });
export type TaskIdInput = z.input<typeof taskIdInputSchema>;
export const taskIdsInputSchema = z.object({ taskIds: z.array(uuidSchema).min(1).max(1000) });
export type TaskIdsInput = z.input<typeof taskIdsInputSchema>;
export const batchGetTasksInputSchema = z.object({
  taskIds: z.array(uuidSchema).min(1).max(1000),
  acceptAfter: acceptAfterSchema,
});
export type BatchGetTasksInput = z.input<typeof batchGetTasksInputSchema>;

const isOrNot = z.enum(['is', 'is-not']);
export const taskFilterSchema = z.object({
  /** Assignee is / is not one of these members. */
  assignees: z.object({ operator: isOrNot, memberIds: z.array(uuidSchema).min(1).max(100) }).optional(),
  /** Linked record is / is not one of these records. */
  records: z.object({ operator: isOrNot, records: z.array(recordRefInputSchema).min(1).max(100) }).optional(),
  createdByMemberIds: z.array(uuidSchema).min(1).max(100).optional(),
  isCompleted: z.boolean().optional(),
  /** Only tasks without assignees. */
  unassigned: z.boolean().optional(),
});
export type TaskFilter = z.input<typeof taskFilterSchema>;

export const taskGroupBySchema = z.enum(['deadline', 'assignee', 'created-at', 'created-by', 'none']);
export type TaskGroupBy = z.infer<typeof taskGroupBySchema>;

/** Tasks page and record Tasks tab (E README §2.6). Buckets are computed in the viewer's zone and week start. */
export const listTasksInputSchema = z.object({
  timeZone: z.string().min(1).max(64).default('UTC'),
  /** 0 = Sunday … 6 = Saturday; default: the member's preference, else Monday. */
  weekStartDay: z.number().int().min(0).max(6).optional(),
  groupBy: taskGroupBySchema.default('deadline'),
  sort: z
    .object({
      field: z.enum(['deadline', 'assignee', 'created-at']),
      direction: z.enum(['asc', 'desc']),
    })
    .default({ field: 'deadline', direction: 'asc' }),
  showCompleted: z.boolean().default(true),
  filter: taskFilterSchema.default({}),
  limit: z.number().int().min(1).max(5000).default(2000),
  /** Clock override for tests and previews. */
  now: timestampSchema.optional(),
  acceptAfter: acceptAfterSchema,
});
export type ListTasksInput = z.input<typeof listTasksInputSchema>;

export const taskGroupSchema = z.object({
  /** deadline: overdue|today|this-week|later|no-date|completed; assignee/created-by: member id or 'none';
   * created-at: today|this-week|…|older; none: 'all'. */
  key: z.string(),
  memberId: uuidSchema.nullable(),
  tasks: z.array(taskSchema),
});
export type TaskGroup = z.infer<typeof taskGroupSchema>;
export const listTasksOutputSchema = z.object({
  groups: z.array(taskGroupSchema),
  total: z.number().int(),
  /** Bucket boundaries used (ISO): start/end of today and end of the week in the viewer's zone. */
  bounds: z.object({ startOfToday: timestampSchema, endOfToday: timestampSchema, endOfWeek: timestampSchema }),
});
export type ListTasksOutput = z.infer<typeof listTasksOutputSchema>;

/** Sidebar badge: incomplete tasks assigned to the member with a deadline ≤ end of today (E README §2.6). */
export const countDueTasksInputSchema = z.object({
  timeZone: z.string().min(1).max(64).default('UTC'),
  memberId: uuidSchema.optional(),
  now: timestampSchema.optional(),
  acceptAfter: acceptAfterSchema,
});
export type CountDueTasksInput = z.input<typeof countDueTasksInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Comments (E README §2.8, §3.5, §4.4)

export const commentTargetKindSchema = z.enum(['record', 'list-entry']);
/** A record (object id/slug + record id) or a list entry (list definition id + entry id). */
export const commentTargetInputSchema = z.object({
  kind: commentTargetKindSchema,
  entityDefinitionId: idOrSlugSchema,
  entityInstanceId: uuidSchema,
});
export type CommentTargetInput = z.input<typeof commentTargetInputSchema>;
export const commentTargetSchema = z.object({
  kind: commentTargetKindSchema,
  entityDefinitionId: uuidSchema,
  entityInstanceId: uuidSchema,
});
export type CommentTarget = z.infer<typeof commentTargetSchema>;

export const reactionGroupSchema = z.object({
  emoji: z.string(),
  count: z.number().int(),
  /** Reactors in reaction order. */
  memberIds: z.array(uuidSchema),
  /** The caller's own reaction with this emoji (clicking the chip removes it). */
  myReactionId: uuidSchema.nullable(),
});
export type ReactionGroup = z.infer<typeof reactionGroupSchema>;

export const commentSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  threadId: uuidSchema,
  isThreadRoot: z.boolean(),
  target: commentTargetSchema,
  content: commentContentSchema,
  author: actorSchema,
  createdBy: actorSchema,
  /** "(via API)": written by an API token, or on behalf of the author. */
  viaApi: z.boolean(),
  createdAt: timestampSchema,
  resolvedAt: timestampSchema.nullable(),
  resolvedBy: actorSchema.nullable(),
  reactions: z.array(reactionGroupSchema),
});
export type Comment = z.infer<typeof commentSchema>;

export const threadSummarySchema = z.object({
  threadId: uuidSchema,
  root: commentSchema,
  replyCount: z.number().int(),
  /** Distinct members who replied, most recent first (card facepile). */
  replierMemberIds: z.array(uuidSchema),
  lastReplyAt: timestampSchema.nullable(),
});
export type ThreadSummary = z.infer<typeof threadSummarySchema>;

export const threadSchema = z.object({
  threadId: uuidSchema,
  root: commentSchema,
  /** Replies, oldest first. */
  replies: z.array(commentSchema),
});
export type Thread = z.infer<typeof threadSchema>;

/** A top-level comment (`target`) or a reply (`threadId` = the thread root's id). */
export const createCommentInputSchema = z
  .object({
    id: uuidSchema,
    content: commentContentSchema.refine((c) => c.text.trim().length > 0, {
      message: 'A comment cannot be empty',
      path: ['text'],
    }),
    target: commentTargetInputSchema.optional(),
    threadId: uuidSchema.optional(),
  })
  .refine((v) => (v.target === undefined) !== (v.threadId === undefined), {
    message: 'Give either a target (new thread) or a threadId (reply)',
  });
export type CreateCommentInput = z.input<typeof createCommentInputSchema>;

export const resolveCommentInputSchema = z.object({ commentId: uuidSchema, resolved: z.boolean() });
export type ResolveCommentInput = z.input<typeof resolveCommentInputSchema>;
export const commentIdInputSchema = z.object({ commentId: uuidSchema, acceptAfter: acceptAfterSchema });
export type CommentIdInput = z.input<typeof commentIdInputSchema>;

/** One emoji character sequence (any Unicode emoji, incl. ZWJ sequences and skin tones). */
export const emojiSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}‍️⃣#*0-9])+$/u, {
    message: 'Not an emoji',
  })
  .refine((s) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s), { message: 'Not an emoji' });

export const addReactionInputSchema = z.object({ commentId: uuidSchema, reactionId: uuidSchema, emoji: emojiSchema });
export type AddReactionInput = z.input<typeof addReactionInputSchema>;
export const removeReactionInputSchema = z.object({ commentId: uuidSchema, reactionId: uuidSchema });
export type RemoveReactionInput = z.input<typeof removeReactionInputSchema>;

/**
 * Threads of a record or entry (`target`), or of every record of an object (`entityDefinitionId`: the object-level
 * "All comments" panel), newest first.
 */
export const listThreadsInputSchema = z
  .object({
    target: commentTargetInputSchema.optional(),
    entityDefinitionId: idOrSlugSchema.optional(),
    /**
     * With `entityDefinitionId`: only threads on the rows of this snapshot (list Comments panel = comments on the
     * entries of the current view, C2 README §2.4).
     */
    snapshotId: uuidSchema.optional(),
    includeResolved: z.boolean().default(false),
    onlyMine: z.boolean().default(false),
    limit: z.number().int().min(1).max(500).default(200),
    offset: z.number().int().min(0).default(0),
    acceptAfter: acceptAfterSchema,
  })
  .refine((v) => (v.target === undefined) !== (v.entityDefinitionId === undefined), {
    message: 'Give either a target or an entityDefinitionId',
  });
export type ListThreadsInput = z.input<typeof listThreadsInputSchema>;
export const listThreadsOutputSchema = z.object({ threads: z.array(threadSummarySchema), total: z.number().int() });
export type ListThreadsOutput = z.infer<typeof listThreadsOutputSchema>;

export const threadIdInputSchema = z.object({ threadId: uuidSchema, acceptAfter: acceptAfterSchema });
export type ThreadIdInput = z.input<typeof threadIdInputSchema>;

/** Deep link `/comment/$commentHeaderId` (B README §2.7): where the comment lives. */
export const commentLocationSchema = z.object({
  commentId: uuidSchema,
  threadId: uuidSchema,
  target: commentTargetSchema,
  /** For list entries: the entry's parent record, when known. */
  parentRecord: recordRefSchema.nullable(),
  isResolved: z.boolean(),
});
export type CommentLocation = z.infer<typeof commentLocationSchema>;

/** Thread counts per record (table-row dots, header comment count). */
export const commentCountsInputSchema = z.object({
  entityDefinitionId: idOrSlugSchema,
  entityInstanceIds: z.array(uuidSchema).min(1).max(1000),
  acceptAfter: acceptAfterSchema,
});
export type CommentCountsInput = z.input<typeof commentCountsInputSchema>;
export const commentCountsOutputSchema = z.object({
  counts: z.record(
    z.string(),
    z.object({ threads: z.number().int(), unresolvedThreads: z.number().int(), comments: z.number().int() }),
  ),
});
export type CommentCountsOutput = z.infer<typeof commentCountsOutputSchema>;
