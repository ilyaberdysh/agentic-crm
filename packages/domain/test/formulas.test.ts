import type { AttributeDefinition, CreateAttributeInput, FormulaAnnotationInput } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { describe, expect, it } from 'vitest';
import { createDomain, RecordingJobQueue } from '../src/index.ts';
import { createWorkspace, database, domain, expectCode, newId, type TestWorkspace } from './support/harness.ts';

const hop = (entityDefinitionId: string, attributeDefinitionId: string) => ({
  entityDefinitionId,
  attributeDefinitionId,
});

function ref(path: { entityDefinitionId: string; attributeDefinitionId: string }[], field: string | null = null) {
  return { type: 'entity-variable' as const, path, field };
}

type Part = FormulaAnnotationInput extends infer A
  ? A extends unknown
    ? Omit<A, 'startPosition' | 'length'>
    : never
  : never;

/** Builds plaintext + annotations from parts: strings are text, objects are references. */
function formula(...parts: (string | Part)[]) {
  let plaintext = '';
  const annotations: FormulaAnnotationInput[] = [];
  for (const p of parts) {
    if (typeof p === 'string') plaintext += p;
    else {
      annotations.push({ ...p, startPosition: plaintext.length, length: 1 } as FormulaAnnotationInput);
      plaintext += '_';
    }
  }
  return { plaintext, annotations };
}

const xmax = async () =>
  BigInt(
    (
      (await sql<{ x: string }>`SELECT pg_snapshot_xmax(pg_current_snapshot())::text AS x`.execute(database.kysely))
        .rows[0] as { x: string }
    ).x,
  );
const cursor = async () =>
  BigInt(
    (
      (
        await sql<{ x: string }>`SELECT xid_cursor::text AS x FROM formula_recompute_state WHERE id = 1`.execute(
          database.kysely,
        )
      ).rows[0] as { x: string }
    ).x,
  );

/**
 * Runs pump passes until every change committed so far is processed (the cursor waits for older concurrent
 * transactions of other test files), then again while passes still find work (one level of a formula chain each).
 */
