// Transaction runner: one domain service call = one Postgres transaction (I1) that
//   1. enters the workspace (GUC app.workspace_id + SET LOCAL ROLE agentic_crm_app → RLS backstop, I2),
//   2. runs the service code (data + history),
//   3. appends one change_log row per changed key and NOTIFYs `change_log` (delivered by Postgres only on commit).
// Serialization failures, deadlocks and DDL lock timeouts are retried a few times.
import type { Database, DB, Transaction } from '@agentic-crm/db';
import { sql } from '@agentic-crm/db';
import { CHANGE_LOG_CHANNEL, type InvalidationResource } from '@agentic-crm/realtime';
import type { ServiceContext } from './context.ts';
import { conflict, DomainError } from './errors.ts';
import { emitReportStale } from './reports/stale.ts';
import { type DomainEvent, normalizeEvents, subscribedEvents } from './webhooks/events.ts';
import { captureWorkflowEvents } from './workflows/capture.ts';

export type { DomainEvent };

export interface ChangeEntry {
  resource: InvalidationResource;
  resourceId: string | null;
  scope: Record<string, unknown>;
  /** null = every member who can read the resource; otherwise these auth user ids only (personal resources). */
  audience: { userIds: string[] } | null;
}

const RETRYABLE = new Set(['40001', '40P01', '55P03']);
const MAX_ATTEMPTS = 4;

export class Tx {
  readonly db: Transaction<DB>;
  readonly ctx: ServiceContext;
  /** Transaction timestamp (now()), ISO with microseconds: active_from / active_until of every value written here. */
  readonly now: string;
  /** Per-transaction memo (e.g. loaded entity definitions); invalidated explicitly by schema writes. */
  readonly memo = new Map<string, unknown>();
  private readonly changes = new Map<string, ChangeEntry>();
  private readonly events: DomainEvent[] = [];

  constructor(db: Transaction<DB>, ctx: ServiceContext, now: string) {
    this.db = db;
    this.ctx = ctx;
    this.now = now;
  }

  get workspaceId(): string {
    return this.ctx.workspaceId;
  }

  /**
   * Records that `resource` changed. Entries with the same (resource, resourceId) are merged: array-valued scope keys
   * are united (e.g. entityInstanceIds), other keys keep the last value.
   */
  emit(
    resource: InvalidationResource,
    resourceId: string | null,
    scope: Record<string, unknown> = {},
    audience: { userIds: string[] } | null = null,
  ): void {
    const key = `${resource}:${resourceId ?? ''}:${audience ? audience.userIds.join(',') : '*'}`;
    const existing = this.changes.get(key);
    if (!existing) {
      this.changes.set(key, { resource, resourceId, scope: { ...scope }, audience });
      return;
    }
    for (const [k, v] of Object.entries(scope)) {
      const prev = existing.scope[k];
      existing.scope[k] = Array.isArray(prev) && Array.isArray(v) ? [...new Set([...prev, ...v])] : v;
    }
  }

  /** Runs DDL (projection tables) as the owning role; RLS-scoped role is restored afterwards. */
  async asOwner<T>(fn: () => Promise<T>): Promise<T> {
    await sql`SELECT set_config('role', 'none', true)`.execute(this.db);
    try {
      return await fn();
    } finally {
      await sql`SELECT set_config('role', 'agentic_crm_app', true)`.execute(this.db);
    }
  }

  /**
   * Records a webhook event of this transaction (B.28; the 27 types of the webhooks catalogue). Events are written as
   * one change_log row (resource 'domain-events', audience nobody) when the workspace has webhooks subscribed to
   * them; the worker fans them out into signed deliveries.
   */
  event(e: DomainEvent): void {
    this.events.push(e);
  }

