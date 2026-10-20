import type { AttributeDefinition, AttributeType, CreateAttributeInput } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import { toErrorEnvelope } from '../src/index.ts';
import { createWorkspace, domain, expectCode, newId, type TestWorkspace } from './support/harness.ts';

async function customObject(ws: TestWorkspace, slug = 'projects') {
  return domain.schema.createObject(ws.ctx, {
    id: newId(),
    apiSlug: slug,
    singularNoun: 'Project',
    pluralNoun: 'Projects',
  });
}

async function attribute(
  ws: TestWorkspace,
  objectId: string,
  input: Omit<CreateAttributeInput, 'id' | 'entityDefinitionId'>,
) {
  return domain.schema.createAttribute(ws.ctx, { id: newId(), entityDefinitionId: objectId, ...input });
}

async function newRecord(ws: TestWorkspace, object: string, values: Record<string, { value: unknown }[]> = {}) {
  const id = newId();
  const out = await domain.records.create(ws.ctx, { entityDefinitionId: object, entityInstanceId: id, values });
  return { id, ...out };
}

const read = async (ws: TestWorkspace, object: string, id: string, attr: AttributeDefinition, activeAt?: string) =>
  (
    await domain.records.get(ws.ctx, {
      entityDefinitionId: object,
      entityInstanceId: id,
      ...(activeAt ? { activeAt } : {}),
    })
  ).values[attr.id] ?? [];

