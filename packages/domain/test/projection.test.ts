// The projection is a cache of attribute_values: after any sequence of writes it must equal a rebuild (D-06).
import { describe, expect, it } from 'vitest';
import { createWorkspace, database, domain, newId } from './support/harness.ts';

describe('typed projection', () => {
  it('equals a rebuild from attribute_values after random writes', async () => {
    const ws = await createWorkspace();
    const object = await domain.schema.createObject(ws.ctx, {
      id: newId(),
      apiSlug: 'deals2',
      singularNoun: 'Opportunity',
      pluralNoun: 'Opportunities',
    });
    const make = (title: string, type: string, extra: Record<string, unknown> = {}) =>
      domain.schema.createAttribute(ws.ctx, {
        id: newId(),
        entityDefinitionId: object.id,
        title,
        type: type as never,
        ...extra,
      });
    const title = await make('Title', 'text');
    const amount = await make('Amount', 'currency');
    const stage = await make('Stage', 'pipeline', { stages: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] });
    const tags = await make('Tags', 'select', {
      isMultiselect: true,
      options: [{ title: 'x' }, { title: 'y' }, { title: 'z' }],
    });
    const where = await make('Where', 'location');
    const who = await make('Who', 'personal-name');
    const phones = await make('Phones', 'phone-number', { isMultiselect: true });
    const stages = (
      await domain.schema.listStages(ws.ctx, { entityDefinitionId: object.id, attributeDefinitionId: stage.id })
    ).map((s) => s.id);
    const options = (
      await domain.schema.listOptions(ws.ctx, { entityDefinitionId: object.id, attributeDefinitionId: tags.id })
    ).map((o) => o.id);

    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 48_271) % 2_147_483_647;
      return seed % n;
    };
    const ids: string[] = [];
    const deleted = new Set<string>();
    const ref = (id: string) => ({ entityDefinitionId: object.id, entityInstanceId: id });

    for (let step = 0; step < 150; step++) {
      const op = ids.length < 5 ? 0 : rnd(7);
      const id = ids[rnd(ids.length)] as string;
      const alive = id && !deleted.has(id);
      if (op === 0) {
        const nid = newId();
        ids.push(nid);
        await domain.records.create(ws.ctx, { ...ref(nid), values: { [title.id]: [{ value: `T${rnd(50)}` }] } });
      } else if (op === 1 && alive) {
        await domain.records.update(ws.ctx, {
          ...ref(id),
          values: {
            [amount.id]: rnd(3) === 0 ? [] : [{ value: { currencyValue: rnd(10_000) } }],
            [stage.id]: [{ value: { pipelineStageId: stages[rnd(3)] } }],
          },
        });
      } else if (op === 2 && alive) {
        const set = options.filter(() => rnd(2) === 0).map((o) => ({ value: { selectOptionId: o } }));
        await domain.records.update(ws.ctx, { ...ref(id), values: { [tags.id]: set } });
      } else if (op === 3 && alive) {
        await domain.records.update(ws.ctx, {
          ...ref(id),
          values: {
            [where.id]: [
              { value: { locality: ['Paris', 'Berlin', 'Zürich'][rnd(3)], countryCode: ['FR', 'DE', 'CH'][rnd(3)] } },
            ],
            [who.id]: [{ value: { firstName: `F${rnd(9)}`, lastName: `L${rnd(9)}` } }],
          },
        });
      } else if (op === 4 && alive) {
        await domain.records.update(ws.ctx, {
          ...ref(id),
          values: { [phones.id]: [{ value: `+4930${rnd(1_000_000)}` }] },
          multiselectMode: 'append',
        });
      } else if (op === 5 && alive) {
        await domain.records.delete(ws.ctx, ref(id));
        deleted.add(id);
      } else if (op === 6 && id && deleted.has(id)) {
        await domain.records.restore(ws.ctx, ref(id));
        deleted.delete(id);
      }
    }
    const live = ids.length - deleted.size;
    expect(await domain.schema.verifyProjection(ws.ctx, object.id)).toEqual({
      entityDefinitionId: object.id,
      rows: live,
      mismatchedRows: 0,
    });

    // Corrupt the cache behind the engine's back: verification notices, rebuild repairs.
    const def = await database.kysely
      .selectFrom('entity_definitions')
      .select('projection_table')
      .where('id', '=', object.id)
      .executeTakeFirstOrThrow();
    await database.pool.query(`UPDATE proj."${def.projection_table}" SET a6 = NULL`);
    const drift = await domain.schema.verifyProjection(ws.ctx, object.id);
    expect(drift.mismatchedRows).toBeGreaterThan(0);
    expect(await domain.schema.rebuildProjection(ws.ctx, object.id)).toEqual({
      entityDefinitionId: object.id,
      rows: live,
      mismatchedRows: 0,
    });

    // A new attribute adds its column; existing rows read NULL until written.
    const later = await make('Later', 'number');
    expect(await domain.schema.verifyProjection(ws.ctx, object.id)).toMatchObject({ mismatchedRows: 0 });
    const target = ids.find((i) => !deleted.has(i)) as string;
    await domain.records.update(ws.ctx, { ...ref(target), values: { [later.id]: [{ value: 7 }] } });
    expect(await domain.schema.verifyProjection(ws.ctx, object.id)).toMatchObject({ mismatchedRows: 0 });
    await domain.schema.ensureIndex(ws.ctx, object.id, later.id);
    await domain.schema.ensureIndex(ws.ctx, object.id, tags.id);
    const attrs = await domain.schema.listAttributes(ws.ctx, { entityDefinitionId: object.id });
    expect(attrs.find((a) => a.id === later.id)).toBeDefined();
  });
});
