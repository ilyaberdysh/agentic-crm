// D-03 / BACKLOG 1.07 against the real API, driven through the app's own modules (served by Vite in the page):
// point reads in one frame → one `records.batchGet`; an optimistic value write → per-key pending overlay →
// reconciled from the mutation response; our own realtime echo does not invalidate, someone else's write does.
import { expect, test } from '@playwright/test';
import { WORKSPACE_SLUG } from './env.ts';
import { signIn } from './support.ts';

test('batched reads, optimistic write with reconciliation, echo suppression', async ({ page }) => {
  await signIn(page, `/${WORKSPACE_SLUG}/companies`);
  await expect(page.getByTestId('page-header')).toContainText('Companies');
  // Let the realtime connection subscribe to the workspace.
  await page.waitForTimeout(500);

  const batchCalls: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('records.batchGet')) batchCalls.push(req.url());
  });

  const setup = await page.evaluate(async (slug) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api, getCurrentWorkspace } = await load('/src/data/trpc.ts');
    const workspace = getCurrentWorkspace();
    if (!workspace || workspace.slug !== slug) throw new Error('workspace not set');
    const ctx = { context: { workspaceId: workspace.id, workspaceSlug: workspace.slug } };
    const def = await api.schema.objects.get.query({ entityDefinitionId: 'companies' }, ctx);
    const attrs = await api.schema.attributes.list.query({ entityDefinitionId: def.id }, ctx);
    const name = attrs.find((a: { apiSlug: string }) => a.apiSlug === 'name');
    if (!name) throw new Error('no name attribute');
    const ids: string[] = [];
    for (const label of ['Batch A', 'Batch B']) {
      const id = crypto.randomUUID();
      await api.records.put.mutate(
        { entityDefinitionId: def.id, entityInstanceId: id, values: { [name.id]: [{ value: label }] } },
        ctx,
      );
      ids.push(id);
    }
    return { workspace, defId: def.id, nameId: name.id, ids };
  }, WORKSPACE_SLUG);

  // Two point reads issued in the same frame share one request.
  const headers = await page.evaluate(async ({ workspace, defId, ids }) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { queryClient } = await load('/src/data/queryClient.ts');
    const { recordQuery } = await load('/src/data/records.ts');
    const rows = await Promise.all(
      ids.map((id: string) =>
        queryClient.fetchQuery(recordQuery({ workspace, entityDefinitionId: defId, entityInstanceId: id })),
      ),
    );
    return rows.map((r: { entityInstanceId: string }) => r.entityInstanceId);
  }, setup);
  expect(headers).toEqual(setup.ids);
  expect(batchCalls).toHaveLength(1);

  // Optimistic write: pending immediately, reconciled from the response, overlay gone afterwards.
  const write = await page.evaluate(async ({ workspace, defId, nameId, ids }) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { appQueue, putValue } = await load('/src/data/mutations/index.ts');
    const { valueOverlayKey, keys } = await load('/src/data/keys.ts');
    const { queryClient } = await load('/src/data/queryClient.ts');
    const queue = appQueue();
    const id = ids[0] as string;
    const overlayKey = valueOverlayKey(id, nameId);
    putValue(
      queue,
      { workspace, entityDefinitionId: defId, entityInstanceId: id, attributeDefinitionId: nameId },
      'Renamed A',
      {
        value: 'Batch A',
      },
    );
    const pending = queue.get(overlayKey);
    const started = Date.now();
    while (queue.get(overlayKey) && Date.now() - started < 5000) await new Promise((r) => setTimeout(r, 20));
    const cacheKey = keys.values(workspace.id, defId, nameId, id);
    const cached = queryClient.getQueryData(cacheKey) as { values: Array<{ value: unknown }> } | undefined;
    return {
      pendingValue: pending?.value,
      pendingStatus: pending?.status,
      stillPending: Boolean(queue.get(overlayKey)),
      cachedValues: cached?.values.map((v) => v.value),
      cacheKey,
    };
  }, setup);
  expect(write.pendingValue).toBe('Renamed A');
  expect(['queued', 'inflight']).toContain(write.pendingStatus);
  expect(write.stillPending).toBe(false);
  expect(write.cachedValues).toEqual(['Renamed A']);

  // Our own write echoes back over realtime: already reflected, so the key is not invalidated.
  await page.waitForTimeout(1200);
  const isInvalidated = () =>
    page.evaluate(async (cacheKey) => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { queryClient } = await load('/src/data/queryClient.ts');
      return queryClient.getQueryState(cacheKey)?.isInvalidated ?? null;
    }, write.cacheKey);
  expect(await isInvalidated()).toBe(false);

  // A write by someone else (another session through the API) is newer: the key is invalidated within 1 s.
  const response = await page.request.post('/trpc/values.put', {
    headers: { 'content-type': 'application/json', 'x-workspace-slug': WORKSPACE_SLUG },
    data: {
      entityDefinitionId: setup.defId,
      entityInstanceId: setup.ids[0],
      attributeDefinitionId: setup.nameId,
      attributeValueId: crypto.randomUUID(),
      value: 'Changed elsewhere',
    },
  });
  expect(response.ok()).toBe(true);
  await expect.poll(isInvalidated, { timeout: 1500 }).toBe(true);
});
