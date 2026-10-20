// `report-stale` invalidations (BACKLOG 9.10; H api §4.6, README §3.7): when a transaction changes records, values,
// attributes or options of a definition that some saved report depends on, Tx.flush adds one `report-stale` row per
// such definition (scope: the changed attributes, null = records added/removed). Cheap: one indexed query per write
// transaction over entity_reports.depends_on_definition_ids (GIN), and only definitions — the client matches the
// event against each cell's dataset freshness (definitions + attributes + seq) and shows "New data".
import { sql } from '@agentic-crm/db';
import type { ChangeEntry, Tx } from '../tx.ts';

/** Change entries that can change report results, per definition (null attribute set = everything). */
function changedDefinitions(changes: ChangeEntry[]): Map<string, Set<string> | null> {
  const out = new Map<string, Set<string> | null>();
  const add = (defId: unknown, attrIds: unknown[] | null) => {
    if (typeof defId !== 'string') return;
    if (!out.has(defId)) out.set(defId, new Set());
    const cur = out.get(defId);
    if (cur === null || cur === undefined) return;
    if (attrIds === null) out.set(defId, null);
    else for (const a of attrIds) if (typeof a === 'string') cur.add(a);
  };
  for (const c of changes) {
    switch (c.resource) {
      case 'snapshot-selection': {
        // Value writes name their attributes (engine.finalize).
        const attrs = c.scope.attributeDefinitionIds;
        add(c.scope.entityDefinitionId ?? c.resourceId, Array.isArray(attrs) ? attrs : null);
        break;
      }
      case 'entity-instance':
        // Records created, restored, deleted or merged: every result over the definition may change.
        add(c.scope.entityDefinitionId, null);
        break;
      case 'select-option-list':
      case 'attribute-definition':
        // Options renamed/reordered/archived, attributes archived or retyped: labels and stage order change.
        add(c.scope.entityDefinitionId, c.resourceId ? [c.resourceId] : null);
        break;
      default:
        break;
    }
  }
  return out;
}

export async function emitReportStale(tx: Tx, changes: ChangeEntry[]): Promise<void> {
  const changed = changedDefinitions(changes);
  if (changed.size === 0) return;
  const defIds = [...changed.keys()];
  const { rows } = await sql<{ defs: string[]; attrs: string[] }>`
    SELECT depends_on_definition_ids AS defs, depends_on_attribute_ids AS attrs
    FROM entity_reports
    WHERE depends_on_definition_ids && ${defIds}::uuid[]`.execute(tx.db);
  if (rows.length === 0) return;
  for (const [defId, attrs] of changed) {
    const affected = rows.some((r) => r.defs.includes(defId) && (attrs === null || r.attrs.some((a) => attrs.has(a))));
    if (!affected) continue;
    tx.emit('report-stale', defId, {
      entityDefinitionId: defId,
      attributeDefinitionIds: attrs === null ? null : [...attrs].sort(),
    });
  }
}

/**
 * The change_log cursor a result read in this transaction reflects: the newest row of the workspace visible to this
 * snapshot. A concurrent transaction that took a lower id but commits after this read is the only miss (its window is
 * the few statements between Tx.flush and COMMIT); an xmin-based cursor would avoid it but lags behind any long
 * transaction on the cluster, which kept cells permanently "stale".
 */
export async function freshnessSeq(tx: Tx): Promise<string> {
  const { rows } = await sql<{ id: string | null }>`
    SELECT max(id)::text AS id FROM change_log WHERE workspace_id = ${tx.workspaceId}::uuid`.execute(tx.db);
  return rows[0]?.id ?? '0';
}
