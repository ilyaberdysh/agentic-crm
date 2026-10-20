// Slice-8 services wired for createDomain(): workflows (storage, versions, blocks, variables, publish), runs, triggers,
// catalogue, credits usage and the engine entry points the worker calls (process a run, trigger fan-out, minute tick).
// Every method is one workspace transaction (I1) except the engine, which runs one transaction per block.
import {
  BLOCK_CATEGORY_LABELS,
  type BlockDefinition,
  blockCategories,
  type ConnectBlocksInput,
  type CreateWorkflowInput,
  type DeleteBlockInput,
  type DiscardDraftInput,
  type DisconnectBlocksInput,
  type DuplicateWorkflowInput,
  type GetWorkflowInput,
  type ListRunsInput,
  type ListWorkflowsInput,
  type ManualTriggerInput,
  type OrganizeBlocksInput,
  type PublishWorkflowInput,
  type PutBlockInput,
  type RerunInput,
  type RestoreVersionInput,
  type RetryRunInput,
  type RunIdInput,
  STEP_DEFINITIONS,
  TRIGGER_DEFINITIONS,
  type UpdateWorkflowInput,
  type UpdateWorkflowSettingsInput,
  type UsageInput,
  type VariablesInput,
  type WorkflowIdInput,
} from '@agentic-crm/contracts';
import { type Database, sql } from '@agentic-crm/db';
import type { LlmClient } from '../ai/llm.ts';
import type { ServiceContext } from '../context.ts';
import { actingMemberId } from '../context.ts';
import type { JobQueue } from '../jobs/queue.ts';
import { entryOps } from '../lists/entries.ts';
import { registerResourceKind } from '../permissions/service.ts';
import type { Policies } from '../permissions.ts';
import { runAsOwner, runInWorkspace, type Tx } from '../tx.ts';
import { type EngineDeps, fanOutTriggers, processRun, tick, triggerManual, triggerWebhook } from './engine.ts';
import { runOps } from './runs.ts';
import { loadWorkflowResource, workflowOps } from './service.ts';
import { fetchHttpSender, type HttpSender } from './steps.ts';

export { nextCronRun, parseCron } from './cron.ts';
export { matchEvents } from './engine.ts';
export { evaluateFormula, fetchHttpSender, type HttpRequest, type HttpSender } from './steps.ts';

export interface WorkflowWiring {
  database: Database;
  policies: Policies;
  jobs: JobQueue;
  /** Workflow clock for delays and schedules (tests move it). */
  clock?: () => Date;
  /** Send HTTP request block transport (tests inject a recorder). */
  http?: HttpSender;
  /** LLM client of the AI blocks (slice 10). */
  llm?: LlmClient;
}

let registered = false;

/** The catalogue as the palette shows it (categories in palette order; triggers before steps). */
export function workflowCatalog(): {
  categories: { slug: string; label: string }[];
  triggers: BlockDefinition[];
  steps: BlockDefinition[];
} {
  return {
    categories: blockCategories.map((slug) => ({ slug, label: BLOCK_CATEGORY_LABELS[slug] })),
    triggers: TRIGGER_DEFINITIONS,
    steps: STEP_DEFINITIONS,
  };
}

