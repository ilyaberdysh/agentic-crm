import type { AttributeDefinition, CreateAttributeInput } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { describe, expect, it } from 'vitest';
import {
  createDomain,
  FakeLlm,
  type FakeReply,
  type LlmRequest,
  lastUserText,
  RecordingJobQueue,
} from '../src/index.ts';
import {
  createWorkspace,
  database,
  expectCode,
  newId,
  domain as plainDomain,
  type TestWorkspace,
} from './support/harness.ts';

/** What the model saw, flattened for assertions. */
interface Seen {
  system: string;
  prompt: string;
  schema: unknown;
}
const seen = (r: LlmRequest): Seen => ({
  system: typeof r.system === 'string' ? r.system : '',
  prompt: lastUserText(r),
  schema: r.outputSchema ?? null,
});

/** The real FakeLlm (packages/domain/src/ai/llm.ts) answering every request through `responder`. */
function setup(options: { responder?: (r: Seen) => FakeReply } = {}) {
  const responder =
    options.responder ??
    ((r: Seen): FakeReply => {
      if (r.system.includes('classify')) return { json: { options: ['Enterprise'] } };
      if (r.system.includes('single number')) return { text: 'About 1,250 people.' };
      return { text: 'Acme builds rockets for enterprise customers.' };
    });
  const llm = new FakeLlm().when(
    () => true,
    (r) => responder(seen(r)),
  );
  const jobs = new RecordingJobQueue();
  const domain = createDomain({ database, jobs, llm });
  return { domain, llm, jobs, requests: () => llm.calls.map(seen) };
}

/** Rows of the real credits ledger (credit_ledger) of a workspace. */
async function ledger(workspaceId: string) {
  return database.kysely
    .selectFrom('credit_ledger')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .orderBy('created_at')
    .execute();
}

async function setPoolBudget(workspaceId: string, credits: number) {
  await sql`UPDATE workspaces SET settings = jsonb_set(settings, '{capabilities}',
    ${JSON.stringify({ quotas: { workflow_credits_per_month_hard: credits } })}::jsonb) WHERE id = ${workspaceId}`.execute(
    database.kysely,
  );
}

type Env = ReturnType<typeof setup>;

async function fixture(env: Env) {
  const { domain } = env;
  const ws = await createWorkspace();
  const companies = await domain.schema.getObject(ws.ctx, 'companies');
  const attrs = await domain.schema.listAttributes(ws.ctx, { entityDefinitionId: companies.id });
  const name = attrs.find((a) => a.apiSlug === 'name') as AttributeDefinition;
  const create = (input: Omit<CreateAttributeInput, 'id' | 'entityDefinitionId'>) =>
    domain.schema.createAttribute(ws.ctx, { id: newId(), entityDefinitionId: companies.id, ...input });
  const records: string[] = [];
  for (const n of ['Acme', 'Globex', 'Initech']) {
    const id = newId();
    await domain.records.create(ws.ctx, {
      entityDefinitionId: companies.id,
      entityInstanceId: id,
      values: { [name.id]: [{ value: n }] },
    });
    records.push(id);
  }
  return { ws, companiesId: companies.id, name, create, records };
}

async function runJobs(env: Env, ws: TestWorkspace) {
  const sent = env.jobs.take('ai-attribute.run').filter((j) => j.data.workspaceId === ws.workspaceId);
  for (const job of sent) await env.domain.aiAttributes.processBatch(job.data as never);
  return sent.length;
}

