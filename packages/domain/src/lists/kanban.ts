// Kanban boards over objects and lists (BACKLOG 4.05, 4.06; C2 kanban K2, K7, K8; README §4):
//   columns       one snapshot per visible stage (+ "No stage"), each the view's filter AND the stage leaf, ordered by
//                 the view's sorts (default: newest first) — no persisted in-column order (C.4 #11); archived stages
//                 never become columns (X-08); the board-wide calculation runs per column with the table rule (X-23).
//   move          writes the grouping value on the card itself, or through `parent_record` on the parent record
//                 (retire + insert, history and Activity, I6); "No stage" clears it; reports Confetti.
//   timeInStage   now − active_from of the current grouping value (value history), whole days, overdue vs target.
import type {
  AttributeValue,
  KanbanCalculation,
  KanbanColumn,
  KanbanColumnChunkInput,
  KanbanColumnsInput,
  KanbanColumnsOutput,
  KanbanMoveInput,
  KanbanMoveOutput,
  KanbanTimeInStageInput,
  KanbanTimeInStageOutput,
  Path,
  Predicate,
  PredicateLeaf,
  SnapshotChunkOutput,
  Sort,
  View,
} from '@agentic-crm/contracts';
import {
  kanbanColumnChunkInputSchema,
  kanbanColumnsInputSchema,
  kanbanMoveInputSchema,
  kanbanTimeInStageInputSchema,
} from '@agentic-crm/contracts';
import { badRequest, notFound } from '../errors.ts';
import type { Policies } from '../permissions.ts';
import { engineFor, toAttributeValue } from '../records/engine.ts';
import { type AttrDef, type DefInfo, loadDefinition } from '../schema/model.ts';
import { addIsoDuration } from '../time.ts';
import type { Tx } from '../tx.ts';
import { walkPath } from '../views/resolve.ts';
import { validateGroupBy, viewOps } from '../views/service.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The grouping attribute's id field in filters ('pipeline_stage_id' / 'select_option_id'). */
const idField = (attr: AttrDef) => (attr.type === 'pipeline' ? 'pipeline_stage_id' : 'select_option_id');

/** Default card order: newest first (decision C.4 #11), by the definition's created_at attribute. */
function defaultSorts(def: DefInfo): Sort[] {
  const createdAt = def.attrs.find((a) => a.systemAttributeType === 'created-at');
  return createdAt
    ? [{ path: [{ entityDefinitionId: def.id, attributeDefinitionId: createdAt.id }], direction: 'desc' }]
    : [];
}

/**
 * Follows a path from instances of `def` to the instances holding its last hop: every hop but the last is a record
 * reference; the first referenced record is followed (A §4.10 path semantics). Returns start id → leaf instance id.
 */
async function leafInstances(
  tx: Tx,
  def: DefInfo,
  path: Path,
  ids: string[],
): Promise<{ leafDef: DefInfo; leafAttr: AttrDef; targets: Map<string, string | null> }> {
  const { defs, attrs } = await walkPath(tx, def, path);
  let current = new Map(ids.map((id) => [id, id as string | null]));
  for (let i = 0; i < path.length - 1; i++) {
    const attr = attrs[i] as AttrDef;
    const from = [...new Set([...current.values()].filter((v): v is string => v !== null))];
    const rows = from.length
      ? await tx.db
          .selectFrom('attribute_values')
          .select(['instance_id', 'v_ref'])
          .where('instance_id', 'in', from)
          .where('attribute_id', '=', attr.id)
          .where('active_until', 'is', null)
          .orderBy('sort_order')
          .orderBy('active_from')
          .orderBy('id')
          .execute()
      : [];
    const first = new Map<string, string>();
    for (const r of rows) if (r.v_ref && !first.has(r.instance_id)) first.set(r.instance_id, r.v_ref);
    current = new Map([...current].map(([start, at]) => [start, at ? (first.get(at) ?? null) : null]));
  }
  return { leafDef: defs[defs.length - 1] as DefInfo, leafAttr: attrs[attrs.length - 1] as AttrDef, targets: current };
}

