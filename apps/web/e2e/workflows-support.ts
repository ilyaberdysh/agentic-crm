//  e2e helpers: an "Opportunities" object with a number "Amount" attribute, records created through tRPC (they
// trigger "Record created" workflows like UI writes), workflows built through the procedures, and polling helpers.
import type { Page } from '@playwright/test';
import { uuidv7 } from './kanban-support.ts';
import { trpc } from './slice3-support.ts';

export interface Opportunities {
  objectId: string;
  amount: string;
  plural: string;
  singular: string;
}

export async function opportunities(page: Page): Promise<Opportunities> {
  const suffix = Date.now().toString(36).slice(-5);
  const objectId = uuidv7();
  const plural = `Opportunities ${suffix}`;
  const singular = `Opportunity ${suffix}`;
  await trpc(page, 'schema.objects.create', {
    id: objectId,
    apiSlug: `opps_${suffix}`,
    singularNoun: singular,
    pluralNoun: plural,
  });
  const amount = uuidv7();
  await trpc(page, 'schema.attributes.create', {
    id: amount,
    entityDefinitionId: objectId,
    title: 'Amount',
    apiSlug: 'amount',
    type: 'number',
  });
  return { objectId, amount, plural, singular };
}

export async function createOpportunity(page: Page, opp: Opportunities, amount: number): Promise<string> {
  const id = uuidv7();
  await trpc(page, 'records.put', {
    entityDefinitionId: opp.objectId,
    entityInstanceId: id,
    values: { [opp.amount]: [{ value: amount }] },
  });
  return id;
}

export async function poll<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 30_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let last = await fn();
  while (!ok(last)) {
    if (Date.now() > until) throw new Error(`poll timed out; last value: ${JSON.stringify(last).slice(0, 400)}`);
    await new Promise((r) => setTimeout(r, 400));
    last = await fn();
  }
  return last;
}

interface BlockSpec {
  id?: string;
  slug: string;
  config?: Record<string, unknown>;
  position?: { x: number; y: number };
}

/** A workflow built through the procedures: blocks in order, paths as [fromIndex, outcome, toIndex]. */
export async function buildWorkflow(
  page: Page,
  title: string,
  blocks: BlockSpec[],
  paths: [number, string, number][],
): Promise<{ workflowId: string; ids: string[] }> {
  const workflowId = uuidv7();
  await trpc(page, 'workflows.create', { id: workflowId, draftVersionId: uuidv7() });
  await trpc(page, 'workflows.update', { workflowId, title });
  const ids: string[] = [];
  for (const [i, b] of blocks.entries()) {
    const blockId = b.id ?? uuidv7();
    ids.push(blockId);
    await trpc(page, 'workflows.blocks.put', {
      workflowId,
      blockId,
      slug: b.slug,
      position: b.position ?? { x: i * 270, y: 0 },
      config: { type: 'object', entries: b.config ?? {} },
    });
  }
  for (const [from, outcome, to] of paths) {
    await trpc(page, 'workflows.blocks.connect', {
      workflowId,
      sourceBlockId: ids[from],
      outcome,
      targetBlockId: ids[to],
    });
  }
  return { workflowId, ids };
}

export interface RunSummary {
  id: string;
  versionId: string;
  status: string;
  sequenceNumber: number;
}

export async function runsOf(page: Page, workflowId: string): Promise<RunSummary[]> {
  const { runs } = await trpc<{ runs: RunSummary[] }>(page, 'workflows.runs.list', { workflowId, limit: 100 });
  return runs;
}
