// View export (BACKLOG 4.08, acceptance 5): the CSV follows the saved view's filter, sorts and columns (kanban:
// grouping attribute first), values formatted with the one-locale rule; job status, progress and download URL.
import { describe, expect, it } from 'vitest';
import { csvField } from '../src/exports/csv.ts';
import { formatCurrency, formatDateAbsolute, formatNumber, formatTimestampAbsolute } from '../src/exports/format.ts';
import { createWorkspace, expectCode, newId, type TestWorkspace } from './support/harness.ts';
import { dt, jobs, listFixture, projectsFixture } from './support/imports.ts';

async function download(ws: TestWorkspace, exportId: string): Promise<{ text: string; fileName: string }> {
  const { url, fileName } = await dt.exports.downloadUrl(ws.ctx, { exportId });
  const res = await fetch(url);
  expect(res.ok).toBe(true);
  const bytes = new Uint8Array(await res.arrayBuffer());
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  return { text: new TextDecoder().decode(bytes.slice(3)), fileName };
}

const lines = (text: string) => text.split('\r\n').filter((l) => l !== '');

describe('export formatting (server-side formatValue)', () => {
  it('uses one locale for numbers and currency and fixed English date patterns', () => {
    const ru = { locale: 'ru-RU', timeZone: 'Europe/Moscow' };
    const us = { locale: 'en-US', timeZone: 'UTC' };
    expect(formatNumber(1200.5, {}, ru)).toBe('1 200,5');
    expect(formatNumber(1200.5, { decimals: 2 }, us)).toBe('1,200.50');
    expect(formatNumber(1200.5, { grouping: 'no-groups' }, ru)).toBe('1200,5');
    expect(formatCurrency(250000, 'EUR', {}, ru)).toBe('250 000,00 €');
    expect(formatCurrency(250000, 'EUR', {}, us)).toBe('€250,000.00');
    expect(formatCurrency(250000, 'EUR', { display: 'code', decimals: 'no-decimals' }, us)).toBe('EUR 250,000');
    expect(formatDateAbsolute('2026-03-01')).toBe('Mar 1, 2026');
    expect(formatTimestampAbsolute('2026-03-01T09:30:00Z', ru)).toBe('Mar 1st 2026, 12:30pm');
    expect(formatTimestampAbsolute('2026-03-22T00:05:00Z', us)).toBe('Mar 22nd 2026, 12:05am');
  });

  it('quotes CSV fields per RFC 4180', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a, b')).toBe('"a, b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField(' padded')).toBe('" padded"');
  });
});

