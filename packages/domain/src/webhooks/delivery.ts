// Webhook fan-out and delivery (worker; B.28, Attio docs "Authenticating", "Idempotency", "Delivery attempts").
//
// Fan-out reads the 'domain-events' rows of change_log whose transaction ids lie between the previous cursor and the
// current snapshot's xmin (transactions of other databases ignored): every transaction of this database below it has
// ended, so each committed row is read exactly once whatever the commit order, and aborted ones are never seen. Each
// event is completed (workspace id, actor, parent ids), matched against the active subscriptions (event type + filter)
// of webhooks created before it, and stored as one pending delivery per webhook. The cursor moves in the same
// transaction as the inserts. A transaction of this database still running holds later events back until it ends.
//
// Delivery claims due rows with a short lease (no locks are held during HTTP), POSTs `{webhook_id, events:[event]}`
// with `Attio-Signature` / `X-Attio-Signature` = hex HMAC-SHA256 of the body under the webhook's secret and
// `Idempotency-Key` = the delivery id, and records the outcome: 2xx succeeds; anything else (or a 5 s timeout) is
// retried with exponential back-off up to 10 attempts, after which the delivery fails and the webhook is marked
// degraded. A later success marks it active again. Test deliveries are attempted once.
import { createHmac } from 'node:crypto';
import {
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_TIMEOUT_MS,
  type WebhookFilter,
  webhookRetryDelaySeconds,
} from '@agentic-crm/contracts';
import { type Database, jsonb, sql } from '@agentic-crm/db';
import { CHANGE_LOG_CHANNEL } from '@agentic-crm/realtime';
import { newId } from '../ids.ts';
import { runAsOwner } from '../tx.ts';
import type { DomainEvent } from './events.ts';

/** Sends one request; the default uses fetch with Attio's 5 s timeout. Tests inject their own. */
export type WebhookSender = (request: {
  url: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<{ status: number }>;

export const fetchSender: WebhookSender = async ({ url, headers, body }) => {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });
  await response.body?.cancel().catch(() => {});
  return { status: response.status };
};

