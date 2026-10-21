// AI layer (slice 10, S10-ASK): Ask Agentic threads and turns, tool parts and approvals, the SSE stream, models,
// settings, prompts library, credits and the AI record summary (BACKLOG 10.01–10.04, 10.07, 10.16; I ask-agentic.md,
// Camel-case representations of AI attribute values.
//
// Procedures:
//   ai.threads.list/get/create/delete/rename        ai.turns.send/approve/deny/retry/cancel/feedback/suggestions
//   ai.webSearch.allow({threadId, always?})         ai.models.list   ai.settings.get/update   ai.workspaceSettings.*
//   prompts.list/get/create/update/delete/share/save/unsave/curated
//   credits.usage({period})   credits.ledger({cursor})   records.summary.get/regenerate({recordRef})
// Streaming: GET /ai/threads/:threadId/stream?turnId=… (SSE, aiStreamEventSchema per `data:` line) for the tab that
// sent the turn; room `thread:<workspaceId>:<threadId>` carries the same events as ephemeral payloads
// `{kind:'ai-stream', event}` for other tabs; the persisted turn follows as an `ai-turn` invalidation.
import { z } from 'zod';
import { acceptAfterSchema, timestampSchema, uuidSchema } from './common.ts';

// ---------------------------------------------------------------------------------------------------------------
// Models

export const aiModelSchema = z.object({
  /** Model id sent with turns (`model`); "auto" is not a model (it resolves to the workspace's Ask model). */
  id: z.string(),
  label: z.string(),
  brand: z.enum(['anthropic', 'openai', 'openai-compatible']),
  /** The model "Auto" resolves to. */
  isAuto: z.boolean(),
  isUnavailable: z.boolean(),
});
export type AiModel = z.infer<typeof aiModelSchema>;
export const aiModelsOutputSchema = z.object({ configured: z.boolean(), models: z.array(aiModelSchema) });
export type AiModelsOutput = z.infer<typeof aiModelsOutputSchema>;
/** "auto" or a model id. */
export const aiModelChoiceSchema = z.string().min(1).max(64);

/** Version-pinned saved target IDs share the existing model picker and turn model field. */
export function aiTargetModelChoice(targetId: string, version: number): string {
  return `target:${targetId.toLowerCase()}:${version}`;
}

export function parseAiTargetModelChoice(
  choice: string | null | undefined,
): { targetId: string; expectedVersion: number } | null {
  const match = /^target:([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}):([1-9]\d*)$/i.exec(choice ?? '');
  if (!match || !Number.isSafeInteger(Number(match[2]))) return null;
  return { targetId: match[1]!.toLowerCase(), expectedVersion: Number(match[2]) };
}

// ---------------------------------------------------------------------------------------------------------------
// Threads

export const aiThreadSchema = z.object({
  id: uuidSchema,
  /** User-set title (rename); the UI shows `title ?? aiTitle ?? "Untitled chat"`. */
  title: z.string().nullable(),
  aiTitle: z.string().nullable(),
  createdByMemberId: uuidSchema,
  /** Web search allowed for every pending and future search in this thread ("Allow" once per thread). */
  webSearchAllowed: z.boolean(),
  /** Σ credit cost of the thread's assistant turns ("Chat usage"). */
  creditCost: z.number().int(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type AiThread = z.infer<typeof aiThreadSchema>;

export const listAiThreadsInputSchema = z
  .object({
    query: z.string().max(200).optional(),
    sort: z.enum(['updated', 'created']).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    acceptAfter: acceptAfterSchema,
  })
  .optional();
export type ListAiThreadsInput = z.infer<typeof listAiThreadsInputSchema>;

export const aiThreadIdInputSchema = z.object({ threadId: uuidSchema, acceptAfter: acceptAfterSchema });
export type AiThreadIdInput = z.infer<typeof aiThreadIdInputSchema>;
/** Client-minted id (idempotent create; I3). */
export const createAiThreadInputSchema = z.object({ threadId: uuidSchema.optional() });
export type CreateAiThreadInput = z.infer<typeof createAiThreadInputSchema>;
export const renameAiThreadInputSchema = z.object({ threadId: uuidSchema, title: z.string().max(200).nullable() });
export type RenameAiThreadInput = z.infer<typeof renameAiThreadInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Turns: user parts (text with mention annotations, page-context interests) and assistant steps / parts

const recordRefSchema = z.object({ entityDefinitionId: uuidSchema, entityInstanceId: uuidSchema });
export type AiRecordRef = z.infer<typeof recordRefSchema>;

/** Composer mention annotations on the text part (ask-agentic §2, §10). */
export const aiAnnotationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('entity-instance'),
    start: z.number().int().min(0),
    length: z.number().int().min(0),
    entityDefinitionId: uuidSchema,
    entityInstanceId: uuidSchema,
  }),
  z.object({
    type: z.literal('entity-definition'),
    start: z.number().int().min(0),
    length: z.number().int().min(0),
    entityDefinitionId: uuidSchema,
  }),
  z.object({
    type: z.literal('workspace-member'),
    start: z.number().int().min(0),
    length: z.number().int().min(0),
    memberId: uuidSchema,
  }),
  /** A prompt chip (custom prompt id or curated prompt slug); its body is sent to the model. */
  z.object({
    type: z.literal('prompt'),
    start: z.number().int().min(0),
    length: z.number().int().min(0),
    promptId: z.string().min(1).max(64),
  }),
]);
export type AiAnnotation = z.infer<typeof aiAnnotationSchema>;