describe('exports', () => {
  it('exports a saved table view: filter, sorts, columns, locale and time zone', async () => {
    const ws = await createWorkspace();
    const { object, a } = await projectsFixture(ws);
    const tagIds = (
      await dt.schema.listOptions(ws.ctx, { entityDefinitionId: object.id, attributeDefinitionId: a.tags.id })
    ).map((o) => o.id);
    const make = async (
      name: string,
      budget: number,
      active: boolean,
      extra: Record<string, { value: unknown }[]> = {},
    ) => {
      const id = newId();
      await dt.records.create(ws.ctx, {
        entityDefinitionId: object.id,
        entityInstanceId: id,
        values: {
          [a.name.id]: [{ value: name }],
          [a.budget.id]: [{ value: { currencyValue: budget, currencyCode: 'EUR' } }],
          [a.active.id]: [{ value: active }],
          ...extra,
        },
      });
      return id;
    };
    const big = await make('Big, "quoted"', 250000, true, {
      [a.tags.id]: [{ value: { selectOptionId: tagIds[0] } }, { value: { selectOptionId: tagIds[1] } }],
      [a.start.id]: [{ value: '2026-03-01' }],
      [a.kickoff.id]: [{ value: '2026-03-01T09:30:00Z' }],
      [a.owner.id]: [{ value: { referencedActorType: 'workspace-member', referencedActorId: ws.memberId } }],
      [a.headcount.id]: [{ value: 1200.5 }],
    });
    const small = await make('Small', 99.5, true);
    await make('Hidden', 1, false);
    const view = await dt.views.create(ws.ctx, {
      id: newId(),
      entityDefinitionId: object.id,
      title: 'Active projects',
      filter: {
        path: [{ entityDefinitionId: object.id, attributeDefinitionId: a.active.id }],
        mode: 'must',
        constraints: [{ field: 'value', operator: 'eq', value: true }],
      },
      sorts: [{ path: [{ entityDefinitionId: object.id, attributeDefinitionId: a.budget.id }], direction: 'asc' }],
      columns: [
        { path: [{ entityDefinitionId: object.id, attributeDefinitionId: a.budget.id }] },
        {
          path: [{ entityDefinitionId: object.id, attributeDefinitionId: a.headcount.id }],
          title: 'People',
          displayConfiguration: { numberConfiguration: { decimalPlaces: 2 } },
        },
        { path: [{ entityDefinitionId: object.id, attributeDefinitionId: a.tags.id }] },
        { path: [{ entityDefinitionId: object.id, attributeDefinitionId: a.start.id }] },
        { path: [{ entityDefinitionId: object.id, attributeDefinitionId: a.kickoff.id }] },
        { path: [{ entityDefinitionId: object.id, attributeDefinitionId: a.owner.id }] },
      ],
    });
    jobs.take();
    const exportId = newId();
    const created = await dt.exports.create(ws.ctx, {
      exportId,
      viewId: view.id,
      format: 'csv',
      locale: 'ru-RU',
      timeZone: 'Europe/Moscow',
    });
    expect(created.export).toMatchObject({
      status: 'pending',
      progress: 0,
      title: 'Projects - Active projects Export',
      fileName: 'Projects - Active projects.csv',
    });
    expect(jobs.take('export.run')).toEqual([
      { name: 'export.run', data: { workspaceId: ws.workspaceId, exportId }, options: { singletonKey: exportId } },
    ]);
    // Replays return the same export; downloading before completion is refused.
    expect((await dt.exports.create(ws.ctx, { exportId, viewId: view.id })).exportId).toBe(exportId);
    await expectCode(dt.exports.downloadUrl(ws.ctx, { exportId }), 'EXPORT_NOT_READY', 409);

    // The view changes after the export was requested: the export keeps the saved state of the request.
    await dt.views.setFilter(ws.ctx, { viewId: view.id, filter: null });
    const done = await dt.exports.execute(ws.workspaceId, exportId);
    expect(done).toMatchObject({ status: 'complete', progress: 100, rowCount: 2 });
    expect(await dt.exports.execute(ws.workspaceId, exportId)).toMatchObject({ status: 'complete' });

    const { text, fileName } = await download(ws, exportId);
    expect(fileName).toBe('Projects - Active projects.csv');
    expect(lines(text)).toEqual([
      'Record ID,Name,Budget,People,Tags,Start,Kickoff,Owner',
      `${small},Small,"99,50 €",,,,,`,
      `${big},"Big, ""quoted""",250 000 €,"1 200,50","Alpha, Beta","Mar 1, 2026","Mar 1st 2026, 12:30pm",${ws.user.firstName} ${ws.user.lastName}`.replace(
        '250 000 €',
        '"250 000,00 €"',
      ),
    ]);
  });

  it('exports a kanban view with the grouping attribute first, and a list with Entry ID and Record ID', async () => {
    const ws = await createWorkspace();
    const { object, a } = await projectsFixture(ws);
    const stages = await dt.schema.listStages(ws.ctx, {
      entityDefinitionId: object.id,
      attributeDefinitionId: a.status.id,
    });
    const id = newId();
    await dt.records.create(ws.ctx, {
      entityDefinitionId: object.id,
      entityInstanceId: id,
      values: {
        [a.name.id]: [{ value: 'Board item' }],
        [a.status.id]: [{ value: { pipelineStageId: stages[1]?.id } }],
        [a.code.id]: [{ value: 'K-1' }],
      },
    });
    const board = await dt.views.create(ws.ctx, {
      id: newId(),
      entityDefinitionId: object.id,
      type: 'kanban',
      title: 'Board',
      // Kanban settings per the slice-4 contract: card attributes are the view's columns.
      kanban: {
        groupBy: [{ entityDefinitionId: object.id, attributeDefinitionId: a.status.id }],
        cardAttributePaths: [[{ entityDefinitionId: object.id, attributeDefinitionId: a.code.id }]],
      },
    });
    expect(board.kanban?.groupBy).toEqual([{ entityDefinitionId: object.id, attributeDefinitionId: a.status.id }]);
    const e = await dt.exports.create(ws.ctx, { viewId: board.id, locale: 'en-US' });
    await dt.exports.execute(ws.workspaceId, e.exportId);
    expect(lines((await download(ws, e.exportId)).text)).toEqual([
      'Record ID,Name,Status,Code',
      `${id},Board item,Active,K-1`,
    ]);

    // List: Entry ID, the parent's Record ID and name, then the list columns (paths through parent_record too).
    const list = await listFixture(ws);
    const company = newId();
    await dt.records.create(ws.ctx, {
      entityDefinitionId: 'companies',
      entityInstanceId: company,
      values: { name: [{ value: 'Acme' }], domains: [{ value: 'acme.com' }] },
    });
    // Entries are added through the entries service (parent_record is read-only for records.*).
    const stages2 = await dt.schema.listStages(ws.ctx, {
      entityDefinitionId: list.listId,
      attributeDefinitionId: list.stageAttr,
    });
    const added = await dt.entries.add(ws.ctx, {
      listId: list.listId,
      parentRecords: [{ entityDefinitionId: list.companiesId, entityInstanceId: company }],
      values: {
        [list.noteAttr]: [{ value: 'hello' }],
        [list.stageAttr]: [{ value: { pipelineStageId: stages2[1]?.id } }],
      },
      onDuplicate: 'keep',
    });
    const entry = added.entries[0]?.id as string;
    const cAttrs = await dt.schema.listAttributes(ws.ctx, { entityDefinitionId: 'companies' });
    const listView = await dt.views.create(ws.ctx, {
      id: newId(),
      entityDefinitionId: list.listId,
      title: 'All entries',
      columns: [
        { path: [{ entityDefinitionId: list.listId, attributeDefinitionId: list.noteAttr }] },
        {
          path: [
            { entityDefinitionId: list.listId, attributeDefinitionId: list.parentAttr },
            {
              entityDefinitionId: list.companiesId,
              attributeDefinitionId: cAttrs.find((x) => x.apiSlug === 'domains')?.id as string,
            },
          ],
        },
      ],
    });
    const le = await dt.exports.create(ws.ctx, { viewId: listView.id });
    expect(le.export.title).toBe('Pipeline - All entries Export');
    await dt.exports.execute(ws.workspaceId, le.exportId);
    const listFile = await download(ws, le.exportId);
    expect(listFile.fileName).toBe('Pipeline - All entries.csv');
    expect(lines(listFile.text)).toEqual([
      'Entry ID,Record ID,Company,Note,Domains',
      `${entry},${company},Acme,hello,acme.com`,
    ]);

    // A list board: the list's own Stage first, then its card attributes.
    const listBoard = await dt.views.create(ws.ctx, {
      id: newId(),
      entityDefinitionId: list.listId,
      type: 'kanban',
      title: 'Board',
      kanban: {
        groupBy: [{ entityDefinitionId: list.listId, attributeDefinitionId: list.stageAttr }],
        cardAttributePaths: [[{ entityDefinitionId: list.listId, attributeDefinitionId: list.noteAttr }]],
      },
    });
    const lb = await dt.exports.create(ws.ctx, { viewId: listBoard.id });
    await dt.exports.execute(ws.workspaceId, lb.exportId);
    expect(lines((await download(ws, lb.exportId)).text)).toEqual([
      'Entry ID,Record ID,Company,Stage,Note',
      `${entry},${company},Acme,Qualified,hello`,
    ]);
  });

  it('fails with "No records to export" when the view is empty', async () => {
    const ws = await createWorkspace();
    const { object } = await projectsFixture(ws);
    const view = await dt.views.create(ws.ctx, { id: newId(), entityDefinitionId: object.id, title: 'Empty' });
    const e = await dt.exports.create(ws.ctx, { viewId: view.id });
    expect(await dt.exports.execute(ws.workspaceId, e.exportId)).toMatchObject({
      status: 'failed',
      failureReason: 'instance-count-zero',
    });
    expect(await dt.exports.status(ws.ctx, { exportId: e.exportId })).toMatchObject({ status: 'failed' });
  });

  it('round-trips: an exported view imports back as updates by Record ID', async () => {
    const ws = await createWorkspace();
    const { object, a } = await projectsFixture(ws);
    const id = newId();
    await dt.records.create(ws.ctx, {
      entityDefinitionId: object.id,
      entityInstanceId: id,
      values: {
        [a.name.id]: [{ value: 'Round' }],
        [a.budget.id]: [{ value: { currencyValue: 1234.5, currencyCode: 'EUR' } }],
        [a.start.id]: [{ value: '2026-03-01' }],
      },
    });
    const view = await dt.views.create(ws.ctx, {
      id: newId(),
      entityDefinitionId: object.id,
      title: 'All',
      columns: [
        { path: [{ entityDefinitionId: object.id, attributeDefinitionId: a.budget.id }] },
        { path: [{ entityDefinitionId: object.id, attributeDefinitionId: a.start.id }] },
      ],
    });
    const e = await dt.exports.create(ws.ctx, { viewId: view.id, locale: 'ru-RU' });
    await dt.exports.execute(ws.workspaceId, e.exportId);
    const [header, row] = lines((await download(ws, e.exportId)).text);
    const parse = (l: string) =>
      (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? [])
        .map((f) => f.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'))
        .filter((_, i, all) => i < all.length - 1);
    const imported = await dt.imports.create(ws.ctx, {
      entityDefinitionId: object.id,
      fileName: 'export.csv',
      columns: parse(header as string),
      rowCount: 1,
    });
    await dt.imports.uploadRows(ws.ctx, {
      jobId: imported.jobId,
      startRow: 0,
      rows: [parse(row as string)],
      final: true,
    });
    const status = await dt.imports.status(ws.ctx, { jobId: imported.jobId });
    expect(status.properties.map((p) => p.columnIndex)).toEqual([0, 1, 2, 3]);
    expect(status.properties.find((p) => p.columnIndex === 2)?.decimalSeparator).toBe('comma');
    expect(status.properties.find((p) => p.columnIndex === 3)?.dateFormat).toBe('uk');
    expect(status.strategies[0]?.mode).toBe('update');
    const plan = await dt.imports.preview(ws.ctx, { jobId: imported.jobId });
    expect(plan.totals).toMatchObject({ update: 1, fail: 0 });
    const page = await dt.imports.assertions(ws.ctx, { jobId: imported.jobId, strategyIndex: 0 });
    expect(page.rows[0]?.values[a.budget.id]).toEqual([{ currencyValue: 1234.5, currencyCode: 'EUR' }]);
    expect(page.rows[0]?.values[a.start.id]).toEqual(['2026-03-01']);
  });
});