describe('AI attributes', () => {
  it('summarize: confirmation data, run, values by the AI actor, annotations queued → complete, credits recorded', async () => {
    const env = setup();
    const { ws, companiesId, records, create } = await fixture(env);
    const summary = await create({
      title: 'AI summary',
      type: 'text',
      isRequired: true,
      aiAutofillConfiguration: { type: 'summarize-record', prompt: { plaintext: 'One sentence, please.' } },
    });
    expect(summary.aiAutofillConfiguration).toMatchObject({
      isEnabled: true,
      type: 'summarize-record',
      creditsPerValue: 1,
    });
    expect(summary.isRequired).toBe(false);

    const target = { type: 'records' as const, entityInstanceIds: records.slice(0, 2) };
    const estimate = await env.domain.aiAttributes.estimate(ws.ctx, {
      entityDefinitionId: companiesId,
      attributeDefinitionId: summary.id,
      target,
    });
    expect(estimate).toMatchObject({ recordCount: 2, creditsPerValue: 1, credits: 2 });
    const remaining = estimate.creditsRemaining;

    const run = await env.domain.aiAttributes.run(ws.ctx, {
      entityDefinitionId: companiesId,
      attributeDefinitionId: summary.id,
      target,
    });
    expect(run).toMatchObject({ recordCount: 2, credits: 2 });
    expect(Object.values(run.annotations).map((a) => [a.aiAutofill?.status, a.aiAutofill?.thinking])).toEqual([
      ['queued', true],
      ['queued', true],
    ]);
    expect(await runJobs(env, ws)).toBe(1);

    const read = await env.domain.records.get(ws.ctx, {
      entityDefinitionId: companiesId,
      entityInstanceId: records[0] as string,
    });
    const value = read.values[summary.id]?.[0];
    expect(value?.value).toBe('Acme builds rockets for enterprise customers.');
    expect(value?.createdBy).toEqual({ type: 'ai-autofill-attribute', id: summary.id });
    // The model saw the record's attributes and the guidance.
    const request = env.requests().find((r) => r.prompt.includes('Acme'));
    expect(request?.prompt).toContain('- Name: Acme');
    expect(request?.prompt).toContain('Instructions: One sentence, please.');

    const after = await env.domain.aiAttributes.annotations(ws.ctx, {
      entityDefinitionId: companiesId,
      attributeDefinitionId: summary.id,
      entityInstanceIds: records,
    });
    expect(after[records[0] as string]?.aiAutofill).toMatchObject({ status: 'complete', thinking: false });
    expect(after[records[2] as string]?.aiAutofill).toMatchObject({ status: null, thinking: false });
    // Acceptance 6: the ledger records the spend (1 credit per value), attributed to the requesting member.
    const spend = await ledger(ws.workspaceId);
    expect(spend.map((e) => [e.source, Number(e.credits), e.member_id, e.spend, e.pool, e.ref_type])).toEqual([
      ['ai-attribute', 1, ws.memberId, 'workspace', 'workspace', 'entity-instance'],
      ['ai-attribute', 1, ws.memberId, 'workspace', 'workspace', 'entity-instance'],
    ]);
    expect(spend.map((e) => e.ref_id).sort()).toEqual(records.slice(0, 2).sort());
    expect(spend.every((e) => e.model && e.input_tokens > 0)).toBe(true);
    // The confirmation dialog of the next run sees the spend (workspace pool, 1 credit = $0.01).
    const next = await env.domain.aiAttributes.estimate(ws.ctx, {
      entityDefinitionId: companiesId,
      attributeDefinitionId: summary.id,
      target,
    });
    expect(next.creditsRemaining).toBe(remaining === null ? null : remaining - 2);
    const runRow = await database.kysely
      .selectFrom('ai_attribute_runs')
      .selectAll()
      .where('id', '=', run.runId)
      .executeTakeFirstOrThrow();
    expect(runRow).toMatchObject({ status: 'complete', credits_used: 2, values_written: 2, errors: 0 });
  });

  it('classify: matches options, creates new ones when allowed, charges even without a match', async () => {
    const env = setup({
      responder: (r) => ({
        json: {
          options: r.prompt.includes('Name: Acme')
            ? ['enterprise']
            : r.prompt.includes('Name: Globex')
              ? ['Startup']
              : [],
        },
      }),
    });
    const { ws, companiesId, records, create } = await fixture(env);
    const segment = await create({
      title: 'Segment',
      type: 'select',
      options: [{ title: 'Enterprise' }, { title: 'SMB' }],
      aiAutofillConfiguration: { type: 'classify-record', isOptionCreationEnabled: true },
    });
    await env.domain.aiAttributes.run(ws.ctx, {
      entityDefinitionId: companiesId,
      attributeDefinitionId: segment.id,
      target: { type: 'records', entityInstanceIds: records },
    });
    await runJobs(env, ws);
    const options = await env.domain.schema.listOptions(ws.ctx, {
      entityDefinitionId: companiesId,
      attributeDefinitionId: segment.id,
    });
    expect(options.map((o) => o.title)).toEqual(['Enterprise', 'SMB', 'Startup']);
    const byTitle = new Map(options.map((o) => [o.id, o.title]));
    const titles = [];
    for (const id of records) {
      const rec = await env.domain.records.get(ws.ctx, { entityDefinitionId: companiesId, entityInstanceId: id });
      titles.push(
        rec.values[segment.id]?.map((v) => byTitle.get((v.value as { selectOptionId: string }).selectOptionId)) ?? [],
      );
    }
    expect(titles).toEqual([['Enterprise'], ['Startup'], []]);
    // No option for Initech, still charged (classify).
    expect(await ledger(ws.workspaceId)).toHaveLength(3);
    const prompt = env.requests()[0]?.prompt ?? '';
    // Option creation on: free-text titles in the structured output schema.
    expect(env.requests()[0]?.schema).toMatchObject({ properties: { options: { items: { type: 'string' } } } });
    expect(prompt).toContain('- Enterprise');
  });

  it('prompt completion with variables into a number attribute; selection and column targets', async () => {
    const env = setup();
    const { ws, companiesId, records, create, name } = await fixture(env);
    const employees = await create({
      title: 'Estimated employees',
      type: 'number',
      aiAutofillConfiguration: {
        type: 'prompt-completion',
        prompt: {
          plaintext: 'How many employees does _ have?',
          variables: [
            { startPosition: 24, path: [{ entityDefinitionId: companiesId, attributeDefinitionId: name.id }] },
          ],
        },
      },
    });
    const snap = await env.domain.views.query(ws.ctx, { entityDefinitionId: companiesId });
    const selection = await env.domain.aiAttributes.estimate(ws.ctx, {
      entityDefinitionId: companiesId,
      attributeDefinitionId: employees.id,
      target: { type: 'selection', snapshotId: snap.snapshotId, zebraEdges: [0, 2] },
    });
    expect(selection.recordCount).toBe(2);
    const column = await env.domain.aiAttributes.run(ws.ctx, {
      entityDefinitionId: companiesId,
      attributeDefinitionId: employees.id,
      target: { type: 'column', snapshotId: snap.snapshotId },
    });
    expect(column.recordCount).toBe(3);
    await runJobs(env, ws);
    const prompts = env
      .requests()
      .map((r) => r.prompt)
      .sort();
    expect(prompts).toEqual([
      'How many employees does Acme have?',
      'How many employees does Globex have?',
      'How many employees does Initech have?',
    ]);
    for (const id of records) {
      const rec = await env.domain.records.get(ws.ctx, { entityDefinitionId: companiesId, entityInstanceId: id });
      expect(rec.values[employees.id]?.[0]?.value).toBe(1250);
    }
  });

  it('never stays thinking: model errors, failed jobs and the stale sweep end in error; no credits', async () => {
    const env = setup({
      responder: (r) => (r.prompt.includes('Acme') ? { error: new Error('boom') } : { text: 'Fine.' }),
    });
    const { ws, companiesId, records, create } = await fixture(env);
    const summary = await create({
      title: 'Summary',
      type: 'text',
      aiAutofillConfiguration: { type: 'summarize-record' },
    });
    const run = await env.domain.aiAttributes.run(ws.ctx, {
      entityDefinitionId: companiesId,
      attributeDefinitionId: summary.id,
      target: { type: 'records', entityInstanceIds: records },
    });
    await runJobs(env, ws);
    const ann = await env.domain.aiAttributes.annotations(ws.ctx, {
      entityDefinitionId: companiesId,
      attributeDefinitionId: summary.id,
      entityInstanceIds: records,
    });
    expect(ann[records[0] as string]?.aiAutofill).toMatchObject({
      status: 'error',
      error: 'llm-error',
      thinking: false,
    });
    expect(ann[records[1] as string]?.aiAutofill?.status).toBe('complete');
    expect(run.recordCount).toBe(3);
    expect(await ledger(ws.workspaceId)).toHaveLength(2); // the failed value is not charged

    // A job that failed for good: its annotations end as errors.
    const second = await env.domain.aiAttributes.run(ws.ctx, {
      entityDefinitionId: companiesId,
      attributeDefinitionId: summary.id,
      target: { type: 'records', entityInstanceIds: [records[1] as string] },
    });
    const [job] = env.jobs.take('ai-attribute.run');
    expect(await env.domain.aiAttributes.failBatch(job?.data as never)).toBe(1);
    const failed = await env.domain.aiAttributes.annotations(ws.ctx, {
      entityDefinitionId: companiesId,
      attributeDefinitionId: summary.id,
      entityInstanceIds: [records[1] as string],
    });
    expect(failed[records[1] as string]?.aiAutofill).toMatchObject({
      status: 'error',
      error: 'job-failed',
      thinking: false,
    });
    expect(second.recordCount).toBe(1);

    // A run nobody processes: the sweep ends it.
    await env.domain.aiAttributes.run(ws.ctx, {
      entityDefinitionId: companiesId,
      attributeDefinitionId: summary.id,
      target: { type: 'records', entityInstanceIds: [records[2] as string] },
    });
    env.jobs.take('ai-attribute.run');
    expect(await env.domain.aiAttributes.sweep(-1000)).toBeGreaterThanOrEqual(1);
    const swept = await env.domain.aiAttributes.annotations(ws.ctx, {
      entityDefinitionId: companiesId,
      attributeDefinitionId: summary.id,
      entityInstanceIds: [records[2] as string],
    });
    expect(swept[records[2] as string]?.aiAutofill).toMatchObject({
      status: 'error',
      error: 'timeout',
      thinking: false,
    });
  });

  it('budget, configuration and provider guards', async () => {
    const env = setup();
    const { ws, companiesId, records, create } = await fixture(env);
    await setPoolBudget(ws.workspaceId, 2);
    const summary = await create({
      title: 'Summary',
      type: 'text',
      aiAutofillConfiguration: { type: 'summarize-record' },
    });
    const estimate = await env.domain.aiAttributes.estimate(ws.ctx, {
      entityDefinitionId: companiesId,
      attributeDefinitionId: summary.id,
      target: { type: 'records', entityInstanceIds: records },
    });
    expect(estimate).toMatchObject({ credits: 3, creditsRemaining: 2 });
    await expectCode(
      env.domain.aiAttributes.run(ws.ctx, {
        entityDefinitionId: companiesId,
        attributeDefinitionId: summary.id,
        target: { type: 'records', entityInstanceIds: records },
      }),
      'CREDITS_EXHAUSTED',
      402,
    );
    await expectCode(
      create({ title: 'Bad', type: 'number', aiAutofillConfiguration: { type: 'summarize-record' } }),
      'VALIDATION_ERROR',
    );
    await expectCode(
      create({
        title: 'Web',
        type: 'text',
        aiAutofillConfiguration: { type: 'research-web', prompt: { plaintext: 'x' } },
      }),
      'VALIDATION_ERROR',
    );
    await expectCode(
      create({ title: 'Prompt', type: 'text', aiAutofillConfiguration: { type: 'prompt-completion' } }),
      'VALIDATION_ERROR',
    );
    // Turning AI autofill off.
    const off = await env.domain.schema.updateAttribute(ws.ctx, {
      entityDefinitionId: companiesId,
      attributeDefinitionId: summary.id,
      aiAutofillConfiguration: null,
    });
    expect(off.aiAutofillConfiguration).toBeNull();
    // Without a provider: AI_NOT_CONFIGURED.
    const plain = await plainDomain.schema.createAttribute(ws.ctx, {
      id: newId(),
      entityDefinitionId: companiesId,
      title: 'Plain summary',
      type: 'text',
      aiAutofillConfiguration: { type: 'summarize-record' },
    });
    await expectCode(
      plainDomain.aiAttributes.run(ws.ctx, {
        entityDefinitionId: companiesId,
        attributeDefinitionId: plain.id,
        target: { type: 'records', entityInstanceIds: records },
      }),
      'AI_NOT_CONFIGURED',
      503,
    );
  });
});