/**
 * Page context of the turn ("interests", ask-agentic-internals §7.2): records (record page, ⌘J), a call (call page;
 * with a transcript selection in seconds), a meeting, a list. The composer shows the high-prominence one as a chip.
 */
export const aiContextSchema = z.object({
  records: z.array(recordRefSchema).max(10).optional(),
  call: z
    .object({
      meetingId: uuidSchema,
      callRecordingId: uuidSchema,
      startTime: z.number().min(0).optional(),
      endTime: z.number().min(0).optional(),
    })
    .optional(),
  meeting: z.object({ meetingId: uuidSchema }).optional(),
  listId: uuidSchema.optional(),
});
export type AiContext = z.infer<typeof aiContextSchema>;

export const aiUserPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), content: z.string(), annotations: z.array(aiAnnotationSchema) }),
  z.object({
    type: z.literal('interest'),
    interestType: z.enum([
      'entity-instance',
      'call-recording',
      'call-recording-transcript-selection',
      'meeting',
      'list',
    ]),
    params: z.record(z.string(), z.unknown()),
    prominence: z.enum(['high', 'low']),
  }),
]);
export type AiUserPart = z.infer<typeof aiUserPartSchema>;

export const aiToolStatuses = [
  'awaiting-approval',
  'awaiting-execution',
  'executing',
  'completed',
  'failed',
  'canceled',
] as const;
export type AiToolStatus = (typeof aiToolStatuses)[number];

/** Generation status of a part (text / tool input still streaming, or done). */
export const aiPartStatusSchema = z.enum(['streaming', 'completed', 'failed', 'canceled']);

export const aiAssistantPartSchema = z.discriminatedUnion('type', [
  /** Model reasoning ("Thinking"); content is never exposed. */
  z.object({
    id: z.string(),
    type: z.literal('reasoning'),
    status: aiPartStatusSchema,
    startedAt: timestampSchema,
    completedAt: timestampSchema.nullable(),
  }),
  /**
   * Markdown with record links `[label](agentic-crm://entity-instance:{entityDefinitionId}/{entityInstanceId})` and
   * fenced component blocks: ```` ```agentic-crm:entity-embed {"entity_definition_id","entity_instance_id"} ````,
   * `agentic-crm:task-embed {"task_id"}`, `agentic-crm:note-embed {"note_id"}`, `agentic-crm:meeting-embed {"meeting_id"}`,
   * `agentic-crm:call-recording-snippets {"meeting_id","call_recording_id","snippets":[{title,start_time,end_time}]}`.
   */
  z.object({ id: z.string(), type: z.literal('text'), status: aiPartStatusSchema, content: z.string() }),
  z.object({
    id: z.string(),
    type: z.literal('tool'),
    status: aiPartStatusSchema,
    /** Provider tool_use id; approve / deny name it. */
    toolCallId: z.string(),
    /** Tool identifier (e.g. `search-records`, `create-task`; AI_TOOL_LABELS). */
    tool: z.string(),
    /** Parsed input (null while streaming or unparseable); `inputRaw` is the raw JSON so far. */
    input: z.unknown().nullable(),
    inputRaw: z.string(),
    /** The user's edits from the approval card (the input actually executed). */
    inputAmendment: z.unknown().nullable(),
    toolStatus: z.enum(aiToolStatuses).nullable(),
    requiresApproval: z.boolean(),
    /** Small digest for the row ("4 found", ids for avatars, the created task id…). */
    outputDigest: z.record(z.string(), z.unknown()).nullable(),
    error: z.string().nullable(),
  }),
]);
export type AiAssistantPart = z.infer<typeof aiAssistantPartSchema>;
export type AiToolPart = Extract<AiAssistantPart, { type: 'tool' }>;

