// "Export view as CSV": the export follows the *saved* view — its
// filter (Strategic and Code starting with "SEED-0"), its sorts (Headcount, descending) and its columns in order —
// shows the progress toast and downloads "<Object> - <View>.csv". Unsaved draft changes are not exported.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { projectsSchema } from './imports-support.ts';
import { signedInPage, trpc, uuid, ws } from './slice3-support.ts';

test('export view as CSV follows the saved filter, sorts and columns', async ({ browser }) => {
  test.setTimeout(60_000);
  const { context, page } = await signedInPage(browser, ws('home'));
  const projects = await projectsSchema(page);
  const hop = (slug: string) => [
    { entityDefinitionId: projects.id, attributeDefinitionId: projects.attrs[slug] as string },
  ];
  const viewId = uuid();
  const title = `Strategic export ${Date.now().toString(36).slice(-4)}`;
  await trpc(page, 'views.create', {
    id: viewId,
    entityDefinitionId: projects.id,
    type: 'table',
    title,
    filter: {
      and: [
        { path: hop('strategic'), mode: 'must', constraints: [{ field: 'value', operator: 'eq', value: true }] },
        {
          path: hop('code'),
          mode: 'must',
          constraints: [{ field: 'value', operator: 'starts-with', value: 'SEED-0' }],
        },
      ],
    },
    sorts: [{ path: hop('headcount'), direction: 'desc' }],
    columns: [{ path: hop('code') }, { path: hop('headcount'), title: 'People' }, { path: hop('strategic') }],
  });

  await page.goto(ws(`custom/projects/view/${viewId}`));
  await page.getByTestId('import-export-button').click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export view as CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`Projects - ${title}.csv`);
  await expect(page.getByText('Export complete')).toBeVisible();

  const text = readFileSync((await file.path()) as string, 'utf8').replace(/^﻿/, '');
  const [header, ...rows] = text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split(','));
  // Record ID, the record column (Projects have no label attribute: the singular noun), then the view's columns.
  expect(header).toEqual(['Record ID', 'Project', 'Code', 'People', 'Strategic']);
  // Seeded strategic projects by headcount, highest first: SEED-004 (20), 001 (12), 009 (7), 006 (6), 008 (2).
  expect(rows.map((r) => r[2])).toEqual(['SEED-004', 'SEED-001', 'SEED-009', 'SEED-006', 'SEED-008']);
  expect(rows.map((r) => r[3])).toEqual(['20', '12', '7', '6', '2']);
  expect(rows.every((r) => /^[0-9a-f-]{36}$/.test(r[0] as string))).toBe(true);
  await context.close();
});

test('export of an empty view says there is nothing to export', async ({ browser }) => {
  const { context, page } = await signedInPage(browser, ws('home'));
  const projects = await projectsSchema(page);
  const viewId = uuid();
  await trpc(page, 'views.create', {
    id: viewId,
    entityDefinitionId: projects.id,
    type: 'table',
    title: `Nothing ${Date.now().toString(36).slice(-4)}`,
    filter: {
      path: [{ entityDefinitionId: projects.id, attributeDefinitionId: projects.attrs.code as string }],
      mode: 'must',
      constraints: [{ field: 'value', operator: 'eq', value: 'NO-SUCH-CODE' }],
    },
    columns: [{ path: [{ entityDefinitionId: projects.id, attributeDefinitionId: projects.attrs.code as string }] }],
  });
  await page.goto(ws(`custom/projects/view/${viewId}`));
  await page.getByTestId('import-export-button').click();
  await page.getByRole('menuitem', { name: 'Export view as CSV' }).click();
  await expect(page.getByText('No records to export')).toBeVisible();
  await context.close();
});
