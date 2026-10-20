// @agentic-crm/domain: domain services — the single write path (I1). Every method is one transaction in the
// caller's workspace (I2) that writes data, history and change_log rows; transports (tRPC, /v2, workflows, AI
// tools) are thin adapters over these methods (I5). Inputs are validated with the @agentic-crm/contracts schemas.

import { config } from '@agentic-crm/config';
import type {
  AcceptInviteInput,
  ActionFlag,
  AddColumnInput,
  AddEntriesInput,
  AggregateInput,
  ArchiveNotificationsInput,
  BatchGetRecordsInput,
  BatchGetRecordsWithValuesInput,
  CheckDuplicatesInput,
  CreateApiTokenInput,
  CreateAttributeInput,
  CreateInvitesInput,
  CreateListInput,
  CreateObjectInput,
  CreateOptionInput,
  CreateRecordInput,
  CreateRuleInput,
  CreateStageInput,
  CreateTeamInput,
  CreateViewInput,
  CreateWebhookInput,
  CreateWorkspaceInput,
  DeleteListInput,
  DeleteRecordInput,
  DuplicateListInput,
  EntriesForRecordInput,
  FindByUniqueValuesInput,
  GetEntryInput,
  GetRecordInput,
  HomeSummaryInput,
  KanbanColumnChunkInput,
  KanbanColumnsInput,
  KanbanMoveInput,
  KanbanTimeInStageInput,
  ListAttributesInput,
  ListEntityDefinitionsInput,
  ListListsInput,
  ListMembersInput,
  ListNotificationsInput,
  ListOptionsInput,
  ListPermissionsInput,
  ListRefInput,
  ListRulesInput,
  ListValuesInput,
  ListViewsInput,
  ListWebhookDeliveriesInput,
  MarkNotificationsReadInput,
  MarkNotificationsUnreadInput,
  MergeRecordsInput,
  PutPermissionInput,
  PutValueInput,
  QuerySnapshotInput,
  RemoveColumnInput,
  RemoveEntriesInput,
  RemovePermissionInput,
  ReorderRulesInput,
  ReorderValueInput,
  ResolvePermissionsInput,
  ResolvePoliciesInput,
  ResolveSelectionInput,
  RestoreRecordInput,
  RetireValueInput,
  SearchMembersInput,
  SearchRecordsInput,
  SetListAccessInput,
  SetViewFilterInput,
  SetViewSortsInput,
  SnapshotChunkInput,
  TeamMembersInput,
  TestWebhookInput,
  UpdateApiTokenInput,
  UpdateAttributeInput,
  UpdateColumnInput,
  UpdateListInput,
  UpdateMemberInput,
  UpdateNotificationPreferenceInput,
  UpdateObjectInput,
  UpdateOptionInput,
  UpdateProfileInput,
  UpdateRecordInput,
  UpdateRuleInput,
  UpdateStageInput,
  UpdateTeamInput,
  UpdateViewInput,
  UpdateWebhookInput,
  UpdateWorkspaceGeneralInput,
  UpdateWorkspaceInput,
  UpdateWorkspaceSettingsInput,
  UserIdentity,
  ValueHistoryInput,
} from '@agentic-crm/contracts';
import {
  DELETE_SELECTION_MAX_ROWS,
  type DeleteSelectionInput,
  deleteSelectionInputSchema,
  zebraClamp,
  zebraSize,
} from '@agentic-crm/contracts';
import { type Database, sql } from '@agentic-crm/db';
import { systemActor } from './actors.ts';
import {
  type DecideActionInput,
  type ExecuteTaskCreateInput,
  type ProposeTaskActionInput,
  type ReconcileExecutingActionInput,
  type RecordAgentState,
  type RecordAgentStateInput,
  recordAgentStateSchema,
} from './agentic/actions/contracts.ts';
import { createActionService } from './agentic/actions/service.ts';
import type { CaptureEvidenceInput } from './agentic/evidence/contracts.ts';
import { createNoteEvidenceSource } from './agentic/evidence/note-source.ts';
import { createEvidenceService } from './agentic/evidence/service.ts';
import { type AgentAuthoritySource, createAgenticPolicy } from './agentic/policy.ts';
import { createRunnerService, runnerAuthoritySource, runnerTokenWorkspace } from './agentic/runners/service.ts';
import { createTaskCapability } from './agentic/task-capability.ts';
import type { AgentTask, EnqueueAgentTaskInput } from './agentic/tasks/contracts.ts';
import { createAgentTaskService } from './agentic/tasks/service.ts';
import { type AiTurnHub, createAiServices } from './ai/index.ts';
import { createLlm, type LlmClient } from './ai/llm.ts';
import { apiTokenOps } from './api-tokens/service.ts';
import { createCallServices } from './calls/index.ts';
import { capabilityOps } from './capabilities.ts';
import { createCollabServices } from './collab/index.ts';
import { resolveEncryptionKey } from './connectors/google/crypto.ts';
import { type GoogleSettings, googleSettingsFromEnv } from './connectors/google/settings.ts';
import type { ConnectorRegistry } from './connectors/types.ts';
import { memberContext, type ServiceContext, systemContext } from './context.ts';
import { documentsApi } from './documents/service.ts';
import { createEmailServices } from './email/index.ts';
import { badRequest, forbidden, notFound } from './errors.ts';
import { createExportServices } from './exports/index.ts';
import {
  createAttributeWithExtensions,
  createFormulaServices,
  updateAttributeWithExtensions,
} from './formulas/index.ts';
import { homeOps } from './home/service.ts';
import { createImportServices } from './imports/index.ts';
import { type JobQueue, unavailableJobQueue } from './jobs/queue.ts';
import { entryOps } from './lists/entries.ts';
import { kanbanOps } from './lists/kanban.ts';
import { listOps } from './lists/service.ts';
import { profileOps } from './members/profile.ts';
import { memberAdminOps } from './members/service.ts';
import {
  type CreateProviderConnectionInput,
  createProviderConnections,
  type DisableProviderConnectionInput,
  type RotateProviderConnectionInput,
} from './model-gateway/connections.ts';
import {
  type CompleteRunnerInvocationInput,
  type ConfigureModelTargetInput,
  type CreateModelTargetInput,
  type InvokeModelTargetInput,
} from './model-gateway/contracts.ts';
import { createModelGateway } from './model-gateway/gateway.ts';
import { type UpdateProductModuleInput, workspaceProductModuleOps } from './modules/service.ts';
import { memberGrantsOf, notifyListShared } from './notifications/producers.ts';
import { drainEmailDeliveries, notificationOps } from './notifications/service.ts';
import { grantResolver } from './permissions/resolver.ts';
import { grantDefaultsOnCreate, permissionOps } from './permissions/service.ts';
import { allowAllResolver, createPolicies, type PolicyResolver } from './permissions.ts';
import { recordOps } from './records/service.ts';
import { createReportServices } from './reports/index.ts';
import { ruleOps } from './rules/service.ts';
import { loadDefinition } from './schema/model.ts';
import { schemaOps } from './schema/service.ts';
import { seedCustomObject, seedStandardObject } from './schema/standard.ts';
import { rebuildSearchIndex } from './search/indexer.ts';
import { searchOps } from './search/service.ts';
import { type ObjectStorage, S3Storage } from './storage/s3.ts';
import { teamOps } from './teams/service.ts';
import { runAsOwner, runInWorkspace, type Tx } from './tx.ts';
import { viewOps } from './views/service.ts';
import { deliverDueWebhooks, fanOutWebhookEvents, fetchSender, type WebhookSender } from './webhooks/delivery.ts';
import { webhookOps } from './webhooks/service.ts';
import { createWorkflowServices, type HttpSender } from './workflows/index.ts';
import { checkWorkspaceSlug, workspaceSettingsOps } from './workspace/service.ts';
import { inviteOps, memberOps, workspaceOps } from './workspaces/service.ts';