describe('attribute types: write, read, clear', () => {
  it('handles all 17 internal types', async () => {
    const ws = await createWorkspace();
    const project = await customObject(ws);
    const company = await newRecord(ws, 'companies', { name: [{ value: 'Acme' }] });
    const companies = await domain.schema.getObject(ws.ctx, 'companies');

    const cases: { type: AttributeType; extra?: Partial<CreateAttributeInput>; write: (a: AttributeDefinition) => Promise<unknown>; expected: (a: AttributeDefinition) => Promise<unknown>; system?: boolean }[] = [
      { type: 'text', write: async () => 'Hello world', expected: async () => 'Hello world' },
      { type: 'number', write: async () => 42.5, expected: async () => 42.5 },
      { type: 'checkbox', write: async () => true, expected: async () => true },
      {
        type: 'currency',
        extra: { currencyConfiguration: { defaultCurrencyCode: 'EUR', defaultDisplayType: 'symbol', defaultDecimalPlaces: 'two-decimals', defaultGroups: 'default' } },
        write: async () => ({ currencyValue: 1250.5, currencyCode: 'eur' }),
        expected: async () => ({ currencyValue: 1250.5, currencyCode: 'EUR' }),
      },
      { type: 'date', write: async () => '2026-01-15', expected: async () => '2026-01-15' },
      { type: 'timestamp', write: async () => '2026-01-15T12:20:30.123456+02:00', expected: async () => '2026-01-15T10:20:30.123456Z' },
      { type: 'rating', write: async () => 4, expected: async () => 4 },
      {
        type: 'pipeline',
        extra: { stages: [{ title: 'Open' }, { title: 'Done', lifecyclePhase: 'WON' }] },
        write: async (a) => ({ pipelineStageId: (await stages(ws, project.id, a.id))[1] }),
        expected: async (a) => ({ pipelineStageId: (await stages(ws, project.id, a.id))[1] }),
      },
      {
        type: 'select',
        extra: { options: [{ title: 'Red' }, { title: 'Blue' }] },
        write: async (a) => ({ selectOptionId: (await options(ws, project.id, a.id))[0] }),
        expected: async (a) => ({ selectOptionId: (await options(ws, project.id, a.id))[0] }),
      },
      {
        type: 'entity-reference',
        extra: { entityReferenceConfiguration: { allowedEntityDefinitionIds: [companies.id] } },
        write: async () => ({ entityInstanceId: company.id }),
        expected: async () => ({ entityDefinitionId: companies.id, entityInstanceId: company.id }),
      },
      {
        type: 'actor-reference',
        write: async () => ({ referencedActorType: 'workspace-member', referencedActorId: ws.memberId }),
        expected: async () => ({ referencedActorType: 'workspace-member', referencedActorId: ws.memberId }),
      },
      {
        type: 'location',
        write: async () => ({ locality: 'Berlin', countryCode: 'de', postcode: '10115' }),
        expected: async () => ({
          line1: null, line2: null, line3: null, line4: null, locality: 'Berlin', region: null, postcode: '10115',
          countryCode: 'DE', latitude: null, longitude: null,
        }),
      },
      {
        type: 'domain',
        extra: { isMultiselect: true },
        write: async () => 'https://www.Example.co.uk/about',
        expected: async () => ({ normalizedDomain: 'example.co.uk', rootDomain: 'example.co.uk' }),
      },
      {
        type: 'email-address',
        extra: { isMultiselect: true },
        write: async () => 'Ada+crm@Example.COM',
        expected: async () => ({
          originalEmailAddress: 'Ada+crm@Example.COM',
          normalizedEmailAddress: 'ada+crm@example.com',
          emailDomain: 'example.com',
          emailRootDomain: 'example.com',
          emailLocalSpecifier: 'crm',
        }),
      },
      {
        type: 'phone-number',
        write: async () => ({ originalPhoneNumber: '020 7946 0958', countryCode: 'GB' }),
        expected: async () => ({ originalPhoneNumber: '020 7946 0958', countryCode: 'GB', normalizedPhoneNumber: '+442079460958' }),
      },
      {
        type: 'interaction',
        system: true,
        write: async () => ({ interactionType: 'email', interactedAt: '2026-02-01T09:00:00Z', ownerMembershipId: ws.memberId }),
        expected: async () => ({
          interactionHeaderId: null,
          interactionType: 'email',
          interactedAt: '2026-02-01T09:00:00.000000Z',
          ownerMembershipId: ws.memberId,
          mailboxId: null,
        }),
      },
      {
        type: 'personal-name',
        write: async () => ({ firstName: 'Ada', lastName: 'Lovelace' }),
        expected: async () => ({ firstName: 'Ada', lastName: 'Lovelace', fullName: 'Ada Lovelace' }),
      },
    ]; // biome-ignore format: table

    const record = await newRecord(ws, project.id);
    for (const c of cases) {
      const attr = await attribute(ws, project.id, { title: `My ${c.type}`, type: c.type, ...c.extra });
      expect(attr.isHistoric).toBe(c.type === 'pipeline' || c.type === 'currency');
      const ctx = c.system ? ws.sys : ws.ctx;
      const value = await c.write(attr);
      await domain.records.update(ctx, {
        entityDefinitionId: project.id,
        entityInstanceId: record.id,
        values: { [attr.apiSlug]: [{ value }] },
      });
      const current = await read(ws, project.id, record.id, attr);
      expect(current, c.type).toHaveLength(1);
      expect(current[0]?.value, c.type).toEqual(await c.expected(attr));
      expect(current[0]?.attributeType).toBe(c.type);
      // Writing the same value again keeps the row (no history noise).
      await domain.records.update(ctx, {
        entityDefinitionId: project.id,
        entityInstanceId: record.id,
        values: { [attr.id]: [{ value }] },
      });
      expect((await read(ws, project.id, record.id, attr))[0]?.id).toBe(current[0]?.id);
      // Clear = retire.
      await domain.records.update(ctx, {
        entityDefinitionId: project.id,
        entityInstanceId: record.id,
        values: { [attr.id]: [] },
      });
      expect(await read(ws, project.id, record.id, attr), c.type).toEqual([]);
      const history = await domain.values.history(ws.ctx, {
        entityDefinitionId: project.id,
        entityInstanceId: record.id,
        attributeDefinitionId: attr.id,
      });
      expect(history.values, c.type).toHaveLength(1);
      expect(history.values[0]?.activeUntil).not.toBeNull();
    }
    const report = await domain.schema.verifyProjection(ws.ctx, project.id);
    expect(report).toMatchObject({ rows: 1, mismatchedRows: 0 });
  });

  it('validates values per type', async () => {
    const ws = await createWorkspace();
    const project = await customObject(ws);
    const people = await domain.schema.getObject(ws.ctx, 'people');
    const companies = await domain.schema.getObject(ws.ctx, 'companies');
    const person = await newRecord(ws, 'people');
    const record = await newRecord(ws, project.id);
    const attrs = {
      number: await attribute(ws, project.id, { title: 'Budget', type: 'number' }),
      rating: await attribute(ws, project.id, { title: 'Score', type: 'rating' }),
      select: await attribute(ws, project.id, { title: 'Color', type: 'select', options: [{ title: 'Red' }] }),
      ref: await attribute(ws, project.id, {
        title: 'Account',
        type: 'entity-reference',
        entityReferenceConfiguration: { allowedEntityDefinitionIds: [companies.id] },
      }),
      phone: await attribute(ws, project.id, { title: 'Phone', type: 'phone-number' }),
      date: await attribute(ws, project.id, { title: 'Due', type: 'date' }),
      text: await attribute(ws, project.id, { title: 'Code', type: 'text' }),
      interaction: await attribute(ws, project.id, { title: 'Touch', type: 'interaction' }),
    };
    const write = (attr: AttributeDefinition, values: unknown[]) =>
      domain.records.update(ws.ctx, {
        entityDefinitionId: project.id,
        entityInstanceId: record.id,
        values: { [attr.id]: values.map((value) => ({ value })) },
      });
    const reason = async (p: Promise<unknown>, expected: string) => {
      const err = await expectCode(p, 'VALUE_VALIDATION_FAILED', 400);
      expect(err.details.reason).toBe(expected);
    };
    await reason(write(attrs.number, ['12']), 'invalid');
    await reason(write(attrs.rating, [7]), 'invalid');
    await reason(write(attrs.select, [{ selectOptionId: newId() }]), 'unknown-option');
    await reason(write(attrs.ref, [{ entityInstanceId: person.id }]), 'record-type-not-allowed');
    await reason(write(attrs.ref, [{ entityInstanceId: newId() }]), 'unknown-record');
    await reason(
      write(attrs.ref, [{ entityDefinitionId: people.id, entityInstanceId: person.id }]),
      'record-type-not-allowed',
    );
    await reason(write(attrs.phone, ['020 7946 0958']), 'MISSING_COUNTRY_CODE');
    await reason(write(attrs.date, ['2026-02-30']), 'invalid');
    await reason(write(attrs.text, ['a', 'b']), 'single-value');
    await expectCode(
      write(attrs.interaction, [{ interactionType: 'email', interactedAt: '2026-01-01T00:00:00Z' }]),
      'ATTRIBUTE_READ_ONLY',
      400,
    );
    const createdAt = (await domain.schema.listAttributes(ws.ctx, { entityDefinitionId: project.id })).find(
      (a) => a.apiSlug === 'created_at',
    );
    await expectCode(write(createdAt as AttributeDefinition, ['2020-01-01T00:00:00Z']), 'ATTRIBUTE_READ_ONLY', 400);
    // Archived attributes reject writes.
    await domain.schema.updateAttribute(ws.ctx, {
      entityDefinitionId: project.id,
      attributeDefinitionId: attrs.text.id,
      isArchived: true,
    });
    await expectCode(write(attrs.text, ['x']), 'ATTRIBUTE_ARCHIVED', 400);
  });

  it('enforces required attributes and applies defaults', async () => {
    const ws = await createWorkspace();
    const project = await customObject(ws);
    const name = await attribute(ws, project.id, { title: 'Name', type: 'text', isRequired: true });
    const done = await attribute(ws, project.id, {
      title: 'Done',
      type: 'checkbox',
      defaultValue: { type: 'static', identifier: '[false]' },
    });
    await expectCode(newRecord(ws, project.id), 'VALUE_VALIDATION_FAILED', 400);
    const r = await newRecord(ws, project.id, { name: [{ value: 'Apollo' }] });
    expect(r.values[done.id]?.[0]?.value).toBe(false);
    const createdBy = (await domain.schema.listAttributes(ws.ctx, { entityDefinitionId: project.id })).find(
      (a) => a.apiSlug === 'created_by',
    );
    expect(r.values[createdBy?.id ?? '']?.[0]?.value).toEqual({
      referencedActorType: 'workspace-member',
      referencedActorId: ws.memberId,
    });
    expect(r.record.createdBy).toEqual({ type: 'workspace-member', id: ws.memberId });
    await expectCode(
      domain.records.update(ws.ctx, {
        entityDefinitionId: project.id,
        entityInstanceId: r.id,
        values: { [name.id]: [] },
      }),
      'VALUE_VALIDATION_FAILED',
      400,
    );
  });
});

