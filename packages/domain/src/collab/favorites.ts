// Favorites and favorite folders (BACKLOG 3.17; B sidebar §6, A README §4.15, D README §3.10b; CROSS-DOMAIN B.18).
// Personal: every read and write is scoped to the acting member; invalidations go to that member only.
import {
  type Favorite,
  type FavoriteDirectory,
  type FavoriteTargetSummary,
  type FavoriteType,
  type ListFavoritesOutput,
  type MoveFavoriteInput,
  moveFavoriteInputSchema,
  type PutFavoriteDirectoryInput,
  type PutFavoriteInput,
  putFavoriteDirectoryInputSchema,
  putFavoriteInputSchema,
  type RemoveFavoriteByTargetInput,
  rankBefore,
  removeFavoriteByTargetInputSchema,
  type UpdateFavoriteDirectoryInput,
  updateFavoriteDirectoryInputSchema,
} from '@agentic-crm/contracts';
import type { FavoritesTable, Selectable } from '@agentic-crm/db';
import { meetingAccess } from '../email/access.ts';
import { conflict, notFound } from '../errors.ts';
import { dashboardAccess } from '../reports/access.ts';
import { loadDefinition, loadDefinitionsByIds } from '../schema/model.ts';
import type { Tx } from '../tx.ts';
import { type CollabDeps, memberAudience, readableDefinitions, recordLabels, requireMember } from './common.ts';

type FavoriteRow = Selectable<FavoritesTable>;

async function emitFavorites(tx: Tx, memberId: string): Promise<void> {
  tx.emit('favorite-list', memberId, { memberId }, await memberAudience(tx, memberId));
}

/** The member's favorite ids of the given targets (notes, templates, records…), keyed by target id. */
export async function favoriteIdsFor(tx: Tx, type: FavoriteType, targetIds: string[]): Promise<Map<string, string>> {
  const memberId = tx.ctx.actor.type === 'workspace-member' ? tx.ctx.actor.id : null;
  if (!memberId || targetIds.length === 0) return new Map();
  const rows = await tx.db
    .selectFrom('favorites')
    .select(['id', 'target_id'])
    .where('member_id', '=', memberId)
    .where('favorite_type', '=', type)
    .where('target_id', 'in', [...new Set(targetIds)])
    .execute();
  return new Map(rows.map((r) => [r.target_id, r.id]));
}

/** Rank before the first sibling (new favorites and folders go to the top). */
async function topRank(tx: Tx, memberId: string, directoryId: string | null): Promise<string> {
  const fav = await tx.db
    .selectFrom('favorites')
    .select('sort_order')
    .where('member_id', '=', memberId)
    .$if(directoryId === null, (q) => q.where('directory_id', 'is', null))
    .$if(directoryId !== null, (q) => q.where('directory_id', '=', directoryId as string))
    .orderBy('sort_order')
    .limit(1)
    .executeTakeFirst();
  let first = fav?.sort_order ?? null;
  if (directoryId === null) {
    const dir = await tx.db
      .selectFrom('favorite_directories')
      .select('sort_order')
      .where('member_id', '=', memberId)
      .orderBy('sort_order')
      .limit(1)
      .executeTakeFirst();
    if (dir && (first === null || dir.sort_order < first)) first = dir.sort_order;
  }
  return rankBefore(first, { jitter: true });
}

async function requireDirectory(tx: Tx, memberId: string, directoryId: string) {
  const dir = await tx.db
    .selectFrom('favorite_directories')
    .selectAll()
    .where('id', '=', directoryId)
    .where('member_id', '=', memberId)
    .executeTakeFirst();
  if (!dir) throw notFound('The requested favorites folder could not be found', { directory_id: directoryId });
  return dir;
}

function toDirectory(row: { id: string; title: string; sort_order: string; created_at: string }): FavoriteDirectory {
  return { id: row.id, title: row.title, sortOrder: row.sort_order, createdAt: row.created_at };
}

