// Ask Agentic (BACKLOG 10.01–10.04, 10.07; slice10-contracts procedure names): threads, turns (send / approve / deny /
// retry / cancel / feedback / suggestions), web search permission, models, personal and workspace settings, plus the
// prompts library, credits and AI record summaries. Thin adapters over domain.ai / prompts / credits /
// recordSummaries (I5). A sent turn streams over SSE (GET /ai/threads/:threadId/stream?turnId=…, apps/api/src/ai)
// and as ephemeral messages in the room `thread:<workspaceId>:<threadId>`; the persisted turn follows as an
// `ai-turn` invalidation.
import {
  aiThreadIdInputSchema,
  aiTurnFeedbackInputSchema,
  aiTurnIdInputSchema,
  allowWebSearchInputSchema,
  approveAiToolInputSchema,
  createAiThreadInputSchema,
  createPromptInputSchema,
  creditsLedgerInputSchema,
  creditsUsageInputSchema,
  denyAiToolInputSchema,
  listAiThreadsInputSchema,
  listPromptsInputSchema,
  promptIdInputSchema,
  recordSummaryInputSchema,
  renameAiThreadInputSchema,
  retryAiTurnInputSchema,
  sendAiTurnInputSchema,
  sharePromptInputSchema,
  updateAiMemberSettingsInputSchema,
  updateAiWorkspaceSettingsInputSchema,
  updatePromptInputSchema,
} from '@agentic-crm/contracts';
import { acceptAfterOnly, withSeq } from '../mutation';
import { adminProcedure, router, workspaceProcedure } from '../trpc';

export const aiRouter = router({
  threads: router({
    /** The caller's chats (sidebar Chats, View history): newest updated first; `query` searches titles. */
    list: workspaceProcedure
      .input(listAiThreadsInputSchema)
      .query(({ ctx, input }) => ctx.domain.ai.threads.list(ctx.service, input)),
    /** `{thread, turns}`: every turn of the tree (user and assistant) with steps and parts. */
    get: workspaceProcedure
      .input(aiThreadIdInputSchema)
      .query(({ ctx, input }) => ctx.domain.ai.threads.get(ctx.service, input.threadId)),
    /** An empty thread with a client-minted id (idempotent). `turns.send` also creates it when missing. */
    create: workspaceProcedure.input(createAiThreadInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.ai.threads.create(svc, input));
      return { thread: result, seq };
    }),
    rename: workspaceProcedure.input(renameAiThreadInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.ai.threads.rename(svc, input));
      return { thread: result, seq };
    }),
    delete: workspaceProcedure.input(aiThreadIdInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.ai.threads.delete(svc, input.threadId));
      return { ...result, seq };
    }),
  }),

  turns: router({
    /**
     * `{threadId, userTurnId, turnId}`: the user turn and an executing assistant turn. Stream the answer with
     * GET /ai/threads/:threadId/stream?turnId=… (402 CREDITS_EXHAUSTED when out of credits).
     */
    send: workspaceProcedure.input(sendAiTurnInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.ai.turns.send(svc, input));
      return { ...result, seq };
    }),
    get: workspaceProcedure
      .input(aiTurnIdInputSchema)
      .query(({ ctx, input }) => ctx.domain.ai.turns.get(ctx.service, input.turnId)),
    /** Approval card "Create ⌘↵": `input` = the edited tool input. Resumes the turn (stream it again). */
    approve: workspaceProcedure.input(approveAiToolInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.ai.turns.approve(svc, input));
      return { turn: result, seq };
    }),
    /** "Discard" / "Deny": when nothing else is pending the turn ends (or continues with the other results). */
    deny: workspaceProcedure.input(denyAiToolInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.ai.turns.deny(svc, input));
      return { turn: result, seq };
    }),
    /** "Try again" (optionally another model or a refinement): a new sibling assistant turn. */
    retry: workspaceProcedure.input(retryAiTurnInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.ai.turns.retry(svc, input));
      return { ...result, seq };
    }),
    /** Stop: cancels a running (or waiting) answer. */
    cancel: workspaceProcedure.input(aiTurnIdInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.ai.turns.cancel(svc, input.turnId));
      return { turn: result, seq };
    }),
    feedback: workspaceProcedure.input(aiTurnFeedbackInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.ai.turns.feedback(svc, input));
      return { turn: result, seq };
    }),
    /** Up to 3 reply suggestions under a completed answer (generated once). */
    suggestions: workspaceProcedure
      .input(aiTurnIdInputSchema)
      .query(({ ctx, input }) => ctx.domain.ai.turns.suggestions(ctx.service, input.turnId)),
  }),

  webSearch: router({
    /** Web search permission card: "Allow" (this thread) / "Always allow" (`always`: member setting). */
    allow: workspaceProcedure.input(allowWebSearchInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.ai.webSearch.allow(svc, input));
      return { thread: result, seq };
    }),
  }),

  /** Model picker: `{configured, models[{id, label, brand, isAuto, isUnavailable}]}`. */
  models: router({
    list: workspaceProcedure.input(acceptAfterOnly).query(({ ctx }) => ctx.domain.ai.models.list(ctx.service)),
  }),

  /** Personal › Ask Agentic (and Profile › personal context). */
  settings: router({
    get: workspaceProcedure.input(acceptAfterOnly).query(({ ctx }) => ctx.domain.ai.settings.get(ctx.service)),
    update: workspaceProcedure.input(updateAiMemberSettingsInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.ai.settings.update(svc, input));
      return { settings: result, seq };
    }),
  }),

  /** Workspace › Ask Agentic: custom context, the Ask Agentic credit limit, model overrides (admins change them). */
  workspaceSettings: router({
    get: workspaceProcedure.input(acceptAfterOnly).query(({ ctx }) => ctx.domain.ai.workspaceSettings.get(ctx.service)),
    update: adminProcedure.input(updateAiWorkspaceSettingsInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.ai.workspaceSettings.update(svc, input));
      return { settings: result, seq };
    }),
  }),
});