async function options(ws: TestWorkspace, objectId: string, attrId: string) {
  return (await domain.schema.listOptions(ws.ctx, { entityDefinitionId: objectId, attributeDefinitionId: attrId })).map(
    (o) => o.id,
  );
}
async function stages(ws: TestWorkspace, objectId: string, attrId: string) {
  return (await domain.schema.listStages(ws.ctx, { entityDefinitionId: objectId, attributeDefinitionId: attrId })).map(
    (o) => o.id,
  );
}

describe('history, point-in-time and value operations', () => {
  it('keeps every version (I6) and reads values active at an instant', async () => {
    const ws = await createWorkspace();
    const project = await customObject(ws);
    const status = await attribute(ws, project.id, { title: 'Status', type: 'text' });
    const r = await newRecord(ws, project.id, { status: [{ value: 'draft' }] });
    const v1 = r.values[status.id]?.[0];
    await domain.records.update(ws.ctx, {
      entityDefinitionId: project.id,
      entityInstanceId: r.id,
      values: { status: [{ value: 'live' }] },
    });
    await domain.records.update(ws.ctx, {
      entityDefinitionId: project.id,
      entityInstanceId: r.id,
      values: { status: [{ value: 'done' }] },
    });

    const history = await domain.values.history(ws.ctx, {
      entityDefinitionId: project.id,
      entityInstanceId: r.id,
      attributeDefinitionId: 'status',
    });
    expect(history.values.map((v) => v.value)).toEqual(['done', 'live', 'draft']);
    expect(history.values[0]?.activeUntil).toBeNull();
    expect(history.values[1]?.activeUntil).toBe(history.values[0]?.activeFrom);
    expect(history.values[2]?.activeUntil).toBe(history.values[1]?.activeFrom);
    expect(history.values[2]?.deactivatedBy).toEqual({ type: 'workspace-member', id: ws.memberId });

    expect((await read(ws, project.id, r.id, status, v1?.activeFrom))[0]?.value).toBe('draft');
    expect((await read(ws, project.id, r.id, status, history.values[1]?.activeFrom))[0]?.value).toBe('live');
    expect((await read(ws, project.id, r.id, status))[0]?.value).toBe('done');
    expect(await read(ws, project.id, r.id, status, '2000-01-01T00:00:00Z')).toEqual([]);

    const paged = await domain.values.history(ws.ctx, {
      entityDefinitionId: project.id,
      entityInstanceId: r.id,
      attributeDefinitionId: 'status',
      before: history.values[0]?.activeFrom,
      limit: 1,
    });
    expect(paged.values.map((v) => v.value)).toEqual(['live']);

    const batch = await domain.values.list(ws.ctx, {
      entityDefinitionId: project.id,
      attributeDefinitionId: status.id,
      entityInstanceIds: [r.id, newId()],
      activeAt: v1?.activeFrom,
    });
    const entries = Object.values(batch.values);
    expect(entries.filter((e) => e.state === 'error')).toEqual([{ state: 'error', error: 'NOT_FOUND' }]);
    expect(batch.values[r.id]).toMatchObject({ state: 'complete', value: { values: [{ value: 'draft' }] } });
  });

  it('puts, retires and reorders values with idempotent value ids', async () => {
    const ws = await createWorkspace();
    const project = await customObject(ws);
    const labels = await attribute(ws, project.id, {
      title: 'Labels',
      type: 'select',
      isMultiselect: true,
      options: [{ title: 'A' }, { title: 'B' }, { title: 'C' }],
    });
    const [a, b, c] = await options(ws, project.id, labels.id);
    const r = await newRecord(ws, project.id);
    const ref = { entityDefinitionId: project.id, entityInstanceId: r.id, attributeDefinitionId: labels.id };
    const va = newId();
    await domain.values.put(ws.ctx, { ...ref, attributeValueId: va, value: { selectOptionId: a } });
    const afterB = await domain.values.put(ws.ctx, { ...ref, attributeValueId: newId(), value: { selectOptionId: b } });
    expect(afterB.values.map((v) => (v.value as { selectOptionId: string }).selectOptionId)).toEqual([a, b]);
    // Replay of the same value id: nothing new.
    const replay = await domain.values.put(ws.ctx, { ...ref, attributeValueId: va, value: { selectOptionId: c } });
    expect(replay.values).toHaveLength(2);
    await expectCode(
      domain.values.put(ws.ctx, { ...ref, attributeValueId: newId(), value: { selectOptionId: a } }),
      'DUPLICATE_VALUE_IN_MULTISELECT',
      409,
    );
    await expectCode(
      domain.records.update(ws.ctx, {
        ...ref,
        values: { [labels.id]: [{ value: { selectOptionId: c } }, { value: { selectOptionId: c } }] },
      }),
      'DUPLICATE_VALUE_IN_MULTISELECT',
      409,
    );
    // Reorder B before A: rank only, no new history.
    const bRow = afterB.values[1];
    const reordered = await domain.values.reorder(ws.ctx, {
      ...ref,
      attributeValueId: bRow?.id ?? '',
      sortOrder: '0i',
    });
    expect(reordered.values.map((v) => v.id)).toEqual([bRow?.id, va]);
    // Retire A (idempotent).
    const retired = await domain.values.retire(ws.ctx, { ...ref, attributeValueId: va });
    expect(retired.values.map((v) => v.id)).toEqual([bRow?.id]);
    await domain.values.retire(ws.ctx, { ...ref, attributeValueId: va });
    const history = await domain.values.history(ws.ctx, ref);
    expect(history.values).toHaveLength(2);
    // Append mode adds without removing.
    const appended = await domain.records.update(ws.ctx, {
      ...ref,
      values: { [labels.id]: [{ value: { selectOptionId: c } }, { value: { selectOptionId: b } }] },
      multiselectMode: 'append',
    });
    expect(appended.values[labels.id]?.map((v) => (v.value as { selectOptionId: string }).selectOptionId)).toEqual([
      b,
      c,
    ]);
  });

  it('creates idempotently by client id (A I-7)', async () => {
    const ws = await createWorkspace();
    const project = await customObject(ws);
    await attribute(ws, project.id, { title: 'Title', type: 'text' });
    const id = newId();
    const first = await domain.records.create(ws.ctx, {
      entityDefinitionId: project.id,
      entityInstanceId: id,
      values: { title: [{ value: 'One' }] },
    });
    const replay = await domain.records.create(ws.ctx, {
      entityDefinitionId: project.id,
      entityInstanceId: id,
      values: { title: [{ value: 'Two' }] },
    });
    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.values).toEqual(first.values);
    expect(replay.record.version).toBe(first.record.version);
    await expectCode(
      domain.records.create(ws.ctx, { entityDefinitionId: 'people', entityInstanceId: id }),
      'INSTANCE_ID_CONFLICT',
      409,
    );
  });
});