/** Labels for the sidebar rows (B sidebar §6 table) for the types this slice knows. */
async function summarize(tx: Tx, deps: CollabDeps, rows: FavoriteRow[]): Promise<Map<string, FavoriteTargetSummary>> {
  const out = new Map<string, FavoriteTargetSummary>();
  const unknown: FavoriteTargetSummary = { state: 'unknown', label: null, secondaryLabel: null };
  const missing: FavoriteTargetSummary = { state: 'missing', label: null, secondaryLabel: null };
  const forbiddenSummary: FavoriteTargetSummary = { state: 'forbidden', label: null, secondaryLabel: null };
  const ids = (type: string) => rows.filter((r) => r.favorite_type === type).map((r) => r.target_id);

  // Records
  const recordRows = rows.filter((r) => r.favorite_type === 'record');
  if (recordRows.length > 0) {
    const live = await tx.db
      .selectFrom('entity_instances')
      .select(['id', 'entity_definition_id'])
      .where(
        'id',
        'in',
        recordRows.map((r) => r.target_id),
      )
      .where('archived_at', 'is', null)
      .where('merged_at', 'is', null)
      .execute();
    const defOf = new Map(live.map((r) => [r.id, r.entity_definition_id]));
    const readable = await readableDefinitions(tx, deps, [...defOf.values()]);
    const defs = await loadDefinitionsByIds(tx, [...defOf.values()]);
    const labels = await recordLabels(
      tx,
      live.map((r) => ({ entityDefinitionId: r.entity_definition_id, entityInstanceId: r.id })),
    );
    for (const row of recordRows) {
      const defId = defOf.get(row.target_id);
      if (!defId) out.set(row.id, missing);
      else if (!readable.has(defId)) out.set(row.id, forbiddenSummary);
      else
        out.set(row.id, {
          state: 'ok',
          label: labels.get(row.target_id) ?? null,
          secondaryLabel: defs.get(defId)?.singularNoun ?? null,
        });
    }
  }

  // Views
  const viewIds = ids('entity-view').concat(ids('collection-view'));
  if (viewIds.length > 0) {
    const views = await tx.db
      .selectFrom('entity_views')
      .select(['id', 'title', 'entity_definition_id', 'is_archived'])
      .where('id', 'in', viewIds)
      .execute();
    const byId = new Map(views.map((v) => [v.id, v]));
    const readable = await readableDefinitions(
      tx,
      deps,
      views.map((v) => v.entity_definition_id),
    );
    const defs = await loadDefinitionsByIds(
      tx,
      views.map((v) => v.entity_definition_id),
    );
    for (const row of rows.filter((r) => r.favorite_type === 'entity-view' || r.favorite_type === 'collection-view')) {
      const view = byId.get(row.target_id);
      if (!view || view.is_archived) out.set(row.id, missing);
      else if (!readable.has(view.entity_definition_id)) out.set(row.id, forbiddenSummary);
      else
        out.set(row.id, {
          state: 'ok',
          label: view.title,
          secondaryLabel: defs.get(view.entity_definition_id)?.pluralNoun ?? null,
        });
    }
  }

  // Notes: title + primary parent record name
  const noteIds = ids('note');
  if (noteIds.length > 0) {
    const notes = await tx.db
      .selectFrom('notes')
      .select(['id', 'title'])
      .where('id', 'in', noteIds)
      .where('deleted_at', 'is', null)
      .execute();
    const parents = await tx.db
      .selectFrom('note_records')
      .select(['note_id', 'entity_definition_id', 'entity_instance_id'])
      .where('note_id', 'in', noteIds)
      .where('position', '=', 0)
      .execute();
    const parentOf = new Map(parents.map((p) => [p.note_id, p]));
    const labels = await recordLabels(
      tx,
      parents.map((p) => ({ entityDefinitionId: p.entity_definition_id, entityInstanceId: p.entity_instance_id })),
    );
    const titles = new Map(notes.map((n) => [n.id, n.title]));
    for (const row of rows.filter((r) => r.favorite_type === 'note')) {
      if (!titles.has(row.target_id)) {
        out.set(row.id, missing);
        continue;
      }
      const parent = parentOf.get(row.target_id);
      out.set(row.id, {
        state: 'ok',
        label: titles.get(row.target_id) || null,
        secondaryLabel: parent ? (labels.get(parent.entity_instance_id) ?? null) : null,
      });
    }
  }

  // Note templates
  const templateIds = ids('note-template');
  if (templateIds.length > 0) {
    const templates = await tx.db
      .selectFrom('note_templates')
      .select(['id', 'title'])
      .where('id', 'in', templateIds)
      .where('deleted_at', 'is', null)
      .execute();
    const titles = new Map(templates.map((t) => [t.id, t.title]));
    for (const row of rows.filter((r) => r.favorite_type === 'note-template')) {
      out.set(
        row.id,
        titles.has(row.target_id)
          ? { state: 'ok', label: titles.get(row.target_id) || null, secondaryLabel: null }
          : missing,
      );
    }
  }

  // Dashboards (slice 9): title; "Private item" without read access.
  const dashboardIds = ids('reporting-dashboard');
  if (dashboardIds.length > 0) {
    const dashboards = await tx.db
      .selectFrom('reporting_dashboards')
      .select(['id', 'title'])
      .where('id', 'in', dashboardIds)
      .execute();
    const titles = new Map(dashboards.map((d) => [d.id, d.title]));
    const access = await dashboardAccess(tx, [...titles.keys()]);
    for (const row of rows.filter((r) => r.favorite_type === 'reporting-dashboard')) {
      if (!titles.has(row.target_id)) out.set(row.id, missing);
      else if (!access.get(row.target_id)?.flags.read_reporting_dashboard) out.set(row.id, forbiddenSummary);
      else out.set(row.id, { state: 'ok', label: titles.get(row.target_id) || null, secondaryLabel: null });
    }
  }

  // Call recordings (slice 10): the meeting title; "Private item" when the meeting is not visible.
  const callIds = ids('call-recording');
  if (callIds.length > 0) {
    const calls = await tx.db
      .selectFrom('call_recordings as r')
      .innerJoin('meetings as m', 'm.id', 'r.meeting_id')
      .select(['r.id', 'r.meeting_id', 'm.title'])
      .where('r.id', 'in', callIds)
      .where('r.deleted_at', 'is', null)
      .where('m.deleted_at', 'is', null)
      .execute();
    const byId = new Map(calls.map((c) => [c.id, c]));
    const access = await meetingAccess(
      tx,
      calls.map((c) => c.meeting_id),
    );
    for (const row of rows.filter((r) => r.favorite_type === 'call-recording')) {
      const call = byId.get(row.target_id);
      const level = call ? (access.get(call.meeting_id)?.access ?? 'none') : 'none';
      if (!call) out.set(row.id, missing);
      else if (level === 'none') out.set(row.id, forbiddenSummary);
      else out.set(row.id, { state: 'ok', label: level === 'metadata-only' ? null : call.title, secondaryLabel: null });
    }
  }

  for (const row of rows) if (!out.has(row.id)) out.set(row.id, unknown);
  return out;
}

