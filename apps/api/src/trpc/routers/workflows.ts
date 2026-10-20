// Workflows (slice 8; BACKLOG 8.01–8.11; G README, internal-api, runs; procedure names per slice8-9-contracts.md).
// Thin adapters over domain.workflows. Mutations answer the canonical state plus `seq`; the editor autosaves every
// change (one mutation per edit), all to the draft version. Run state is refreshed on 'workflow-run' invalidations.
import {
  connectBlocksInputSchema,
  createWorkflowInputSchema,
  deleteBlockInputSchema,
  discardDraftInputSchema,
  disconnectBlocksInputSchema,
  duplicateWorkflowInputSchema,
  getWorkflowInputSchema,
  listRunsInputSchema,
  listWorkflowsInputSchema,
  manualTriggerInputSchema,
  organizeBlocksInputSchema,
  publishWorkflowInputSchema,
  putBlockInputSchema,
  rerunInputSchema,
  restoreVersionInputSchema,
  retryRunInputSchema,
  runIdInputSchema,
  timestampSchema,
  updateWorkflowInputSchema,
  updateWorkflowSettingsInputSchema,
  usageInputSchema,
  variablesInputSchema,
  workflowIdInputSchema,
} from '@agentic-crm/contracts';
import { z } from 'zod';
import { acceptAfterInput, acceptAfterOnly, withSeq } from '../mutation';
import { router, workspaceProcedure } from '../trpc';