describe('uniqueness', () => {
  it('answers 409 UNIQUE_CONSTRAINT_VIOLATION with the Attio envelope', async () => {
    const ws = await createWorkspace();
    const a = await newRecord(ws, 'people', { email_addresses: [{ value: 'dup@example.com' }] });
    const err = await expectCode(
      newRecord(ws, 'people', { email_addresses: [{ value: 'DUP@example.com' }] }),
      'UNIQUE_CONSTRAINT_VIOLATION',
      409,
    );
    const envelope = toErrorEnvelope(err);
    expect(envelope).toMatchObject({
      statusCode: 409,
      error: 'Conflict',
      status_code: 409,
      additional_information: { code: 'UNIQUE_CONSTRAINT_VIOLATION', entity_instance_ids: [a.id] },
    });
    expect(typeof envelope.message).toBe('string');

    // Custom unique text; switching uniqueness on fails while duplicates exist.
    const project = await customObject(ws);
    const code = await attribute(ws, project.id, { title: 'Code', type: 'text' });
    await newRecord(ws, project.id, { code: [{ value: 'P-1' }] });
    await newRecord(ws, project.id, { code: [{ value: 'P-1' }] });
    await expectCode(
      domain.schema.updateAttribute(ws.ctx, {
        entityDefinitionId: project.id,
        attributeDefinitionId: code.id,
        isUnique: true,
      }),
      'UNIQUE_CONSTRAINT_VIOLATION',
      409,
    );
    const sku = await attribute(ws, project.id, { title: 'SKU', type: 'text', isUnique: true });
    const p1 = await newRecord(ws, project.id, { sku: [{ value: 'X' }] });
    await expectCode(newRecord(ws, project.id, { sku: [{ value: 'X' }] }), 'UNIQUE_CONSTRAINT_VIOLATION', 409);
    // Deleting releases the value; restoring re-claims it (409 when taken meanwhile).
    await domain.records.delete(ws.ctx, { entityDefinitionId: project.id, entityInstanceId: p1.id });
    const p2 = await newRecord(ws, project.id, { sku: [{ value: 'X' }] });
    expect(p2.values[sku.id]?.[0]?.value).toBe('X');
    await expectCode(
      domain.records.restore(ws.ctx, { entityDefinitionId: project.id, entityInstanceId: p1.id }),
      'UNIQUE_CONSTRAINT_VIOLATION',
      409,
    );
  });
});