export const aiStepSchema = z.object({
  id: uuidSchema,
  index: z.number().int(),
  status: z.enum(['executing-llm', 'executing-tools', 'completed', 'canceled', 'failed']),
  parts: z.array(aiAssistantPartSchema),
  createdAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
});
export type AiStep = z.infer<typeof aiStepSchema>;

export const aiRefinementSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('custom'), instruction: z.string().min(1).max(2000) }),
  z.object({ type: z.literal('add-detail') }),
  z.object({ type: z.literal('make-concise') }),
]);
export type AiRefinement = z.infer<typeof aiRefinementSchema>;

export const aiFeedbackSchema = z.object({
  type: z.enum(['positive', 'negative']),
  issueType: z
    .enum([
      'didnt-follow-request',
      'incorrect',
      'incomplete',
      'didnt-use-context',
      'missing-sources',
      'parsing-error',
      'poorly-formatted',
      'other',
    ])
    .nullable()
    .optional(),
  reason: z.string().max(4000).nullable().optional(),
});
export type AiFeedback = z.infer<typeof aiFeedbackSchema>;

export const aiTurnStatusSchema = z.enum(['executing', 'completed', 'canceled', 'failed']);
export type AiTurnStatus = z.infer<typeof aiTurnStatusSchema>;

export const aiTurnSchema = z.object({
  id: uuidSchema,
  threadId: uuidSchema,
  /** null only for the root user turn; a user turn's parent is the assistant turn it replies to (tree, §2.3). */
  parentTurnId: uuidSchema.nullable(),
  role: z.enum(['user', 'assistant']),
  /** User turns. */
  parts: z.array(aiUserPartSchema),
  // Assistant turns (users turns carry status "completed" and empty steps).
  status: aiTurnStatusSchema,
  model: z.string().nullable(),
  modelMode: z.enum(['auto', 'manual']).nullable(),
  refinement: aiRefinementSchema.nullable(),
  steps: z.array(aiStepSchema),
  /** Tool calls waiting for the approval card (tool part ids are in the steps). */
  pendingApprovals: z.array(z.string()),
  creditCost: z.number().int().nullable(),
  contextTokens: z.number().int().nullable(),
  /** "provider-refused-request" | "credits-exhausted" | "interrupted" | "error". */
  failureReason: z.string().nullable(),
  feedback: aiFeedbackSchema.nullable(),
  createdByMemberId: uuidSchema,
  createdAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
  canceledAt: timestampSchema.nullable(),
  failedAt: timestampSchema.nullable(),
});
export type AiTurn = z.infer<typeof aiTurnSchema>;

export const aiThreadDetailSchema = z.object({ thread: aiThreadSchema, turns: z.array(aiTurnSchema) });
export type AiThreadDetail = z.infer<typeof aiThreadDetailSchema>;

export const sendAiTurnInputSchema = z.object({
  threadId: uuidSchema,
  /** Client-minted ids of the user and assistant turns (idempotent send). */
  userTurnId: uuidSchema.optional(),
  turnId: uuidSchema.optional(),
  content: z.string().min(1).max(50_000),
  annotations: z.array(aiAnnotationSchema).max(100).optional(),
  context: aiContextSchema.optional(),
  /** "auto" (default) or a model id from ai.models.list. */
  model: aiModelChoiceSchema.optional(),
  /** The assistant turn replied to; default = the thread's latest turn. Sending interrupts a running parent. */
  parentTurnId: uuidSchema.optional(),
  source: z.enum(['composer', 'suggestion', 'reply-suggestion']).optional(),
  /** IANA zone of the browser (dates in the prompt). */
  timeZone: z.string().max(64).optional(),
});
export type SendAiTurnInput = z.infer<typeof sendAiTurnInputSchema>;
export const sendAiTurnOutputSchema = z.object({
  threadId: uuidSchema,
  userTurnId: uuidSchema,
  /** The assistant turn; stream it with GET /ai/threads/:threadId/stream?turnId=… */
  turnId: uuidSchema,
});
export type SendAiTurnOutput = z.infer<typeof sendAiTurnOutputSchema>;

