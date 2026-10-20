// CSV import end to end in the domain (BACKLOG 4.07, acceptance 4): upload, auto-mapping, review values with
// formats and overrides, missing options, plan (create vs update, matching, invalid rows), run through the worker
// entry point (idempotent, resumable), cancel mid-run, list imports, history.
import { describe, expect, it } from 'vitest';
import { createWorkspace, database, expectCode, newId, type TestWorkspace } from './support/harness.ts';
import { dt, jobs, listFixture, projectsFixture, propertyFor, startImport } from './support/imports.ts';

const valuesOf = async (ws: TestWorkspace, object: string, id: string) =>
  (await dt.records.get(ws.ctx, { entityDefinitionId: object, entityInstanceId: id })).values;

async function recordByCode(ws: TestWorkspace, object: string, codeAttr: string, code: string) {
  const found = await dt.records.findByUniqueValues(ws.ctx, {
    entityDefinitionId: object,
    attributeDefinitionId: codeAttr,
    values: [{ value: code }],
  });
  return found.entityInstanceIds[0] as string;
}

async function allIds(ws: TestWorkspace, object: string) {
  return (await dt.views.query(ws.ctx, { entityDefinitionId: object })).ids;
}

describe('object import: mapping, review, plan, run', () => {
  it('imports the seed projects file like the live run (formats, overrides, missing options, matching)', async () => {
    const ws = await createWorkspace();
    const { object, a } = await projectsFixture(ws);
    const existing = newId();
    await dt.records.create(ws.ctx, {
      entityDefinitionId: object.id,
      entityInstanceId: existing,
      values: {
        [a.name.id]: [{ value: 'Existing' }],
        [a.code.id]: [{ value: 'SEED-012' }],
        [a.headcount.id]: [{ value: 3 }],
        [a.tags.id]: [
          {
            value: {
              selectOptionId: (
                await dt.schema.listOptions(ws.ctx, { entityDefinitionId: object.id, attributeDefinitionId: a.tags.id })
              )[0]?.id,
            },
          },
        ],
      },
    });
    const headers = [
      'Name',
      'Code',
      'Budget',
      'Headcount',
      'Active',
      'Score',
      'Start',
      'Status',
      'Tags',
      'Owner',
      'Office',
      'Ignored',
    ];
    const rows = [
      [
        'Existing renamed',
        'SEED-012',
        '12500,50',
        '4',
        '1',
        '3',
        '14/07/2026',
        'active',
        'Beta',
        ws.user.emailAddress,
        'London, United Kingdom',
        'x',
      ],
      [
        'New one',
        'SEED-100',
        '100',
        'abc',
        'no',
        '9',
        '01/02/2026',
        'Unknown stage',
        'Alpha, Imported',
        'Nobody',
        'Germany',
        'y',
      ],
      ['', 'SEED-101', '7', '1', 'false', '0', '', '', '', '', '', ''],
    ];
    const created = await startImport(ws.ctx, object.id, headers, rows, { fileName: 'seed-projects-import.csv' });
    expect(created.job.status).toBe('uploading');

    // Auto-mapping by exact title; "Ignored" stays unmapped.
    let status = await dt.imports.status(ws.ctx, { jobId: created.jobId });
    expect(status.job.status).toBe('draft');
    expect(status.job.uploadedRowCount).toBe(3);
    expect(status.properties.map((p) => p.columnIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(status.columns[11]).toMatchObject({ header: 'Ignored', propertyId: null, exampleValues: ['x', 'y'] });
    // Format detection: "14/07/2026" → European dates; "12500,50" stays on Point.
    const start = status.properties.find((p) => p.columnIndex === 6);
    expect(start?.dateFormat).toBe('uk');
    expect(status.properties.find((p) => p.columnIndex === 2)?.decimalSeparator).toBe('point');
    expect(status.validation.blocking).toEqual([]);
    expect(status.strategies).toHaveLength(1);
    expect(status.strategies[0]).toMatchObject({ mode: 'create-or-update', matchingAttributeDefinitionId: a.code.id });

    // Decimal separator per property: Point reads 12500,50 as 1 250 050 (as observed), Comma as 12 500,50.
    const budget = propertyFor(status, 2);
    await dt.imports.setMapping(ws.ctx, {
      jobId: created.jobId,
      columns: [
        {
          columnIndex: 2,
          target: { type: 'attribute', path: status.properties[2]?.path as never, decimalSeparator: 'point' },
        },
      ],
    });
    let review = await dt.imports.reviewValues(ws.ctx, { jobId: created.jobId, propertyId: budget });
    expect(review.values.find((v) => v.rawValue === '12500,50')?.values).toEqual([
      { currencyValue: 1250050, currencyCode: 'EUR' },
    ]);
    await dt.imports.setMapping(ws.ctx, {
      jobId: created.jobId,
      columns: [
        {
          columnIndex: 2,
          target: { type: 'attribute', path: status.properties[2]?.path as never, decimalSeparator: 'comma' },
        },
      ],
    });
    review = await dt.imports.reviewValues(ws.ctx, { jobId: created.jobId, propertyId: budget });
    expect(propertyFor(await dt.imports.status(ws.ctx, { jobId: created.jobId }), 2)).toBe(budget); // same property, same overrides
    expect(review.values.find((v) => v.rawValue === '12500,50')?.values).toEqual([
      { currencyValue: 12500.5, currencyCode: 'EUR' },
    ]);

    // Invalid values need review; a fix applies to every row with that raw value.
    const headcount = propertyFor(status, 3);
    review = await dt.imports.reviewValues(ws.ctx, {
      jobId: created.jobId,
      propertyId: headcount,
      group: 'needs-review',
    });
    expect(review.needsReviewCount).toBe(1);
    expect(review.values).toEqual([
      expect.objectContaining({ rawValue: 'abc', status: 'invalid', errors: ['Invalid number'], rowCount: 1 }),
    ]);
    const fixed = await dt.imports.setOverride(ws.ctx, {
      jobId: created.jobId,
      propertyId: headcount,
      rawValue: 'abc',
      override: { type: 'values', values: [7] },
    });
    expect(fixed).toMatchObject({ status: 'overridden', needsReview: false, values: [7], override: { values: [7] } });
    await expectCode(
      dt.imports.setOverride(ws.ctx, {
        jobId: created.jobId,
        propertyId: headcount,
        rawValue: 'abc',
        override: { type: 'values', values: ['seven'] },
      }),
      'VALUE_VALIDATION_FAILED',
    );
    // Skip, then revert, an invalid checkbox; the rating 9 stays invalid (skipped on import).
    const active = propertyFor(status, 4);
    expect(
      (
        await dt.imports.setOverride(ws.ctx, {
          jobId: created.jobId,
          propertyId: active,
          rawValue: 'no',
          override: { type: 'skip' },
        })
      ).values,
    ).toEqual([]);
    expect(
      (
        await dt.imports.setOverride(ws.ctx, {
          jobId: created.jobId,
          propertyId: active,
          rawValue: 'no',
          override: null,
        })
      ).status,
    ).toBe('invalid');
    await dt.imports.setOverride(ws.ctx, {
      jobId: created.jobId,
      propertyId: active,
      rawValue: 'no',
      override: { type: 'values', values: [false] },
    });

    // Missing select options and statuses can be created.
    const tags = propertyFor(status, 8);
    review = await dt.imports.reviewValues(ws.ctx, { jobId: created.jobId, propertyId: tags });
    expect(review.missingOptions).toEqual(['Imported']);
    expect(review.values.find((v) => v.rawValue === 'Alpha, Imported')).toMatchObject({
      status: 'missing-options',
      values: [expect.any(Object)],
      missingOptions: ['Imported'],
    });
    const summary = await dt.imports.reviewSummary(ws.ctx, { jobId: created.jobId });
    expect(summary.properties.find((p) => p.propertyId === tags)).toMatchObject({
      missingOptionCount: 1,
      needsReviewCount: 1,
    });
    const options = await dt.imports.createOptions(ws.ctx, { jobId: created.jobId, propertyId: tags });
    expect(options.created.map((o) => o.title)).toEqual(['Imported']);
    const statusProp = propertyFor(status, 7);
    expect(
      (await dt.imports.reviewValues(ws.ctx, { jobId: created.jobId, propertyId: statusProp })).missingOptions,
    ).toEqual(['Unknown stage']);
    // Actor matching by email; unknown names are invalid.
    const owner = propertyFor(status, 9);
    review = await dt.imports.reviewValues(ws.ctx, {
      jobId: created.jobId,
      propertyId: owner,
      sort: { field: 'row-count', direction: 'desc' },
    });
    expect(review.values.find((v) => v.rawValue === ws.user.emailAddress)?.values).toEqual([
      { referencedActorType: 'workspace-member', referencedActorId: ws.memberId },
    ]);
    expect(review.values.find((v) => v.rawValue === 'Nobody')?.errors).toEqual(['Invalid actor']);

    // Plan: SEED-012 matched by the unique Code → update; SEED-100 → create; the row without the required Name
    // cannot be created → listed as invalid before the run.
    const plan = await dt.imports.preview(ws.ctx, { jobId: created.jobId });
    expect(plan.totals).toEqual({ create: 1, update: 1, skip: 0, fail: 1 });
    expect(plan.invalidRows).toEqual([
      expect.objectContaining({
        rowIndex: 2,
        plannedOutcome: 'fail',
        failureReason: 'required-value-not-provided',
        failureMessage: 'A required value was not provided',
      }),
    ]);
    const page = await dt.imports.assertions(ws.ctx, { jobId: created.jobId, strategyIndex: 0 });
    expect(page.total).toBe(3);
    expect(page.rows[0]).toMatchObject({ plannedOutcome: 'update', matchedEntityInstanceIds: [existing] });
    expect(page.rows[1]?.values[a.headcount.id]).toEqual([7]);

    // Start import: confirmed + job enqueued in the same transaction; a second run does not enqueue again.
    jobs.take();
    status = await dt.imports.run(ws.ctx, { jobId: created.jobId });
    expect(status.job).toMatchObject({
      status: 'confirmed',
      confirmedBy: { type: 'workspace-member', id: ws.memberId },
    });
    await dt.imports.run(ws.ctx, { jobId: created.jobId });
    expect(jobs.take('import.run')).toEqual([
      {
        name: 'import.run',
        data: { workspaceId: ws.workspaceId, jobId: created.jobId },
        options: { singletonKey: created.jobId },
      },
    ]);
    await expectCode(
      dt.imports.setMapping(ws.ctx, {
        jobId: created.jobId,
        columns: [{ columnIndex: 11, target: { type: 'ignore' } }],
      }),
      'IMPORT_STATE_CONFLICT',
    );

    const result = await dt.imports.execute(ws.workspaceId, created.jobId);
    expect(result).toMatchObject({ status: 'completed', processedRows: 3 });
    status = await dt.imports.status(ws.ctx, { jobId: created.jobId });
    expect(status.job).toMatchObject({ status: 'completed', progress: { done: 3, total: 3 } });
    expect(status.strategies[0]?.statuses).toMatchObject({ created: 1, updated: 1, failed: 1, planned: 0 });

    // Realtime: the batches wrote change_log invalidations for the job and for the records' values (as the import).
    const { rows: changes } = await database.pool.query<{ resource: string; actor: { type: string; id: string } }>(
      `SELECT resource, actor FROM change_log WHERE workspace_id = $1 AND resource IN ('import-job', 'attribute-value-list')`,
      [ws.workspaceId],
    );
    expect(changes.some((c) => c.resource === 'import-job')).toBe(true);
    expect(
      changes.some(
        (c) => c.resource === 'attribute-value-list' && c.actor.type === 'import' && c.actor.id === created.jobId,
      ),
    ).toBe(true);

    // Updated record: single values replaced, multi-select appended.
    const updated = await valuesOf(ws, object.id, existing);
    expect(updated[a.name.id]?.[0]?.value).toBe('Existing renamed');
    expect(updated[a.budget.id]?.[0]?.value).toEqual({ currencyValue: 12500.5, currencyCode: 'EUR' });
    expect(updated[a.headcount.id]?.[0]?.value).toBe(4);
    expect(updated[a.start.id]?.[0]?.value).toBe('2026-07-14');
    expect(updated[a.tags.id]?.map((v) => v.value)).toHaveLength(2);
    expect(updated[a.owner.id]?.[0]?.value).toEqual({
      referencedActorType: 'workspace-member',
      referencedActorId: ws.memberId,
    });
    expect(updated[a.office.id]?.[0]?.value).toMatchObject({ locality: 'London', countryCode: 'GB' });
    expect(updated[a.status.id]?.[0]?.createdBy).toEqual({ type: 'import', id: created.jobId });

    // Created record: overrides applied, invalid values skipped, known options imported, created option used.
    const createdId = await recordByCode(ws, object.id, a.code.id, 'SEED-100');
    const fresh = await valuesOf(ws, object.id, createdId);
    expect(fresh[a.headcount.id]?.[0]?.value).toBe(7);
    expect(fresh[a.active.id]?.[0]?.value).toBe(false);
    expect(fresh[a.score.id]).toBeUndefined();
    expect(fresh[a.status.id]).toBeUndefined();
    expect(fresh[a.owner.id]).toBeUndefined();
    expect(fresh[a.tags.id]).toHaveLength(2);
    expect(fresh[a.start.id]?.[0]?.value).toBe('2026-02-01');
    expect(await recordByCode(ws, object.id, a.code.id, 'SEED-101')).toBeUndefined();

    // Idempotent: running again does nothing.
    expect(await dt.imports.execute(ws.workspaceId, created.jobId)).toMatchObject({ status: 'completed', batches: 0 });
    expect(await allIds(ws, object.id)).toHaveLength(2);

    // History: per object and workspace-wide; executed imports cannot be deleted.
    const history = await dt.imports.history(ws.ctx, { entityDefinitionId: object.id });
    expect(history.jobs[0]).toMatchObject({
      id: created.jobId,
      title: 'seed-projects-import.csv',
      statusLabel: 'Done',
      counts: { created: 1, updated: 1, failed: 1 },
    });
    expect((await dt.imports.history(ws.ctx, { onlyMine: true })).jobs.map((j) => j.id)).toContain(created.jobId);
    await expectCode(dt.imports.delete(ws.ctx, { jobId: created.jobId }), 'IMPORT_STATE_CONFLICT');
  });

  it('cancels mid-run: rows after the batch in flight are not imported', async () => {
    const ws = await createWorkspace();
    const { object } = await projectsFixture(ws);
    const rows = Array.from({ length: 7 }, (_, i) => [`Project ${i}`, `C-${i}`]);
    const created = await startImport(ws.ctx, object.id, ['Name', 'Code'], rows);
    await dt.imports.run(ws.ctx, { jobId: created.jobId });
    const first = await dt.imports.execute(ws.workspaceId, created.jobId, { batchSize: 2, maxBatches: 1 });
    expect(first).toMatchObject({ status: 'executing', processedRows: 2 });
    const canceled = await dt.imports.cancel(ws.ctx, { jobId: created.jobId });
    expect(canceled.job).toMatchObject({
      status: 'canceled',
      canceledBy: { type: 'workspace-member', id: ws.memberId },
    });
    expect(canceled.strategies[0]?.statuses).toMatchObject({ created: 2, canceled: 5, planned: 0 });
    expect(await dt.imports.execute(ws.workspaceId, created.jobId, { batchSize: 2 })).toMatchObject({
      status: 'canceled',
      batches: 0,
    });
    expect(await allIds(ws, object.id)).toHaveLength(2);
    // Cancel is idempotent; a finished import cannot be canceled.
    await dt.imports.cancel(ws.ctx, { jobId: created.jobId });
  });

  it('resumes after an interruption without importing a row twice', async () => {
    const ws = await createWorkspace();
    const { object } = await projectsFixture(ws);
    const rows = Array.from({ length: 5 }, (_, i) => [`P${i}`]);
    const created = await startImport(ws.ctx, object.id, ['Name'], rows);
    await dt.imports.run(ws.ctx, { jobId: created.jobId });
    const controller = new AbortController();
    controller.abort();
    await expect(dt.imports.execute(ws.workspaceId, created.jobId, { signal: controller.signal })).rejects.toThrow(
      /interrupted/,
    );
    await dt.imports.execute(ws.workspaceId, created.jobId, { batchSize: 2, maxBatches: 1 });
    expect(await dt.imports.execute(ws.workspaceId, created.jobId, { batchSize: 2 })).toMatchObject({
      status: 'completed',
      processedRows: 3,
    });
    expect(await allIds(ws, object.id)).toHaveLength(5);
    // No unique attribute mapped → the duplicate warning lists the unique attributes to map instead.
    expect(created.validation.duplicateWarnings[0]?.uniqueAttributes.map((u) => u.title)).toEqual([
      'Record ID',
      'Code',
    ]);
  });

  it('isolates a row that fails at run time: earlier and later rows of the batch commit with correct projections', async () => {
    const ws = await createWorkspace();
    const { object, a } = await projectsFixture(ws);
    await dt.schema.createAttribute(ws.ctx, {
      id: newId(),
      entityDefinitionId: object.id,
      title: 'External ID',
      type: 'text',
      isUnique: true,
    });
    // Matched on Code; the second row reuses another row's unique External ID, which only the run can detect.
    const created = await startImport(
      ws.ctx,
      object.id,
      ['Name', 'Code', 'External ID'],
      [
        ['First', 'A', 'E1'],
        ['Second', 'B', 'E1'],
        ['Third', 'C', 'E3'],
      ],
    );
    expect((await dt.imports.preview(ws.ctx, { jobId: created.jobId })).totals).toMatchObject({ create: 3 });
    await dt.imports.run(ws.ctx, { jobId: created.jobId });
    await dt.imports.execute(ws.workspaceId, created.jobId);
    const failed = await dt.imports.assertions(ws.ctx, {
      jobId: created.jobId,
      strategyIndex: 0,
      statuses: ['failed'],
    });
    expect(failed.rows.map((r) => [r.rowIndex, r.failureReason])).toEqual([[1, 'unique-constraint-violation']]);
    // The projection (what views query) holds the committed rows' values.
    const byCode = async (code: string) =>
      (
        await dt.views.query(ws.ctx, {
          entityDefinitionId: object.id,
          filter: {
            path: [{ entityDefinitionId: object.id, attributeDefinitionId: a.code.id }],
            mode: 'must',
            constraints: [{ field: 'value', operator: 'eq', value: code }],
          },
        })
      ).total;
    expect([await byCode('A'), await byCode('B'), await byCode('C')]).toEqual([1, 0, 1]);
    expect(await allIds(ws, object.id)).toHaveLength(2);
  });
});

describe('matching and linked records', () => {
  it('people by email with Company › Domains: create or update, duplicates merge, Record ID is update-only', async () => {
    const ws = await createWorkspace();
    const people = await dt.schema.getObject(ws.ctx, 'people');
    const companies = await dt.schema.getObject(ws.ctx, 'companies');
    const pAttrs = await dt.schema.listAttributes(ws.ctx, { entityDefinitionId: 'people' });
    const cAttrs = await dt.schema.listAttributes(ws.ctx, { entityDefinitionId: 'companies' });
    const pa = (slug: string) => pAttrs.find((x) => x.apiSlug === slug)?.id as string;
    const ca = (slug: string) => cAttrs.find((x) => x.apiSlug === slug)?.id as string;
    const acme = newId();
    await dt.records.create(ws.ctx, {
      entityDefinitionId: 'companies',
      entityInstanceId: acme,
      values: { domains: [{ value: 'acme.com' }], name: [{ value: 'Acme' }] },
    });
    const ada = newId();
    await dt.records.create(ws.ctx, {
      entityDefinitionId: 'people',
      entityInstanceId: ada,
      values: { email_addresses: [{ value: 'ada@acme.com' }], job_title: [{ value: 'Engineer' }] },
    });

    const created = await startImport(
      ws.ctx,
      'people',
      ['First name', 'Last name', 'Email addresses', 'Company domain', 'Company description', 'Job title'],
      [
        ['Ada', 'Lovelace', 'ADA@acme.com, ada@home.org', 'acme.com', 'Engines', 'CTO'],
        ['Grace', 'Hopper', 'grace@navy.mil', 'navy.mil', 'Navy', 'Admiral'],
        ['Grace', 'Hopper', 'grace@navy.mil', 'navy.mil', '', 'Rear admiral'],
        ['No', 'Email', '', '', '', 'Intern'],
      ],
    );
    const status = await dt.imports.setMapping(ws.ctx, {
      jobId: created.jobId,
      columns: [
        {
          columnIndex: 3,
          target: {
            type: 'attribute',
            path: [
              { entityDefinitionId: people.id, attributeDefinitionId: pa('company') },
              { entityDefinitionId: companies.id, attributeDefinitionId: ca('domains') },
            ],
          },
        },
        {
          columnIndex: 4,
          target: {
            type: 'attribute',
            path: [
              { entityDefinitionId: people.id, attributeDefinitionId: pa('company') },
              { entityDefinitionId: companies.id, attributeDefinitionId: ca('description') },
            ],
          },
        },
      ],
    });
    // Auto-mapped name parts and title; two strategies: people (by email) then companies (by domain).
    expect(status.properties.filter((p) => p.columnIndex <= 1).map((p) => p.resolutionType)).toEqual([
      'personal-name:first-name',
      'personal-name:last-name',
    ]);
    expect(status.strategies.map((s) => [s.entityDefinitionId, s.mode, s.matchingAttributeDefinitionId])).toEqual([
      [people.id, 'create-or-update', pa('email_addresses')],
      [companies.id, 'create-or-update', ca('domains')],
    ]);
    const plan = await dt.imports.preview(ws.ctx, { jobId: created.jobId });
    expect(plan.strategies[0]?.planned).toEqual({ create: 3, update: 1, skip: 0, fail: 0 });
    expect(plan.strategies[1]?.planned).toEqual({ create: 2, update: 1, skip: 1, fail: 0 });

    await dt.imports.run(ws.ctx, { jobId: created.jobId });
    await dt.imports.execute(ws.workspaceId, created.jobId);
    const st = await dt.imports.status(ws.ctx, { jobId: created.jobId });
    // Duplicate rows merge into one record at run time: the second Grace row updates the first.
    expect(st.strategies[0]?.statuses).toMatchObject({ created: 2, updated: 2 });
    expect(st.strategies[1]?.statuses).toMatchObject({ created: 1, updated: 2, skipped: 1 });

    const adaValues = await valuesOf(ws, 'people', ada);
    expect(
      adaValues[pa('email_addresses')]?.map(
        (v) => (v.value as { normalizedEmailAddress: string }).normalizedEmailAddress,
      ),
    ).toEqual(['ada@acme.com', 'ada@home.org']);
    expect(adaValues[pa('name')]?.[0]?.value).toMatchObject({
      firstName: 'Ada',
      lastName: 'Lovelace',
      fullName: 'Ada Lovelace',
    });
    expect(adaValues[pa('job_title')]?.[0]?.value).toBe('CTO');
    expect(adaValues[pa('company')]?.[0]?.value).toMatchObject({ entityInstanceId: acme });
    expect((await valuesOf(ws, 'companies', acme))[ca('description')]?.[0]?.value).toBe('Engines');
    const navy = (
      await dt.records.findByUniqueValues(ws.ctx, {
        entityDefinitionId: 'companies',
        attributeDefinitionId: 'domains',
        values: [{ value: 'navy.mil' }],
      })
    ).entityInstanceIds;
    expect(navy).toHaveLength(1);
    const grace = (
      await dt.records.findByUniqueValues(ws.ctx, {
        entityDefinitionId: 'people',
        attributeDefinitionId: 'email_addresses',
        values: [{ value: 'grace@navy.mil' }],
      })
    ).entityInstanceIds;
    expect(grace).toHaveLength(1);
    const graceValues = await valuesOf(ws, 'people', grace[0] as string);
    expect(graceValues[pa('job_title')]?.[0]?.value).toBe('Rear admiral');
    expect(graceValues[pa('company')]?.[0]?.value).toMatchObject({ entityInstanceId: navy[0] });

    // Record ID mapping updates only: an unknown id fails with "No matching record found".
    const byId = await startImport(
      ws.ctx,
      'people',
      ['Record ID', 'Job title'],
      [
        [ada, 'Countess'],
        [newId(), 'Ghost'],
        ['', 'Nobody'],
      ],
    );
    expect(byId.strategies[0]).toMatchObject({ mode: 'update', matchingAttributeDefinitionId: pa('record_id') });
    const idPlan = await dt.imports.preview(ws.ctx, { jobId: byId.jobId });
    expect(idPlan.invalidRows.map((r) => [r.rowIndex, r.failureReason])).toEqual([
      [1, 'matching-entity-instance-not-found'],
      [2, 'matching-values-missing'],
    ]);
    await dt.imports.run(ws.ctx, { jobId: byId.jobId });
    await dt.imports.execute(ws.workspaceId, byId.jobId);
    expect((await valuesOf(ws, 'people', ada))[pa('job_title')]?.[0]?.value).toBe('Countess');
    const failed = await dt.imports.assertions(ws.ctx, { jobId: byId.jobId, strategyIndex: 0, statuses: ['failed'] });
    expect(failed.rows.map((r) => r.failureMessage)).toEqual(['No matching record found', 'Matching values missing']);
  });

  it('validates mappings: nothing mapped, duplicate attributes, create attribute from the importer', async () => {
    const ws = await createWorkspace();
    const { object, a } = await projectsFixture(ws);
    const created = await startImport(ws.ctx, object.id, ['Foo', 'Bar', 'Baz'], [['1', '2', '3']]);
    expect(created.validation.blocking.map((i) => i.code)).toEqual(['no-mapping']);
    await expectCode(dt.imports.preview(ws.ctx, { jobId: created.jobId }), 'VALIDATION_ERROR');
    const path = [{ entityDefinitionId: object.id, attributeDefinitionId: a.code.id }];
    let status = await dt.imports.setMapping(ws.ctx, {
      jobId: created.jobId,
      columns: [
        { columnIndex: 0, target: { type: 'attribute', path } },
        { columnIndex: 1, target: { type: 'attribute', path } },
      ],
    });
    expect(status.validation.blocking.map((i) => i.code)).toEqual(['duplicate-attribute']);
    const attrId = newId();
    status = await dt.imports.setMapping(ws.ctx, {
      jobId: created.jobId,
      columns: [
        { columnIndex: 1, target: { type: 'ignore' } },
        {
          columnIndex: 2,
          target: { type: 'create-attribute', attribute: { id: attrId, title: 'Baz', type: 'number' } },
        },
      ],
    });
    expect(status.validation.blocking).toEqual([]);
    expect(status.properties.find((p) => p.columnIndex === 2)).toMatchObject({
      path: [{ entityDefinitionId: object.id, attributeDefinitionId: attrId }],
      attributeType: 'number',
    });
    const mappable = await dt.imports.mappableProperties(ws.ctx, { jobId: created.jobId });
    expect(mappable.groups[0]?.attributes.map((x) => x.title)).toContain('Baz');
    expect(mappable.groups[0]?.attributes.find((x) => x.title === 'Record ID')?.isMatchKey).toBe(true);
    // Drafts can be deleted.
    await dt.imports.delete(ws.ctx, { jobId: created.jobId });
    await expectCode(dt.imports.status(ws.ctx, { jobId: created.jobId }), 'NOT_FOUND');
  });
});

describe('list imports', () => {
  it('matches or creates parent records, then adds entries (Add again) or updates them (Update existing)', async () => {
    const ws = await createWorkspace();
    const list = await listFixture(ws);
    const cAttrs = await dt.schema.listAttributes(ws.ctx, { entityDefinitionId: 'companies' });
    const domainsAttr = cAttrs.find((x) => x.apiSlug === 'domains')?.id as string;
    const acme = newId();
    await dt.records.create(ws.ctx, {
      entityDefinitionId: 'companies',
      entityInstanceId: acme,
      values: { domains: [{ value: 'acme.com' }] },
    });

    const headers = ['Domains', 'Stage', 'Note'];
    const rows = [
      ['acme.com', 'Lead', 'first'],
      ['globex.com', 'Qualified', 'second'],
    ];
    const created = await startImport(ws.ctx, list.listId, headers, rows);
    // List attributes auto-map first; "Domains" maps through parent_record.
    expect(created.properties.map((p) => p.path.length)).toEqual([2, 1, 1]);
    expect(created.strategies.map((s) => [s.isListEntries, s.mode])).toEqual([
      [true, 'create'],
      [false, 'create-or-update'],
    ]);
    const mappable = await dt.imports.mappableProperties(ws.ctx, { jobId: created.jobId });
    expect(mappable.groups.map((g) => g.key)).toEqual(['parent-record', 'list']);
    expect(mappable.groups[1]?.attributes.map((x) => x.title)).toEqual(['Entry ID', 'Stage', 'Note']);
    await dt.imports.run(ws.ctx, { jobId: created.jobId });
    await dt.imports.execute(ws.workspaceId, created.jobId);
    let status = await dt.imports.status(ws.ctx, { jobId: created.jobId });
    expect(status.strategies[0]?.statuses).toMatchObject({ created: 2 });
    expect(status.strategies[1]?.statuses).toMatchObject({ created: 1, updated: 1 });
    expect(await allIds(ws, list.listId)).toHaveLength(2);
    // Entries went through the entries service: the parent's list memberships (list_entries) know them.
    const acmeLists = await dt.entries.forRecord(ws.ctx, {
      recordRef: { entityDefinitionId: list.companiesId, entityInstanceId: acme },
    });
    expect(acmeLists.memberships.map((m) => m.listId)).toEqual([list.listId]);
    expect(acmeLists.memberships[0]?.entry.values[list.noteAttr]?.[0]?.value).toBe('first');
    const listEntries = (await dt.schema.getAttribute(ws.ctx, 'companies', 'list_entries')).id;
    const acmeRecord = await dt.records.get(ws.ctx, { entityDefinitionId: 'companies', entityInstanceId: acme });
    expect(acmeRecord.values[listEntries]?.map((v) => v.value)).toEqual([
      { entityDefinitionId: list.listId, entityInstanceId: acmeLists.memberships[0]?.entryId },
    ]);
    const globex = (
      await dt.records.findByUniqueValues(ws.ctx, {
        entityDefinitionId: 'companies',
        attributeDefinitionId: domainsAttr,
        values: [{ value: 'globex.com' }],
      })
    ).entityInstanceIds[0];
    expect(globex).toBeDefined();

    // Update existing: matched by parent record → entries updated, none added.
    const again = await startImport(ws.ctx, list.listId, headers, [['acme.com', 'Qualified', 'updated']]);
    await dt.imports.setMapping(ws.ctx, { jobId: again.jobId, listStrategy: 'create-or-update' });
    status = await dt.imports.status(ws.ctx, { jobId: again.jobId });
    expect(status.strategies[0]).toMatchObject({
      mode: 'create-or-update',
      matchingAttributeDefinitionId: list.parentAttr,
    });
    const plan = await dt.imports.preview(ws.ctx, { jobId: again.jobId });
    expect(plan.strategies[0]?.planned).toMatchObject({ update: 1 });
    await dt.imports.run(ws.ctx, { jobId: again.jobId });
    await dt.imports.execute(ws.workspaceId, again.jobId);
    const ids = await allIds(ws, list.listId);
    expect(ids).toHaveLength(2);
    const entries = await dt.records.batchGetWithValues(ws.ctx, {
      entityDefinitionId: list.listId,
      entityInstanceIds: ids,
    });
    const acmeEntry = entries.records.find(
      (r) => (r.values[list.parentAttr]?.[0]?.value as { entityInstanceId: string }).entityInstanceId === acme,
    );
    expect(acmeEntry?.values[list.noteAttr]?.[0]?.value).toBe('updated');

    // Add again (default) adds a second entry for the same company; a list import needs a parent attribute or Entry ID.
    const third = await startImport(ws.ctx, list.listId, ['Note'], [['orphan']]);
    expect(third.validation.blocking.map((i) => i.code)).toEqual(['list-parent-required']);
    const fourth = await startImport(ws.ctx, list.listId, ['Domains', 'Note'], [['acme.com', 'dup']]);
    await dt.imports.run(ws.ctx, { jobId: fourth.jobId });
    await dt.imports.execute(ws.workspaceId, fourth.jobId);
    expect(await allIds(ws, list.listId)).toHaveLength(3);
  });
});
