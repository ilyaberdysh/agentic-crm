// Slice 4 import / export procedures over HTTP (BACKLOG 4.07, 4.08): the wizard flow through tRPC, and the
// transactional enqueue (D-10) of the worker jobs through the API's pg-boss producer (the job row exists after the
// mutation commits). Execution is driven through the domain here; apps/worker runs it in production.
import { randomUUID } from 'node:crypto';
import type { inferRouterOutputs } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppRouter } from '../src/trpc/router';
import {
  createWorkspaceWithMembers,
  type Harness,
  signUp,
  startHarness,
  type TestUser,
  trpcCall,
  trpcError,
} from './support/harness';

type Out = inferRouterOutputs<AppRouter>;

let h: Harness;
let admin: TestUser;
let workspaceId: string;
const slug = `s4i-${Date.now().toString(36)}`;
const call = <T>(path: string, input?: unknown) => trpcCall<T>(h, path, input, { user: admin, slug });

async function queued(name: string, key: string): Promise<number> {
  const { rows } = await h.db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1 AND singleton_key = $2`,
    [name, key],
  );
  return rows[0]?.n ?? 0;
}

beforeAll(async () => {
  h = await startHarness();
  admin = await signUp(h, 'Ada Admin');
  workspaceId = (await createWorkspaceWithMembers(h, slug, [{ user: admin, admin: true }])).workspaceId;
});

afterAll(async () => {
  await h?.close();
});

describe('imports over tRPC', () => {
  it('creates, uploads, maps, reviews, previews and runs an import into companies', async () => {
    const importId = randomUUID();
    const jobId = randomUUID();
    const created = await call<Out['imports']['create']>('imports.create', {
      importId,
      jobId,
      entityDefinitionId: 'companies',
      fileName: 'companies.csv',
      columns: ['Name', 'Domains', 'Employee range', 'Foundation date'],
      rowCount: 3,
    });
    expect(created).toMatchObject({ importId, jobId, job: { status: 'uploading' }, seq: expect.any(String) });
    expect(created.properties).toHaveLength(4);
    const uploaded = await call<Out['imports']['uploadRows']>('imports.uploadRows', {
      jobId,
      startRow: 0,
      rows: [
        ['Acme', 'acme.com', '11-50', '1984'],
        ['Globex', 'globex.com, globex.io', '1K-5K', '1990-05-01'],
        ['Initech', 'initech.com', 'Huge', ''],
      ],
      final: true,
    });
    expect(uploaded).toMatchObject({ status: 'draft', uploadedRowCount: 3 });
    const mappable = await call<Out['imports']['mappableProperties']>('imports.mappableProperties', { jobId });
    expect(
      mappable.groups[0]?.attributes.find((a) => a.title === 'Team')?.related?.attributes.map((a) => a.title),
    ).toEqual(expect.arrayContaining(['Record ID', 'Email addresses']));
    const status = await call<Out['imports']['status']>('imports.status', { jobId });
    expect(status.strategies[0]?.mode).toBe('create-or-update');
    const range = status.properties.find((p) => p.columnIndex === 2)?.id as string;
    const review = await call<Out['imports']['reviewValues']>('imports.reviewValues', { jobId, propertyId: range });
    expect(review.missingOptions).toEqual(['Huge']);
    const summary = await call<Out['imports']['reviewSummary']>('imports.reviewSummary', { jobId });
    expect(summary.properties.find((p) => p.propertyId === range)?.needsReviewCount).toBe(1);
    const fixed = await call<Out['imports']['setOverride']>('imports.setOverride', {
      jobId,
      propertyId: range,
      rawValue: 'Huge',
      override: { type: 'skip' },
    });
    expect(fixed.value.status).toBe('overridden');
    const plan = await call<Out['imports']['preview']>('imports.preview', { jobId });
    expect(plan.totals).toMatchObject({ create: 3 });
    const rows = await call<Out['imports']['assertions']>('imports.assertions', { jobId, strategyIndex: 0 });
    expect(rows.total).toBe(3);

    // Start import: the pg-boss job is committed with the confirmation.
    const run = await call<Out['imports']['run']>('imports.run', { jobId });
    expect(run.job.status).toBe('confirmed');
    expect(await queued('import.run', jobId)).toBe(1);
    await call('imports.run', { jobId });
    expect(await queued('import.run', jobId)).toBe(1);

    await h.domain.imports.execute(workspaceId, jobId);
    const done = await call<Out['imports']['status']>('imports.status', { jobId });
    expect(done.job).toMatchObject({ status: 'completed', statusLabel: 'Done', progress: { done: 3, total: 3 } });
    const history = await call<Out['imports']['history']>('imports.history', { entityDefinitionId: 'companies' });
    expect(history.jobs[0]).toMatchObject({ id: jobId, title: 'companies.csv' });
    const err = await trpcError(call('imports.delete', { jobId }));
    expect(err.status).toBe(409);
  });

  it('refuses mapping changes with a validation envelope for unknown columns', async () => {
    const created = await call<Out['imports']['create']>('imports.create', {
      entityDefinitionId: 'companies',
      fileName: 'x.csv',
      columns: ['Name'],
      rowCount: 1,
    });
    const err = await trpcError(
      call('imports.setMapping', { jobId: created.jobId, columns: [{ columnIndex: 5, target: { type: 'ignore' } }] }),
    );
    expect(err.status).toBe(400);
  });
});

describe('exports over tRPC', () => {
  it('queues an export of a saved view and serves a download URL when complete', async () => {
    const companies = await call<Out['schema']['objects']['get']>('schema.objects.get', {
      entityDefinitionId: 'companies',
    });
    const views = await call<Out['views']['list']>('views.list', { entityDefinitionId: companies.id });
    const view = views[0];
    if (!view) throw new Error('no default view');
    const exportId = randomUUID();
    const created = await call<Out['exports']['create']>('exports.create', {
      exportId,
      viewId: view.id,
      format: 'csv',
      locale: 'ru-RU',
      timeZone: 'Europe/Moscow',
    });
    expect(created).toMatchObject({
      exportId,
      export: { status: 'pending', locale: 'ru-RU' },
      seq: expect.any(String),
    });
    expect(await queued('export.run', exportId)).toBe(1);
    const notReady = await trpcError(call('exports.downloadUrl', { exportId }));
    expect(notReady.status).toBe(409);
    await h.domain.exports.execute(workspaceId, exportId);
    const status = await call<Out['exports']['status']>('exports.status', { exportId });
    expect(status).toMatchObject({ status: 'complete', progress: 100, rowCount: 3 });
    const link = await call<Out['exports']['downloadUrl']>('exports.downloadUrl', { exportId });
    expect(link.fileName).toBe(`Companies - ${view.title}.csv`);
    const text = await (await fetch(link.url)).text();
    expect(text.replace(/^﻿/, '').split('\r\n')[0]).toMatch(/^Record ID,Name/);
  });
});
