// Record reads/writes added for the public API adapters: unique-value lookup (upsert by matching attribute),
// batch reads with values (query pages) and per-attribute multiselect modes (upsert appends to its matching attribute).
import { describe, expect, it } from 'vitest';
import { createWorkspace, domain, expectCode, newId } from './support/harness.ts';

describe('records for the public API', () => {
  it('finds live records by normalised unique values; non-unique attributes are rejected', async () => {
    const ws = await createWorkspace();
    const id = newId();
    await domain.records.create(ws.ctx, {
      entityDefinitionId: 'people',
      entityInstanceId: id,
      values: { email_addresses: [{ value: 'ada@example.com' }, { value: 'ada@lovelace.test' }] },
    });
    const ref = { entityDefinitionId: 'people', attributeDefinitionId: 'email_addresses' };
    const found = await domain.records.findByUniqueValues(ws.ctx, { ...ref, values: [{ value: ' ADA@Example.com ' }] });
    expect(found.entityInstanceIds).toEqual([id]);
    const none = await domain.records.findByUniqueValues(ws.ctx, { ...ref, values: [{ value: 'nobody@example.com' }] });
    expect(none.entityInstanceIds).toEqual([]);
    await expectCode(
      domain.records.findByUniqueValues(ws.ctx, {
        ...ref,
        attributeDefinitionId: 'job_title',
        values: [{ value: 'x' }],
      }),
      'VALIDATION_ERROR',
      400,
    );
    await domain.records.delete(ws.ctx, { entityDefinitionId: 'people', entityInstanceId: id });
    const afterDelete = await domain.records.findByUniqueValues(ws.ctx, {
      ...ref,
      values: [{ value: 'ada@example.com' }],
    });
    expect(afterDelete.entityInstanceIds).toEqual([]);
  });

  it('reads many live records with values in the requested order', async () => {
    const ws = await createWorkspace();
    const ids = [newId(), newId(), newId()];
    for (const [i, id] of ids.entries()) {
      await domain.records.create(ws.ctx, {
        entityDefinitionId: 'companies',
        entityInstanceId: id,
        values: { name: [{ value: `Company ${i}` }] },
      });
    }
    await domain.records.delete(ws.ctx, { entityDefinitionId: 'companies', entityInstanceId: ids[1] as string });
    const out = await domain.records.batchGetWithValues(ws.ctx, {
      entityDefinitionId: 'companies',
      entityInstanceIds: [ids[2] as string, ids[1] as string, newId(), ids[0] as string],
    });
    expect(out.records.map((r) => r.record.entityInstanceId)).toEqual([ids[2], ids[0]]);
    const companies = await domain.schema.getObject(ws.ctx, 'companies');
    const name = (await domain.schema.listAttributes(ws.ctx, { entityDefinitionId: companies.id })).find(
      (a) => a.apiSlug === 'name',
    );
    expect(out.records[0]?.values[name?.id as string]?.[0]?.value).toBe('Company 2');
  });

  it('applies per-attribute multiselect modes in one update', async () => {
    const ws = await createWorkspace();
    const id = newId();
    await domain.records.create(ws.ctx, {
      entityDefinitionId: 'people',
      entityInstanceId: id,
      values: { email_addresses: [{ value: 'a@example.com' }], phone_numbers: [{ value: '+442079460958' }] },
    });
    const updated = await domain.records.update(ws.ctx, {
      entityDefinitionId: 'people',
      entityInstanceId: id,
      values: { email_addresses: [{ value: 'b@example.com' }], phone_numbers: [{ value: '+14155550100' }] },
      multiselectMode: 'replace',
      multiselectModes: { email_addresses: 'append' },
    });
    const attrs = await domain.schema.listAttributes(ws.ctx, { entityDefinitionId: 'people' });
    const slug = (s: string) => attrs.find((a) => a.apiSlug === s)?.id as string;
    expect(
      updated.values[slug('email_addresses')]?.map(
        (v) => (v.value as { normalizedEmailAddress: string }).normalizedEmailAddress,
      ),
    ).toEqual(['a@example.com', 'b@example.com']);
    expect(
      updated.values[slug('phone_numbers')]?.map(
        (v) => (v.value as { normalizedPhoneNumber: string }).normalizedPhoneNumber,
      ),
    ).toEqual(['+14155550100']);
  });
});