function toFavorite(row: FavoriteRow, target: FavoriteTargetSummary): Favorite {
  return {
    id: row.id,
    favoriteType: row.favorite_type as FavoriteType,
    entityDefinitionId: row.entity_definition_id,
    targetId: row.target_id,
    directoryId: row.directory_id,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    target,
  };
}

async function oneFavorite(tx: Tx, deps: CollabDeps, row: FavoriteRow): Promise<Favorite> {
  const summaries = await summarize(tx, deps, [row]);
  return toFavorite(row, summaries.get(row.id) as FavoriteTargetSummary);
}

/** Validates that the target exists (for the types this slice owns) and returns its definition id for records/views. */
async function resolveTarget(
  tx: Tx,
  deps: CollabDeps,
  data: { favoriteType: FavoriteType; targetId: string; entityDefinitionId?: string | undefined },
): Promise<string | null> {
  switch (data.favoriteType) {
    case 'record': {
      const def = await loadDefinition(tx, data.entityDefinitionId as string);
      const row = await tx.db
        .selectFrom('entity_instances')
        .select(['entity_definition_id'])
        .where('id', '=', data.targetId)
        .where('archived_at', 'is', null)
        .where('merged_at', 'is', null)
        .executeTakeFirst();
      if (!row || row.entity_definition_id !== def.id) {
        throw notFound('The requested record could not be found', { entity_instance_id: data.targetId });
      }
      await deps.policies.assertCan(tx, def.id, 'read_entity_instance');
      return def.id;
    }
    case 'entity-view':
    case 'collection-view': {
      const view = await tx.db
        .selectFrom('entity_views')
        .select(['entity_definition_id'])
        .where('id', '=', data.targetId)
        .where('is_archived', '=', false)
        .executeTakeFirst();
      if (!view) throw notFound('The requested view could not be found', { view_id: data.targetId });
      await deps.policies.assertCan(tx, view.entity_definition_id, 'read_entity_definition');
      return view.entity_definition_id;
    }
    case 'note': {
      const note = await tx.db
        .selectFrom('notes')
        .select('id')
        .where('id', '=', data.targetId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!note) throw notFound('Note not found', { note_id: data.targetId });
      return null;
    }
    case 'note-template': {
      const template = await tx.db
        .selectFrom('note_templates')
        .select('id')
        .where('id', '=', data.targetId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!template) throw notFound('Note template not found', { note_template_id: data.targetId });
      return null;
    }
    case 'reporting-dashboard': {
      const row = await tx.db
        .selectFrom('reporting_dashboards')
        .select('id')
        .where('id', '=', data.targetId)
        .executeTakeFirst();
      const access = row ? (await dashboardAccess(tx, [row.id])).get(row.id) : undefined;
      if (!access?.flags.read_reporting_dashboard) {
        throw notFound('The requested dashboard could not be found', { reporting_dashboard_id: data.targetId });
      }
      return null;
    }
    case 'call-recording': {
      const row = await tx.db
        .selectFrom('call_recordings')
        .select(['id', 'meeting_id'])
        .where('id', '=', data.targetId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      const level = row ? ((await meetingAccess(tx, [row.meeting_id])).get(row.meeting_id)?.access ?? 'none') : 'none';
      if (level === 'none') throw notFound('Call recording not found', { call_recording_id: data.targetId });
      return null;
    }
    default:
      // Types owned by later slices (workflows, …) are stored as given.
      return null;
  }
}

export const favoriteOps = {
  async list(tx: Tx, deps: CollabDeps): Promise<ListFavoritesOutput> {
    const memberId = requireMember(tx);
    const dirs = await tx.db
      .selectFrom('favorite_directories')
      .selectAll()
      .where('member_id', '=', memberId)
      .orderBy('sort_order')
      .orderBy('id')
      .execute();
    const rows = await tx.db
      .selectFrom('favorites')
      .selectAll()
      .where('member_id', '=', memberId)
      .orderBy('sort_order')
      .orderBy('id')
      .execute();
    const summaries = await summarize(tx, deps, rows);
    return {
      directories: dirs.map(toDirectory),
      favorites: rows.map((r) => toFavorite(r, summaries.get(r.id) as FavoriteTargetSummary)),
    };
  },

  async put(tx: Tx, deps: CollabDeps, input: PutFavoriteInput): Promise<Favorite> {
    const data = putFavoriteInputSchema.parse(input);
    const memberId = requireMember(tx);
    const byId = await tx.db.selectFrom('favorites').selectAll().where('id', '=', data.id).executeTakeFirst();
    if (byId) {
      if (byId.member_id !== memberId || byId.target_id !== data.targetId) {
        throw conflict('ID_CONFLICT', 'This favorite id is already used', { favorite_id: data.id });
      }
      return oneFavorite(tx, deps, byId); // replay
    }
    const existing = await tx.db
      .selectFrom('favorites')
      .selectAll()
      .where('member_id', '=', memberId)
      .where('favorite_type', '=', data.favoriteType)
      .where('target_id', '=', data.targetId)
      .executeTakeFirst();
    if (existing) return oneFavorite(tx, deps, existing);
    const definitionId = await resolveTarget(tx, deps, data);
    if (data.directoryId) await requireDirectory(tx, memberId, data.directoryId);
    const sortOrder = data.sortOrder ?? (await topRank(tx, memberId, data.directoryId));
    const row = await tx.db
      .insertInto('favorites')
      .values({
        id: data.id,
        workspace_id: tx.workspaceId,
        member_id: memberId,
        favorite_type: data.favoriteType,
        entity_definition_id: definitionId,
        target_id: data.targetId,
        directory_id: data.directoryId,
        sort_order: sortOrder,
        created_at: tx.now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await emitFavorites(tx, memberId);
    return oneFavorite(tx, deps, row);
  },

  async move(tx: Tx, deps: CollabDeps, input: MoveFavoriteInput): Promise<Favorite> {
    const data = moveFavoriteInputSchema.parse(input);
    const memberId = requireMember(tx);
    if (data.directoryId) await requireDirectory(tx, memberId, data.directoryId);
    const row = await tx.db
      .updateTable('favorites')
      .set({ directory_id: data.directoryId, sort_order: data.sortOrder })
      .where('id', '=', data.favoriteId)
      .where('member_id', '=', memberId)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw notFound('The requested favorite could not be found', { favorite_id: data.favoriteId });
    await emitFavorites(tx, memberId);
    return oneFavorite(tx, deps, row);
  },

  /** Idempotent: removing a missing favorite succeeds. */
  async delete(tx: Tx, favoriteId: string): Promise<{ id: string }> {
    const memberId = requireMember(tx);
    const deleted = await tx.db
      .deleteFrom('favorites')
      .where('id', '=', favoriteId)
      .where('member_id', '=', memberId)
      .returning('id')
      .execute();
    if (deleted.length > 0) await emitFavorites(tx, memberId);
    return { id: favoriteId };
  },

  async removeByTarget(tx: Tx, input: RemoveFavoriteByTargetInput): Promise<{ removedIds: string[] }> {
    const data = removeFavoriteByTargetInputSchema.parse(input);
    const memberId = requireMember(tx);
    const deleted = await tx.db
      .deleteFrom('favorites')
      .where('member_id', '=', memberId)
      .where('favorite_type', '=', data.favoriteType)
      .where('target_id', '=', data.targetId)
      .returning('id')
      .execute();
    if (deleted.length > 0) await emitFavorites(tx, memberId);
    return { removedIds: deleted.map((d) => d.id) };
  },

  async putDirectory(tx: Tx, input: PutFavoriteDirectoryInput): Promise<FavoriteDirectory> {
    const data = putFavoriteDirectoryInputSchema.parse(input);
    const memberId = requireMember(tx);
    const existing = await tx.db
      .selectFrom('favorite_directories')
      .selectAll()
      .where('id', '=', data.id)
      .executeTakeFirst();
    if (existing) {
      if (existing.member_id !== memberId) throw conflict('ID_CONFLICT', 'This folder id is already used');
      return toDirectory(existing);
    }
    const row = await tx.db
      .insertInto('favorite_directories')
      .values({
        id: data.id,
        workspace_id: tx.workspaceId,
        member_id: memberId,
        title: data.title,
        sort_order: data.sortOrder ?? (await topRank(tx, memberId, null)),
        created_at: tx.now,
        updated_at: tx.now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await emitFavorites(tx, memberId);
    return toDirectory(row);
  },

  async updateDirectory(tx: Tx, input: UpdateFavoriteDirectoryInput): Promise<FavoriteDirectory> {
    const data = updateFavoriteDirectoryInputSchema.parse(input);
    const memberId = requireMember(tx);
    await requireDirectory(tx, memberId, data.directoryId);
    const row = await tx.db
      .updateTable('favorite_directories')
      .set({
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.sortOrder !== undefined ? { sort_order: data.sortOrder } : {}),
        updated_at: tx.now,
      })
      .where('id', '=', data.directoryId)
      .returningAll()
      .executeTakeFirstOrThrow();
    await emitFavorites(tx, memberId);
    return toDirectory(row);
  },

  /** Deletes the folder and every favorite inside it (B sidebar §6, observed). Idempotent. */
  async deleteDirectory(tx: Tx, directoryId: string): Promise<{ id: string; deletedFavoriteIds: string[] }> {
    const memberId = requireMember(tx);
    const dir = await tx.db
      .selectFrom('favorite_directories')
      .select('id')
      .where('id', '=', directoryId)
      .where('member_id', '=', memberId)
      .executeTakeFirst();
    if (!dir) return { id: directoryId, deletedFavoriteIds: [] };
    const favorites = await tx.db
      .deleteFrom('favorites')
      .where('directory_id', '=', directoryId)
      .returning('id')
      .execute();
    await tx.db.deleteFrom('favorite_directories').where('id', '=', directoryId).execute();
    await emitFavorites(tx, memberId);
    return { id: directoryId, deletedFavoriteIds: favorites.map((f) => f.id) };
  },
};

/** Removes every member's favorites of deleted targets (record delete, note delete, …). */
export async function deleteFavoritesOfTargets(tx: Tx, type: FavoriteType, targetIds: string[]): Promise<void> {
  if (targetIds.length === 0) return;
  const deleted = await tx.db
    .deleteFrom('favorites')
    .where('favorite_type', '=', type)
    .where('target_id', 'in', targetIds)
    .returning('member_id')
    .execute();
  for (const memberId of new Set(deleted.map((d) => d.member_id))) await emitFavorites(tx, memberId);
}

/** Re-points record favorites from merged-away records to the merged record (one favorite per member). */
export async function relinkRecordFavorites(
  tx: Tx,
  sourceIds: string[],
  mergedId: string,
  mergedDefId: string,
): Promise<void> {
  const rows = await tx.db
    .selectFrom('favorites')
    .selectAll()
    .where('favorite_type', '=', 'record')
    .where('target_id', 'in', sourceIds)
    .orderBy('sort_order')
    .execute();
  const kept = new Set<string>();
  for (const row of rows) {
    if (kept.has(row.member_id)) {
      await tx.db.deleteFrom('favorites').where('id', '=', row.id).execute();
    } else {
      kept.add(row.member_id);
      await tx.db
        .updateTable('favorites')
        .set({ target_id: mergedId, entity_definition_id: mergedDefId })
        .where('id', '=', row.id)
        .execute();
    }
  }
  for (const memberId of new Set(rows.map((r) => r.member_id))) await emitFavorites(tx, memberId);
}