export const promptsRouter = router({
  /** scope mine (default: own + saved curated), shared (shared with me), curated (gallery), all. */
  list: workspaceProcedure
    .input(listPromptsInputSchema)
    .query(({ ctx, input }) => ctx.domain.prompts.list(ctx.service, input)),
  get: workspaceProcedure
    .input(promptIdInputSchema)
    .query(({ ctx, input }) => ctx.domain.prompts.get(ctx.service, input.promptId)),
  /** mode manual ("Advanced"), generate (AI draft from a description; transient until updated), customize. */
  create: workspaceProcedure.input(createPromptInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.prompts.create(svc, input));
    return { prompt: result, seq };
  }),
  update: workspaceProcedure.input(updatePromptInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.prompts.update(svc, input));
    return { prompt: result, seq };
  }),
  /** Custom prompts: delete (full access); curated ids: remove from "My prompts". */
  delete: workspaceProcedure.input(promptIdInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.prompts.delete(svc, input.promptId));
    return { ...result, seq };
  }),
  /** Share popover: workspace level + member levels; answers the resulting sharing. */
  share: workspaceProcedure.input(sharePromptInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.prompts.share(svc, input));
    return { sharing: result, seq };
  }),
  sharing: workspaceProcedure
    .input(promptIdInputSchema)
    .query(({ ctx, input }) => ctx.domain.prompts.sharing(ctx.service, input.promptId)),
  /** Curated prompts: "Add to my prompts" / "Remove". */
  save: workspaceProcedure.input(promptIdInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.prompts.save(svc, input.promptId));
    return { prompt: result, seq };
  }),
  unsave: workspaceProcedure.input(promptIdInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.prompts.unsave(svc, input.promptId));
    return { ...result, seq };
  }),
});

export const creditsRouter = router({
  /** Usage counters of the period (current / previous): seat, workspace pool, Ask limit, by source, per member. */
  usage: workspaceProcedure
    .input(creditsUsageInputSchema)
    .query(({ ctx, input }) => ctx.domain.credits.usage(ctx.service, input)),
  /** Ledger rows newest first (`nextCursor`); admins see every member and workflow spend. */
  ledger: workspaceProcedure
    .input(creditsLedgerInputSchema)
    .query(({ ctx, input }) => ctx.domain.credits.ledger(ctx.service, input)),
});

/** records.summary.get / regenerate (record page Overview card). */
export const recordSummaryRouter = router({
  get: workspaceProcedure
    .input(recordSummaryInputSchema)
    .query(({ ctx, input }) => ctx.domain.recordSummaries.get(ctx.service, input)),
  regenerate: workspaceProcedure.input(recordSummaryInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.recordSummaries.regenerate(svc, input));
    return { ...result, seq };
  }),
});