export function signWebhookBody(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

/** Attio's filter semantics: `$and` / `$or` of equals / not_equals on dot paths of the event payload. */
export function filterMatches(filter: WebhookFilter, event: Record<string, unknown>): boolean {
  if (!filter) return true;
  const ops = '$and' in filter ? filter.$and : filter.$or;
  const test = (o: { field: string; operator: 'equals' | 'not_equals'; value: string }) => {
    let v: unknown = event;
    for (const key of o.field.split('.'))
      v = v && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined;
    const equal = v !== undefined && v !== null && String(v) === o.value;
    return o.operator === 'equals' ? equal : !equal;
  };
  if ('$and' in filter) return ops.every(test);
  return ops.length === 0 ? true : ops.some(test);
}

const WEBHOOK_ACTOR_TYPES = new Set(['api-token', 'workspace-member', 'system', 'app']);

function publicActor(actor: unknown): { type: string; id: string | null } {
  const a = (actor ?? {}) as { type?: string; id?: string | null };
  if (a.type && WEBHOOK_ACTOR_TYPES.has(a.type))
    return { type: a.type, id: a.type === 'system' ? null : (a.id ?? null) };
  return { type: 'system', id: null };
}

type Trx = Parameters<Parameters<typeof runAsOwner>[1]>[0];

/** Parent records of list entries (entry-parent-record values), across one workspace. */
async function entryParents(trx: Trx, workspaceId: string, entryIds: string[]) {
  const out = new Map<string, { object_id: string; record_id: string }>();
  if (entryIds.length === 0) return out;
  const { rows } = await sql<{ entry_id: string; object_id: string; record_id: string }>`
    SELECT DISTINCT ON (v.instance_id) v.instance_id AS entry_id, r.entity_definition_id AS object_id, r.id AS record_id
    FROM attribute_values v
    JOIN attribute_definitions a ON a.id = v.attribute_id AND a.system_attribute_type = 'entry-parent-record'
    JOIN entity_instances r ON r.id = v.v_ref
    WHERE v.workspace_id = ${workspaceId}::uuid AND v.instance_id = ANY(${entryIds}::uuid[])
    ORDER BY v.instance_id, v.active_from DESC`.execute(trx);
  for (const r of rows) out.set(r.entry_id, { object_id: r.object_id, record_id: r.record_id });
  return out;
}

async function noteParents(trx: Trx, workspaceId: string, noteIds: string[]) {
  const out = new Map<string, { object_id: string; record_id: string }>();
  if (noteIds.length === 0) return out;
  const rows = await trx
    .selectFrom('note_records')
    .select(['note_id', 'entity_definition_id', 'entity_instance_id'])
    .where('workspace_id', '=', workspaceId)
    .where('note_id', 'in', noteIds)
    .orderBy('position')
    .execute();
  for (const r of rows) {
    if (!out.has(r.note_id)) out.set(r.note_id, { object_id: r.entity_definition_id, record_id: r.entity_instance_id });
  }
  return out;
}

/** Completes recorded events into Attio payloads (workspace id, actor, parent ids). */
async function completeEvents(
  trx: Trx,
  workspaceId: string,
  rows: { events: DomainEvent[]; actor: unknown }[],
): Promise<Record<string, unknown>[]> {
  const all = rows.flatMap((r) => r.events);
  const entryIds = new Set<string>();
  const noteIds = new Set<string>();
  for (const e of all) {
    if (e.event_type.startsWith('list-entry.') && e.id.entry_id) entryIds.add(e.id.entry_id);
    if (e.event_type.startsWith('comment.') && e.entry_id) entryIds.add(String(e.entry_id));
    if (
      (e.event_type.startsWith('note.') || e.event_type === 'note-content.updated') &&
      !e.parent_record_id &&
      e.id.note_id
    )
      noteIds.add(e.id.note_id);
  }
  const [entries, notes] = await Promise.all([
    entryParents(trx, workspaceId, [...entryIds]),
    noteParents(trx, workspaceId, [...noteIds]),
  ]);
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    const actor = publicActor(row.actor);
    for (const e of row.events) {
      const payload: Record<string, unknown> = { ...e, id: { workspace_id: workspaceId, ...e.id } };
      if (e.event_type.startsWith('list-entry.')) {
        const parent = entries.get(String(e.id.entry_id));
        payload.parent_object_id = parent?.object_id ?? null;
        payload.parent_record_id = parent?.record_id ?? null;
      } else if (e.event_type.startsWith('comment.') && e.entry_id) {
        const parent = entries.get(String(e.entry_id));
        payload.object_id = parent?.object_id ?? null;
        payload.record_id = parent?.record_id ?? null;
      } else if ((e.event_type.startsWith('note.') || e.event_type === 'note-content.updated') && !e.parent_record_id) {
        const parent = notes.get(String(e.id.note_id));
        payload.parent_object_id = parent?.object_id ?? null;
        payload.parent_record_id = parent?.record_id ?? null;
      }
      // An event may name its own actor (call-recording.created: the importer, not the processing job).
      payload.actor = e.actor !== undefined ? publicActor(e.actor) : actor;
      out.push(payload);
    }
  }
  return out;
}

