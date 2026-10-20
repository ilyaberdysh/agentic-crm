import type { ModelTargetsTable } from '@agentic-crm/db';
import { type Database, type Selectable, sql } from '@agentic-crm/db';
import { AnthropicInferenceAdapter } from '../ai/adapters/anthropic.ts';
import { OpenAICompatibleInferenceAdapter } from '../ai/adapters/openai-compatible.ts';
import { InferenceError, type InferenceRequest, type InferenceUsage } from '../ai/inference.ts';
import { type ServiceContext, systemContext } from '../context.ts';
import { badRequest, conflict, DomainError, forbidden, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import { runInWorkspace, type Tx } from '../tx.ts';
import { ProviderConnectionSecrets } from './connection-secrets.ts';
import { bindingOf, caller, loadConnection } from './connections.ts';
import {
  type ClaimedRunnerModelInvocation,
  type CompleteRunnerInvocationInput,
  type ConfigureModelTargetInput,
  type CreateModelTargetInput,
  createModelTargetSchema,
  type InvokeModelTargetInput,
  localFeaturesSchema,
  type ModelInvocationResult,
  type ModelInvocationState,
  type ModelTargetMetadata,
  normalizeLocalEndpoint,
  targetIdSchema,
} from './contracts.ts';
import { RunnerDispatchSecrets } from './runner-dispatch-secrets.ts';
import { normalizeInvocationUsage, safeFailureCode, safeInferenceError, unavailableUsage } from './safety.ts';

type Target = Selectable<ModelTargetsTable>;
type Member = Awaited<ReturnType<typeof caller>>;
export interface ModelGatewayOptions {
  database: Database;
  encryptionKey: Buffer;
  /** Trusted server transport seam for tests. Production destinations are still fixed below. */
  fetch?: typeof fetch;
  /** Must verify current enrollment, workspace, runner owner, and enabled state. Missing callback denies. */
  authorizeRunner?: (tx: Tx, identity: { runnerId: string; memberId: string }) => Promise<void>;
  /** Authenticate the server-side session/lease and derive the principal. Never accept these claims from a payload. */
  authenticateRunnerCompletion?: (
    proof: unknown,
  ) => Promise<{ workspaceId: string; runnerId: string; memberId: string }>;
}

function id(value: unknown): string {
  const parsed = targetIdSchema.safeParse(value);
  if (!parsed.success) throw badRequest('VALIDATION_ERROR', 'Invalid model target input');
  return parsed.data;
}
function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw badRequest('VALIDATION_ERROR', 'Invalid model target version');
  return value;
}
function checkVersion(actual: number, expected: number) {
  if (actual !== version(expected))
    throw conflict('VERSION_CONFLICT', 'The model target or connection version has changed');
}
function metadata(row: Target): ModelTargetMetadata {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    owner: { kind: row.owner_kind, id: row.owner_id },
    name: row.name,
    kind: row.kind,
    provider: row.provider,
    model: row.model,
    enabled: row.enabled,
    version: row.version,
    adapterKind: row.provider === 'anthropic' ? 'anthropic-api' : 'openai-compatible',
    executionHost: row.kind === 'cloud-api' ? 'cloud-worker' : 'runner',
    dataDestination: row.kind === 'cloud-api' ? 'cloud' : 'runner-loopback',
    connection: row.connection_id ? { id: row.connection_id, version: row.connection_version! } : null,
    runner: row.runner_id
      ? { id: row.runner_id, endpoint: row.endpoint!, features: localFeaturesSchema.parse(row.features) }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
async function loadTarget(
  tx: Tx,
  member: Pick<Member, 'id'>,
  targetId: string,
  lock: 'share' | 'update' = 'share',
): Promise<Target> {
  const { rows } = await sql<Target>`SELECT * FROM model_targets
    WHERE workspace_id = ${tx.workspaceId}::uuid AND id = ${targetId}::uuid
      AND (owner_kind = 'workspace' OR (owner_kind = 'member' AND owner_id = ${member.id}::uuid))
    ${lock === 'update' ? sql`FOR UPDATE` : sql`FOR SHARE`}`.execute(tx.db);
  if (!rows[0]) throw notFound('Model target not found');
  return rows[0];
}
function manage(row: Target, member: Member) {
  if (row.owner_kind === 'workspace' && member.access_level !== 'admin')
    throw forbidden('Only workspace admins can manage workspace model targets');
}
function targetChanges(tx: Tx, member: Member, row: Target) {
  tx.emit(
    'ai-settings',
    null,
    { scope: 'model-targets', ...(row.owner_kind === 'member' ? { memberId: member.id } : {}) },
    row.owner_kind === 'member' ? { userIds: [member.user_id] } : null,
  );
}
function usageFields(usage: InferenceUsage) {
  const u = normalizeInvocationUsage(usage);
  return {
    input_tokens: u.inputTokens,
    output_tokens: u.outputTokens,
    cache_read_tokens: u.cacheReadTokens,
    cache_write_tokens: u.cacheWriteTokens,
    cost_status: u.cost.status,
    cost_reason: u.cost.status === 'unknown' ? u.cost.reason : null,
    micro_usd: u.cost.status === 'known' ? u.cost.microUsd : null,
  };
}

/** Server-only dispatch boundary. Do not expose invoke/completion as an unrestricted transport endpoint. */
export function createModelGateway(options: ModelGatewayOptions) {
  const secrets = new ProviderConnectionSecrets(options.encryptionKey);
  const dispatchSecrets = new RunnerDispatchSecrets(options.encryptionKey);
  async function authenticatedRunner(proof: unknown) {
    if (!options.authenticateRunnerCompletion) throw forbidden('An authenticated runner session is required');
    try {
      const principal = await options.authenticateRunnerCompletion(proof);
      return {
        workspaceId: id(principal.workspaceId),
        runnerId: id(principal.runnerId),
        memberId: id(principal.memberId),
      };
    } catch {
      throw forbidden('An authenticated runner session is required');
    }
  }
  async function runner(tx: Tx, runnerId: string, memberId: string) {
    if (!options.authorizeRunner) throw forbidden('An enrolled runner is required');
    try {
      await options.authorizeRunner(tx, { runnerId, memberId });
    } catch {
      throw forbidden('The runner is unavailable to this member');
    }
  }
  async function checkRoute(tx: Tx, member: Member, row: Target) {
    if (!row.enabled) throw new InferenceError('not_configured', 'The model target is disabled');
    if (row.kind === 'runner-local') {
      if (row.provider !== 'openai-compatible' || !row.runner_id || row.connection_id)
        throw new InferenceError('not_configured', 'The model target route is invalid');
      try {
        normalizeLocalEndpoint(row.endpoint!);
        localFeaturesSchema.parse(row.features);
      } catch {
        throw new InferenceError('not_configured', 'The model target route is invalid');
      }
      await runner(tx, row.runner_id, member.id);
      return null;
    }
    if (!row.connection_id || row.runner_id || row.endpoint || !['openai', 'anthropic'].includes(row.provider))
      throw new InferenceError('not_configured', 'The model target route is invalid');
    const connection = await loadConnection(tx, member, row.connection_id, 'share');
    if (!connection.enabled) throw new InferenceError('not_configured', 'The provider connection is disabled');
    checkVersion(connection.version, row.connection_version!);
    if (
      connection.provider !== row.provider ||
      (row.owner_kind === 'workspace' && connection.owner_kind !== 'workspace')
    )
      throw forbidden('The provider connection does not match the model target');
    return connection;
  }
  async function save(
    ctx: ServiceContext,
    input: CreateModelTargetInput | ConfigureModelTargetInput,
    updating: boolean,
  ) {
    const raw = input as ConfigureModelTargetInput;
    const { expectedVersion: _expected, ...unversioned } = raw;
    const result = createModelTargetSchema.safeParse(unversioned);
    if (!result.success)
      throw badRequest('VALIDATION_ERROR', 'Invalid model target input; custom hosted endpoints are unsupported');
    const data = result.data;
    return runInWorkspace(options.database, ctx, async (tx) => {
      const member = await caller(tx);
      if (data.ownerKind === 'workspace' && member.access_level !== 'admin')
        throw forbidden('Only workspace admins can manage workspace model targets');
      const old = updating ? await loadTarget(tx, member, data.id, 'update') : null;
      if (old) {
        manage(old, member);
        checkVersion(old.version, raw.expectedVersion);
        if (old.owner_kind !== data.ownerKind) throw conflict('ID_CONFLICT', 'Model target ownership is immutable');
      }
      const values = {
        name: data.name,
        kind: data.kind,
        provider: data.provider,
        model: data.model,
        connection_id: data.kind === 'cloud-api' ? data.connectionId : null,
        connection_version: data.kind === 'cloud-api' ? data.connectionVersion : null,
        runner_id: data.kind === 'runner-local' ? data.runnerId : null,
        endpoint: data.kind === 'runner-local' ? data.endpoint : null,
        features: data.kind === 'runner-local' ? JSON.stringify(data.features) : null,
      };
      const candidate = {
        ...values,
        id: data.id,
        workspace_id: tx.workspaceId,
        owner_kind: data.ownerKind,
        owner_id: data.ownerKind === 'workspace' ? tx.workspaceId : member.id,
        enabled: true,
        version: (old?.version ?? 0) + 1,
        created_by_member_id: member.id,
        created_at: old?.created_at ?? tx.now,
        updated_at: tx.now,
      };
      // JSON text is a write convention; validation operates on the object form.
      await checkRoute(tx, member, { ...candidate, features: data.kind === 'runner-local' ? data.features : null });
      const row = old
        ? await tx.db
            .updateTable('model_targets')
            .set({ ...values, enabled: true, version: old.version + 1, updated_at: tx.now })
            .where('id', '=', old.id)
            .where('workspace_id', '=', tx.workspaceId)
            .returningAll()
            .executeTakeFirstOrThrow()
        : await tx.db.insertInto('model_targets').values(candidate).returningAll().executeTakeFirstOrThrow();
      targetChanges(tx, member, row);
      return metadata(row);
    });
  }

  return {
    targets: {
      create: (ctx: ServiceContext, input: CreateModelTargetInput) => save(ctx, input, false),
      configure: (ctx: ServiceContext, input: ConfigureModelTargetInput) => save(ctx, input, true),
      get: (ctx: ServiceContext, targetId: string) =>
        runInWorkspace(options.database, ctx, async (tx) =>
          metadata(await loadTarget(tx, await caller(tx), id(targetId))),
        ),
      list: (ctx: ServiceContext) =>
        runInWorkspace(options.database, ctx, async (tx) => {
          const member = await caller(tx);
          const rows = await tx.db
            .selectFrom('model_targets')
            .selectAll()
            .where('workspace_id', '=', tx.workspaceId)
            .where((eb) =>
              eb.or([
                eb('owner_kind', '=', 'workspace'),
                eb.and([eb('owner_kind', '=', 'member'), eb('owner_id', '=', member.id)]),
              ]),
            )
            .orderBy('created_at')
            .orderBy('id')
            .execute();
          return rows.map(metadata);
        }),
      disable: (ctx: ServiceContext, input: { id: string; expectedVersion: number }) =>
        runInWorkspace(options.database, ctx, async (tx) => {
          const member = await caller(tx);
          const row = await loadTarget(tx, member, id(input.id), 'update');
          manage(row, member);
          checkVersion(row.version, input.expectedVersion);
          if (!row.enabled) return metadata(row);
          const changed = await tx.db
            .updateTable('model_targets')
            .set({ enabled: false, version: row.version + 1, updated_at: tx.now })
            .where('id', '=', row.id)
            .where('workspace_id', '=', tx.workspaceId)
            .returningAll()
            .executeTakeFirstOrThrow();
          targetChanges(tx, member, changed);
          return metadata(changed);
        }),
    },

    async invoke(ctx: ServiceContext, input: InvokeModelTargetInput): Promise<ModelInvocationResult> {
      const targetId = id(input.targetId);
      const expected = version(input.expectedVersion);
      const invocationId = newId();
      if (!input.request || !Array.isArray(input.request.messages) || typeof input.request.purpose !== 'string')
        throw badRequest('VALIDATION_ERROR', 'Invalid inference request');
      // Reserve a durable unknown-usage row before external I/O. No prompts, results, errors, endpoints, or keys are stored.
      await runInWorkspace(options.database, ctx, async (tx) => {
        const member = await caller(tx);
        const target = await loadTarget(tx, member, targetId);
        checkVersion(target.version, expected);
        await checkRoute(tx, member, target);
        await tx.db
          .insertInto('model_invocations')
          .values({
            id: invocationId,
            workspace_id: tx.workspaceId,
            target_id: target.id,
            target_version: target.version,
            member_id: member.id,
            provider: target.provider,
            model: target.model,
            connection_id: target.connection_id,
            connection_version: target.connection_version,
            runner_id: target.runner_id,
            outcome: 'pending',
            failure_code: null,
            ...usageFields(unavailableUsage()),
            completed_at: null,
          })
          .execute();
        if (target.kind === 'runner-local') {
          const binding = {
            workspaceId: tx.workspaceId,
            invocationId,
            runnerId: target.runner_id!,
            targetId: target.id,
            targetVersion: target.version,
          };
          const request: InferenceRequest = { ...input.request, model: target.model, signal: undefined };
          const sealed = dispatchSecrets.seal(request, binding);
          await sql`INSERT INTO model_runner_dispatches
            (invocation_id, workspace_id, runner_id, target_id, target_version, encrypted_request)
            VALUES (${invocationId}::uuid, ${tx.workspaceId}::uuid, ${target.runner_id}::uuid,
              ${target.id}::uuid, ${target.version}, ${JSON.stringify(sealed)}::jsonb)`.execute(tx.db);
        }
      });
      try {
        // Recheck current authority and materialize encrypted credentials in a short transaction. No provider I/O
        // occurs inside this retryable transaction, and neither plaintext nor SDK instances are materialized here.
        const { target, connection } = await runInWorkspace(options.database, ctx, async (tx) => {
          const member = await caller(tx);
          const target = await loadTarget(tx, member, targetId);
          checkVersion(target.version, expected);
          const connection = await checkRoute(tx, member, target);
          return { target, connection };
        });
        const request: InferenceRequest = {
          ...input.request,
          model: target.model,
          signal: input.request.signal
            ? AbortSignal.any([input.request.signal, AbortSignal.timeout(120_000)])
            : AbortSignal.timeout(120_000),
        };
        if (request.signal?.aborted) throw new InferenceError('canceled', 'Inference was canceled');
        if (!connection) return { kind: 'runner-required', code: 'RUNNER_REQUIRED', invocationId };
        // Deliberately outside every database transaction and retry loop. One invocation means one HTTP attempt.
        const response = await secrets.invoke(
          connection.encrypted_credentials,
          bindingOf(connection),
          async (apiKey) => {
            const fixedFetch: typeof fetch = (url, init) =>
              (options.fetch ?? fetch)(url, { ...init, redirect: 'error' });
            const adapter =
              target.provider === 'anthropic'
                ? new AnthropicInferenceAdapter({
                    apiKey,
                    baseURL: 'https://api.anthropic.com',
                    maxRetries: 0,
                    fetch: fixedFetch,
                  })
                : new OpenAICompatibleInferenceAdapter({
                    apiKey,
                    baseURL: 'https://api.openai.com/v1',
                    defaultModel: target.model,
                    features: { text: true, clientTools: true, structuredOutput: 'native', streaming: true },
                    fetch: fixedFetch,
                  });
            return { ...(await adapter.complete(request)), provider: target.provider };
          },
        );
        await runInWorkspace(options.database, systemContext(ctx.workspaceId, 'model-invocation-usage'), async (tx) => {
          await tx.db
            .updateTable('model_invocations')
            .set({ outcome: 'completed', ...usageFields(response.usage), completed_at: tx.now })
            .where('id', '=', invocationId)
            .where('workspace_id', '=', tx.workspaceId)
            .where('outcome', '=', 'pending')
            .execute();
        });
        return { kind: 'completed', invocationId, response };
      } catch (error) {
        // The reservation survives rollback/crash. A failed pre-dispatch recheck or DB transaction is recorded once.
        const safe = error instanceof DomainError ? error : safeInferenceError(error);
        await runInWorkspace(options.database, systemContext(ctx.workspaceId, 'model-invocation-usage'), async (tx) => {
          await tx.db
            .updateTable('model_invocations')
            .set({
              outcome: error instanceof InferenceError && error.code === 'canceled' ? 'canceled' : 'failed',
              failure_code: safeFailureCode((error as InferenceError)?.code),
              completed_at: tx.now,
            })
            .where('id', '=', invocationId)
            .where('workspace_id', '=', tx.workspaceId)
            .where('outcome', '=', 'pending')
            .execute();
          await sql`UPDATE model_runner_dispatches SET status = 'settled', encrypted_request = NULL,
            lease_expires_at = NULL, settled_at = clock_timestamp()
            WHERE workspace_id = ${tx.workspaceId}::uuid AND invocation_id = ${invocationId}::uuid
              AND status IN ('queued', 'leased')`.execute(tx.db);
        });
        throw safe;
      }
    },

    /** Outbound poll. Each claim is fenced; the plaintext exists only in this authenticated response. */
    async claimRunnerInvocations(proof: unknown, limit = 1): Promise<ClaimedRunnerModelInvocation[]> {
      const principal = await authenticatedRunner(proof);
      if (!Number.isInteger(limit) || limit < 1 || limit > 10)
        throw badRequest('VALIDATION_ERROR', 'Invalid runner claim limit');
      const claimed = await runInWorkspace(
        options.database,
        systemContext(principal.workspaceId, 'runner-model-claim'),
        async (tx) => {
          await runner(tx, principal.runnerId, principal.memberId);
          const { rows } = await sql<{
            invocationId: string;
            runnerId: string;
            targetId: string;
            targetVersion: number;
            encryptedRequest: unknown;
            endpoint: string;
            model: string;
            features: unknown;
          }>`SELECT d.invocation_id AS "invocationId", d.runner_id AS "runnerId",
            d.target_id AS "targetId", d.target_version AS "targetVersion",
            d.encrypted_request AS "encryptedRequest", t.endpoint, t.model, t.features
            FROM model_runner_dispatches d
            JOIN model_invocations i ON i.workspace_id = d.workspace_id AND i.id = d.invocation_id
            JOIN model_targets t ON t.workspace_id = d.workspace_id AND t.id = d.target_id
            WHERE d.workspace_id = ${tx.workspaceId}::uuid AND d.runner_id = ${principal.runnerId}::uuid
              AND i.member_id = ${principal.memberId}::uuid AND i.outcome = 'pending'
              AND t.enabled = true AND t.version = d.target_version AND t.runner_id = d.runner_id
              AND (d.status = 'queued' OR (d.status = 'leased' AND d.lease_expires_at < clock_timestamp()))
            ORDER BY d.created_at, d.invocation_id FOR UPDATE OF d SKIP LOCKED LIMIT ${limit}`.execute(tx.db);
          const leases = [];
          for (const row of rows) {
            const { rows: updated } = await sql<{ generation: string }>`UPDATE model_runner_dispatches
              SET status = 'leased', lease_generation = lease_generation + 1,
                lease_expires_at = clock_timestamp() + interval '60 seconds'
              WHERE workspace_id = ${tx.workspaceId}::uuid AND invocation_id = ${row.invocationId}::uuid
              RETURNING lease_generation::text AS generation`.execute(tx.db);
            leases.push({ ...row, leaseGeneration: updated[0]!.generation });
          }
          return leases;
        },
      );
      return claimed.map((row) => ({
        invocationId: row.invocationId,
        leaseGeneration: row.leaseGeneration,
        targetId: row.targetId,
        targetVersion: row.targetVersion,
        provider: 'openai-compatible' as const,
        model: row.model,
        endpoint: normalizeLocalEndpoint(row.endpoint),
        features: localFeaturesSchema.parse(row.features),
        request: dispatchSecrets.open(row.encryptedRequest, {
          workspaceId: principal.workspaceId,
          invocationId: row.invocationId,
          runnerId: row.runnerId,
          targetId: row.targetId,
          targetVersion: row.targetVersion,
        }),
      }));
    },

    async heartbeatRunnerInvocation(input: { invocationId: string; leaseGeneration: string }, proof: unknown) {
      const principal = await authenticatedRunner(proof);
      const invocationId = id(input.invocationId);
      if (!/^[1-9]\d*$/.test(input.leaseGeneration))
        throw badRequest('VALIDATION_ERROR', 'Invalid runner lease generation');
      return runInWorkspace(
        options.database,
        systemContext(principal.workspaceId, 'runner-model-heartbeat'),
        async (tx) => {
          await runner(tx, principal.runnerId, principal.memberId);
          const { rows } = await sql<{ expiresAt: string }>`UPDATE model_runner_dispatches d
            SET lease_expires_at = clock_timestamp() + interval '60 seconds'
            FROM model_invocations i
            WHERE d.workspace_id = ${tx.workspaceId}::uuid AND d.invocation_id = ${invocationId}::uuid
              AND d.runner_id = ${principal.runnerId}::uuid AND d.status = 'leased'
              AND d.lease_generation = ${input.leaseGeneration}::bigint
              AND d.lease_expires_at > clock_timestamp()
              AND i.workspace_id = d.workspace_id AND i.id = d.invocation_id
              AND i.member_id = ${principal.memberId}::uuid AND i.outcome = 'pending'
            RETURNING d.lease_expires_at AS "expiresAt"`.execute(tx.db);
          if (!rows[0]) throw conflict('VERSION_CONFLICT', 'Runner invocation lease has expired');
          return { invocationId, leaseGeneration: input.leaseGeneration, expiresAt: rows[0].expiresAt };
        },
      );
    },

    async getRunnerInvocation(ctx: ServiceContext, rawId: string): Promise<ModelInvocationState> {
      const invocationId = id(rawId);
      const row = await runInWorkspace(options.database, ctx, async (tx) => {
        const member = await caller(tx);
        const { rows } = await sql<{
          outcome: ModelInvocationState['outcome'];
          failureCode: string | null;
          inputTokens: number | null;
          outputTokens: number | null;
          cacheReadTokens: number | null;
          cacheWriteTokens: number | null;
          costStatus: 'known' | 'unknown';
          costReason: 'unknown_model_price' | 'usage_unavailable' | null;
          microUsd: string | null;
          runnerId: string;
          targetId: string;
          targetVersion: number;
          encryptedResponse: unknown;
        }>`SELECT i.outcome, i.failure_code AS "failureCode",
          i.input_tokens AS "inputTokens", i.output_tokens AS "outputTokens",
          i.cache_read_tokens AS "cacheReadTokens", i.cache_write_tokens AS "cacheWriteTokens",
          i.cost_status AS "costStatus", i.cost_reason AS "costReason", i.micro_usd::text AS "microUsd",
          i.runner_id AS "runnerId", i.target_id AS "targetId", i.target_version AS "targetVersion",
          d.encrypted_response AS "encryptedResponse"
          FROM model_invocations i JOIN model_runner_dispatches d
            ON d.workspace_id = i.workspace_id AND d.invocation_id = i.id
          WHERE i.workspace_id = ${tx.workspaceId}::uuid AND i.id = ${invocationId}::uuid
            AND i.member_id = ${member.id}::uuid`.execute(tx.db);
        if (!rows[0]) throw notFound('Runner invocation not found');
        return rows[0];
      });
      const knownCost =
        row.costStatus === 'known' && row.microUsd !== null && Number.isSafeInteger(Number(row.microUsd));
      return {
        invocationId,
        outcome: row.outcome,
        failureCode: row.failureCode,
        text:
          row.outcome === 'completed' && row.encryptedResponse
            ? dispatchSecrets.openResponse(row.encryptedResponse, {
                workspaceId: ctx.workspaceId,
                invocationId,
                runnerId: row.runnerId,
                targetId: row.targetId,
                targetVersion: row.targetVersion,
              })
            : null,
        usage: {
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          cacheReadTokens: row.cacheReadTokens,
          cacheWriteTokens: row.cacheWriteTokens,
          serverToolRequests: {},
          cost: knownCost
            ? { status: 'known', microUsd: Number(row.microUsd) }
            : { status: 'unknown', reason: row.costReason ?? 'usage_unavailable' },
        },
      };
    },

    async completeRunnerInvocation(input: CompleteRunnerInvocationInput, proof: unknown): Promise<void> {
      const invocationId = id(input.invocationId);
      if (!/^[1-9]\d*$/.test(input.leaseGeneration))
        throw badRequest('VALIDATION_ERROR', 'Invalid runner lease generation');
      if (!['completed', 'failed', 'canceled'].includes(input.outcome))
        throw badRequest('VALIDATION_ERROR', 'Invalid runner invocation outcome');
      if (input.outcome === 'completed' && (typeof input.text !== 'string' || input.text.length > 100_000))
        throw badRequest('VALIDATION_ERROR', 'A bounded runner response is required');
      if (input.outcome !== 'completed' && input.text !== undefined)
        throw badRequest('VALIDATION_ERROR', 'Failed runner invocation cannot include a response');
      const principal = await authenticatedRunner(proof);
      await runInWorkspace(options.database, systemContext(principal.workspaceId, 'runner-model-usage'), async (tx) => {
        await runner(tx, principal.runnerId, principal.memberId);
        const invocation = await tx.db
          .selectFrom('model_invocations')
          .selectAll()
          .where('workspace_id', '=', tx.workspaceId)
          .where('id', '=', invocationId)
          .where('member_id', '=', principal.memberId)
          .forUpdate()
          .executeTakeFirst();
        if (!invocation || invocation.runner_id !== principal.runnerId || invocation.connection_id)
          throw notFound('Runner invocation not found');
        // The bound member is loaded from durable state under the authenticated runner's workspace, never from
        // an impersonated member context or claims supplied with the completion payload.
        const member = await tx.db
          .selectFrom('workspace_members')
          .select(['id', 'access_level'])
          .where('workspace_id', '=', tx.workspaceId)
          .where('id', '=', invocation.member_id)
          .where('removed_at', 'is', null)
          .forShare()
          .executeTakeFirst();
        if (!member || !['admin', 'member'].includes(member.access_level))
          throw forbidden('The bound runner member is inactive');
        const target = await loadTarget(tx, member, invocation.target_id);
        if (target.runner_id !== principal.runnerId || target.owner_id !== member.id)
          throw forbidden('The runner binding has changed');
        const { rows: dispatches } = await sql<{ status: string; generation: string; live: boolean }>`
          SELECT status, lease_generation::text AS generation,
            lease_expires_at > clock_timestamp() AS live FROM model_runner_dispatches
          WHERE workspace_id = ${tx.workspaceId}::uuid AND invocation_id = ${invocationId}::uuid
            AND runner_id = ${principal.runnerId}::uuid FOR UPDATE`.execute(tx.db);
        const dispatch = dispatches[0];
        if (!dispatch || dispatch.generation !== input.leaseGeneration)
          throw conflict('VERSION_CONFLICT', 'Runner invocation lease has changed');
        if (dispatch.status === 'settled' && invocation.outcome !== 'pending') return;
        if (dispatch.status !== 'leased' || !dispatch.live)
          throw conflict('VERSION_CONFLICT', 'Runner invocation lease has expired');
        if (invocation.outcome !== 'pending')
          throw conflict('VERSION_CONFLICT', 'Runner invocation is already settled');
        await tx.db
          .updateTable('model_invocations')
          .set({
            outcome: input.outcome,
            ...usageFields(normalizeInvocationUsage(input.usage)),
            failure_code: input.outcome === 'completed' ? null : safeFailureCode(input.failureCode),
            completed_at: tx.now,
          })
          .where('id', '=', invocationId)
          .where('workspace_id', '=', tx.workspaceId)
          .where('outcome', '=', 'pending')
          .execute();
        const sealedResponse =
          input.outcome === 'completed'
            ? dispatchSecrets.sealResponse(input.text!, {
                workspaceId: tx.workspaceId,
                invocationId,
                runnerId: principal.runnerId,
                targetId: invocation.target_id,
                targetVersion: invocation.target_version,
              })
            : null;
        await sql`UPDATE model_runner_dispatches SET status = 'settled', encrypted_request = NULL,
          encrypted_response = ${sealedResponse ? JSON.stringify(sealedResponse) : null}::jsonb,
          lease_expires_at = NULL, settled_at = clock_timestamp()
          WHERE workspace_id = ${tx.workspaceId}::uuid AND invocation_id = ${invocationId}::uuid
            AND status = 'leased' AND lease_generation = ${input.leaseGeneration}::bigint`.execute(tx.db);
      });
    },
  };
}
export type ModelGateway = ReturnType<typeof createModelGateway>;