export { actorTypeCode, memberActor, systemActor } from './actors.ts';
export * from './agentic/actions/contracts.ts';
export { type ActionService, createActionService } from './agentic/actions/service.ts';
export * from './agentic/evidence/contracts.ts';
export { createNoteEvidenceSource } from './agentic/evidence/note-source.ts';
export { createEvidenceService, type EvidenceService } from './agentic/evidence/service.ts';
export {
  type AgentAuthoritySource,
  type AgenticPolicy,
  type AgenticPolicyOptions,
  createAgenticPolicy,
} from './agentic/policy.ts';
export {
  createRunnerService,
  type RunnerService,
  type RunnerTaskRuntime,
  runnerAuthoritySource,
  runnerTokenWorkspace,
} from './agentic/runners/service.ts';
export { createTaskCapability } from './agentic/task-capability.ts';
export * from './agentic/tasks/contracts.ts';
export { type AgentTaskService, createAgentTaskService } from './agentic/tasks/service.ts';
export { type AnthropicAdapterOptions, AnthropicInferenceAdapter } from './ai/adapters/anthropic.ts';
export { FakeInferenceAdapter } from './ai/adapters/fake.ts';
export {
  type OpenAICompatibleAdapterOptions,
  type OpenAICompatibleFeatures,
  OpenAICompatibleInferenceAdapter,
} from './ai/adapters/openai-compatible.ts';
export {
  AI_TOOLS,
  type AiStreamEnvelope,
  AiTurnHub,
  type CreditBalance,
  type CreditChargeInput,
  type CreditSpend,
  creditOps,
  creditsExhausted,
} from './ai/index.ts';
export * from './ai/inference.ts';
export * from './ai/llm.ts';
export { hashApiToken } from './api-tokens/service.ts';
export {
  BLOCK_GAP_SECONDS,
  buildBlocks,
  CALL_PURPOSES,
  type CallServices,
  callsFakeReply,
  fakeCallsLlm,
  formatClock,
  INSIGHT_PRESETS,
  PARAGRAPH_GAP_SECONDS,
  withCallsFakeReplies,
} from './calls/index.ts';
export { blocksToPlaintext, markdownToPlaintext, plaintextToMarkdown } from './collab/documents.ts';
export { DOWNLOAD_URL_TTL_SECONDS, UPLOAD_URL_TTL_SECONDS } from './collab/files.ts';
export {
  createGoogleIntegration,
  FakeGoogle,
  type FakeGoogleOptions,
  GoogleConnectError,
  type GoogleConnectFailure,
  GoogleConnector,
  type GoogleCredentials,
  type GoogleIntegration,
  type GoogleSettings,
  googleSettingsFromEnv,
  OAUTH_TTL_SECONDS,
  resolveEncryptionKey,
  SecretBox,
} from './connectors/google/index.ts';
export { TEST_FAILURE_DOMAIN, TestConnector, testFixtures } from './connectors/test-connector.ts';
export {
  type CalendarChange,
  type ChangePage,
  ConnectorError,
  type ConnectorEvent,
  type ConnectorMailbox,
  type ConnectorMessage,
  type ConnectorRegistry,
  type EmailCalendarConnector,
  type MailChange,
  type OutgoingMessage,
  type SentMessage,
} from './connectors/types.ts';
export { actingMemberId, memberContext, type ServiceContext, systemContext } from './context.ts';
export {
  type CreateDocumentInput,
  createDocumentInputSchema,
  DOC_TYPES,
  DOCUMENT_STATE_CHANNEL,
  type DocType,
  type DocumentAccess,
  type DocumentContentInput,
  type DocumentsApi,
  type DocumentView,
  MAX_DOCUMENT_STATE_BYTES,
  type ReplaceDocumentContentInput,
  type StoredState,
  type StoreStateResult,
} from './documents/service.ts';
export { FAILURE_REASONS } from './email/outbox.ts';
export { DomainError, toErrorEnvelope } from './errors.ts';
export { newId } from './ids.ts';
export { IMPORT_BATCH_ROWS, ImportInterruptedError } from './imports/execute.ts';
export { bucketOf, HALF_LIFE_DAYS, STRENGTH_BUCKETS, WEIGHTS, WINDOW_DAYS } from './interactions/strength.ts';
export {
  createJobProducer,
  DEAD_LETTER_QUEUE,
  ensureQueues,
  JOB_NAMES,
  type JobName,
  type JobProducer,
  type JobQueue,
  type PgBossLike,
  pgBossJobQueue,
  QUEUE_OPTIONS,
  RecordingJobQueue,
} from './jobs/queue.ts';
export { limitOf } from './limits.ts';
export { rawTranscript, speakerLabel } from './meetings/service.ts';
export {
  type CreateProviderConnectionInput,
  createProviderConnections,
  type DisableProviderConnectionInput,
  type ProviderConnectionMetadata,
  type ProviderConnections,
  type RotateProviderConnectionInput,
} from './model-gateway/connections.ts';
export {
  configureModelTargetSchema,
  createModelTargetSchema,
  localFeaturesSchema,
  type ModelInvocationResult,
  type ModelTargetMetadata,
} from './model-gateway/contracts.ts';
export {
  compileProductModuleRegistry,
  DuplicateProductModuleError,
  type ProductModuleRegistry,
  productModuleRegistry,
  UnknownProductModuleError,
} from './modules/registry.ts';
export {
  type UpdateProductModuleInput,
  updateProductModuleSchema,
  type WorkspaceProductModule,
} from './modules/service.ts';
export { isAdminCaller } from './permissions/admin.ts';
export { effectiveAccess, kindOfDefinition } from './permissions/resolve.ts';
export { grantResolver } from './permissions/resolver.ts';
export { type ResourceKindHandler, registerResourceKind } from './permissions/service.ts';
export { allowAllResolver, type PolicyResolver, type PolicySubject } from './permissions.ts';
export { type ObjectStorage, type S3Config, S3Storage } from './storage/s3.ts';
export { NO_MEMBER } from './views/resolve.ts';
export { CHUNK_SIZE, SNAPSHOT_TTL_HOURS } from './views/service.ts';
export { fetchSender, filterMatches, signWebhookBody, type WebhookSender } from './webhooks/delivery.ts';
export { type DomainEvent, normalizeEvents } from './webhooks/events.ts';
export { filterKey } from './webhooks/service.ts';
export {
  evaluateFormula,
  fetchHttpSender,
  type HttpRequest,
  type HttpSender,
  matchEvents,
  nextCronRun,
  parseCron,
  workflowCatalog,
} from './workflows/index.ts';
export { RESERVED_SLUGS } from './workspaces/service.ts';