async function settle(d = domain, options?: { inlineLimit?: number }) {
  for (let round = 0; round < 6; round++) {
    const target = await xmax();
    let rows = 0;
    for (let i = 0; i < 400; i++) {
      rows += (await d.formulas.pump(options)).rows;
      if ((await cursor()) >= target) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    if (rows === 0) return;
  }
}

interface Fixture {
  ws: TestWorkspace;
  projectId: string;
  budget: AttributeDefinition;
  headcount: AttributeDefinition;
  stage: AttributeDefinition;
  company: AttributeDefinition;
  companiesId: string;
  companyName: AttributeDefinition;
}

async function fixture(): Promise<Fixture> {
  const ws = await createWorkspace();
  const project = await domain.schema.createObject(ws.ctx, {
    id: newId(),
    apiSlug: 'projects',
    singularNoun: 'Project',
    pluralNoun: 'Projects',
  });
  const attr = (input: Omit<CreateAttributeInput, 'id' | 'entityDefinitionId'>) =>
    domain.schema.createAttribute(ws.ctx, { id: newId(), entityDefinitionId: project.id, ...input });
  const companies = await domain.schema.getObject(ws.ctx, 'companies');
  const companyAttrs = await domain.schema.listAttributes(ws.ctx, { entityDefinitionId: companies.id });
  return {
    ws,
    projectId: project.id,
    companiesId: companies.id,
    budget: await attr({ title: 'Budget', type: 'currency' }),
    headcount: await attr({ title: 'Headcount', type: 'number' }),
    stage: await attr({
      title: 'Stage',
      type: 'pipeline',
      stages: [{ title: 'Lead' }, { title: 'Won', lifecyclePhase: 'WON' }],
    }),
    company: await attr({
      title: 'Company',
      type: 'entity-reference',
      entityReferenceConfiguration: { allowedEntityDefinitionIds: [companies.id] },
    }),
    companyName: companyAttrs.find((a) => a.apiSlug === 'name') as AttributeDefinition,
  };
}

async function createFormula(
  f: Fixture,
  title: string,
  source: ReturnType<typeof formula>,
  override: string | null = null,
) {
  return domain.schema.createAttribute(f.ws.ctx, {
    id: newId(),
    entityDefinitionId: f.projectId,
    title,
    type: 'text',
    formulaConfiguration: { snapshotId: newId(), ...source, outputTypeOverride: override as never },
  });
}

async function newProject(f: Fixture, values: Record<string, { value: unknown }[]>) {
  const id = newId();
  await domain.records.create(f.ws.ctx, { entityDefinitionId: f.projectId, entityInstanceId: id, values });
  return id;
}

async function valueOf(f: Fixture, id: string, attr: AttributeDefinition) {
  const rec = await domain.records.get(f.ws.ctx, { entityDefinitionId: f.projectId, entityInstanceId: id });
  return rec.values[attr.id] ?? [];
}

describe('formula attributes', () => {
  it('creates a formula attribute: output type, read-only, snapshot, values for existing and new records', async () => {
    const f = await fixture();
    const before = await newProject(f, {
      [f.budget.id]: [{ value: { currencyValue: 250000, currencyCode: 'USD' } }],
      [f.headcount.id]: [{ value: 20 }],
    });
    const perHead = await createFormula(
      f,
      'Budget per head',
      formula(
        'round(',
        ref([hop(f.projectId, f.budget.id)], 'raw_value'),
        ' / ',
        ref([hop(f.projectId, f.headcount.id)]),
        ', 0)',
      ),
    );
    expect(perHead.type).toBe('number');
    expect(perHead.isReadOnly).toBe(true);
    expect(perHead.formulaConfiguration?.activeSnapshotId).toBeTruthy();

    const snapshots = await domain.formulas.snapshots(f.ws.ctx, {
      entityDefinitionId: f.projectId,
      attributeDefinitionId: perHead.id,
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      grammarVersion: '0.0.1',
      plaintext: 'round(_ / _, 0)',
      outputTypeOverride: null,
    });

    // Before the pump runs, the cell is "calculating".
    const pending = await domain.formulas.annotations(f.ws.ctx, {
      entityDefinitionId: f.projectId,
      attributeDefinitionId: perHead.id,
      entityInstanceIds: [before],
    });
    expect(pending[before]?.formula?.state).toBe('calculating');

    await settle();
    const values = await valueOf(f, before, perHead);
    expect(values.map((v) => v.value)).toEqual([12500]);
    expect(values[0]?.createdBy).toEqual({ type: 'formula-attribute', id: perHead.id });
    const done = await domain.formulas.annotations(f.ws.ctx, {
      entityDefinitionId: f.projectId,
      attributeDefinitionId: perHead.id,
      entityInstanceIds: [before],
    });
    expect(done[before]?.formula).toMatchObject({ lastExecutionStatus: 'complete', state: 'value' });

    // A record created afterwards gets its value from the pump too.
    const after = await newProject(f, {
      [f.budget.id]: [{ value: { currencyValue: 1000 } }],
      [f.headcount.id]: [{ value: 3 }],
    });
    await settle();
    expect((await valueOf(f, after, perHead)).map((v) => v.value)).toEqual([333]);

    // Members cannot write formula values.
    await expectCode(
      domain.values.put(f.ws.ctx, {
        entityDefinitionId: f.projectId,
        entityInstanceId: after,
        attributeDefinitionId: perHead.id,
        attributeValueId: newId(),
        value: 1,
      }),
      'ATTRIBUTE_READ_ONLY',
    );
  });

  it('recomputes on dependency change, through relationship paths, within the pump pass', async () => {
    const f = await fixture();
    const companyId = newId();
    await domain.records.create(f.ws.ctx, {
      entityDefinitionId: f.companiesId,
      entityInstanceId: companyId,
      values: { [f.companyName.id]: [{ value: 'Acme' }] },
    });
    const project = await newProject(f, {
      [f.headcount.id]: [{ value: 20 }],
      [f.company.id]: [{ value: { entityInstanceId: companyId } }],
    });
    const double = await createFormula(f, 'Double', formula(ref([hop(f.projectId, f.headcount.id)]), ' * 2'));
    const label = await createFormula(
      f,
      'Label',
      formula(
        'upper(',
        ref([hop(f.projectId, f.company.id), hop(f.companiesId, f.companyName.id)]),
        ') + "-" + text(',
        ref([hop(f.projectId, f.headcount.id)]),
        ')',
      ),
    );
    await settle();
    expect((await valueOf(f, project, double)).map((v) => v.value)).toEqual([40]);
    expect((await valueOf(f, project, label)).map((v) => v.value)).toEqual(['ACME-20']);

    await domain.records.update(f.ws.ctx, {
      entityDefinitionId: f.projectId,
      entityInstanceId: project,
      values: { [f.headcount.id]: [{ value: 25 }] },
    });
    // Latency (< 2 s through the running worker) is asserted in apps/worker/test/formulas.test.ts.
    await settle();
    expect((await valueOf(f, project, double)).map((v) => v.value)).toEqual([50]);

    // A change on the related company reaches the project through the path.
    await domain.records.update(f.ws.ctx, {
      entityDefinitionId: f.companiesId,
      entityInstanceId: companyId,
      values: { [f.companyName.id]: [{ value: 'Globex' }] },
    });
    await settle();
    expect((await valueOf(f, project, label)).map((v) => v.value)).toEqual(['GLOBEX-25']);

    // Unchanged results are not rewritten (no history noise).
    const history = await domain.values.history(f.ws.ctx, {
      entityDefinitionId: f.projectId,
      entityInstanceId: project,
      attributeDefinitionId: double.id,
    });
    await domain.records.update(f.ws.ctx, {
      entityDefinitionId: f.companiesId,
      entityInstanceId: companyId,
      values: { [f.companyName.id]: [{ value: 'Initech' }] },
    });
    await settle();
    const history2 = await domain.values.history(f.ws.ctx, {
      entityDefinitionId: f.projectId,
      entityInstanceId: project,
      attributeDefinitionId: double.id,
    });
    expect(history2.values.length).toBe(history.values.length);
  });

  it('chains formulas (formula of a formula) and rejects circular references and chains longer than three', async () => {
    const f = await fixture();
    const project = await newProject(f, { [f.headcount.id]: [{ value: 2 }] });
    const f1 = await createFormula(f, 'F1', formula(ref([hop(f.projectId, f.headcount.id)]), ' + 1'));
    const f2 = await createFormula(f, 'F2', formula(ref([hop(f.projectId, f1.id)]), ' * 10'));
    const f3 = await createFormula(f, 'F3', formula(ref([hop(f.projectId, f2.id)]), ' + 0.5'));
    await settle();
    expect((await valueOf(f, project, f3)).map((v) => v.value)).toEqual([30.5]);
    await domain.records.update(f.ws.ctx, {
      entityDefinitionId: f.projectId,
      entityInstanceId: project,
      values: { [f.headcount.id]: [{ value: 4 }] },
    });
    await settle();
    expect((await valueOf(f, project, f3)).map((v) => v.value)).toEqual([50.5]);

    await expectCode(
      createFormula(f, 'F4', formula(ref([hop(f.projectId, f3.id)]), ' + 1')),
      'FORMULA_MAX_DEPTH_EXCEEDED',
      400,
    );
    // Making F1 depend on F3 closes a loop.
    await expectCode(
      domain.schema.updateAttribute(f.ws.ctx, {
        entityDefinitionId: f.projectId,
        attributeDefinitionId: f1.id,
        formulaConfiguration: { snapshotId: newId(), ...formula(ref([hop(f.projectId, f3.id)]), ' + 1') },
      }),
      'FORMULA_CIRCULAR_REFERENCE',
      400,
    );
    await expectCode(
      domain.schema.updateAttribute(f.ws.ctx, {
        entityDefinitionId: f.projectId,
        attributeDefinitionId: f1.id,
        formulaConfiguration: { snapshotId: newId(), ...formula(ref([hop(f.projectId, f1.id)]), ' + 1') },
      }),
      'FORMULA_CIRCULAR_REFERENCE',
    );
    const validation = await domain.formulas.validate(f.ws.ctx, {
      entityDefinitionId: f.projectId,
      attributeDefinitionId: f1.id,
      ...formula(ref([hop(f.projectId, f2.id)])),
    });
    expect(validation).toMatchObject({ valid: true, saveError: 'FORMULA_CIRCULAR_REFERENCE' });
  });

  it('rejects empty and erroneous formulas with diagnostics', async () => {
    const f = await fixture();
    await expectCode(createFormula(f, 'Empty', formula('  // nothing')), 'FORMULA_EMPTY', 400);
    const err = await expectCode(
      createFormula(f, 'Bad', formula('upper(1, 2) + unknownFn(1)')),
      'FORMULA_HAS_ERRORS',
      400,
    );
    expect((err.details.diagnostics as { code: string }[]).map((d) => d.code)).toEqual([
      'INVALID_ARGUMENT_COUNT',
      'INVALID_FUNCTION_NAME',
    ]);
    const validation = await domain.formulas.validate(f.ws.ctx, {
      entityDefinitionId: f.projectId,
      ...formula(
        ref([hop(f.projectId, f.stage.id)]),
        ' == "Won" and ',
        ref([hop(f.projectId, f.headcount.id)]),
        ' > "x"',
      ),
    });
    expect(validation.valid).toBe(false);
    expect(validation.diagnostics[0]).toMatchObject({ code: 'INCOMPATIBLE_ARGUMENT_TYPES', line: 1 });
    expect(validation.summary).toBe('Argument of type text is not compatible with expected type (number)');
  });

  it('previews against a record and reports evaluation errors', async () => {
    const f = await fixture();
    const project = await newProject(f, { [f.headcount.id]: [{ value: 8 }] });
    const ok = await domain.formulas.preview(f.ws.ctx, {
      entityDefinitionId: f.projectId,
      entityInstanceId: project,
      ...formula('"Team of " + text(', ref([hop(f.projectId, f.headcount.id)]), ')'),
    });
    expect(ok).toMatchObject({ type: 'complete', value: 'Team of 8', outputType: 'text', display: 'Team of 8' });
    const asCurrency = await domain.formulas.preview(f.ws.ctx, {
      entityDefinitionId: f.projectId,
      entityInstanceId: project,
      outputTypeOverride: 'currency',
      ...formula(ref([hop(f.projectId, f.headcount.id)]), ' * 1.5'),
    });
    expect(asCurrency).toMatchObject({
      type: 'complete',
      outputType: 'currency',
      value: { currencyValue: 12, currencyCode: null },
    });
    const div = await domain.formulas.preview(f.ws.ctx, {
      entityDefinitionId: f.projectId,
      entityInstanceId: project,
      ...formula('1 / (', ref([hop(f.projectId, f.headcount.id)]), ' - 8)'),
    });
    expect(div).toMatchObject({ type: 'evaluation_error', code: 'division-by-zero' });
    const syntax = await domain.formulas.preview(f.ws.ctx, {
      entityDefinitionId: f.projectId,
      entityInstanceId: project,
      ...formula('1 +'),
    });
    expect(syntax.type).toBe('syntax_error');
  });

  it('stores runtime errors in the annotation and clears the value', async () => {
    const f = await fixture();
    const project = await newProject(f, { [f.headcount.id]: [{ value: 4 }] });
    const inverse = await createFormula(f, 'Inverse', formula('1 / ', ref([hop(f.projectId, f.headcount.id)])));
    await settle();
    expect((await valueOf(f, project, inverse)).map((v) => v.value)).toEqual([0.25]);
    await domain.records.update(f.ws.ctx, {
      entityDefinitionId: f.projectId,
      entityInstanceId: project,
      values: { [f.headcount.id]: [{ value: 0 }] },
    });
    await settle();
    expect(await valueOf(f, project, inverse)).toEqual([]);
    const ann = await domain.formulas.annotations(f.ws.ctx, {
      entityDefinitionId: f.projectId,
      attributeDefinitionId: inverse.id,
      entityInstanceIds: [project],
    });
    expect(ann[project]?.formula).toMatchObject({
      lastExecutionStatus: 'error',
      lastExecutionError: 'division-by-zero',
      state: 'errored',
    });
  });

  it('changing the output type clears old values and recomputes with the new type', async () => {
    const f = await fixture();
    const project = await newProject(f, { [f.headcount.id]: [{ value: 3 }] });
    const attr = await createFormula(f, 'Size', formula(ref([hop(f.projectId, f.headcount.id)]), ' * 2'));
    await settle();
    expect((await valueOf(f, project, attr)).map((v) => v.value)).toEqual([6]);
    const updated = await domain.schema.updateAttribute(f.ws.ctx, {
      entityDefinitionId: f.projectId,
      attributeDefinitionId: attr.id,
      formulaConfiguration: {
        snapshotId: newId(),
        ...formula('if(', ref([hop(f.projectId, f.headcount.id)]), ' > 2, "big", "small")'),
      },
    });
    expect(updated.type).toBe('text');
    expect(updated.formulaConfiguration?.activeSnapshotId).not.toBe(attr.formulaConfiguration?.activeSnapshotId);
    expect(await valueOf(f, project, attr)).toEqual([]);
    await settle();
    expect((await valueOf(f, project, attr)).map((v) => v.value)).toEqual(['big']);
    const history = await domain.values.history(f.ws.ctx, {
      entityDefinitionId: f.projectId,
      entityInstanceId: project,
      attributeDefinitionId: attr.id,
    });
    expect(history.values.map((v) => v.value)).toEqual(['big']); // the number history was erased
    const report = await domain.schema.verifyProjection(f.ws.ctx, f.projectId);
    expect(report.mismatchedRows).toBe(0);
    expect(
      await domain.formulas.snapshots(f.ws.ctx, { entityDefinitionId: f.projectId, attributeDefinitionId: attr.id }),
    ).toHaveLength(2);
  });

  it('history functions read the value history (hasBeenIn, valueSetAt, previousValue)', async () => {
    const f = await fixture();
    const stages = await domain.schema.listStages(f.ws.ctx, {
      entityDefinitionId: f.projectId,
      attributeDefinitionId: f.stage.id,
    });
    const [lead, won] = stages as unknown as [{ id: string }, { id: string }];
    const project = await newProject(f, { [f.stage.id]: [{ value: { pipelineStageId: lead.id } }] });
    await domain.records.update(f.ws.ctx, {
      entityDefinitionId: f.projectId,
      entityInstanceId: project,
      values: { [f.stage.id]: [{ value: { pipelineStageId: won.id } }] },
    });
    const stageRef = ref([hop(f.projectId, f.stage.id)]);
    const wasLead = await createFormula(
      f,
      'Was lead',
      formula(
        'hasBeenIn(',
        stageRef,
        ', ',
        {
          type: 'pipeline-stage',
          entityDefinitionId: f.projectId,
          attributeDefinitionId: f.stage.id,
          pipelineStageId: lead.id,
        },
        ')',
      ),
    );
    const previous = await createFormula(f, 'Previous stage', formula('previousValue(', stageRef, ')'));
    const wonAt = await createFormula(
      f,
      'Won at',
      formula(
        'valueSetAt(',
        stageRef,
        ', ',
        {
          type: 'pipeline-stage',
          entityDefinitionId: f.projectId,
          attributeDefinitionId: f.stage.id,
          pipelineStageId: won.id,
        },
        ', "last")',
      ),
    );
    expect(previous.type).toBe('text');
    expect(wonAt.type).toBe('timestamp');
    await settle();
    expect((await valueOf(f, project, wasLead)).map((v) => v.value)).toEqual([true]);
    expect((await valueOf(f, project, previous)).map((v) => v.value)).toEqual(['Lead']);
    expect((await valueOf(f, project, wonAt))[0]?.value).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('recomputes dependents when an option is renamed or a referenced attribute is archived', async () => {
    const f = await fixture();
    const stages = await domain.schema.listStages(f.ws.ctx, {
      entityDefinitionId: f.projectId,
      attributeDefinitionId: f.stage.id,
    });
    const lead = stages[0] as { id: string };
    const project = await newProject(f, {
      [f.stage.id]: [{ value: { pipelineStageId: lead.id } }],
      [f.headcount.id]: [{ value: 5 }],
    });
    const stageText = await createFormula(
      f,
      'Stage text',
      formula('upper(text(', ref([hop(f.projectId, f.stage.id)]), '))'),
    );
    const plusOne = await createFormula(f, 'Plus one', formula(ref([hop(f.projectId, f.headcount.id)]), ' + 1'));
    await settle();
    expect((await valueOf(f, project, stageText)).map((v) => v.value)).toEqual(['LEAD']);
    await domain.schema.updateStage(f.ws.ctx, {
      entityDefinitionId: f.projectId,
      attributeDefinitionId: f.stage.id,
      pipelineStageId: lead.id,
      title: 'Prospect',
    });
    await settle();
    expect((await valueOf(f, project, stageText)).map((v) => v.value)).toEqual(['PROSPECT']);

    await domain.schema.updateAttribute(f.ws.ctx, {
      entityDefinitionId: f.projectId,
      attributeDefinitionId: f.headcount.id,
      isArchived: true,
    });
    await settle();
    expect(await valueOf(f, project, plusOne)).toEqual([]);
    const ann = await domain.formulas.annotations(f.ws.ctx, {
      entityDefinitionId: f.projectId,
      attributeDefinitionId: plusOne.id,
      entityInstanceIds: [project],
    });
    expect(ann[project]?.formula?.lastExecutionError).toBe('referenced-attribute-missing-or-archived');
  });

  it('batches large recomputes into formula.recompute jobs', async () => {
    const jobs = new RecordingJobQueue();
    const withJobs = createDomain({ database, jobs });
    const f = await fixture();
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) ids.push(await newProject(f, { [f.headcount.id]: [{ value: i }] }));
    const attr = await createFormula(f, 'Plus one', formula(ref([hop(f.projectId, f.headcount.id)]), ' + 1'));
    await settle(withJobs, { inlineLimit: 5 });
    const sent = jobs.take('formula.recompute').filter((j) => j.data.attributeId === attr.id);
    expect(sent.length).toBeGreaterThan(0);
    for (const job of sent) await withJobs.formulas.recompute(job.data as never);
    for (const [i, id] of ids.entries()) expect((await valueOf(f, id, attr)).map((v) => v.value)).toEqual([i + 1]);
  });
});