export const workflowsRouter = router({
  /** Index (non-transient workflows the caller can read; `admin` = Workspace settings → Workflows). */
  list: workspaceProcedure
    .input(listWorkflowsInputSchema.extend(acceptAfterInput))
    .query(({ ctx, input }) => ctx.domain.workflows.list(ctx.service, input)),

  /** Header + a version (default: the draft) with blocks (config, typed outcomes, issues), paths and checklist. */
  get: workspaceProcedure
    .input(getWorkflowInputSchema.extend(acceptAfterInput))
    .query(({ ctx, input }) => ctx.domain.workflows.get(ctx.service, input)),

  /** "New workflow": a transient draft (client-minted id); hidden from the index until its first edit. */
  create: workspaceProcedure.input(createWorkflowInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.workflows.create(svc, input));
    return { workflow: result, seq };
  }),

  /** Title, description, archive, timezone, cycle warning. */
  update: workspaceProcedure.input(updateWorkflowInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.workflows.update(svc, input));
    return { workflow: result, seq };
  }),

  /** Discard a transient workflow / delete one that never ran (409 when live or already run). */
  delete: workspaceProcedure.input(workflowIdInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.workflows.delete(svc, input));
    return { ...result, seq };
  }),

  /** Commit the draft into an immutable version and make it live (400 WORKFLOW_INVALID with the checklist). */
  publish: workspaceProcedure.input(publishWorkflowInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.workflows.publish(svc, input));
    return { ...result, seq };
  }),

  enable: workspaceProcedure.input(workflowIdInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.workflows.enable(svc, input));
    return { workflow: result, seq };
  }),

  disable: workspaceProcedure.input(workflowIdInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.workflows.disable(svc, input));
    return { workflow: result, seq };
  }),

  /** "Discard changes": a new draft forked from the latest published version. */
  discardDraft: workspaceProcedure.input(discardDraftInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.workflows.discardDraft(svc, input));
    return { ...result, seq };
  }),

  /** Version history: current draft first, then published versions newest first. */
  versions: workspaceProcedure
    .input(workflowIdInputSchema.extend(acceptAfterInput))
    .query(({ ctx, input }) => ctx.domain.workflows.versions(ctx.service, input)),

  /** "Restore this version": forks the version into a new draft. */
  restoreVersion: workspaceProcedure.input(restoreVersionInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.workflows.restoreVersion(svc, input));
    return { ...result, seq };
  }),

  duplicate: workspaceProcedure.input(duplicateWorkflowInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.workflows.duplicate(svc, input));
    return { workflow: result, seq };
  }),

  /** Checklist of the draft: issues per block and publish blockers. */
  validate: workspaceProcedure
    .input(workflowIdInputSchema.extend(acceptAfterInput))
    .query(({ ctx, input }) => ctx.domain.workflows.validate(ctx.service, input)),

  settings: router({
    /** Settings tab: workflow timezone, "Get notified when this workflow fails" (for the caller). */
    update: workspaceProcedure.input(updateWorkflowSettingsInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.workflows.settings.update(svc, input));
      return { workflow: result, seq };
    }),
  }),

  blocks: router({
    /** Create / update / replace a block of the draft (whole config each time). */
    put: workspaceProcedure.input(putBlockInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.workflows.blocks.put(svc, input));
      return { ...result, seq };
    }),
    delete: workspaceProcedure.input(deleteBlockInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.workflows.blocks.delete(svc, input));
      return { ...result, seq };
    }),
    /** A path from a source block's outcome to a target block. */
    connect: workspaceProcedure.input(connectBlocksInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.workflows.blocks.connect(svc, input));
      return { ...result, seq };
    }),
    disconnect: workspaceProcedure.input(disconnectBlocksInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.workflows.blocks.disconnect(svc, input));
      return { ...result, seq };
    }),
    /** Organize blocks (no positions) or batch moves; answers `previous` for Undo. */
    organize: workspaceProcedure.input(organizeBlocksInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.workflows.blocks.organize(svc, input));
      return { ...result, seq };
    }),
  }),

  /** Variable picker of a block: upstream blocks (nearest first) with typed outputs + attribute lists. */
  variables: workspaceProcedure
    .input(variablesInputSchema.extend(acceptAfterInput))
    .query(({ ctx, input }) => ctx.domain.workflows.variables(ctx.service, input)),

  runs: router({
    /** Run history (newest first, cursor = sequence number) + the last-7-days overview. */
    list: workspaceProcedure
      .input(listRunsInputSchema.extend(acceptAfterInput))
      .query(({ ctx, input }) => ctx.domain.workflows.runs.list(ctx.service, input)),
    /** Run viewer: run, frames (attempts, loop iterations), block executions, taken paths. */
    get: workspaceProcedure
      .input(runIdInputSchema.extend(acceptAfterInput))
      .query(({ ctx, input }) => ctx.domain.workflows.runs.get(ctx.service, input)),
    /** Retry from a failed block (or from the trigger execution = retry from start). */
    retry: workspaceProcedure.input(retryRunInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.workflows.runs.retry(svc, input));
      return { run: result, seq };
    }),
    /** Rerun (new attempt from the trigger) or, with `live`, retry with the live workflow (a new linked run). */
    rerun: workspaceProcedure.input(rerunInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.workflows.runs.rerun(svc, input));
      return { run: result, seq };
    }),
    cancel: workspaceProcedure.input(runIdInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.workflows.runs.cancel(svc, input));
      return { run: result, seq };
    }),
  }),

  trigger: router({
    /** Trigger workflow / Run workflow: manual run, record action (recordRefs), list entry action, note action. */
    manual: workspaceProcedure.input(manualTriggerInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.workflows.trigger.manual(svc, input));
      return { ...result, seq };
    }),
  }),

  /** Trigger and step definitions: inputs, outcomes, credit cost, availability. */
  catalog: workspaceProcedure.input(acceptAfterOnly).query(({ ctx }) => ctx.domain.workflows.catalog()),

  /** Credits usage over a period (default: this month), per day and per workflow. */
  usage: workspaceProcedure
    .input(usageInputSchema.extend(acceptAfterInput))
    .query(({ ctx, input }) => ctx.domain.workflows.usage(ctx.service, input)),

  /** Broadcast messages and celebrations sent to the caller (fetched on 'workflow-broadcast' invalidations). */
  broadcasts: workspaceProcedure
    .input(z.object({ since: timestampSchema.optional(), ...acceptAfterInput }))
    .query(({ ctx, input }) =>
      ctx.domain.workflows.broadcasts(ctx.service, input.since !== undefined ? { since: input.since } : {}),
    ),
});