describe('formula composer', () => {
  it('generates a formula from a prompt with $n handles, self-corrects once, refuses, fixes', async () => {
    let calls = 0;
    const env = setup({
      responder: (r) => {
        calls++;
        if (r.prompt.includes('regex')) {
          return {
            json: {
              formula: null,
              refusal: { category: 'unsupported_function', message: 'Regular expressions are not supported' },
            },
          };
        }
        if (r.prompt.includes('fix the current formula')) return { json: { formula: 'upper($1)', refusal: null } };
        if (r.prompt.includes('previous formula had these errors')) {
          return { json: { formula: 'length($1) * 2', refusal: null } };
        }
        return { json: { formula: 'length($1) * "x"', refusal: null } };
      },
    });
    const { ws, companiesId } = await fixture(env);
    const id = newId();
    const created = await env.domain.formulas.generate(ws.ctx, {
      id,
      entityDefinitionId: companiesId,
      prompt: 'Twice the name length',
    });
    expect(created).toMatchObject({ type: 'generate', status: 'queued' });
    const [job] = env.jobs.take('formula.generate');
    expect(await env.domain.formulas.processGeneration(job?.data as never)).toEqual({ status: 'completed' });
    const done = await env.domain.formulas.generationRequest(ws.ctx, id);
    expect(done.status).toBe('completed');
    expect(done.outputPlaintext).toBe('length(_) * 2');
    expect(calls).toBe(2);
    const check = await env.domain.formulas.validate(ws.ctx, {
      entityDefinitionId: companiesId,
      plaintext: done.outputPlaintext as string,
      annotations: done.outputAnnotations as never,
    });
    expect(check).toMatchObject({ valid: true, outputType: 'number' });

    const refusedId = newId();
    await env.domain.formulas.generate(ws.ctx, {
      id: refusedId,
      entityDefinitionId: companiesId,
      prompt: 'use a regex',
    });
    await env.domain.formulas.processGeneration(env.jobs.take('formula.generate')[0]?.data as never);
    expect(await env.domain.formulas.generationRequest(ws.ctx, refusedId)).toMatchObject({
      status: 'failed',
      refusalCategory: 'unsupported_function',
      refusalMessage: 'Regular expressions are not supported',
    });

    const fixId = newId();
    const fix = await env.domain.formulas.fix(ws.ctx, {
      id: fixId,
      entityDefinitionId: companiesId,
      inputFormulaDraft: {
        plaintext: 'uper(_)',
        annotations: (done.outputAnnotations as { startPosition: number }[]).map((a) => ({
          ...a,
          startPosition: 5,
        })) as never,
      },
    });
    expect(fix.type).toBe('fix');
    await env.domain.formulas.processGeneration(env.jobs.take('formula.generate')[0]?.data as never);
    expect(await env.domain.formulas.generationRequest(ws.ctx, fixId)).toMatchObject({
      status: 'completed',
      outputPlaintext: 'upper(_)',
    });
    const fixPrompt = env.requests().find((r) => r.prompt.includes('fix the current formula'))?.prompt ?? '';
    expect(fixPrompt).toContain('Current formula:\nuper($');
    expect(fixPrompt).toContain('Invalid function name uper');
  });
});