/** Turns committed domain events into pending deliveries; returns how many events and deliveries were processed. */
export async function fanOutWebhookEvents(database: Database): Promise<{ events: number; deliveries: number }> {
  return runAsOwner(database, async (trx) => {
    const state = await trx
      .selectFrom('webhook_fanout_state')
      .select(['xid_cursor'])
      .where('id', '=', 1)
      .forUpdate()
      .executeTakeFirst();
    // The snapshot's xmin, ignoring transactions of other databases of the cluster (they never write this change_log;
    // xids are cluster-wide, so a long transaction elsewhere would otherwise hold deliveries back). Unknown in-progress
    // xids count, conservatively.
    const { rows: snap } = await sql<{ upper: string }>`
      SELECT coalesce(
        (SELECT min(x) FROM pg_snapshot_xip(q.s) x
          WHERE NOT EXISTS (
            SELECT 1 FROM pg_stat_activity a
            WHERE a.backend_xid = x::xid AND a.datname IS DISTINCT FROM current_database())),
        pg_snapshot_xmax(q.s))::text AS upper
      FROM (SELECT pg_current_snapshot() AS s) q`.execute(trx);
    const upper = (snap[0] as { upper: string }).upper;
    if (!state) {
      await sql`INSERT INTO webhook_fanout_state (id, xid_cursor) VALUES (1, ${upper}::xid8) ON CONFLICT DO NOTHING`.execute(
        trx,
      );
      return { events: 0, deliveries: 0 };
    }
    const { rows } = await sql<{
      id: string;
      workspace_id: string;
      scope: { events?: DomainEvent[] };
      actor: unknown;
      created_at: string;
    }>`
      SELECT c.id::text AS id, c.workspace_id::text AS workspace_id, c.scope, c.actor, c.created_at
      FROM change_log c
      WHERE c.xid >= ${state.xid_cursor}::xid8 AND c.xid < ${upper}::xid8 AND c.resource = 'domain-events'
      ORDER BY c.id`.execute(trx);
    let events = 0;
    let deliveries = 0;
    const byWorkspace = new Map<string, typeof rows>();
    for (const r of rows) byWorkspace.set(r.workspace_id, [...(byWorkspace.get(r.workspace_id) ?? []), r]);
    for (const [workspaceId, wsRows] of byWorkspace) {
      const hooks = await trx
        .selectFrom('webhooks as w')
        .innerJoin('webhook_subscriptions as s', 's.webhook_id', 'w.id')
        .select(['w.id', 'w.created_at', 's.event_type', 's.filter'])
        .where('w.workspace_id', '=', workspaceId)
        .where('w.deleted_at', 'is', null)
        .where('w.status', '!=', 'inactive')
        .execute();
      if (hooks.length === 0) continue;
      const values: Record<string, unknown>[] = [];
      for (const row of wsRows) {
        const completed = await completeEvents(trx, workspaceId, [
          { events: row.scope.events ?? [], actor: row.actor },
        ]);
        events += completed.length;
        for (const event of completed) {
          const matched = new Set<string>();
          for (const h of hooks) {
            if (matched.has(h.id) || h.event_type !== event.event_type || h.created_at > row.created_at) continue;
            if (!filterMatches((h.filter ?? null) as WebhookFilter, event)) continue;
            matched.add(h.id);
            values.push({
              id: newId(),
              workspace_id: workspaceId,
              webhook_id: h.id,
              event_type: String(event.event_type),
              payload: jsonb({ webhook_id: h.id, events: [event] }),
              status: 'pending',
              next_attempt_at: sql`now()`,
              change_log_id: row.id,
            });
          }
        }
      }
      if (values.length > 0) {
        for (let i = 0; i < values.length; i += 500) {
          await trx
            .insertInto('webhook_deliveries')
            .values(values.slice(i, i + 500) as never)
            .execute();
        }
        deliveries += values.length;
      }
    }
    await trx
      .updateTable('webhook_fanout_state')
      .set({ xid_cursor: upper, updated_at: sql`now()` })
      .where('id', '=', 1)
      .execute();
    return { events, deliveries };
  });
}

interface Claimed {
  id: string;
  workspace_id: string;
  webhook_id: string;
  payload: unknown;
  is_test: boolean;
  attempts: number;
  target_url: string;
  secret: string;
  webhook_status: string;
  webhook_deleted: boolean;
}

/** Leases due deliveries (or the given ones) for 60 s so concurrent workers skip them during the HTTP call. */
async function claim(database: Database, options: { ids?: string[]; limit: number }): Promise<Claimed[]> {
  return runAsOwner(database, async (trx) => {
    const { rows } = await sql<Claimed>`
      WITH due AS (
        SELECT d.id FROM webhook_deliveries d
        WHERE d.status = 'pending' AND d.next_attempt_at <= now()
          ${options.ids ? sql`AND d.id = ANY(${options.ids}::uuid[])` : sql``}
        ORDER BY d.next_attempt_at, d.id
        LIMIT ${options.limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE webhook_deliveries d SET next_attempt_at = now() + interval '60 seconds'
      FROM due, webhooks w
      WHERE d.id = due.id AND w.id = d.webhook_id
      RETURNING d.id, d.workspace_id, d.webhook_id, d.payload, d.is_test, d.attempts, w.target_url, w.secret,
        w.status AS webhook_status, (w.deleted_at IS NOT NULL) AS webhook_deleted`.execute(trx);
    return rows;
  });
}