export function createWorkflowServices(wiring: WorkflowWiring) {
  const { database, policies } = wiring;
  if (!registered) {
    registered = true;
    registerResourceKind('workflow', {
      load: loadWorkflowResource,
      emit(tx, id) {
        tx.emit('workflow', id, { workflowId: id });
        tx.emit('workflow-list', null);
      },
    });
  }
  const deps: EngineDeps = {
    database,
    policies,
    jobs: wiring.jobs,
    clock: wiring.clock ?? (() => new Date()),
    http: wiring.http ?? fetchHttpSender,
    entries: entryOps(policies),
    ...(wiring.llm ? { llm: wiring.llm } : {}),
  };
  const runs = runOps(deps);
  const run = <T>(ctx: ServiceContext, fn: (tx: Tx) => Promise<T>) => runInWorkspace(database, ctx, fn);

  const engine = {
    /** Worker job `workflow.run`: executes the run until it finishes or waits for a delay. */
    process: (workspaceId: string, runId: string, options?: { maxSteps?: number; signal?: AbortSignal }) =>
      processRun(deps, workspaceId, runId, options),
    /** Worker loop: committed trigger events → runs. */
    fanOut: () => fanOutTriggers(deps),
    /** Worker cron `workflow.tick`: due recurring schedules and overdue delays. */
    tick: (options?: { now?: Date }) => tick(deps, options),
    /**
     * Runs fan-out and every open run (of one workspace) until nothing moves (tests, CLI). Waits up to `timeoutMs`
     * while `until` is false (the fan-out bound is held back by concurrent transactions for a moment).
     */
    async drain(options: { workspaceId?: string; until?: () => Promise<boolean>; timeoutMs?: number } = {}) {
      const deadline = Date.now() + (options.timeoutMs ?? 10_000);
      // Everything committed before this call is fanned out once the trigger cursor passes a fresh xid: until then
      // "nothing moved" may only mean a concurrent transaction is still holding the bound back.
      const marker = await runAsOwner(database, async (trx) => {
        const { rows } = await sql<{ xid: string }>`SELECT pg_current_xact_id()::text AS xid`.execute(trx);
        return BigInt((rows[0] as { xid: string }).xid);
      });
      const fannedOut = async () =>
        runAsOwner(database, async (trx) => {
          const { rows } = await sql<{ c: string }>`
            SELECT xid_cursor::text AS c FROM workflow_trigger_state WHERE id = 1`.execute(trx);
          return rows[0] !== undefined && BigInt(rows[0].c) > marker;
        });
      let processed = 0;
      for (;;) {
        await fanOutTriggers(deps);
        const caughtUp = await fannedOut();
        const open = await runAsOwner(database, (trx) =>
          trx
            .selectFrom('workflow_runs')
            .select(['id', 'workspace_id'])
            .where('status', 'in', ['queued', 'executing'])
            .$if(options.workspaceId !== undefined, (q) => q.where('workspace_id', '=', options.workspaceId as string))
            .orderBy('created_at')
            .execute(),
        );
        let moved = false;
        for (const r of open) {
          const result = await processRun(deps, r.workspace_id, r.id);
          if (result.waitingUntil === null || result.steps > 1) moved = true;
          processed++;
        }
        const satisfied = options.until ? await options.until() : !moved && caughtUp;
        if (satisfied && !moved) return { processed };
        if (Date.now() > deadline) return { processed };
        if (!moved) await new Promise((r) => setTimeout(r, 50));
      }
    },
  };

  return {
    workflows: {
      list: (ctx: ServiceContext, input?: ListWorkflowsInput) => run(ctx, (tx) => workflowOps.list(tx, input)),
      get: (ctx: ServiceContext, input: GetWorkflowInput) => run(ctx, (tx) => workflowOps.get(tx, input)),
      create: (ctx: ServiceContext, input: CreateWorkflowInput) => run(ctx, (tx) => workflowOps.create(tx, input)),
      update: (ctx: ServiceContext, input: UpdateWorkflowInput) => run(ctx, (tx) => workflowOps.update(tx, input)),
      delete: (ctx: ServiceContext, input: WorkflowIdInput) => run(ctx, (tx) => workflowOps.delete(tx, input)),
      publish: (ctx: ServiceContext, input: PublishWorkflowInput) => run(ctx, (tx) => workflowOps.publish(tx, input)),
      enable: (ctx: ServiceContext, input: WorkflowIdInput) => run(ctx, (tx) => workflowOps.enable(tx, input)),
      disable: (ctx: ServiceContext, input: WorkflowIdInput) => run(ctx, (tx) => workflowOps.disable(tx, input)),
      discardDraft: (ctx: ServiceContext, input: DiscardDraftInput) =>
        run(ctx, (tx) => workflowOps.discardDraft(tx, input)),
      versions: (ctx: ServiceContext, input: WorkflowIdInput) => run(ctx, (tx) => workflowOps.versions(tx, input)),
      restoreVersion: (ctx: ServiceContext, input: RestoreVersionInput) =>
        run(ctx, (tx) => workflowOps.restoreVersion(tx, input)),
      duplicate: (ctx: ServiceContext, input: DuplicateWorkflowInput) =>
        run(ctx, (tx) => workflowOps.duplicate(tx, input)),
      /** Checklist: issues per block of the draft. */
      validate: (ctx: ServiceContext, input: WorkflowIdInput) => run(ctx, (tx) => workflowOps.validate(tx, input)),
      settings: {
        update: (ctx: ServiceContext, input: UpdateWorkflowSettingsInput) =>
          run(ctx, (tx) => workflowOps.updateSettings(tx, input)),
      },
      blocks: {
        put: (ctx: ServiceContext, input: PutBlockInput) => run(ctx, (tx) => workflowOps.putBlock(tx, input)),
        delete: (ctx: ServiceContext, input: DeleteBlockInput) => run(ctx, (tx) => workflowOps.deleteBlock(tx, input)),
        connect: (ctx: ServiceContext, input: ConnectBlocksInput) => run(ctx, (tx) => workflowOps.connect(tx, input)),
        disconnect: (ctx: ServiceContext, input: DisconnectBlocksInput) =>
          run(ctx, (tx) => workflowOps.disconnect(tx, input)),
        organize: (ctx: ServiceContext, input: OrganizeBlocksInput) =>
          run(ctx, (tx) => workflowOps.organize(tx, input)),
      },
      variables: (ctx: ServiceContext, input: VariablesInput) => run(ctx, (tx) => workflowOps.variables(tx, input)),
      runs: {
        list: (ctx: ServiceContext, input: ListRunsInput) => run(ctx, (tx) => runs.list(tx, input)),
        get: (ctx: ServiceContext, input: RunIdInput) => run(ctx, (tx) => runs.get(tx, input)),
        retry: (ctx: ServiceContext, input: RetryRunInput) => run(ctx, (tx) => runs.retry(tx, input)),
        rerun: (ctx: ServiceContext, input: RerunInput) => run(ctx, (tx) => runs.rerun(tx, input)),
        cancel: (ctx: ServiceContext, input: RunIdInput) => run(ctx, (tx) => runs.cancel(tx, input)),
      },
      trigger: {
        manual: (ctx: ServiceContext, input: ManualTriggerInput) => run(ctx, (tx) => triggerManual(tx, deps, input)),
        /** Webhook received (public hook URL; no member session): one run with the raw body. */
        webhook: (workspaceId: string, workflowId: string, body: string) =>
          run({ workspaceId, actor: { type: 'system', id: 'workflow-webhook' } }, (tx) =>
            triggerWebhook(tx, deps, workflowId, body),
          ),
      },
      catalog: () => workflowCatalog(),
      usage: (ctx: ServiceContext, input?: UsageInput) => run(ctx, (tx) => runs.usage(tx, input)),
      /** Broadcast messages and celebrations for the caller since `since` (clients fetch on the invalidation). */
      broadcasts: (ctx: ServiceContext, input: { since?: string } = {}) =>
        run(ctx, async (tx) => {
          const member = actingMemberId(tx.ctx);
          const since = input.since ?? new Date(Date.parse(tx.now) - 60_000).toISOString();
          const rows = await tx.db
            .selectFrom('workflow_broadcasts')
            .selectAll()
            .where('created_at', '>', since)
            .orderBy('created_at')
            .limit(50)
            .execute();
          return {
            broadcasts: rows
              .filter(
                (r) => r.recipient_member_ids === null || (member !== null && r.recipient_member_ids.includes(member)),
              )
              .map((r) => ({
                id: r.id,
                kind: r.kind,
                payload: r.payload,
                workflowId: r.workflow_id,
                createdAt: r.created_at,
              })),
          };
        }),
      engine,
    },
  };
}