export interface DomainOptions {
  database: Database;
  /** Trusted runtime authentication/grants; never supplied through a product request. Missing integration denies agents. */
  agentAuthority?: AgentAuthoritySource;
  /** Test seam; production uses AGENTIC_CRM_ENCRYPTION_KEY from shared config. */
  modelEncryptionKey?: Buffer;
  /** Defaults to the allow-all resolver of slice 1. */
  policyResolver?: PolicyResolver;
  /** Object storage for record files and exports (defaults to S3 at config.s3 — SeaweedFS locally). */
  storage?: ObjectStorage;
  /** Background jobs (D-10, pg-boss). Without it, enqueuing (import run, export) fails with 503 JOBS_UNAVAILABLE. */
  jobs?: JobQueue;
  /** How webhook requests are sent (default: fetch with a 5 s timeout); tests inject a recorder. */
  webhookSender?: WebhookSender;
  /** Email / calendar connectors by provider (slice 7; the test connector is always available). */
  connectors?: ConnectorRegistry;
  /**
   * Google OAuth client for the Gmail + Google Calendar connector (slice 7b). Default: from the environment
   * (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI / AGENTIC_CRM_ENCRYPTION_KEY); null = not configured.
   * Tests pass settings whose `fetch` is a FakeGoogle.
   */
  google?: GoogleSettings | null;
  /** Workflow clock for delays and recurring schedules (default: the system clock); tests move it. */
  workflowClock?: () => Date;
  /** Transport of the workflow "Send HTTP request" block (default fetch); tests inject a recorder. */
  workflowHttp?: HttpSender;
  /**
   * The LLM client of the AI layer (slice 10; packages/domain/src/ai/llm.ts). Defaults to Anthropic when
   * ANTHROPIC_API_KEY is set, otherwise the unconfigured client (AI calls fail with 503 AI_NOT_CONFIGURED). Tests pass
   * a FakeLlm — tests never call the network.
   */
  llm?: LlmClient;
  /** Ask Agentic stream hub (apps/api shares it with the SSE route and the thread rooms). */
  aiHub?: AiTurnHub;
}

type WithDef = { entityDefinitionId?: unknown };

/** The id of a list named by id or slug; null when it is not a list (the call then fails with its own 404). */
async function listIdOf(tx: Tx, ref: string): Promise<string | null> {
  const def = await loadDefinition(tx, ref).catch(() => null);
  return def?.entityType === 'collection-entry' ? def.id : null;
}