describe('relationships, delete, restore and merge', () => {
  it('mirrors relationship pairs, including displacement of single-valued sides', async () => {
    const ws = await createWorkspace();
    const people = await domain.schema.listAttributes(ws.ctx, { entityDefinitionId: 'people' });
    const companies = await domain.schema.listAttributes(ws.ctx, { entityDefinitionId: 'companies' });
    const companyAttr = people.find((a) => a.apiSlug === 'company') as AttributeDefinition;
    const teamAttr = companies.find((a) => a.apiSlug === 'team') as AttributeDefinition;
    const c1 = await newRecord(ws, 'companies', { name: [{ value: 'One' }] });
    const c2 = await newRecord(ws, 'companies', { name: [{ value: 'Two' }] });
    const p = await newRecord(ws, 'people', { company: [{ value: { entityInstanceId: c1.id } }] });
    const team = async (id: string) =>
      (await read(ws, 'companies', id, teamAttr)).map(
        (v) => (v.value as { entityInstanceId: string }).entityInstanceId,
      );
    const companyOf = async (id: string) =>
      (await read(ws, 'people', id, companyAttr)).map(
        (v) => (v.value as { entityInstanceId: string }).entityInstanceId,
      );
    expect(await team(c1.id)).toEqual([p.id]);

    await domain.records.update(ws.ctx, {
      entityDefinitionId: 'people',
      entityInstanceId: p.id,
      values: { company: [{ value: { entityInstanceId: c2.id } }] },
    });
    expect(await team(c1.id)).toEqual([]);
    expect(await team(c2.id)).toEqual([p.id]);

    // Adding p to c1's team moves them (people.company is single-valued): c2 loses p.
    const p2 = await newRecord(ws, 'people');
    await domain.records.update(ws.ctx, {
      entityDefinitionId: 'companies',
      entityInstanceId: c1.id,
      values: { team: [{ value: { entityInstanceId: p.id } }, { value: { entityInstanceId: p2.id } }] },
    });
    expect(await companyOf(p.id)).toEqual([c1.id]);
    expect(await companyOf(p2.id)).toEqual([c1.id]);
    expect(await team(c2.id)).toEqual([]);
    expect((await team(c1.id)).sort()).toEqual([p.id, p2.id].sort());

    // Deleting the company retires the references to it; restore re-creates the inverse side.
    await domain.records.delete(ws.ctx, { entityDefinitionId: 'companies', entityInstanceId: c1.id });
    expect(await companyOf(p.id)).toEqual([]);
    const batch = await domain.records.batchGet(ws.ctx, {
      entityDefinitionId: 'companies',
      entityInstanceIds: [c1.id, c2.id],
    });
    expect(batch.records[c1.id]).toEqual({ state: 'error', error: 'NOT_FOUND' });
    expect(batch.records[c2.id]?.state).toBe('complete');
    await expectCode(
      domain.records.get(ws.ctx, { entityDefinitionId: 'companies', entityInstanceId: c1.id }),
      'NOT_FOUND',
      404,
    );
    // Idempotent delete.
    const again = await domain.records.delete(ws.ctx, { entityDefinitionId: 'companies', entityInstanceId: c1.id });
    expect(again.archivedAt).not.toBeNull();
    await domain.records.restore(ws.ctx, { entityDefinitionId: 'companies', entityInstanceId: c1.id });
    // The restored company kept its own relationship values; restore re-creates their inverse side.
    expect((await team(c1.id)).sort()).toEqual([p.id, p2.id].sort());
    expect(await companyOf(p.id)).toEqual([c1.id]);
    expect(await domain.schema.verifyProjection(ws.ctx, 'companies')).toMatchObject({ mismatchedRows: 0 });
    expect(await domain.schema.verifyProjection(ws.ctx, 'people')).toMatchObject({ mismatchedRows: 0 });
  });

  it('merges two people into a new record (D §3.10)', async () => {
    const ws = await createWorkspace();
    const acme = await newRecord(ws, 'companies', { name: [{ value: 'Acme' }] });
    const base = await newRecord(ws, 'people', {
      name: [{ value: { firstName: 'Merge', lastName: 'Alpha' } }],
      email_addresses: [{ value: 'alpha@example.com' }],
      company: [{ value: { entityInstanceId: acme.id } }],
    });
    const target = await newRecord(ws, 'people', {
      name: [{ value: { firstName: 'Merge', lastName: 'Beta' } }],
      email_addresses: [{ value: 'beta@example.com' }],
      job_title: [{ value: 'Engineer' }],
    });
    const merged = await domain.records.merge(ws.ctx, {
      entityDefinitionId: 'people',
      baseEntityInstanceId: base.id,
      targetEntityInstanceId: target.id,
    });
    const attrs = new Map(
      (await domain.schema.listAttributes(ws.ctx, { entityDefinitionId: 'people' })).map((a) => [a.apiSlug, a.id]),
    );
    const v = (slug: string) => merged.values[attrs.get(slug) ?? '']?.map((x) => x.value);
    expect(v('name')).toEqual([{ firstName: 'Merge', lastName: 'Beta', fullName: 'Merge Beta' }]);
    expect(v('email_addresses')?.map((e) => (e as { normalizedEmailAddress: string }).normalizedEmailAddress)).toEqual([
      'beta@example.com',
      'alpha@example.com',
    ]);
    expect(v('job_title')).toEqual(['Engineer']);
    expect(v('company')).toEqual([{ entityDefinitionId: acme.record.entityDefinitionId, entityInstanceId: acme.id }]);
    const team = await domain.records.get(ws.ctx, { entityDefinitionId: 'companies', entityInstanceId: acme.id });
    const teamAttr = (await domain.schema.listAttributes(ws.ctx, { entityDefinitionId: 'companies' })).find(
      (a) => a.apiSlug === 'team',
    );
    expect(
      team.values[teamAttr?.id ?? '']?.map((x) => (x.value as { entityInstanceId: string }).entityInstanceId),
    ).toEqual([merged.record.entityInstanceId]);
    const sources = await domain.records.batchGet(ws.ctx, {
      entityDefinitionId: 'people',
      entityInstanceIds: [base.id, target.id],
    });
    expect(Object.values(sources.records).every((r) => r.state === 'error')).toBe(true);
    await expectCode(
      domain.records.merge(ws.ctx, {
        entityDefinitionId: 'people',
        baseEntityInstanceId: base.id,
        targetEntityInstanceId: base.id,
      }),
      'SELF_MERGE',
      400,
    );
    const project = await customObject(ws);
    const x = await newRecord(ws, project.id);
    const y = await newRecord(ws, project.id);
    await expectCode(
      domain.records.merge(ws.ctx, {
        entityDefinitionId: project.id,
        baseEntityInstanceId: x.id,
        targetEntityInstanceId: y.id,
      }),
      'MERGING_NOT_SUPPORTED_FOR_ENTITY_TYPE',
      400,
    );
  });
});