export function kanbanOps(policies: Policies) {
  return {
    async columns(tx: Tx, input: KanbanColumnsInput): Promise<KanbanColumnsOutput> {
      const data = kanbanColumnsInputSchema.parse(input);
      const def = await loadDefinition(tx, data.entityDefinitionId);
      await policies.assertCan(tx, def.id, 'read_entity_instance');
      let view: View | null = null;
      if (data.viewId) {
        view = await viewOps.get(tx, data.viewId);
        if (view.entityDefinitionId !== def.id) {
          throw badRequest('VALIDATION_ERROR', 'The view belongs to another object', { entity_view_id: view.id });
        }
      }
      const groupBy = data.groupBy ?? view?.kanban?.groupBy ?? view?.kanbanPivotPath ?? null;
      if (!groupBy) throw badRequest('VALIDATION_ERROR', 'Choose a status attribute to group the board by');
      const leaf = await validateGroupBy(tx, def, groupBy);
      for (const defId of new Set(groupBy.map((h) => h.entityDefinitionId))) {
        await policies.assertCan(tx, defId, 'read_attribute_value');
      }
      const filter: Predicate | null = data.filter !== undefined ? data.filter : (view?.filter ?? null);
      const sorts: Sort[] =
        data.sorts ??
        (view && view.sorts.length > 0
          ? view.sorts.map(({ path, field, direction }) => ({ path, direction, ...(field ? { field } : {}) }))
          : defaultSorts(def));
      const hidden = new Set(data.hiddenStageIds ?? view?.kanban?.hiddenStageIds ?? []);
      const showNoStage = data.showNoStage ?? view?.kanban?.showNoStage ?? view?.kanbanIsNoStatusVisible ?? true;
      const calculation: KanbanCalculation | null =
        data.calculation !== undefined ? data.calculation : (view?.kanban?.calculation ?? null);

      const stages = await tx.db
        .selectFrom('select_options')
        .selectAll()
        .where('attribute_id', '=', leaf.id)
        .where('is_archived', '=', false)
        .orderBy('sort_order')
        .orderBy('created_at')
        .execute();
      const stageIds: (string | null)[] = [
        ...(showNoStage ? [null] : []),
        ...stages.filter((s) => data.includeHidden || !hidden.has(s.id)).map((s) => s.id),
      ];
      const columns: KanbanColumn[] = [];
      for (const stageId of stageIds) {
        const leafPredicate: PredicateLeaf =
          stageId === null
            ? { path: groupBy, mode: 'must-not', constraints: [] }
            : { path: groupBy, mode: 'must', constraints: [{ field: idField(leaf), operator: 'eq', value: stageId }] };
        const snapshot = await viewOps.query(tx, {
          entityDefinitionId: def.id,
          filter: filter ? { and: [filter, leafPredicate] } : leafPredicate,
          sorts,
          ...(data.timeZone ? { timeZone: data.timeZone } : {}),
          initialRange: { start: 0, size: data.cardsPerColumn },
        });
        const aggregate = calculation
          ? await viewOps.aggregate(tx, {
              snapshotId: snapshot.snapshotId,
              path: calculation.path,
              ...(calculation.field ? { field: calculation.field } : {}),
              aggregation: calculation.aggregation,
            })
          : null;
        columns.push({
          stageId,
          snapshotId: snapshot.snapshotId,
          total: snapshot.total,
          firstIds: snapshot.ids,
          aggregate,
        });
      }
      return {
        entityDefinitionId: def.id,
        groupBy,
        attribute: {
          entityDefinitionId: leaf.entityDefinitionId,
          attributeDefinitionId: leaf.id,
          type: leaf.type,
          isRequired: leaf.isRequired,
        },
        stages: stages.map((s) => ({
          id: s.id,
          title: s.title,
          color: s.color,
          sortOrder: s.sort_order,
          isHidden: hidden.has(s.id),
          lifecyclePhase: s.kind === 'stage' ? (s.lifecycle_phase ?? 'ACTIVE') : null,
          targetTimeInStatus: s.target_time_in_status,
          celebrationEnabled: s.celebration_enabled,
        })),
        columns,
        calculation,
        accurateAt: tx.now,
      };
    },

    async columnChunk(tx: Tx, input: KanbanColumnChunkInput): Promise<SnapshotChunkOutput> {
      const data = kanbanColumnChunkInputSchema.parse(input);
      const def = await loadDefinition(tx, data.entityDefinitionId);
      await policies.assertCan(tx, def.id, 'read_entity_instance');
      const chunk = await viewOps.chunk(tx, { snapshotId: data.snapshotId, start: data.start, size: data.size });
      if (chunk.entityDefinitionId !== def.id) {
        throw notFound(
          'The snapshot has expired or does not exist',
          { snapshot_id: data.snapshotId },
          'SNAPSHOT_NOT_FOUND',
        );
      }
      return chunk;
    },

    async move(tx: Tx, input: KanbanMoveInput): Promise<KanbanMoveOutput> {
      const data = kanbanMoveInputSchema.parse(input);
      const def = await loadDefinition(tx, data.entityDefinitionId);
      await policies.assertCan(tx, def.id, 'read_entity_instance');
      await validateGroupBy(tx, def, data.groupBy);
      const card = await tx.db
        .selectFrom('entity_instances')
        .select(['id', 'entity_definition_id', 'archived_at', 'merged_at'])
        .where('id', '=', data.entityInstanceId)
        .executeTakeFirst();
      if (!card || card.entity_definition_id !== def.id || card.archived_at || card.merged_at) {
        throw notFound('The requested record could not be found', { entity_instance_id: data.entityInstanceId });
      }
      const { leafDef, leafAttr, targets } = await leafInstances(tx, def, data.groupBy, [card.id]);
      const targetId = targets.get(card.id);
      if (!targetId) {
        throw badRequest('VALIDATION_ERROR', 'This card has no record to move', { entity_instance_id: card.id });
      }
      await policies.assertCan(tx, leafDef.id, 'update_attribute_value');
      const engine = engineFor(tx);
      await engine.lock([targetId]);
      const target = await tx.db
        .selectFrom('entity_instances')
        .select(['archived_at', 'merged_at'])
        .where('id', '=', targetId)
        .executeTakeFirst();
      if (!target || target.archived_at || target.merged_at) {
        throw notFound('The requested record could not be found', { entity_instance_id: targetId });
      }
      const before = await engine.currentValues(targetId, leafAttr.id);
      const replay = data.attributeValueId
        ? await tx.db
            .selectFrom('attribute_values')
            .select(['instance_id', 'attribute_id'])
            .where('id', '=', data.attributeValueId)
            .executeTakeFirst()
        : undefined;
      let changed = false;
      if (replay) {
        if (replay.instance_id !== targetId || replay.attribute_id !== leafAttr.id) {
          throw badRequest('VALIDATION_ERROR', 'This value id is already used', {
            attribute_value_id: data.attributeValueId,
          });
        }
      } else if (data.toStageId === null) {
        changed = before.length > 0;
        if (changed) await engine.setAttribute(leafDef, targetId, leafAttr, [], 'replace');
      } else if (!(before.length === 1 && before[0]?.v_ref === data.toStageId.toLowerCase())) {
        changed = true;
        const value =
          leafAttr.type === 'pipeline' ? { pipelineStageId: data.toStageId } : { selectOptionId: data.toStageId };
        await engine.setAttribute(
          leafDef,
          targetId,
          leafAttr,
          [{ ...(data.attributeValueId ? { id: data.attributeValueId } : {}), value }],
          'replace',
        );
      }
      await engine.finalize();
      const after = await engine.currentValues(targetId, leafAttr.id);
      let celebrate = false;
      if (changed && data.toStageId !== null) {
        const stage = await tx.db
          .selectFrom('select_options')
          .select('celebration_enabled')
          .where('id', '=', data.toStageId)
          .executeTakeFirst();
        celebrate = stage?.celebration_enabled === true;
      }
      return {
        target: { entityDefinitionId: leafDef.id, entityInstanceId: targetId, attributeDefinitionId: leafAttr.id },
        values: after.map((r): AttributeValue => toAttributeValue(leafAttr, r)),
        changed,
        celebrate,
      };
    },

    async timeInStage(tx: Tx, input: KanbanTimeInStageInput): Promise<KanbanTimeInStageOutput> {
      const data = kanbanTimeInStageInputSchema.parse(input);
      const def = await loadDefinition(tx, data.entityDefinitionId);
      await policies.assertCan(tx, def.id, 'read_entity_instance');
      await validateGroupBy(tx, def, data.groupBy);
      const { leafDef, leafAttr, targets } = await leafInstances(tx, def, data.groupBy, data.entityInstanceIds);
      await policies.assertCan(tx, leafDef.id, 'read_attribute_value');
      const leafIds = [...new Set([...targets.values()].filter((v): v is string => v !== null))];
      const rows = leafIds.length
        ? await tx.db
            .selectFrom('attribute_values as v')
            .leftJoin('select_options as s', 's.id', 'v.v_ref')
            .select(['v.instance_id', 'v.v_ref', 'v.active_from', 's.target_time_in_status'])
            .where('v.instance_id', 'in', leafIds)
            .where('v.attribute_id', '=', leafAttr.id)
            .where('v.active_until', 'is', null)
            .orderBy('v.active_from', 'desc')
            .execute()
        : [];
      const current = new Map<string, (typeof rows)[number]>();
      for (const r of rows) if (!current.has(r.instance_id)) current.set(r.instance_id, r);
      const now = Date.parse(tx.now);
      const items: KanbanTimeInStageOutput['items'] = {};
      for (const id of data.entityInstanceIds) {
        const leafId = targets.get(id);
        const r = leafId ? current.get(leafId) : undefined;
        if (!r) {
          items[id] = { stageId: null, enteredAt: null, days: null, targetTimeInStatus: null, isOverdue: false };
          continue;
        }
        const target = r.target_time_in_status ?? null;
        items[id] = {
          stageId: r.v_ref,
          enteredAt: r.active_from,
          days: Math.max(0, Math.floor((now - Date.parse(r.active_from)) / DAY_MS)),
          targetTimeInStatus: target,
          isOverdue: target !== null && Date.parse(addIsoDuration(r.active_from, target)) < now,
        };
      }
      return { items, accurateAt: tx.now };
    },
  };
}