export function createDomain(options: DomainOptions) {
  const { database } = options;
  // Objects and lists honour their grants (workspace, teams, member; slice 6) on top of the configured resolver.
  const resolver = grantResolver(options.policyResolver ?? allowAllResolver);
  const policies = createPolicies(resolver);
  const agents: AgentAuthoritySource = {
    principalOf: async (tx) => {
      if (tx.ctx.agentRuntime) return runnerAuthoritySource.principalOf(tx);
      return (await options.agentAuthority?.principalOf(tx)) ?? null;
    },
    loadGrant: async (tx, grantId) => {
      if (tx.ctx.agentRuntime) return runnerAuthoritySource.loadGrant(tx, grantId);
      return (await options.agentAuthority?.loadGrant(tx, grantId)) ?? null;
    },
  };
  const policy = createAgenticPolicy({ resolver, agents });
  const evidence = createEvidenceService(createNoteEvidenceSource({ policy, resolver, agents }));
  const agentTasks = createAgentTaskService({ policy });
  const actions = createActionService({
    policy,
    evidence,
    onStateChanged: async (tx, action) => {
      await agentTasks.reconcileLinkedAction(tx, action.id);
    },
  });
  const taskCapability = createTaskCapability({ actions, tasks: agentTasks, collab: { policies } });
  const runners = createRunnerService({
    tasks: {
      ...agentTasks,
      assertLease: async (tx, input) => {
        await agentTasks.assertLease(tx, input);
      },
    },
    executeTaskCreate: (tx, input) => taskCapability.execute(tx, input),
  });
  const encryptionKey =
    options.modelEncryptionKey ??
    resolveEncryptionKey(config.encryptionKey, config.authSecret, { production: config.isProduction });
  const providerConnections = createProviderConnections({ database, encryptionKey });
  const modelGateway = createModelGateway({
    database,
    encryptionKey,
    authorizeRunner: async (tx, identity) => {
      const { rows } = await sql<{ id: string }>`SELECT r.id FROM agentic_runners r
        JOIN workspace_members m ON m.workspace_id = r.workspace_id AND m.id = r.member_id
        WHERE r.workspace_id = ${tx.workspaceId}::uuid AND r.id = ${identity.runnerId}::uuid
          AND r.member_id = ${identity.memberId}::uuid AND r.revoked_at IS NULL
          AND m.removed_at IS NULL AND m.access_level IN ('admin', 'member') FOR SHARE OF r, m`.execute(tx.db);
      if (!rows[0]) throw forbidden('The runner is unavailable to this member');
    },
    authenticateRunnerCompletion: async (proof) => {
      if (typeof proof !== 'string') throw forbidden('An authenticated runner session is required');
      const workspaceId = runnerTokenWorkspace(proof, 'run');
      if (!workspaceId) throw forbidden('An authenticated runner session is required');
      const runner = await runInWorkspace(database, systemContext(workspaceId, 'runner-model-usage'), (tx) =>
        runners.authenticate(tx, proof),
      );
      return { workspaceId: runner.workspaceId, runnerId: runner.id, memberId: runner.memberId };
    },
  });
  const permissions = permissionOps(policies);
  const rules = ruleOps(policies);
  const webhookSender = options.webhookSender ?? fetchSender;
  const lists = listOps(policies);
  const entries = entryOps(policies);
  const kanban = kanbanOps(policies);
  const notifications = notificationOps(policies);
  const home = homeOps({ policies });
  const run = <T>(ctx: ServiceContext, fn: (tx: Tx) => Promise<T>) => runInWorkspace(database, ctx, fn);
  /** Runs `fn` after checking `flag` on the input's entity definition (invalid inputs fail in `fn`'s Zod parse). */
  const guarded =
    <I extends WithDef, T>(flag: ActionFlag, fn: (tx: Tx, input: I) => Promise<T>) =>
    (ctx: ServiceContext, input: I) =>
      run(ctx, async (tx) => {
        if (typeof input?.entityDefinitionId === 'string') await policies.assertCan(tx, input.entityDefinitionId, flag);
        return fn(tx, input);
      });
  const storage = options.storage ?? new S3Storage(config.s3);
  const jobs = options.jobs ?? unavailableJobQueue;
  const collabServices = createCollabServices({ database, policies, storage });
  const importServices = createImportServices({ database, policies, jobs });
  const exportServices = createExportServices({ database, policies, storage, jobs });
  // Email & calendar: without a job queue, sync / delivery / connection strength run inline when asked to.
  const emailServices = createEmailServices({
    database,
    policies,
    storage,
    jobs: options.jobs,
    connectors: options.connectors,
    google: options.google === undefined ? googleSettingsFromEnv() : options.google,
  });
  const llm = options.llm ?? createLlm();
  const workflowServices = createWorkflowServices({
    database,
    policies,
    jobs,
    llm,
    ...(options.workflowClock ? { clock: options.workflowClock } : {}),
    ...(options.workflowHttp ? { http: options.workflowHttp } : {}),
  });
  const reportServices = createReportServices({ database, policies });
  const aiServices = createAiServices({ database, policies, llm, ...(options.aiHub ? { hub: options.aiHub } : {}) });
  const formulaServices = createFormulaServices({
    database,
    policies,
    jobs: options.jobs ?? null,
    requiredJobs: jobs,
    llm,
  });
  // Slice 10: call recordings (the /v2 import path), processing, Calls list, insights, insight templates.
  const callServices = createCallServices({ database, policies, jobs: options.jobs, llm });

  return {
    productModules: {
      list: (ctx: ServiceContext) => run(ctx, (tx) => workspaceProductModuleOps.list(tx)),
      update: (ctx: ServiceContext, input: UpdateProductModuleInput) =>
        run(ctx, (tx) => workspaceProductModuleOps.update(tx, input)),
    },
    agentic: {
      providerConnections: {
        create: (ctx: ServiceContext, input: CreateProviderConnectionInput) => providerConnections.create(ctx, input),
        get: (ctx: ServiceContext, id: string) => providerConnections.get(ctx, id),
        list: (ctx: ServiceContext) => providerConnections.list(ctx),
        rotate: (ctx: ServiceContext, input: RotateProviderConnectionInput) => providerConnections.rotate(ctx, input),
        disable: (ctx: ServiceContext, input: DisableProviderConnectionInput) =>
          providerConnections.disable(ctx, input),
      },
      models: {
        targets: {
          create: (ctx: ServiceContext, input: CreateModelTargetInput) => modelGateway.targets.create(ctx, input),
          configure: (ctx: ServiceContext, input: ConfigureModelTargetInput) =>
            modelGateway.targets.configure(ctx, input),
          get: (ctx: ServiceContext, id: string) => modelGateway.targets.get(ctx, id),
          list: (ctx: ServiceContext) => modelGateway.targets.list(ctx),
          disable: (ctx: ServiceContext, input: { id: string; expectedVersion: number }) =>
            modelGateway.targets.disable(ctx, input),
        },
        invoke: (ctx: ServiceContext, input: InvokeModelTargetInput) => modelGateway.invoke(ctx, input),
        claimRunnerInvocations: (bearer: string, limit?: number) => modelGateway.claimRunnerInvocations(bearer, limit),
        heartbeatRunnerInvocation: (input: { invocationId: string; leaseGeneration: string }, bearer: string) =>
          modelGateway.heartbeatRunnerInvocation(input, bearer),
        getRunnerInvocation: (ctx: ServiceContext, invocationId: string) =>
          modelGateway.getRunnerInvocation(ctx, invocationId),
        completeRunnerInvocation: (input: CompleteRunnerInvocationInput, bearer: string) =>
          modelGateway.completeRunnerInvocation(input, bearer),
      },
      runners: {
        createEnrollment: (ctx: ServiceContext) => run(ctx, (tx) => runners.createEnrollment(tx)),
        enroll: (ctx: ServiceContext, input: Parameters<typeof runners.enroll>[1]) =>
          run(ctx, (tx) => runners.enroll(tx, input)),
        list: (ctx: ServiceContext) => run(ctx, (tx) => runners.list(tx)),
        revoke: (ctx: ServiceContext, runnerId: string) => run(ctx, (tx) => runners.revoke(tx, runnerId)),
        authenticate: (ctx: ServiceContext, bearer: string) => run(ctx, (tx) => runners.authenticate(tx, bearer)),
        claim: (ctx: ServiceContext, bearer: string, input: Parameters<typeof runners.claim>[2]) =>
          run(ctx, (tx) => runners.claim(tx, bearer, input)),
        heartbeat: (ctx: ServiceContext, bearer: string, input: Parameters<typeof runners.heartbeat>[2]) =>
          run(ctx, (tx) => runners.heartbeat(tx, bearer, input)),
        finish: (
          ctx: ServiceContext,
          bearer: string,
          kind: Parameters<typeof runners.finish>[2],
          input: Parameters<typeof runners.finish>[3],
        ) => run(ctx, (tx) => runners.finish(tx, bearer, kind, input)),
        recoverExpired: (ctx: ServiceContext, bearer: string, input: Parameters<typeof runners.recoverExpired>[2]) =>
          run(ctx, (tx) => runners.recoverExpired(tx, bearer, input)),
        resumeBlocked: (ctx: ServiceContext, bearer: string, input: Parameters<typeof runners.resumeBlocked>[2]) =>
          run(ctx, (tx) => runners.resumeBlocked(tx, bearer, input)),
        executeTool: (ctx: ServiceContext, bearer: string, grant: string, input: ExecuteTaskCreateInput) =>
          run(ctx, (tx) => runners.executeTool(tx, bearer, grant, input)),
      },
      recordState: (ctx: ServiceContext, input: RecordAgentStateInput): Promise<RecordAgentState> =>
        run(ctx, async (tx) => {
          const parsed = recordAgentStateSchema.parse(input);
          const activity = await actions.listRecord(tx, parsed);
          const tasks = await agentTasks.listRecord(tx, parsed);
          return { scope: parsed.scope, ...activity, tasks };
        }),
      tasks: {
        get: (ctx: ServiceContext, id: string): Promise<AgentTask> => run(ctx, (tx) => agentTasks.get(tx, id)),
        listRecord: (ctx: ServiceContext, input: RecordAgentStateInput): Promise<AgentTask[]> =>
          run(ctx, (tx) => agentTasks.listRecord(tx, input)),
        /** Trusted seed/worker entry point. Product transports intentionally expose only record reads. */
        enqueue: (ctx: ServiceContext, input: EnqueueAgentTaskInput): Promise<AgentTask> =>
          run(ctx, (tx) => agentTasks.enqueue(tx, input)),
        resumeBlocked: (ctx: ServiceContext, taskId: string): Promise<AgentTask> =>
          run(ctx, (tx) => agentTasks.resumeBlocked(tx, { taskId })),
      },
      evidence: {
        capture: (ctx: ServiceContext, input: CaptureEvidenceInput) => run(ctx, (tx) => evidence.capture(tx, input)),
      },
      actions: {
        get: (ctx: ServiceContext, id: string) => run(ctx, (tx) => actions.get(tx, id)),
        propose: (ctx: ServiceContext, input: ProposeTaskActionInput) => run(ctx, (tx) => actions.propose(tx, input)),
        decide: (ctx: ServiceContext, input: DecideActionInput) => run(ctx, (tx) => actions.decide(tx, input)),
        reconcileExecuting: (ctx: ServiceContext, input: ReconcileExecutingActionInput) =>
          run(ctx, (tx) => actions.reconcileExecuting(tx, input)),
        reconcileExecutingAsOperator: (ctx: ServiceContext, input: ReconcileExecutingActionInput) =>
          run(ctx, async (tx) => {
            if (tx.ctx.actor.type !== 'workspace-member' || !tx.ctx.actor.id)
              throw forbidden('Workspace admin required');
            const operatorId = tx.ctx.actor.id;
            const member = await tx.db
              .selectFrom('workspace_members')
              .select('id')
              .where('workspace_id', '=', tx.workspaceId)
              .where('id', '=', operatorId)
              .where('access_level', '=', 'admin')
              .where('removed_at', 'is', null)
              .forShare()
              .executeTakeFirst();
            if (!member) throw forbidden('Workspace admin required');
            tx.ctx.actor = systemActor(`operator-reconcile:${operatorId}`);
            try {
              return await actions.reconcileExecuting(tx, input);
            } finally {
              tx.ctx.actor = { type: 'workspace-member', id: operatorId };
            }
          }),
      },
      taskCreate: {
        execute: (ctx: ServiceContext, input: ExecuteTaskCreateInput) =>
          run(ctx, (tx) => taskCapability.execute(tx, input)),
      },
    },
    workspaces: {
      create: (user: UserIdentity, input: CreateWorkspaceInput) => workspaceOps.create(database, user, input),
      get: (ctx: ServiceContext) => run(ctx, (tx) => workspaceOps.get(tx)),
      update: (ctx: ServiceContext, input: UpdateWorkspaceInput) => run(ctx, (tx) => workspaceOps.update(tx, input)),
      listForUser: (userId: string) => workspaceOps.listForUser(database, userId),
      resolveForUser: (userId: string, key: { slug: string } | { id: string }) =>
        workspaceOps.resolveForUser(database, userId, key),
      isSlugAvailable: (slug: string) => workspaceOps.isSlugAvailable(database, slug),
    },
    members: {
      /** Every member with teams, removed ones included unless `includeRemoved: false` (they label history). */
      list: (ctx: ServiceContext, input?: ListMembersInput) => run(ctx, (tx) => memberAdminOps.list(tx, input)),
      /** Member detail (teams with "Added at"). */
      get: (ctx: ServiceContext, memberId: string) => run(ctx, (tx) => memberAdminOps.get(tx, memberId)),
      updateAccessLevel: (ctx: ServiceContext, input: UpdateMemberInput) =>
        run(ctx, (tx) => memberOps.updateAccessLevel(tx, input)),
      suspend: (ctx: ServiceContext, memberId: string) => run(ctx, (tx) => memberAdminOps.suspend(tx, memberId)),
      reactivate: (ctx: ServiceContext, memberId: string) => run(ctx, (tx) => memberAdminOps.reactivate(tx, memberId)),
      remove: (ctx: ServiceContext, memberId: string) => run(ctx, (tx) => memberAdminOps.remove(tx, memberId)),
    },
    /** Teams (slice 6): CRUD, membership, usage. */
    teams: {
      list: (ctx: ServiceContext) => run(ctx, (tx) => teamOps.list(tx)),
      get: (ctx: ServiceContext, teamId: string) => run(ctx, (tx) => teamOps.get(tx, teamId)),
      create: (ctx: ServiceContext, input: CreateTeamInput) => run(ctx, (tx) => teamOps.create(tx, input)),
      update: (ctx: ServiceContext, input: UpdateTeamInput) => run(ctx, (tx) => teamOps.update(tx, input)),
      delete: (ctx: ServiceContext, teamId: string) => run(ctx, (tx) => teamOps.delete(tx, teamId)),
      addMembers: (ctx: ServiceContext, input: TeamMembersInput) => run(ctx, (tx) => teamOps.addMembers(tx, input)),
      removeMembers: (ctx: ServiceContext, input: TeamMembersInput) =>
        run(ctx, (tx) => teamOps.removeMembers(tx, input)),
    },
    /** The caller's profile; names and time preferences apply to every workspace of the user. */
    profile: {
      get: (ctx: ServiceContext) => run(ctx, (tx) => profileOps.get(tx)),
      update: async (ctx: ServiceContext, input: UpdateProfileInput) => {
        const profile = await run(ctx, (tx) => profileOps.update(tx, input));
        const shared = {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.timeZone !== undefined ? { timeZone: input.timeZone } : {}),
          ...(input.weekStart !== undefined ? { weekStart: input.weekStart } : {}),
          ...(input.locale !== undefined ? { locale: input.locale } : {}),
        };
        if (Object.keys(shared).length > 0) {
          const others = await runAsOwner(database, (trx) =>
            trx
              .selectFrom('workspace_members')
              .select(['id', 'workspace_id'])
              .where('user_id', '=', profile.userId)
              .where('id', '!=', profile.memberId)
              .where('removed_at', 'is', null)
              .execute(),
          );
          for (const m of others) {
            await run(memberContext(m.workspace_id, m.id), (tx) => profileOps.update(tx, shared));
          }
        }
        return profile;
      },
    },
    /** Workspace › General and Security settings (slice 6). */
    workspace: {
      get: (ctx: ServiceContext) => run(ctx, (tx) => workspaceSettingsOps.get(tx)),
      update: (ctx: ServiceContext, input: UpdateWorkspaceGeneralInput) =>
        run(ctx, (tx) => workspaceSettingsOps.updateGeneral(tx, input)),
      checkSlug: (ctx: ServiceContext, slug: string) => checkWorkspaceSlug(database, ctx.workspaceId, slug),
      updateSettings: (ctx: ServiceContext, input: UpdateWorkspaceSettingsInput) =>
        run(ctx, (tx) => workspaceSettingsOps.updateSettings(tx, input)),
    },
    /** Grants of objects, lists and (later) dashboards, workflows, sequences (slice 6). */
    permissions: {
      list: (ctx: ServiceContext, input: ListPermissionsInput) => run(ctx, (tx) => permissions.list(tx, input)),
      put: (ctx: ServiceContext, input: PutPermissionInput) =>
        run(ctx, async (tx) => {
          const listId = input.resourceKind === 'list' ? await listIdOf(tx, input.resourceId) : null;
          const before = listId ? await memberGrantsOf(tx, listId) : new Map();
          const grant = await permissions.put(tx, input);
          // A member grant on a list shares it with them (notification list-shared, as lists.setAccess).
          if (listId) await notifyListShared(tx, listId, before, await memberGrantsOf(tx, listId));
          return grant;
        }),
      remove: (ctx: ServiceContext, input: RemovePermissionInput) => run(ctx, (tx) => permissions.remove(tx, input)),
      resolve: (ctx: ServiceContext, input: ResolvePermissionsInput) =>
        run(ctx, (tx) => permissions.resolve(tx, input)),
    },
    /** Requirement rules of objects (slice 6). */
    rules: {
      list: (ctx: ServiceContext, input: ListRulesInput) => run(ctx, (tx) => rules.list(tx, input)),
      create: (ctx: ServiceContext, input: CreateRuleInput) => run(ctx, (tx) => rules.create(tx, input)),
      update: (ctx: ServiceContext, input: UpdateRuleInput) => run(ctx, (tx) => rules.update(tx, input)),
      delete: (ctx: ServiceContext, ruleId: string) => run(ctx, (tx) => rules.delete(tx, { ruleId })),
      reorder: (ctx: ServiceContext, input: ReorderRulesInput) => run(ctx, (tx) => rules.reorder(tx, input)),
    },
    /** Webhooks (slice 6): settings, delivery log, test, and the worker's fan-out and delivery loops. */
    webhooks: {
      list: (ctx: ServiceContext) => run(ctx, (tx) => webhookOps.list(tx)),
      get: (ctx: ServiceContext, webhookId: string) => run(ctx, (tx) => webhookOps.get(tx, webhookId)),
      create: (ctx: ServiceContext, input: CreateWebhookInput) => run(ctx, (tx) => webhookOps.create(tx, input)),
      update: (ctx: ServiceContext, input: UpdateWebhookInput) => run(ctx, (tx) => webhookOps.update(tx, input)),
      delete: (ctx: ServiceContext, webhookId: string) => run(ctx, (tx) => webhookOps.delete(tx, webhookId)),
      secret: (ctx: ServiceContext, webhookId: string) => run(ctx, (tx) => webhookOps.secret(tx, webhookId)),
      deliveries: (ctx: ServiceContext, input: ListWebhookDeliveriesInput) =>
        run(ctx, (tx) => webhookOps.deliveries(tx, input)),
      /** "Test subscription": a sample event delivered right away (one attempt); answers the delivery. */
      test: async (ctx: ServiceContext, input: TestWebhookInput) => {
        const created = await run(ctx, (tx) => webhookOps.createTestDelivery(tx, input));
        await deliverDueWebhooks(database, { ids: [created.id], limit: 1, send: webhookSender });
        return run(ctx, (tx) => webhookOps.delivery(tx, created.id));
      },
      /** Worker: committed domain events → pending deliveries. */
      fanOut: () => fanOutWebhookEvents(database),
      /** Worker: attempts due deliveries (signed POSTs, back-off). */
      deliverDue: (options: { limit?: number } = {}) =>
        deliverDueWebhooks(database, { ...options, send: webhookSender }),
    },
    invites: {
      create: (ctx: ServiceContext, input: CreateInvitesInput) => run(ctx, (tx) => inviteOps.create(tx, input)),
      list: (ctx: ServiceContext) => run(ctx, (tx) => inviteOps.list(tx)),
      revoke: (ctx: ServiceContext, inviteId: string) => run(ctx, (tx) => inviteOps.revoke(tx, inviteId)),
      listForEmail: (emailAddress: string) => inviteOps.listForEmail(database, emailAddress),
      accept: (user: UserIdentity, input: AcceptInviteInput) => inviteOps.accept(database, user, input),
    },
    schema: {
      listObjects: (ctx: ServiceContext, input: ListEntityDefinitionsInput = {}) =>
        run(ctx, (tx) => schemaOps.listObjects(tx, input)),
      getObject: (ctx: ServiceContext, entityDefinitionId: string) =>
        run(ctx, (tx) => schemaOps.getObject(tx, entityDefinitionId)),
      createObject: (ctx: ServiceContext, input: CreateObjectInput) =>
        run(ctx, async (tx) => {
          const object = await schemaOps.createObject(tx, input, seedCustomObject);
          // Workspace access from the dialog (default Read and write) + Full access for the creator (X-06).
          await grantDefaultsOnCreate(tx, 'object', object.id, input.workspaceAccess ?? null);
          return object;
        }),
      updateObject: guarded('update_entity_definition', (tx, input: UpdateObjectInput) =>
        schemaOps.updateObject(tx, input, seedStandardObject),
      ),
      listAttributes: (ctx: ServiceContext, input: ListAttributesInput) =>
        run(ctx, (tx) => schemaOps.listAttributes(tx, input)),
      getAttribute: (ctx: ServiceContext, entityDefinitionId: string, attributeDefinitionId: string) =>
        run(ctx, (tx) => schemaOps.getAttribute(tx, entityDefinitionId, attributeDefinitionId)),
      /** Also formula attributes (formulaConfiguration) and AI autofill attributes (slice 10). */
      createAttribute: guarded('create_attribute_definition', (tx, input: CreateAttributeInput) =>
        createAttributeWithExtensions(tx, input),
      ),
      updateAttribute: guarded('update_attribute_definition', (tx, input: UpdateAttributeInput) =>
        updateAttributeWithExtensions(tx, input),
      ),
      listOptions: (ctx: ServiceContext, input: ListOptionsInput) => run(ctx, (tx) => schemaOps.listOptions(tx, input)),
      createOption: guarded('update_attribute_definition', (tx, input: CreateOptionInput) =>
        schemaOps.createOption(tx, input),
      ),
      updateOption: guarded('update_attribute_definition', (tx, input: UpdateOptionInput) =>
        schemaOps.updateOption(tx, input),
      ),
      listStages: (ctx: ServiceContext, input: ListOptionsInput) => run(ctx, (tx) => schemaOps.listStages(tx, input)),
      createStage: guarded('update_attribute_definition', (tx, input: CreateStageInput) =>
        schemaOps.createStage(tx, input),
      ),
      updateStage: guarded('update_attribute_definition', (tx, input: UpdateStageInput) =>
        schemaOps.updateStage(tx, input),
      ),
      rebuildProjection: (ctx: ServiceContext, entityDefinitionId: string) =>
        run(ctx, (tx) => schemaOps.rebuildProjection(tx, entityDefinitionId)),
      verifyProjection: (ctx: ServiceContext, entityDefinitionId: string) =>
        run(ctx, (tx) => schemaOps.verifyProjection(tx, entityDefinitionId)),
      ensureIndex: (
        ctx: ServiceContext,
        entityDefinitionId: string,
        attributeDefinitionId: string,
        kind?: 'sort' | 'contains',
      ) => run(ctx, (tx) => schemaOps.ensureIndex(tx, entityDefinitionId, attributeDefinitionId, kind)),
    },
    records: {
      create: guarded('create_entity_instance', (tx, input: CreateRecordInput) => recordOps.create(tx, input)),
      update: guarded('update_entity_instance', (tx, input: UpdateRecordInput) => recordOps.update(tx, input)),
      get: guarded('read_entity_instance', (tx, input: GetRecordInput) => recordOps.get(tx, input)),
      batchGet: guarded('read_entity_instance', (tx, input: BatchGetRecordsInput) => recordOps.batchGet(tx, input)),
      batchGetWithValues: guarded('read_entity_instance', (tx, input: BatchGetRecordsWithValuesInput) =>
        recordOps.batchGetWithValues(tx, input),
      ),
      findByUniqueValues: guarded('read_entity_instance', (tx, input: FindByUniqueValuesInput) =>
        recordOps.findByUniqueValues(tx, input),
      ),
      delete: guarded('delete_entity_instance', (tx, input: DeleteRecordInput) => recordOps.delete(tx, input)),
      /** Bulk delete of a selection over a snapshot: exactly the selected rows of the frozen id list. */
      deleteSelection: guarded('delete_entity_instance', async (tx, input: DeleteSelectionInput) => {
        const data = deleteSelectionInputSchema.parse(input);
        const def = await loadDefinition(tx, data.entityDefinitionId);
        const probe = await viewOps.chunk(tx, { snapshotId: data.snapshotId, start: 0, size: 1 });
        if (probe.entityDefinitionId !== def.id) {
          throw notFound('The snapshot has expired or does not exist', { snapshot_id: data.snapshotId });
        }
        if (zebraSize(zebraClamp(data.zebraEdges, probe.total)) > DELETE_SELECTION_MAX_ROWS) {
          throw badRequest('VALIDATION_ERROR', `At most ${DELETE_SELECTION_MAX_ROWS} rows per call`);
        }
        const { ids } = await viewOps.resolveSelection(tx, {
          snapshotId: data.snapshotId,
          zebraEdges: data.zebraEdges,
        });
        return recordOps.deleteMany(tx, { entityDefinitionId: def.id, entityInstanceIds: ids });
      }),
      restore: guarded('delete_entity_instance', (tx, input: RestoreRecordInput) => recordOps.restore(tx, input)),
      merge: guarded('update_entity_instance', (tx, input: MergeRecordsInput) => recordOps.merge(tx, input)),
    },
    values: {
      list: guarded('read_attribute_value', (tx, input: ListValuesInput) => recordOps.listValues(tx, input)),
      put: guarded('update_attribute_value', (tx, input: PutValueInput) => recordOps.putValue(tx, input)),
      retire: guarded('update_attribute_value', (tx, input: RetireValueInput) => recordOps.retireValue(tx, input)),
      reorder: guarded('update_attribute_value', (tx, input: ReorderValueInput) => recordOps.reorderValue(tx, input)),
      history: guarded('read_attribute_value', (tx, input: ValueHistoryInput) => recordOps.history(tx, input)),
    },
    views: {
      list: (ctx: ServiceContext, input: ListViewsInput) => run(ctx, (tx) => viewOps.list(tx, input)),
      get: (ctx: ServiceContext, viewId: string) => run(ctx, (tx) => viewOps.get(tx, viewId)),
      create: guarded('create_entity_view', (tx, input: CreateViewInput) => viewOps.create(tx, input)),
      update: (ctx: ServiceContext, input: UpdateViewInput) => run(ctx, (tx) => viewOps.update(tx, input)),
      delete: (ctx: ServiceContext, viewId: string) => run(ctx, (tx) => viewOps.delete(tx, viewId)),
      setFilter: (ctx: ServiceContext, input: SetViewFilterInput) => run(ctx, (tx) => viewOps.setFilter(tx, input)),
      setSorts: (ctx: ServiceContext, input: SetViewSortsInput) => run(ctx, (tx) => viewOps.setSorts(tx, input)),
      addColumn: (ctx: ServiceContext, input: AddColumnInput) => run(ctx, (tx) => viewOps.addColumn(tx, input)),
      updateColumn: (ctx: ServiceContext, input: UpdateColumnInput) =>
        run(ctx, (tx) => viewOps.updateColumn(tx, input)),
      removeColumn: (ctx: ServiceContext, input: RemoveColumnInput) =>
        run(ctx, (tx) => viewOps.removeColumn(tx, input)),
      query: guarded('read_entity_instance', (tx, input: QuerySnapshotInput) => viewOps.query(tx, input)),
      chunk: (ctx: ServiceContext, input: SnapshotChunkInput) => run(ctx, (tx) => viewOps.chunk(tx, input)),
      resolveSelection: (ctx: ServiceContext, input: ResolveSelectionInput) =>
        run(ctx, (tx) => viewOps.resolveSelection(tx, input)),
      aggregate: (ctx: ServiceContext, input: AggregateInput) => run(ctx, (tx) => viewOps.aggregate(tx, input)),
      purgeExpired: (ctx: ServiceContext) => run(ctx, (tx) => viewOps.purgeExpired(tx)),
    },
    /** Lists (collections + collection-entry definitions), access levels (slice 4). */
    lists: {
      list: (ctx: ServiceContext, input?: ListListsInput) => run(ctx, (tx) => lists.list(tx, input)),
      get: (ctx: ServiceContext, input: ListRefInput) => run(ctx, (tx) => lists.get(tx, input)),
      create: (ctx: ServiceContext, input: CreateListInput) =>
        run(ctx, async (tx) => {
          const created = await lists.create(tx, input);
          // Member grants given at creation share the list with those members (notification list-shared).
          await notifyListShared(tx, created.list.id, new Map(), await memberGrantsOf(tx, created.list.id));
          return created;
        }),
      update: (ctx: ServiceContext, input: UpdateListInput) => run(ctx, (tx) => lists.update(tx, input)),
      duplicate: (ctx: ServiceContext, input: DuplicateListInput) => run(ctx, (tx) => lists.duplicate(tx, input)),
      delete: (ctx: ServiceContext, input: DeleteListInput) => run(ctx, (tx) => lists.delete(tx, input)),
      setAccess: (ctx: ServiceContext, input: SetListAccessInput) =>
        run(ctx, async (tx) => {
          const listId = await loadDefinition(tx, input.listId).then(
            (d) => d.id,
            () => null,
          );
          const before = listId ? await memberGrantsOf(tx, listId) : new Map();
          const list = await lists.setAccess(tx, input);
          await notifyListShared(tx, list.id, before, await memberGrantsOf(tx, list.id));
          return list;
        }),
    },
    /** List entries: add (duplicate handling), duplicate check, remove, one entry, a record's entries. */
    entries: {
      add: (ctx: ServiceContext, input: AddEntriesInput) => run(ctx, (tx) => entries.add(tx, input)),
      checkDuplicates: (ctx: ServiceContext, input: CheckDuplicatesInput) =>
        run(ctx, (tx) => entries.checkDuplicates(tx, input)),
      remove: (ctx: ServiceContext, input: RemoveEntriesInput) => run(ctx, (tx) => entries.remove(tx, input)),
      get: (ctx: ServiceContext, input: GetEntryInput) => run(ctx, (tx) => entries.get(tx, input)),
      forRecord: (ctx: ServiceContext, input: EntriesForRecordInput) => run(ctx, (tx) => entries.forRecord(tx, input)),
    },
    /** Kanban boards over objects and lists: columns, column paging, moves, time in stage. */
    kanban: {
      columns: (ctx: ServiceContext, input: KanbanColumnsInput) => run(ctx, (tx) => kanban.columns(tx, input)),
      columnChunk: (ctx: ServiceContext, input: KanbanColumnChunkInput) =>
        run(ctx, (tx) => kanban.columnChunk(tx, input)),
      move: (ctx: ServiceContext, input: KanbanMoveInput) => run(ctx, (tx) => kanban.move(tx, input)),
      timeInStage: (ctx: ServiceContext, input: KanbanTimeInStageInput) =>
        run(ctx, (tx) => kanban.timeInStage(tx, input)),
    },
    search: {
      /** Ranked record search over the objects the caller may read (pickers, add-to-list, mentions). */
      records: (ctx: ServiceContext, input: SearchRecordsInput) =>
        run(ctx, (tx) => searchOps.records(tx, input, (defs) => policies.allowed(tx, defs, 'read_entity_instance'))),
      members: (ctx: ServiceContext, input: SearchMembersInput) => run(ctx, (tx) => searchOps.members(tx, input)),
      /** Recomputes the search index of the workspace (or of one object) from the current values. */
      rebuildIndex: (ctx: ServiceContext, entityDefinitionId?: string) =>
        run(ctx, (tx) => rebuildSearchIndex(tx, entityDefinitionId)),
    },
    /** The member's inbox and notification preferences (slice 5; producers live in the owning services). */
    notifications: {
      list: (ctx: ServiceContext, input: ListNotificationsInput) => run(ctx, (tx) => notifications.list(tx, input)),
      unreadCount: (ctx: ServiceContext) => run(ctx, (tx) => notifications.unreadCount(tx)),
      markRead: (ctx: ServiceContext, input: MarkNotificationsReadInput) =>
        run(ctx, (tx) => notifications.markRead(tx, input)),
      markUnread: (ctx: ServiceContext, input: MarkNotificationsUnreadInput) =>
        run(ctx, (tx) => notifications.markUnread(tx, input)),
      archive: (ctx: ServiceContext, input: ArchiveNotificationsInput) =>
        run(ctx, (tx) => notifications.archive(tx, input)),
      preferences: {
        get: (ctx: ServiceContext) => run(ctx, (tx) => notifications.getPreferences(tx)),
        update: (ctx: ServiceContext, input: UpdateNotificationPreferenceInput) =>
          run(ctx, (tx) => notifications.updatePreference(tx, input)),
      },
      /** Worker: the email channel stub (pending email deliveries → skipped until slice 7). */
      drainEmailDeliveries: (options?: { limit?: number }) => drainEmailDeliveries(database, options),
    },
    /** Home page summary (greeting, tasks block, recent records). */
    home: {
      summary: (ctx: ServiceContext, input: HomeSummaryInput) => run(ctx, (tx) => home.summary(tx, input)),
    },
    policies: {
      resolve: (ctx: ServiceContext, input: ResolvePoliciesInput) => run(ctx, (tx) => policies.resolve(tx, input)),
    },
    capabilities: {
      get: (ctx: ServiceContext) => run(ctx, (tx) => capabilityOps.get(tx)),
      hasFeature: (ctx: ServiceContext, key: string) => run(ctx, (tx) => capabilityOps.hasFeature(tx, key)),
      quota: (ctx: ServiceContext, key: string) => run(ctx, (tx) => capabilityOps.quota(tx, key)),
    },
    ...collabServices,
    ...importServices,
    ...exportServices,
    ...emailServices,
    /** Meetings (slice 7) with their call recordings from calls/ (slice 10: speakers, processing, events). */
    meetings: { ...emailServices.meetings, recordings: callServices.meetingRecordings },
    /** Calls (slice 10): list, call page, transcript, speakers, insights, member settings, worker entry points. */
    calls: callServices.calls,
    /** Insight templates (slice 10): sections, versions (publish / discard), presets, previews. */
    insightTemplates: callServices.insightTemplates,
    /** Workflows (slice 8): editor, versions, runs, triggers, catalogue, usage and the engine entry points. */
    ...workflowServices,
    /** Slice 9: dashboards, reports, reporting.dataset. */
    ...reportServices,
    /** Slice 10 (S10-ASK): Ask Agentic, prompts, credits, record summaries. */
    ...aiServices,
    /** Slice 10: formula attributes (formulas.*) and AI autofill attributes (aiAttributes.*). */
    ...formulaServices,
    /**
     * Rich-text bodies (notes, templates): Yjs state + blocks/markdown projections (documents/service.ts), plus
     * `owner` (which note / template a document belongs to) from the collab services.
     */
    documents: { ...collabServices.documents, ...documentsApi(database, policies) },
    /** The LLM client (slice 10): `configured` drives the "AI not configured" state. */
    llm,
    apiTokens: {
      create: (ctx: ServiceContext, input: CreateApiTokenInput) => run(ctx, (tx) => apiTokenOps.create(tx, input)),
      list: (ctx: ServiceContext) => run(ctx, (tx) => apiTokenOps.list(tx)),
      update: (ctx: ServiceContext, input: UpdateApiTokenInput) => run(ctx, (tx) => apiTokenOps.update(tx, input)),
      revoke: (ctx: ServiceContext, tokenId: string) => run(ctx, (tx) => apiTokenOps.revoke(tx, tokenId)),
      authenticate: (secret: string) => apiTokenOps.authenticate(database, secret),
    },
  };
}

export type Domain = ReturnType<typeof createDomain>;