export const approveAiToolInputSchema = z.object({
  turnId: uuidSchema,
  toolCallId: z.string().min(1).max(128),
  /** The approval card's edited input (replaces the model's input; validated against the tool's schema). */
  input: z.unknown().optional(),
});
export type ApproveAiToolInput = z.infer<typeof approveAiToolInputSchema>;
export const denyAiToolInputSchema = z.object({
  turnId: uuidSchema,
  toolCallId: z.string().min(1).max(128),
  reason: z.string().max(2000).nullable().optional(),
});
export type DenyAiToolInput = z.infer<typeof denyAiToolInputSchema>;
export const retryAiTurnInputSchema = z.object({
  turnId: uuidSchema,
  /** Client-minted id of the new assistant turn. */
  newTurnId: uuidSchema.optional(),
  model: aiModelChoiceSchema.optional(),
  refinement: aiRefinementSchema.optional(),
});
export type RetryAiTurnInput = z.infer<typeof retryAiTurnInputSchema>;
export const aiTurnIdInputSchema = z.object({ turnId: uuidSchema, acceptAfter: acceptAfterSchema });
export type AiTurnIdInput = z.infer<typeof aiTurnIdInputSchema>;
export const aiTurnFeedbackInputSchema = z.object({ turnId: uuidSchema, feedback: aiFeedbackSchema.nullable() });
export type AiTurnFeedbackInput = z.infer<typeof aiTurnFeedbackInputSchema>;
export const aiReplySuggestionsSchema = z.object({ turnId: uuidSchema, suggestions: z.array(z.string()) });
export type AiReplySuggestions = z.infer<typeof aiReplySuggestionsSchema>;
export const allowWebSearchInputSchema = z.object({
  threadId: uuidSchema,
  /** "Always allow": the member setting becomes auto-approve. */
  always: z.boolean().optional(),
});
export type AllowWebSearchInput = z.infer<typeof allowWebSearchInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Stream events (SSE `data:` JSON; room ephemeral payload `{kind:'ai-stream', event}`)

export const aiStreamEventSchema = z.discriminatedUnion('type', [
  /** The whole assistant turn: first event of a stream, then on every step / status / tool status change. */
  z.object({ type: z.literal('turn'), seq: z.number().int(), turn: aiTurnSchema }),
  /** One part's cumulative snapshot (text so far, tool input so far); replace the part when `seq` is newer. */
  z.object({
    type: z.literal('part'),
    seq: z.number().int(),
    turnId: uuidSchema,
    stepId: uuidSchema,
    partIndex: z.number().int(),
    part: aiAssistantPartSchema,
  }),
  /**
   * The stream ends: the turn completed / failed / was canceled, or paused for approval ("awaiting-approval": open a
   * new stream after approve / deny).
   */
  z.object({
    type: z.literal('done'),
    seq: z.number().int(),
    turnId: uuidSchema,
    status: z.enum(['completed', 'canceled', 'failed', 'awaiting-approval']),
  }),
]);
export type AiStreamEvent = z.infer<typeof aiStreamEventSchema>;
/** Room for other tabs / viewers of a thread (I4b ephemeral). */
export const aiThreadRoom = (workspaceId: string, threadId: string) => `thread:${workspaceId}:${threadId}`;
/**
 * SSE URL of a turn for the web app (the /api prefix is proxied by Vite; the API also serves /ai/…). Send the
 * session cookie and `x-workspace-slug` (fetch streaming), or `&workspace=<slug>` (EventSource).
 */
export const aiStreamPath = (threadId: string, turnId: string) => `/api/ai/threads/${threadId}/stream?turnId=${turnId}`;

// ---------------------------------------------------------------------------------------------------------------
// Tool catalogue (labels for the rows; ask-agentic-internals §4.1, §4.4)

