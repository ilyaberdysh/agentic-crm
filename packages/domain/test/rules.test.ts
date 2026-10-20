// Requirement rules (BACKLOG 6.06; J permissions §7, A §4.13): CRUD, validation, the 8-rule limit, and enforcement in
// the write path — a member write that leaves a matching record violating a requirement rolls back with 422
// PARTICLE_GATE_VIOLATION; API tokens and the system are not checked.
import { describe, expect, it } from 'vitest';
import { createWorkspace, domain, expectCode, newId, type TestWorkspace } from './support/harness.ts';

async function dealsObject(ws: TestWorkspace) {
  const object = await domain.schema.createObject(ws.ctx, {
    id: newId(),
    apiSlug: `opps_${Math.random().toString(36).slice(2, 8)}`,
    singularNoun: 'Opportunity',
    pluralNoun: 'Opportunities',
  });
  const amount = await domain.schema.createAttribute(ws.ctx, {
    id: newId(),
    entityDefinitionId: object.id,
    title: 'Amount',
    type: 'number',
  });
  const stage = await domain.schema.createAttribute(ws.ctx, {
    id: newId(),
    entityDefinitionId: object.id,
    title: 'Stage',
    type: 'select',
    options: [{ title: 'Lead' }, { title: 'Won' }],
  });
  const reason = await domain.schema.createAttribute(ws.ctx, {
    id: newId(),
    entityDefinitionId: object.id,
    title: 'Close reason',
    type: 'text',
  });
  const options = await domain.schema.listOptions(ws.ctx, {
    entityDefinitionId: object.id,
    attributeDefinitionId: stage.id,
  });
  const won = options.find((o) => o.title === 'Won')?.id as string;
  const lead = options.find((o) => o.title === 'Lead')?.id as string;
  return { object, amount, stage, reason, won, lead };
}

