import type {
  AttributeDefinition,
  EntityDefinition,
  PipelineStage,
  SelectOption,
  WorkspaceMember,
} from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import { SchemaIndex } from '../../views/schemaIndex';
import { parseCsvText } from '../csv/parse';
import { autoMap, hasUniqueMapping, validateMapping } from '../model/mapping';
import { needsReview } from '../model/resolve';
import { createFakeImportsBackend, type FakeSource } from './fake';

const DEF = '00000000-0000-7000-8000-000000000001';
let seq = 0;
const id = () => `00000000-0000-7000-8000-${String(++seq).padStart(12, '0')}`;

const attr = (apiSlug: string, title: string, over: Partial<AttributeDefinition> = {}): AttributeDefinition =>
  ({
    id: `attr-${apiSlug}`,
    workspaceId: 'w',
    entityDefinitionId: DEF,
    apiSlug,
    title,
    description: '',
    type: 'text',
    isMultiselect: false,
    isUnique: false,
    isRequired: false,
    isHistoric: false,
    isArchived: false,
    isSystem: false,
    systemAttributeType: null,
    isReadOnly: false,
    isHidden: false,
    config: {},
    defaultValue: null,
    relationship: null,
    interfaceAttributeId: null,
    sortOrder: `m${apiSlug}`,
    createdBy: { type: 'system', id: null },
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as AttributeDefinition;

const ATTRS = [
  attr('record_id', 'Record ID', { isSystem: true, systemAttributeType: 'id', isUnique: true, isReadOnly: true }),
  attr('created_at', 'Created at', {
    type: 'timestamp',
    isSystem: true,
    systemAttributeType: 'created-at',
    isReadOnly: true,
  }),
  attr('code', 'Code', { isUnique: true }),
  attr('headcount', 'Headcount', { type: 'number' }),
  attr('tags', 'Tags', { type: 'select', isMultiselect: true }),
  attr('phase', 'Phase', { type: 'pipeline' }),
  attr('start_date', 'Start date', { type: 'date' }),
];

const option = (title: string): SelectOption => ({
  id: `opt-${title}`,
  title,
  workspaceId: 'w',
  entityDefinitionId: DEF,
  attributeDefinitionId: 'attr-tags',
  color: 'pastel_blue',
  sortOrder: 'a',
  isArchived: false,
  createdAt: '',
});

function fixtureSource() {
  const options: SelectOption[] = [option('AI'), option('Data')];
  const stages = [{ ...option('Discovery'), id: 'stage-discovery', lifecyclePhase: 'ACTIVE' } as PipelineStage];
  const records = new Map<string, Record<string, unknown[]>>([['existing-12', { 'attr-code': ['SEED-012'] }]]);
  const writes: string[] = [];
  const definition = { id: DEF, entityType: 'custom-record', singularNoun: 'Project', pluralNoun: 'Projects' };
  const source: FakeSource = {
    memberId: () => 'member-1',
    index: async () => new SchemaIndex([definition as EntityDefinition], new Map([[DEF, ATTRS]])),
    options: async () => options,
    stages: async () => stages,
    members: async () => [] as WorkspaceMember[],
    createOptions: async (_a, titles) => {
      for (const t of titles) options.push(option(t));
    },
    findExisting: async (_a, keys) => {
      const out = new Map<string, string>();
      for (const [rid, values] of records) {
        const code = String(values['attr-code']?.[0] ?? '').toLowerCase();
        if (keys.includes(code)) out.set(code, rid);
      }
      return out;
    },
    findEntries: async () => new Map(),
    createRecord: async (_def, values) => {
      const rid = `new-${records.size}`;
      records.set(rid, values);
      writes.push(`create ${String(values['attr-code']?.[0])}`);
      return rid;
    },
    updateRecord: async (_def, rid, values) => {
      records.set(rid, { ...records.get(rid), ...values });
      writes.push(`update ${rid}`);
    },
    addEntry: async () => 'entry',
    failureOf: () => 'unknown-error',
  };
  return { source, writes, records, options };
}

const CSV = [
  'Code,Headcount,Tags,Phase,Start date,Notes',
  'SEED-I01,4,"AI, Imported",Discovery,14/07/2026,x',
  'SEED-I02,two,Data,Unknown phase,31/12/2026,y',
  'SEED-012,4,,,,',
  ',,,,,',
].join('\n');

async function waitFor(check: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('timeout');
}

describe('fake imports backend', () => {
  it('runs the whole wizard flow', async () => {
    const { source, writes, records } = fixtureSource();
    const backend = createFakeImportsBackend(source);
    const table = parseCsvText(CSV);
    const columns = table.headers.map((title, index) => ({
      index,
      title,
      exampleValues: table.rows.map((r) => r[index] ?? ''),
    }));
    const index = await source.index(DEF, []);
    const mapping = autoMap(columns, index, DEF, id);
    // Notes has no attribute; every other column maps by title, the date column as European.
    expect(mapping.map((m) => m.columnIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(mapping[4]?.config.dateFormat).toBe('uk');
    expect(validateMapping({ mapping, entityDefinitionId: DEF }, index).error).toBeNull();
    expect(hasUniqueMapping({ mapping, entityDefinitionId: DEF }, index)).toBe(true);

    const importId = id();
    const jobId = id();
    const job = await backend.create({
      importId,
      jobId,
      entityDefinitionId: DEF,
      fileName: 'seed.csv',
      fileSize: CSV.length,
      sourceType: 'csv',
      columns,
      rowCount: table.rows.length,
      mapping,
    });
    expect(job.status).toBe('ingesting');
    await backend.uploadRows({ jobId, start: 0, rows: table.rows });
    expect((await backend.status(jobId)).status).toBe('waiting');

    const headcount = mapping[1]?.id as string;
    let review = await backend.reviewValues({ jobId, propertyId: headcount });
    const two = review.values.find((v) => v.raw === 'two');
    expect(two && needsReview(two)).toBe(true);
    expect(review.values.find((v) => v.raw === '4')?.rowCount).toBe(2);
    // Fix "two" → 2 for every row with that raw value.
    review = await backend.setOverride({
      jobId,
      propertyId: headcount,
      hash: two?.hash as string,
      raw: 'two',
      override: { values: [2] },
    });
    expect(review.values.find((v) => v.raw === 'two')?.override).toEqual({ values: [2] });

    const tags = mapping[2]?.id as string;
    review = await backend.reviewValues({ jobId, propertyId: tags });
    expect(review.missingOptions).toEqual(['Imported']);
    review = await backend.createOptions({ jobId, propertyId: tags, values: ['Imported'] });
    expect(review.missingOptions).toEqual([]);

    const plan = await backend.preview({ jobId });
    const root = plan.strategies[0];
    expect(root?.counts).toEqual({ create: 2, update: 1, skip: 0 });
    expect(root?.matchingAttributeId).toBe('attr-code');
    // The unknown phase stays invalid and is listed before the run.
    expect(plan.invalidRows).toEqual([
      { row: 1, reason: 'Phase: "Unknown phase" doesn\'t exist and will not be imported' },
    ]);

    await backend.run(jobId);
    await waitFor(async () => (await backend.status(jobId)).status === 'completed');
    const done = await backend.status(jobId);
    expect(done.statistics[DEF]).toEqual({ created: 2, updated: 1, skipped: 0, failed: 0, canceled: 0 });
    expect(writes).toEqual(['create SEED-I01', 'create SEED-I02', 'update existing-12']);
    expect(records.get('new-1')?.['attr-headcount']).toEqual([4]);
    expect(records.get('new-2')?.['attr-headcount']).toEqual([2]);
    expect(records.get('new-1')?.['attr-tags']).toEqual([
      { selectOptionId: 'opt-AI' },
      { selectOptionId: 'opt-Imported' },
    ]);
    expect(records.get('new-1')?.['attr-start_date']).toEqual(['2026-07-14']);

    const after = await backend.preview({ jobId });
    expect(after.strategies[0]?.rows.map((r) => r.status)).toEqual(['created', 'created', 'updated']);
    await expect(backend.remove(jobId)).rejects.toThrow(/cannot be deleted/);
    expect((await backend.history({})).map((j) => j.importId)).toEqual([importId]);
  });

  it('deletes drafts and cancels', async () => {
    const { source } = fixtureSource();
    const backend = createFakeImportsBackend(source);
    const jobId = id();
    await backend.create({
      importId: id(),
      jobId,
      entityDefinitionId: DEF,
      fileName: 'x.csv',
      fileSize: 1,
      sourceType: 'csv',
      columns: [{ index: 0, title: 'Code', exampleValues: ['A'] }],
      rowCount: 1,
      mapping: [],
    });
    await backend.remove(jobId);
    expect(await backend.history({})).toEqual([]);
  });
});
