// rules.* (BACKLOG 6.06; J objects-lists §3.2, J permissions §7): the Rules tab of an object. Reading needs read access
// to the object; changing rules is object configuration (Full access: update_entity_definition). At most 8 live rules
// per object (capability particle_gates_per_object_hard): "You’ve reached the limit of {limit} requirement rules for
// this object." Rules are validated by compiling their condition and requirements with the view filter compiler.
import {
  type CreateRuleInput,
  createRuleInputSchema,
  deleteRuleInputSchema,
  type ListRulesInput,
  listRulesInputSchema,
  type Predicate,
  type ReorderRulesInput,
  type Requirement,
  type Rule,
  rankAfter,
  reorderRulesInputSchema,
  type UpdateRuleInput,
  updateRuleInputSchema,
} from '@agentic-crm/contracts';
import { jsonb } from '@agentic-crm/db';
import { capabilityOps } from '../capabilities.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import { kindOfDefinition } from '../permissions/resolve.ts';
import type { Policies } from '../permissions.ts';
import { type DefInfo, loadDefinition } from '../schema/model.ts';
import type { Tx } from '../tx.ts';
import { whereClause } from '../views/compiler.ts';
import { NO_MEMBER, resolvePredicate } from '../views/resolve.ts';
import { forgetRules, liveRules, negate, requirementAllowed, requirementLeaf, toRule } from './model.ts';

const ruleNotFound = (ruleId: string) =>
  notFound('The requested rule could not be found', { particle_gate_id: ruleId });

async function requireObject(tx: Tx, ref: string): Promise<DefInfo> {
  const def = await loadDefinition(tx, ref);
  if (kindOfDefinition(def) !== 'object') {
    throw badRequest('VALIDATION_ERROR', 'Requirement rules apply to objects', { entity_definition_id: def.id });
  }
  return def;
}