describe('requirement rules', () => {
  it('a violating member write is refused with the rule message; fixing the values lets it through', async () => {
    const ws = await createWorkspace();
    const d = await dealsObject(ws);
    const rule = await domain.rules.create(ws.ctx, {
      id: newId(),
      entityDefinitionId: d.object.id,
      name: 'Won deals need a reason and an amount',
      condition: {
        path: [{ entityDefinitionId: d.object.id, attributeDefinitionId: d.stage.id }],
        mode: 'must',
        constraints: [{ field: 'value', operator: 'eq', value: d.won }],
      },
      requirements: [
        { attributeDefinitionId: d.reason.id, operator: 'required' },
        { attributeDefinitionId: d.amount.id, operator: 'gt', value: 10 },
      ],
    });
    expect(rule).toMatchObject({
      name: 'Won deals need a reason and an amount',
      appliesTo: [{ type: 'all-workspace-members' }],
    });
    expect(rule.requirements.every((r) => typeof r.id === 'string')).toBe(true);

    // Records outside the condition are unaffected.
    const id = newId();
    await domain.records.create(ws.ctx, {
      entityDefinitionId: d.object.id,
      entityInstanceId: id,
      values: { [d.stage.id]: [{ value: { selectOptionId: d.lead } }] },
    });
    const ref = { entityDefinitionId: d.object.id, entityInstanceId: id };
    const err = await expectCode(
      domain.records.update(ws.ctx, {
        ...ref,
        values: { [d.stage.id]: [{ value: { selectOptionId: d.won } }], [d.amount.id]: [{ value: 5 }] },
      }),
      'PARTICLE_GATE_VIOLATION',
      422,
    );
    const violations = err.details.violated_validation_rules as { message: string; attribute_definition_id: string }[];
    expect(violations.map((v) => [v.attribute_definition_id, v.message])).toEqual([
      [d.reason.id, 'Must have a value'],
      [d.amount.id, 'Must be greater than 10'],
    ]);
    // Rolled back: the stage is still Lead.
    const current = await domain.records.get(ws.ctx, ref);
    expect((current.values[d.stage.id]?.[0]?.value as { id?: string } | string | undefined) ?? null).not.toBeNull();
    const stageNow = JSON.stringify(current.values[d.stage.id]);
    expect(stageNow).toContain(d.lead);

    await domain.records.update(ws.ctx, {
      ...ref,
      values: {
        [d.stage.id]: [{ value: { selectOptionId: d.won } }],
        [d.amount.id]: [{ value: 50 }],
        [d.reason.id]: [{ value: 'Budget' }],
      },
    });
    // Creating a matching record that violates is refused too; API tokens and the system are not checked.
    await expectCode(
      domain.records.create(ws.ctx, {
        entityDefinitionId: d.object.id,
        entityInstanceId: newId(),
        values: { [d.stage.id]: [{ value: { selectOptionId: d.won } }] },
      }),
      'PARTICLE_GATE_VIOLATION',
      422,
    );
    const token = { workspaceId: ws.workspaceId, actor: { type: 'api-token' as const, id: newId() } };
    await domain.records.create(token, {
      entityDefinitionId: d.object.id,
      entityInstanceId: newId(),
      values: { [d.stage.id]: [{ value: { selectOptionId: d.won } }] },
    });
  });

  it('empty / comparison operators, update, delete and reorder', async () => {
    const ws = await createWorkspace();
    const d = await dealsObject(ws);
    const a = await domain.rules.create(ws.ctx, {
      id: newId(),
      entityDefinitionId: d.object.id,
      name: 'Leads have no reason',
      condition: {
        path: [{ entityDefinitionId: d.object.id, attributeDefinitionId: d.stage.id }],
        mode: 'must',
        constraints: [{ field: 'value', operator: 'eq', value: d.lead }],
      },
      requirements: [{ attributeDefinitionId: d.reason.id, operator: 'empty' }],
    });
    const b = await domain.rules.create(ws.ctx, {
      id: newId(),
      entityDefinitionId: d.object.id,
      name: 'Amounts are small',
      condition: null,
      requirements: [{ attributeDefinitionId: d.amount.id, operator: 'lte', value: 1000 }],
    });
    await expectCode(
      domain.records.create(ws.ctx, {
        entityDefinitionId: d.object.id,
        entityInstanceId: newId(),
        values: { [d.stage.id]: [{ value: { selectOptionId: d.lead } }], [d.reason.id]: [{ value: 'x' }] },
      }),
      'PARTICLE_GATE_VIOLATION',
    );
    const big = await expectCode(
      domain.records.create(ws.ctx, {
        entityDefinitionId: d.object.id,
        entityInstanceId: newId(),
        values: { [d.amount.id]: [{ value: 5000 }] },
      }),
      'PARTICLE_GATE_VIOLATION',
    );
    expect(big.details.violated_validation_rules).toMatchObject([{ message: 'Must be less than or equal to 1000' }]);

    await domain.rules.update(ws.ctx, {
      ruleId: b.id,
      requirements: [{ attributeDefinitionId: d.amount.id, operator: 'lte', value: 10_000 }],
    });
    await domain.records.create(ws.ctx, {
      entityDefinitionId: d.object.id,
      entityInstanceId: newId(),
      values: { [d.amount.id]: [{ value: 5000 }] },
    });
    const reordered = await domain.rules.reorder(ws.ctx, { entityDefinitionId: d.object.id, ruleIds: [b.id, a.id] });
    expect(reordered.map((r) => r.id)).toEqual([b.id, a.id]);
    await domain.rules.delete(ws.ctx, a.id);
    expect((await domain.rules.list(ws.ctx, { entityDefinitionId: d.object.id })).map((r) => r.id)).toEqual([b.id]);
  });

  it('validation: incomplete requirements and operators that do not fit the type are refused', async () => {
    const ws = await createWorkspace();
    const d = await dealsObject(ws);
    const base = { entityDefinitionId: d.object.id, name: 'R', condition: null };
    await expectCode(
      domain.rules.create(ws.ctx, {
        ...base,
        id: newId(),
        requirements: [{ attributeDefinitionId: d.reason.id, operator: 'gt', value: 'a' }],
      }),
      'VALIDATION_ERROR',
    );
    await expectCode(
      domain.rules.create(ws.ctx, {
        ...base,
        id: newId(),
        requirements: [{ attributeDefinitionId: d.amount.id, operator: 'gt' }],
      }),
      'VALIDATION_ERROR',
    );
    await expectCode(
      domain.rules.create(ws.ctx, {
        ...base,
        id: newId(),
        requirements: [{ attributeDefinitionId: newId(), operator: 'required' }],
      }),
      'VALIDATION_ERROR',
    );
    const lists = await domain.lists.create(ws.ctx, { name: 'L', parentEntityDefinitionIds: ['people'] });
    await expectCode(
      domain.rules.create(ws.ctx, {
        ...base,
        entityDefinitionId: lists.list.id,
        id: newId(),
        requirements: [{ attributeDefinitionId: d.amount.id, operator: 'required' }],
      }),
      'VALIDATION_ERROR',
    );
  });

  it('the ninth rule on an object is refused with the limit message; configuring rules needs Full access', async () => {
    const ws = await createWorkspace();
    const d = await dealsObject(ws);
    const make = (ctx = ws.ctx) =>
      domain.rules.create(ctx, {
        id: newId(),
        entityDefinitionId: d.object.id,
        name: 'Amount required',
        condition: null,
        requirements: [{ attributeDefinitionId: d.amount.id, operator: 'required' }],
      });
    for (let i = 0; i < 8; i++) await make();
    const err = await expectCode(make(), 'OVER_USAGE_LIMIT', 409);
    expect((err as unknown as Error).message).toBe('You’ve reached the limit of 8 requirement rules for this object.');
    expect(err.details).toMatchObject({ quota: 'particle_gates_per_object_hard', limit: 8 });

    await domain.permissions.put(ws.ctx, {
      resourceKind: 'object',
      resourceId: d.object.id,
      target: { type: 'member', id: ws.memberId },
      level: 'read-write',
    });
    const rules = await domain.rules.list(ws.ctx, { entityDefinitionId: d.object.id });
    await expectCode(domain.rules.delete(ws.ctx, rules[0]?.id as string), 'FORBIDDEN', 403);
  });
});