export const AI_TOOL_LABELS: Record<string, { running: string; done: string; denied?: string; write: boolean }> = {
  'search-records': { running: 'Searching records', done: 'Records searched', write: false },
  'list-records': { running: 'Querying records', done: 'Records queried', write: false },
  'get-records': { running: 'Retrieving records', done: 'Records retrieved', write: false },
  'list-attributes': { running: 'Retrieving attributes', done: 'Attributes retrieved', write: false },
  'list-lists': { running: 'Retrieving lists', done: 'Lists retrieved', write: false },
  'list-list-entries': { running: 'Retrieving list entries', done: 'List entries retrieved', write: false },
  'list-tasks': { running: 'Searching tasks', done: 'Tasks searched', write: false },
  'list-notes': { running: 'Searching notes', done: 'Notes searched', write: false },
  'get-notes': { running: 'Reading notes', done: 'Notes read', write: false },
  'list-workspace-members': { running: 'Listing members', done: 'Members listed', write: false },
  'search-meetings': { running: 'Searching meetings', done: 'Meetings searched', write: false },
  'get-meeting': { running: 'Retrieving meeting', done: 'Meeting retrieved', write: false },
  'get-call-recording': {
    running: 'Reading call recording transcript',
    done: 'Call recording transcript read',
    write: false,
  },
  'search-emails': { running: 'Searching emails', done: 'Emails searched', write: false },
  'get-emails': { running: 'Reading email', done: 'Email read', write: false },
  'search-web': { running: 'Searching web', done: 'Web searched', denied: 'Web search denied', write: false },
  'create-record': { running: 'Creating record', done: 'Record created', denied: 'Record discarded', write: true },
  'update-record': {
    running: 'Updating record',
    done: 'Record updated',
    denied: 'Record update discarded',
    write: true,
  },
  'create-task': { running: 'Creating task', done: 'Task created', denied: 'Task suggestion discarded', write: true },
  'update-task': { running: 'Updating task', done: 'Task updated', denied: 'Task update discarded', write: true },
  'create-note': { running: 'Creating note', done: 'Note created', denied: 'Note discarded', write: true },
};

// ---------------------------------------------------------------------------------------------------------------
// Settings (Personal › Ask Agentic; Workspace › Ask Agentic; personal context in Profile)

export const webSearchPermissionSchema = z.enum(['always-ask', 'auto-approve', 'disabled']);
export type WebSearchPermission = z.infer<typeof webSearchPermissionSchema>;

export const aiMemberSettingsSchema = z.object({
  memberId: uuidSchema,
  /** Web search: Always ask / Allow / Don't allow. */
  allowWebSearch: webSearchPermissionSchema,
  /** Share downvoted messages: Always ask / Always share / Don't share. */
  shareThreadFeedback: webSearchPermissionSchema,
  /** null = Auto. */
  defaultModel: z.string().nullable(),
  /** Personal context (≤ 20,000 chars). */
  customContext: z.string().nullable(),
});
export type AiMemberSettings = z.infer<typeof aiMemberSettingsSchema>;
export const updateAiMemberSettingsInputSchema = z.object({
  allowWebSearch: webSearchPermissionSchema.optional(),
  shareThreadFeedback: webSearchPermissionSchema.optional(),
  defaultModel: z.string().max(64).nullable().optional(),
  customContext: z.string().max(20_000).nullable().optional(),
});
export type UpdateAiMemberSettingsInput = z.infer<typeof updateAiMemberSettingsInputSchema>;

export const aiWorkspaceSettingsSchema = z.object({
  /** Workspace context (≤ 20,000 chars). */
  customContext: z.string().nullable(),
  /** "Set a limit": workspace credits members may use for Ask Agentic per month (null = no extra limit). */
  askWorkspaceCreditsLimit: z.number().int().min(0).nullable(),
  /** Model per tier (null = default): ask (Auto), bulk (summaries, AI attributes, workflows), fast (titles). */
  models: z.object({ ask: z.string().nullable(), bulk: z.string().nullable(), fast: z.string().nullable() }),
});
export type AiWorkspaceSettings = z.infer<typeof aiWorkspaceSettingsSchema>;
export const updateAiWorkspaceSettingsInputSchema = z.object({
  customContext: z.string().max(20_000).nullable().optional(),
  askWorkspaceCreditsLimit: z.number().int().min(0).max(100_000_000).nullable().optional(),
  models: z
    .object({
      ask: z.string().max(64).nullable().optional(),
      bulk: z.string().max(64).nullable().optional(),
      fast: z.string().max(64).nullable().optional(),
    })
    .optional(),
});
export type UpdateAiWorkspaceSettingsInput = z.infer<typeof updateAiWorkspaceSettingsInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Prompts library (custom + curated; ask-agentic §2.2–2.3, §11.2; internals §7.5)

