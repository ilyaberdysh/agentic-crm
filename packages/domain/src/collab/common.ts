// Shared helpers of the slice-3 services (notes, templates, tasks, comments, favorites, files, timeline): actor
// encoding on cold tables, record reference resolution with permission checks, record labels, personal audiences.
import type { ActionFlag, Actor, RecordRef, RecordRefInput } from '@agentic-crm/contracts';
import { jsonb, sql } from '@agentic-crm/db';
import { actingMemberId, permissionMemberId } from '../context.ts';
import { badRequest, forbidden, notFound } from '../errors.ts';
import type { Policies } from '../permissions.ts';
import { type DefInfo, isUuid, loadDefinition } from '../schema/model.ts';
import type { Tx } from '../tx.ts';

/** Entity types whose instances are records (people, companies, standard and custom objects). */
export const RECORD_ENTITY_TYPES = new Set(['person-record', 'company-record', 'standard-object', 'custom-record']);

/** Dependencies the createDomain wiring hands to slice-3 services. */
export interface CollabDeps {
  policies: Policies;
}

export function actorJson(tx: Tx) {
  return jsonb(tx.ctx.actor);
}

export function toActor(value: unknown): Actor {
  const v = (value ?? {}) as { type?: string; id?: string | null };
  return { type: (v.type ?? 'system') as Actor['type'], id: v.id ?? null };
}

export function toActorOrNull(value: unknown): Actor | null {
  return value === null || value === undefined ? null : toActor(value);
}

/** The acting member or 403 (personal resources: favorites, reactions, preferences). */
export function requireMember(tx: Tx): string {
  const memberId = actingMemberId(tx.ctx);
  if (!memberId) throw forbidden('Only workspace members can do this');
  return memberId;
}

/** Change-log audience of one member (their auth user), for personal resources. */
export async function memberAudience(tx: Tx, memberId: string): Promise<{ userIds: string[] }> {
  const key = `audience:${memberId}`;
  const cached = tx.memo.get(key) as { userIds: string[] } | undefined;
  if (cached) return cached;
  const row = await tx.db
    .selectFrom('workspace_members')
    .select('user_id')
    .where('id', '=', memberId)
    .executeTakeFirst();
  const audience = { userIds: row ? [row.user_id] : [] };
  tx.memo.set(key, audience);
  return audience;
}

export interface ResolveRecordsOptions {
  /** Action flag required on each record's object (default read_entity_instance). */
  flag?: ActionFlag;
  /** Accept list entries (collection-entry instances) as well as records. */
  allowEntries?: boolean;
  /** Accept the caller's own workspace-member record (profile avatar and workspace logo uploads, slice 6). */
  allowOwnMemberRecord?: boolean;
  /** Error details label (e.g. 'parent_record', 'linked_record'). */
  what?: string;
}

/**
 * Validates record references: the object exists (id or api_slug), is a record object, the record is live and
 * belongs to it, and the caller holds `flag` on it. Duplicates are dropped (first occurrence wins).
 */
export async function resolveRecordRefs(
  tx: Tx,
  deps: CollabDeps,
  refs: RecordRefInput[],
  options: ResolveRecordsOptions = {},
): Promise<RecordRef[]> {
  const flag = options.flag ?? 'read_entity_instance';
  const what = options.what ?? 'record';
  const out: RecordRef[] = [];
  const seen = new Set<string>();
  const defs = new Map<string, DefInfo>();
  for (const ref of refs) {
    const def = defs.get(ref.entityDefinitionId) ?? (await loadDefinition(tx, ref.entityDefinitionId));
    defs.set(ref.entityDefinitionId, def);
    const allowed =
      RECORD_ENTITY_TYPES.has(def.entityType) ||
      (options.allowEntries && def.entityType === 'collection-entry') ||
      (options.allowOwnMemberRecord &&
        def.entityType === 'workspace-member' &&
        ref.entityInstanceId === permissionMemberId(tx.ctx));
    if (!allowed) {
      throw badRequest('VALIDATION_ERROR', `Only records can be linked here (got "${def.apiSlug}")`, {
        entity_definition_id: def.id,
        field: what,
      });
    }
    if (seen.has(ref.entityInstanceId)) continue;
    seen.add(ref.entityInstanceId);
    out.push({ entityDefinitionId: def.id, entityInstanceId: ref.entityInstanceId });
  }
  if (out.length === 0) return out;
  const rows = await tx.db
    .selectFrom('entity_instances')
    .select(['id', 'entity_definition_id'])
    .where(
      'id',
      'in',
      out.map((r) => r.entityInstanceId),
    )
    .where('archived_at', 'is', null)
    .where('merged_at', 'is', null)
    .execute();
  const defOf = new Map(rows.map((r) => [r.id, r.entity_definition_id]));
  for (const ref of out) {
    if (defOf.get(ref.entityInstanceId) !== ref.entityDefinitionId) {
      throw notFound('The requested record could not be found', {
        entity_definition_id: ref.entityDefinitionId,
        entity_instance_id: ref.entityInstanceId,
        field: what,
      });
    }
  }
  for (const defId of new Set(out.map((r) => r.entityDefinitionId))) {
    await deps.policies.assertCan(tx, defId, flag);
  }
  return out;
}

/** The definitions among `defIds` on which the caller may read records. */
export async function readableDefinitions(tx: Tx, deps: CollabDeps, defIds: string[]): Promise<Set<string>> {
  const unique = [...new Set(defIds)];
  if (unique.length === 0) return new Set();
  const defs: DefInfo[] = [];
  for (const id of unique) {
    try {
      defs.push(await loadDefinition(tx, id));
    } catch {
      // unknown definition: not readable
    }
  }
  const allowed = await deps.policies.allowed(tx, defs, 'read_entity_instance');
  return new Set(allowed.map((d) => d.id));
}

/** Throws 404 when `id` is not a UUID (malformed ids cannot name anything). */
export function assertUuid(id: string, what: string): void {
  if (!isUuid(id)) throw notFound(`The requested ${what} could not be found`, { id });
}

/**
 * Display labels of records: the value of the object's display ("epithet") attribute, else its `name` attribute.
 * Missing or deleted records map to null.
 */
export async function recordLabels(tx: Tx, refs: RecordRef[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const byDef = new Map<string, string[]>();
  for (const r of refs) {
    out.set(r.entityInstanceId, null);
    byDef.set(r.entityDefinitionId, [...(byDef.get(r.entityDefinitionId) ?? []), r.entityInstanceId]);
  }
  for (const [defId, ids] of byDef) {
    let def: DefInfo;
    try {
      def = await loadDefinition(tx, defId);
    } catch {
      continue;
    }
    const attrId = def.epithetPath?.[0]?.attributeDefinitionId ?? def.bySlug.get('name')?.id;
    if (!attrId) continue;
    const { rows } = await sql<{ instance_id: string; v_text: string | null }>`
      SELECT DISTINCT ON (v.instance_id) v.instance_id, v.v_text
      FROM attribute_values v
      WHERE v.instance_id = ANY(${ids}::uuid[]) AND v.attribute_id = ${attrId}::uuid AND v.active_until IS NULL
      ORDER BY v.instance_id, v.sort_order NULLS FIRST, v.active_from DESC`.execute(tx.db);
    for (const row of rows) out.set(row.instance_id, row.v_text);
  }
  return out;
}

/** Positions 0..n-1 for link tables. */
export function positioned<T>(items: T[]): (T & { position: number })[] {
  return items.map((item, position) => ({ ...item, position }));
}