/** Validates a condition and requirements by compiling them (unknown attributes, bad operators → 400). */
async function validate(tx: Tx, def: DefInfo, condition: Predicate | null, requirements: Requirement[]): Promise<void> {
  const env = { now: tx.now, timeZone: 'UTC', memberId: NO_MEMBER };
  if (condition) {
    try {
      await whereClause(tx, def, await resolvePredicate(tx, def, condition, env));
    } catch (err) {
      throw badRequest('VALIDATION_ERROR', 'Incomplete condition', {
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  for (const req of requirements) {
    const attr = def.byId.get(req.attributeDefinitionId);
    if (!attr || attr.isArchived) {
      throw badRequest('VALIDATION_ERROR', 'Incomplete requirement', {
        attribute_definition_id: req.attributeDefinitionId,
      });
    }
    if (attr.isReadOnly || attr.systemAttributeType === 'id' || !requirementAllowed(attr, req.operator)) {
      throw badRequest('VALIDATION_ERROR', `Requirement "${req.operator}" is not available on "${attr.title}"`, {
        attribute_definition_id: attr.id,
      });
    }
    if (req.operator !== 'required' && req.operator !== 'empty' && (req.value === undefined || req.value === null)) {
      throw badRequest('VALIDATION_ERROR', 'Incomplete requirement', { attribute_definition_id: attr.id });
    }
    try {
      const leaf = await resolvePredicate(tx, def, negate(requirementLeaf(def, req)), env);
      await whereClause(tx, def, leaf);
    } catch (err) {
      throw badRequest('VALIDATION_ERROR', 'Incomplete requirement', {
        attribute_definition_id: attr.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function withIds(requirements: (Omit<Requirement, 'id'> & { id?: string | undefined })[]): Requirement[] {
  return requirements.map((r) => ({ ...r, id: r.id ?? newId() }));
}

async function requireRule(tx: Tx, ruleId: string) {
  const row = await tx.db
    .selectFrom('requirement_rules')
    .selectAll()
    .where('id', '=', ruleId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw ruleNotFound(ruleId);
  return row;
}

function emitRules(tx: Tx, defId: string): void {
  forgetRules(tx);
  tx.emit('requirement-rule-list', defId, { entityDefinitionId: defId });
}

export function ruleOps(policies: Policies) {
  return {
    async list(tx: Tx, input: ListRulesInput): Promise<Rule[]> {
      const data = listRulesInputSchema.parse(input);
      const def = await requireObject(tx, data.entityDefinitionId);
      await policies.assertCan(tx, def.id, 'read_entity_definition');
      return liveRules(tx, def.id);
    },

    async create(tx: Tx, input: CreateRuleInput): Promise<Rule> {
      const data = createRuleInputSchema.parse(input);
      const def = await requireObject(tx, data.entityDefinitionId);
      await policies.assertCan(tx, def.id, 'update_entity_definition');
      const existing = await tx.db
        .selectFrom('requirement_rules')
        .selectAll()
        .where('id', '=', data.id)
        .executeTakeFirst();
      if (existing) {
        if (existing.deleted_at !== null || existing.entity_definition_id !== def.id) {
          throw conflict('ID_CONFLICT', 'This rule id is already used');
        }
        return toRule(existing); // idempotent replay
      }
      const rules = await liveRules(tx, def.id);
      const limit = await capabilityOps.quota(tx, 'particle_gates_per_object_hard');
      if (limit !== null && rules.length >= limit) {
        throw conflict('OVER_USAGE_LIMIT', `You’ve reached the limit of ${limit} requirement rules for this object.`, {
          quota: 'particle_gates_per_object_hard',
          limit,
        });
      }
      const requirements = withIds(data.requirements);
      await validate(tx, def, data.condition, requirements);
      await tx.db
        .insertInto('requirement_rules')
        .values({
          id: data.id,
          workspace_id: tx.workspaceId,
          entity_definition_id: def.id,
          name: data.name,
          sort_order: data.sortOrder ?? rankAfter(rules.at(-1)?.sortOrder ?? null),
          condition: jsonb(data.condition),
          requirements: jsonb(requirements),
          applies_to: jsonb([{ type: 'all-workspace-members' }]),
          created_by: jsonb(tx.ctx.actor),
          created_at: tx.now,
          updated_at: tx.now,
        })
        .execute();
      emitRules(tx, def.id);
      return toRule(await requireRule(tx, data.id));
    },

    async update(tx: Tx, input: UpdateRuleInput): Promise<Rule> {
      const data = updateRuleInputSchema.parse(input);
      const row = await requireRule(tx, data.ruleId);
      const def = await loadDefinition(tx, row.entity_definition_id);
      await policies.assertCan(tx, def.id, 'update_entity_definition');
      const condition = data.condition !== undefined ? data.condition : ((row.condition ?? null) as Predicate | null);
      const requirements = data.requirements ? withIds(data.requirements) : (row.requirements as Requirement[]);
      await validate(tx, def, condition, requirements);
      await tx.db
        .updateTable('requirement_rules')
        .set({
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.condition !== undefined ? { condition: jsonb(data.condition) } : {}),
          ...(data.requirements !== undefined ? { requirements: jsonb(requirements) } : {}),
          ...(data.sortOrder !== undefined ? { sort_order: data.sortOrder } : {}),
          updated_at: tx.now,
        })
        .where('id', '=', row.id)
        .execute();
      emitRules(tx, def.id);
      return toRule(await requireRule(tx, row.id));
    },

    /** "Delete rule? — This removes the rule from this object." (soft). */
    async delete(tx: Tx, input: { ruleId: string }): Promise<{ id: string }> {
      const data = deleteRuleInputSchema.parse(input);
      const row = await requireRule(tx, data.ruleId);
      await policies.assertCan(tx, row.entity_definition_id, 'update_entity_definition');
      await tx.db
        .updateTable('requirement_rules')
        .set({ deleted_at: tx.now, deleted_by: jsonb(tx.ctx.actor), updated_at: tx.now })
        .where('id', '=', row.id)
        .execute();
      emitRules(tx, row.entity_definition_id);
      return { id: row.id };
    },

    /** New order of every live rule of the object. */
    async reorder(tx: Tx, input: ReorderRulesInput): Promise<Rule[]> {
      const data = reorderRulesInputSchema.parse(input);
      const def = await requireObject(tx, data.entityDefinitionId);
      await policies.assertCan(tx, def.id, 'update_entity_definition');
      const rules = await liveRules(tx, def.id);
      const live = new Set(rules.map((r) => r.id));
      if (data.ruleIds.length !== live.size || data.ruleIds.some((id) => !live.has(id))) {
        throw badRequest('VALIDATION_ERROR', 'Reorder must list every rule of the object exactly once');
      }
      let rank: string | null = null;
      for (const id of data.ruleIds) {
        rank = rankAfter(rank);
        await tx.db
          .updateTable('requirement_rules')
          .set({ sort_order: rank, updated_at: tx.now })
          .where('id', '=', id)
          .execute();
      }
      emitRules(tx, def.id);
      return liveRules(tx, def.id);
    },
  };
}