export const aiPromptTargets = [
  'call-recording',
  'call-recording-list',
  'entity-instance',
  'entity-instance-list',
  'meeting',
  'meeting-list',
  'note',
  'note-list',
  'task',
  'task-list',
  'email',
  'email-list',
] as const;
export const promptAccessLevels = ['full-access', 'read-write', 'read-only', 'no-access'] as const;
export const promptAccessLevelSchema = z.enum(promptAccessLevels);
export type PromptAccessLevel = z.infer<typeof promptAccessLevelSchema>;
export const promptCategories = ['sales', 'success', 'product', 'marketing'] as const;

export const aiPromptSchema = z.object({
  id: z.string(),
  kind: z.enum(['custom', 'curated']),
  /** Display: `title ?? aiTitle ?? "Untitled prompt"`. */
  title: z.string().nullable(),
  aiTitle: z.string().nullable(),
  summary: z.string().nullable(),
  /** Markdown body (Context / Task / Constraints for curated prompts). */
  prompt: z.string(),
  iconId: z.string().nullable(),
  iconColor: z.string().nullable(),
  targets: z.array(z.enum(aiPromptTargets)),
  categories: z.array(z.enum(promptCategories)),
  defaultModel: z.string().nullable(),
  /** Curated: saved to "My prompts"; custom: always true for the creator. */
  saved: z.boolean(),
  /** Curated prompts: how many members of the workspace saved it. */
  savedCount: z.number().int(),
  createdByMemberId: uuidSchema.nullable(),
  /** The caller's access ("Shared with me" when not the creator). */
  access: promptAccessLevelSchema,
  createdAt: timestampSchema.nullable(),
});
export type AiPrompt = z.infer<typeof aiPromptSchema>;

export const listPromptsInputSchema = z
  .object({
    /** mine = own + saved curated (Insert prompt menu, Settings › Prompts); shared = shared with me; curated = gallery. */
    scope: z.enum(['mine', 'shared', 'curated', 'all']).optional(),
    query: z.string().max(200).optional(),
    category: z.enum(promptCategories).optional(),
    acceptAfter: acceptAfterSchema,
  })
  .optional();
export type ListPromptsInput = z.infer<typeof listPromptsInputSchema>;
export const promptIdInputSchema = z.object({ promptId: z.string().min(1).max(64), acceptAfter: acceptAfterSchema });
export type PromptIdInput = z.infer<typeof promptIdInputSchema>;
export const createPromptInputSchema = z.discriminatedUnion('mode', [
  /** "Advanced": the body as written. */
  z.object({
    mode: z.literal('manual'),
    id: uuidSchema.optional(),
    title: z.string().max(200).nullable().optional(),
    prompt: z.string().min(1, 'Prompt is required').max(20_000),
    iconId: z.string().max(64).nullable().optional(),
    iconColor: z.string().max(32).nullable().optional(),
    defaultModel: z.string().max(64).nullable().optional(),
  }),
  /** "Generate": an AI-written prompt from a description. */
  z.object({ mode: z.literal('generate'), id: uuidSchema.optional(), description: z.string().min(1).max(4000) }),
  /** "Customize" a curated prompt: a custom copy. */
  z.object({ mode: z.literal('customize'), id: uuidSchema.optional(), curatedPromptId: z.string().min(1).max(64) }),
]);
export type CreatePromptInput = z.infer<typeof createPromptInputSchema>;
export const updatePromptInputSchema = z.object({
  promptId: uuidSchema,
  title: z.string().max(200).nullable().optional(),
  prompt: z.string().min(1).max(20_000).optional(),
  iconId: z.string().max(64).nullable().optional(),
  iconColor: z.string().max(32).nullable().optional(),
  defaultModel: z.string().max(64).nullable().optional(),
});
export type UpdatePromptInput = z.infer<typeof updatePromptInputSchema>;
export const sharePromptInputSchema = z.object({
  promptId: uuidSchema,
  /** "Workspace access" level (default read-only). */
  workspaceAccess: promptAccessLevelSchema.optional(),
  /** Per-member levels; "no-access" removes the member entry. */
  members: z
    .array(z.object({ memberId: uuidSchema, access: promptAccessLevelSchema }))
    .max(200)
    .optional(),
});
export type SharePromptInput = z.infer<typeof sharePromptInputSchema>;
export const promptSharingSchema = z.object({
  promptId: uuidSchema,
  workspaceAccess: promptAccessLevelSchema,
  members: z.array(z.object({ memberId: uuidSchema, access: promptAccessLevelSchema })),
});
export type PromptSharing = z.infer<typeof promptSharingSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Credits (usage counters and ledger; ask-agentic §11, internals §7.6, workspace-admin §10)