  /** Writes the collected change_log rows and queues the NOTIFY. Called once, right before commit. */
  async flush(): Promise<void> {
    if (this.events.length > 0) {
      const raw = this.events.splice(0);
      const events = await subscribedEvents(this, normalizeEvents(raw));
      if (events.length > 0) this.emit('domain-events', null, { events }, { userIds: [] });
      // Workflow triggers (slice 8) read the same events from their own change_log row.
      await captureWorkflowEvents(this, raw);
    }
    if (this.changes.size === 0) return;
    // Report results over changed definitions (slice 9 "New data"): one report-stale row per affected definition.
    await emitReportStale(this, [...this.changes.values()]);
    const rows = [...this.changes.values()];
    this.changes.clear();
    const actor = JSON.stringify(this.ctx.actor);
    const { rows: flushed } = await sql<{ seq: string | null }>`
      WITH ins AS (
        INSERT INTO change_log (workspace_id, resource, resource_id, scope, actor, audience)
        SELECT ${this.ctx.workspaceId}::uuid, r.resource, r.resource_id, r.scope, ${actor}::jsonb, r.audience
        FROM jsonb_to_recordset(${JSON.stringify(
          rows.map((r) => ({
            resource: r.resource,
            resource_id: r.resourceId,
            scope: r.scope,
            audience: r.audience,
          })),
        )}::jsonb) AS r(resource text, resource_id uuid, scope jsonb, audience jsonb)
        RETURNING id
      )
      SELECT pg_notify(${CHANGE_LOG_CHANNEL}, max(id)::text), max(id)::text AS seq FROM ins`.execute(this.db);
    if (this.ctx.receipt) this.ctx.receipt.seq = flushed[0]?.seq ?? null;
  }
}

/** Switches an open transaction into the workspace context and returns the Tx handle. */
export async function enterWorkspace(trx: Transaction<DB>, ctx: ServiceContext): Promise<Tx> {
  const { rows } = await sql<{ now: string }>`
    SELECT set_config('app.workspace_id', ${ctx.workspaceId}, true) AS ws,
           set_config('role', 'agentic_crm_app', true) AS role,
           now() AS now`.execute(trx);
  return new Tx(trx, ctx, (rows[0] as { now: string }).now);
}

/** Runs `fn` in one workspace-scoped transaction with change_log flush, retries and error mapping. */
export async function runInWorkspace<T>(
  database: Database,
  ctx: ServiceContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withRetry(() =>
    database.kysely.transaction().execute(async (trx) => {
      if (ctx.receipt) ctx.receipt.seq = null; // a retried attempt must not report an aborted attempt's seq
      const tx = await enterWorkspace(trx, ctx);
      const result = await fn(tx);
      await tx.flush();
      return result;
    }),
  );
}

/**
 * Runs `fn` as the owner role without a workspace (RLS bypassed). Only for reads and writes that are cross-tenant by
 * nature: creating a workspace, the user's workspace picker, invites addressed to an email.
 */
export async function runAsOwner<T>(database: Database, fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return withRetry(() => database.kysely.transaction().execute(fn));
}

async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code && RETRYABLE.has(code) && attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 10 * attempt + Math.random() * 20));
        continue;
      }
      throw mapPgError(err);
    }
  }
}

/** Constraint violations that race past the domain's own checks → Attio-style 409s. */
function mapPgError(err: unknown): unknown {
  if (err instanceof DomainError) return err;
  const e = err as { code?: string; constraint?: string; detail?: string };
  if (e.code !== '23505') return err;
  switch (e.constraint) {
    case 'av_unique':
      return conflict('UNIQUE_CONSTRAINT_VIOLATION', 'A record with this unique value already exists');
    case 'workspaces_slug':
      return conflict('SLUG_IN_USE', 'This handle is already in use', { conflicting_field: 'slug' });
    case 'entity_definitions_workspace_id_api_slug_key':
    case 'attribute_definitions_entity_definition_id_api_slug_key':
      return conflict('SLUG_IN_USE', 'This slug is already in use', { conflicting_field: 'api_slug' });
    case 'workspace_invites_pending':
      return conflict('INVITE_ALREADY_EXISTS', 'This email has already been invited');
    default:
      return conflict('ID_CONFLICT', 'A resource with this id already exists', { constraint: e.constraint ?? null });
  }
}