async function record(
  database: Database,
  d: Claimed,
  outcome: { statusCode: number | null; error: string | null; durationMs: number },
): Promise<void> {
  await runAsOwner(database, async (trx) => {
    const ok = outcome.statusCode !== null && outcome.statusCode >= 200 && outcome.statusCode < 300;
    const attempts = d.attempts + 1;
    const final = ok || d.is_test || attempts >= WEBHOOK_MAX_ATTEMPTS;
    const entry = {
      at: new Date().toISOString(),
      statusCode: outcome.statusCode,
      error: outcome.error,
      durationMs: outcome.durationMs,
    };
    await sql`
      UPDATE webhook_deliveries SET
        attempts = ${attempts},
        status = ${ok ? 'succeeded' : final ? 'failed' : 'pending'},
        last_status_code = ${outcome.statusCode},
        last_error = ${outcome.error},
        attempt_log = attempt_log || ${JSON.stringify([entry])}::jsonb,
        next_attempt_at = ${final ? sql`NULL` : sql`now() + make_interval(secs => ${webhookRetryDelaySeconds(attempts)})`},
        completed_at = ${final ? sql`now()` : sql`NULL`}
      WHERE id = ${d.id}::uuid`.execute(trx);
    if (ok) {
      await sql`
        UPDATE webhooks SET last_delivery_at = now(),
          status = CASE WHEN status = 'degraded' THEN 'active' ELSE status END,
          degraded_at = CASE WHEN status = 'degraded' THEN NULL ELSE degraded_at END
        WHERE id = ${d.webhook_id}::uuid`.execute(trx);
    } else if (final && !d.is_test) {
      await sql`
        UPDATE webhooks SET status = 'degraded', degraded_at = coalesce(degraded_at, now())
        WHERE id = ${d.webhook_id}::uuid AND status = 'active'`.execute(trx);
    }
    // The settings page refetches the webhook (status, delivery log).
    await sql`
      WITH ins AS (
        INSERT INTO change_log (workspace_id, resource, resource_id, scope, actor, audience)
        VALUES (${d.workspace_id}::uuid, 'webhook', ${d.webhook_id}::uuid,
          ${JSON.stringify({ webhookId: d.webhook_id })}::jsonb, ${JSON.stringify({ type: 'system', id: 'webhooks' })}::jsonb,
          NULL)
        RETURNING id
      )
      SELECT pg_notify(${CHANGE_LOG_CHANNEL}, max(id)::text) FROM ins`.execute(trx);
  });
}

async function attempt(database: Database, d: Claimed, send: WebhookSender): Promise<void> {
  if (d.webhook_deleted || d.webhook_status === 'inactive') {
    await runAsOwner(database, (trx) =>
      sql`UPDATE webhook_deliveries SET status = 'failed', last_error = 'Webhook inactive', next_attempt_at = NULL,
            completed_at = now() WHERE id = ${d.id}::uuid`.execute(trx),
    );
    return;
  }
  const body = JSON.stringify(d.payload);
  const signature = signWebhookBody(d.secret, body);
  const started = Date.now();
  let statusCode: number | null = null;
  let error: string | null = null;
  try {
    const response = await send({
      url: d.target_url,
      body,
      headers: {
        'content-type': 'application/json',
        'attio-signature': signature,
        'x-attio-signature': signature,
        'idempotency-key': d.id,
        'user-agent': 'agentic-crm-webhooks/1.0',
      },
    });
    statusCode = response.status;
    if (statusCode < 200 || statusCode >= 300) error = `Target responded with ${statusCode}`;
  } catch (err) {
    error =
      err instanceof Error ? (err.name === 'TimeoutError' ? 'Timed out after 5 seconds' : err.message) : String(err);
  }
  await record(database, d, { statusCode, error, durationMs: Date.now() - started });
}

/** Attempts due deliveries (worker loop); returns how many were attempted. */
export async function deliverDueWebhooks(
  database: Database,
  options: { limit?: number; send?: WebhookSender; ids?: string[] } = {},
): Promise<{ attempted: number }> {
  const claimed = await claim(database, { limit: options.limit ?? 25, ...(options.ids ? { ids: options.ids } : {}) });
  const send = options.send ?? fetchSender;
  await Promise.all(claimed.map((d) => attempt(database, d, send)));
  return { attempted: claimed.length };
}