export const creditPeriodSchema = z.enum(['current', 'previous']);
export const creditsUsageInputSchema = z
  .object({ period: creditPeriodSchema.optional(), acceptAfter: acceptAfterSchema })
  .optional();
export type CreditsUsageInput = z.infer<typeof creditsUsageInputSchema>;

export const creditsUsageSchema = z.object({
  period: z.object({ start: timestampSchema, end: timestampSchema }),
  /** The caller's seat credits (null limit = unlimited). */
  member: z.object({
    used: z.number().int(),
    limit: z.number().int().nullable(),
    /** The caller's Ask Agentic use paid by the workspace pool after the seat credits ran out. */
    workspaceUsed: z.number().int(),
  }),
  workspace: z.object({
    /** Every workspace-pool spend: workflows, AI attributes, call processing, members over their seat credits. */
    used: z.number().int(),
    limit: z.number().int().nullable(),
    /** Members' Ask Agentic use of the pool, and the admin's limit on it. */
    askUsed: z.number().int(),
    askLimit: z.number().int().nullable(),
    /** "{n} used by other sources". */
    otherSourcesUsed: z.number().int(),
  }),
  bySource: z.array(z.object({ source: z.string(), credits: z.number().int() })),
  /** The caller cannot start Ask Agentic turns until the period resets. */
  outOfCredits: z.boolean(),
  /** Admins: one row per member with spend ("Members using Ask Agentic", "Members reached personal limit"). */
  members: z
    .array(
      z.object({
        memberId: uuidSchema,
        seatUsed: z.number().int(),
        workspaceUsed: z.number().int(),
        limitReached: z.boolean(),
      }),
    )
    .nullable(),
});
export type CreditsUsage = z.infer<typeof creditsUsageSchema>;

export const creditsLedgerInputSchema = z
  .object({
    cursor: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    /** Admins may read every member's rows; others always get their own. */
    memberId: uuidSchema.optional(),
    acceptAfter: acceptAfterSchema,
  })
  .optional();
export type CreditsLedgerInput = z.infer<typeof creditsLedgerInputSchema>;
export const creditLedgerEntrySchema = z.object({
  id: uuidSchema,
  /** ask-turn, record-summary, ai-attribute, call-summary, call-insight, formula, prompt-generate,
   * workflow-block-execution … */
  source: z.string(),
  pool: z.enum(['member', 'workspace']),
  credits: z.number().int(),
  memberId: uuidSchema.nullable(),
  model: z.string().nullable(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  refType: z.string().nullable(),
  refId: z.string().nullable(),
  createdAt: timestampSchema,
});
export type CreditLedgerEntry = z.infer<typeof creditLedgerEntrySchema>;
export const creditsLedgerOutputSchema = z.object({
  entries: z.array(creditLedgerEntrySchema),
  nextCursor: z.string().nullable(),
});
export type CreditsLedgerOutput = z.infer<typeof creditsLedgerOutputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// AI record summary (D README §2.5 item 4)

export const recordSummaryInputSchema = z.object({
  recordRef: z.object({ entityDefinitionId: z.string().min(1).max(128), entityInstanceId: uuidSchema }),
  acceptAfter: acceptAfterSchema,
});
export type RecordSummaryInput = z.infer<typeof recordSummaryInputSchema>;
export const recordSummarySchema = z.object({
  entityDefinitionId: uuidSchema,
  entityInstanceId: uuidSchema,
  /** null until generated ("Generate"). */
  summary: z
    .object({
      text: z.string(),
      model: z.string(),
      generatedAt: timestampSchema,
      creditCost: z.number().int(),
      /** The record changed after generation: the card offers Regenerate. */
      stale: z.boolean(),
    })
    .nullable(),
});
export type RecordSummary = z.infer<typeof recordSummarySchema>;
