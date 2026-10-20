// Rule enforcement in the single write path (decision in slice6-contracts.md; A §4.13): after a transaction's values
// are applied and the projections refreshed (records engine finalize), every rule of a touched object is evaluated on
// the touched records: a record that matches the rule's condition but fails a requirement is a violation. Any
// violation throws 422 PARTICLE_GATE_VIOLATION, which rolls the whole write back; the client parks it.
// Rules apply to member writes only ("all workspace members"; "Rules are not applied to API/app writes" — J
// permissions §7): API tokens, imports, workflows and the system write unchecked.
import type { RuleViolation } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { DomainError } from '../errors.ts';
import type { DefInfo } from '../schema/model.ts';
import { projectionTableRef } from '../sqltext.ts';
import type { Tx } from '../tx.ts';
import { whereClause } from '../views/compiler.ts';
import { resolvePredicate } from '../views/resolve.ts';
import { displayValue, liveRules, negate, requirementLeaf, violationMessage } from './model.ts';

const MAX_REPORTED = 50;

export async function enforceRules(tx: Tx, touched: { def: DefInfo; ids: string[] }[]): Promise<void> {
  if (tx.ctx.actor.type !== 'workspace-member') return;
  const violations: RuleViolation[] = [];
  for (const { def, ids } of touched) {
    if (ids.length === 0 || !def.projectionTable) continue;
    const rules = await liveRules(tx, def.id);
    if (rules.length === 0) continue;
    const env = { now: tx.now, timeZone: 'UTC', memberId: tx.ctx.actor.id };
    const table = projectionTableRef(def.projectionTable);
    for (const rule of rules) {
      const condition = rule.condition
        ? await whereClause(tx, def, await resolvePredicate(tx, def, rule.condition, env))
        : 'TRUE';
      for (const req of rule.requirements) {
        const attr = def.byId.get(req.attributeDefinitionId);
        if (!attr || attr.isArchived) continue;
        const failing = await whereClause(
          tx,
          def,
          await resolvePredicate(tx, def, negate(requirementLeaf(def, req)), env),
        );
        const { rows } = await sql<{ id: string }>`
          SELECT p.instance_id AS id FROM ${sql.raw(table)} p
          WHERE p.instance_id = ANY(${ids}::uuid[]) AND ${sql.raw(condition)} AND ${sql.raw(failing)}
          ORDER BY p.instance_id LIMIT ${MAX_REPORTED}`.execute(tx.db);
        if (rows.length === 0) continue;
        const message = violationMessage(attr, req.operator, await displayValue(tx, attr, req.value));
        for (const r of rows) {
          violations.push({
            particle_gate_id: rule.id,
            rule_name: rule.name,
            particle_gate_validation_rule_id: req.id,
            entity_definition_id: def.id,
            entity_instance_id: r.id,
            attribute_definition_id: attr.id,
            operator: req.operator,
            value: req.value ?? null,
            message,
          });
        }
      }
    }
  }
  if (violations.length === 0) return;
  const first = violations[0] as RuleViolation;
  const attr = touched
    .find((t) => t.def.id === first.entity_definition_id)
    ?.def.byId.get(first.attribute_definition_id);
  throw new DomainError(
    422,
    'PARTICLE_GATE_VIOLATION',
    `Updates required: ${attr?.title ?? 'a value'} — ${first.message} (${first.rule_name})`,
    { violated_validation_rules: violations.slice(0, MAX_REPORTED) },
  );
}
