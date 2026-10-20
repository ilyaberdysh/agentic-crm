// Data-model limits (CROSS-DOMAIN C.4 #7): options/stages per attribute (409 ATTRIBUTE_SELECT_OPTIONS_LIMIT_EXCEEDED),
// attributes and views per object (409 OVER_USAGE_LIMIT), defaults from contracts quotaDefaults, workspace overrides
// through capabilities, and the 500-attribute ceiling.
import { sql } from '@agentic-crm/db';
import { beforeAll, describe, expect, it } from 'vitest';
import { limitOf } from '../src/limits.ts';
import { runInWorkspace } from '../src/tx.ts';
import { createWorkspace, database, domain, expectCode, newId, type TestWorkspace } from './support/harness.ts';

let ws: TestWorkspace;

async function setQuotas(quotas: Record<string, number | null>) {
  await sql`UPDATE workspaces SET settings = jsonb_set(settings, '{capabilities}', ${JSON.stringify({ quotas })}::jsonb)
    WHERE id = ${ws.workspaceId}::uuid`.execute(database.kysely);
}
async function object(slug: string) {
  return (
    await domain.schema.createObject(ws.ctx, {
      id: newId(),
      apiSlug: `${slug}_${Math.random().toString(36).slice(2, 7)}`,
      singularNoun: slug,
      pluralNoun: `${slug}s`,
    })
  ).id;
}

beforeAll(async () => {
  ws = await createWorkspace();
});

describe('limits', () => {
  it('publishes the defaults through capabilities', async () => {
    const caps = await domain.capabilities.get(ws.ctx);
    expect(caps.quotas).toMatchObject({
      select_options_per_attribute_hard: 500,
      attributes_per_object_hard: 500,
      views_per_object_hard: 500,
      seats_per_workspace_hard: null,
    });
  });

  it('caps options per attribute at 500 by default', async () => {
    const id = await object('opt');
    const options = Array.from({ length: 500 }, (_, i) => ({ title: `Option ${i}` }));
    await domain.schema.createAttribute(ws.ctx, {
      id: newId(),
      entityDefinitionId: id,
      title: 'Many',
      type: 'select',
      options,
    });
    const err = await expectCode(
      domain.schema.createOption(ws.ctx, {
        entityDefinitionId: id,
        attributeDefinitionId: 'many',
        id: newId(),
        title: 'One too many',
      }),
      'ATTRIBUTE_SELECT_OPTIONS_LIMIT_EXCEEDED',
      409,
    );
    expect(err.details).toMatchObject({ limit: 500 });
  });

  it('applies workspace overrides: options, stages, attributes (archived count) and views', async () => {
    const id = await object('ovr');
    const attrs = (await domain.schema.listAttributes(ws.ctx, { entityDefinitionId: id })).length;
    await setQuotas({
      select_options_per_attribute_hard: 3,
      attributes_per_object_hard: attrs + 2,
      views_per_object_hard: 2,
    });
    try {
      // Options and stages.
      await expectCode(
        domain.schema.createAttribute(ws.ctx, {
          id: newId(),
          entityDefinitionId: id,
          title: 'Too many options',
          type: 'select',
          options: [{ title: 'a' }, { title: 'b' }, { title: 'c' }, { title: 'd' }],
        }),
        'ATTRIBUTE_SELECT_OPTIONS_LIMIT_EXCEEDED',
        409,
      );
      await domain.schema.createAttribute(ws.ctx, {
        id: newId(),
        entityDefinitionId: id,
        title: 'Phase',
        type: 'pipeline',
        stages: [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }],
      });
      await expectCode(
        domain.schema.createStage(ws.ctx, {
          entityDefinitionId: id,
          attributeDefinitionId: 'phase',
          id: newId(),
          title: 'Four',
        }),
        'ATTRIBUTE_SELECT_OPTIONS_LIMIT_EXCEEDED',
        409,
      );
      // Attributes: the pipeline above used one slot, one more fits, archiving does not free a slot.
      const last = await domain.schema.createAttribute(ws.ctx, {
        id: newId(),
        entityDefinitionId: id,
        title: 'Last',
        type: 'text',
      });
      await domain.schema.updateAttribute(ws.ctx, {
        entityDefinitionId: id,
        attributeDefinitionId: last.id,
        isArchived: true,
      });
      const err = await expectCode(
        domain.schema.createAttribute(ws.ctx, { id: newId(), entityDefinitionId: id, title: 'Over', type: 'number' }),
        'OVER_USAGE_LIMIT',
        409,
      );
      expect(err.details).toMatchObject({
        quota: 'attributes_per_object_hard',
        limit: attrs + 2,
        entity_definition_id: id,
      });
      // A relationship counts on both objects.
      const other = await object('rel');
      await expectCode(
        domain.schema.createAttribute(ws.ctx, {
          id: newId(),
          entityDefinitionId: other,
          title: 'Link',
          type: 'entity-reference',
          relationship: { id: newId(), entityDefinitionId: id, title: 'Back link' },
        }),
        'OVER_USAGE_LIMIT',
        409,
      );
      // Views.
      await domain.views.create(ws.ctx, { id: newId(), entityDefinitionId: id, title: 'One' });
      await domain.views.create(ws.ctx, { id: newId(), entityDefinitionId: id, title: 'Two' });
      const viewErr = await expectCode(
        domain.views.create(ws.ctx, { id: newId(), entityDefinitionId: id, title: 'Three' }),
        'OVER_USAGE_LIMIT',
        409,
      );
      expect(viewErr.details).toMatchObject({ quota: 'views_per_object_hard', limit: 2 });
      // A replayed create of an existing view is not a new view.
      const views = await domain.views.list(ws.ctx, { entityDefinitionId: id });
      const replay = await domain.views.create(ws.ctx, {
        id: views[0]?.id as string,
        entityDefinitionId: id,
        title: 'One',
      });
      expect(replay.id).toBe(views[0]?.id);
    } finally {
      await setQuotas({});
    }
  });

  it('clamps attribute overrides at the 500-column ceiling; null keeps the default', async () => {
    await setQuotas({ attributes_per_object_hard: 10_000, views_per_object_hard: null });
    try {
      await runInWorkspace(database, ws.ctx, async (tx) => {
        expect(await limitOf(tx, 'attributes_per_object_hard')).toBe(500);
        expect(await limitOf(tx, 'views_per_object_hard')).toBe(500);
      });
    } finally {
      await setQuotas({});
    }
  });
});
