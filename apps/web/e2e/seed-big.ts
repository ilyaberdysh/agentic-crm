// Seeds a large custom object for table tests and performance runs (acceptance 2; S2-TABLE perf notes):
// `<count>` records with 10 attribute types and a table view, written through the domain services  with a few
// parallel transactions. Idempotent per slug (stable record ids; re-runs only fill what is missing).
// pnpm --filter @agentic-crm/api exec tsx../web/e2e/seed-big.ts --db agentic_crm_test_s2table --slug big_records --count 12000
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import type { AttributeDefinition, CreateAttributeInput, ValuesMap } from '@agentic-crm/contracts';
import { createDb, sql } from '@agentic-crm/db';
import { createDomain, memberContext } from '@agentic-crm/domain';
import { databaseUrl, E2E_DATABASE, E2E_USER, WORKSPACE_SLUG } from './env.ts';

const { values: args } = parseArgs({
  options: {
    db: { type: 'string', default: E2E_DATABASE },
    slug: { type: 'string', default: 'big_records' },
    singular: { type: 'string', default: 'Big record' },
    plural: { type: 'string', default: 'Big records' },
    count: { type: 'string', default: '12000' },
    concurrency: { type: 'string', default: '8' },
  },
});

const count = Number(args.count);
const slug = args.slug as string;
const database = createDb({ connectionString: databaseUrl(args.db as string), max: 10, applicationName: 'seed-big' });
const domain = createDomain({ database });

function stableId(workspaceId: string, key: string): string {
  const h = createHash('sha256').update(`agentic-crm-big:${workspaceId}:${key}`).digest('hex');
  const variant = ((Number.parseInt(h[16] as string, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const STAGES = ['Lead', 'Qualified', 'Proposal', 'Won', 'Lost'];
const TAGS = ['Alpha', 'Beta', 'Gamma', 'Delta'];
const WORDS = ['north', 'blue', 'cedar', 'orbit', 'quartz', 'helios', 'pine', 'atlas', 'river', 'ember', 'nova', 'zen'];

try {
  const { rows } = await sql<{ id: string }>`SELECT id FROM users WHERE email = ${E2E_USER.email}`.execute(
    database.kysely,
  );
  const userId = rows[0]?.id;
  const resolution = userId ? await domain.workspaces.resolveForUser(userId, { slug: WORKSPACE_SLUG }) : null;
  if (!resolution || resolution.status !== 'ok')
    throw new Error(`workspace "${WORKSPACE_SLUG}" not found for ${E2E_USER.email}`);
  const workspaceId = resolution.workspace.id;
  const ctx = memberContext(workspaceId, resolution.membership.id);
  const ids = (key: string) => stableId(workspaceId, `${slug}:${key}`);

  const object = await domain.schema.createObject(ctx, {
    id: ids('object'),
    apiSlug: slug,
    singularNoun: args.singular as string,
    pluralNoun: args.plural as string,
    icon: 'box',
  });
  const specs: Omit<CreateAttributeInput, 'id' | 'entityDefinitionId'>[] = [
    { apiSlug: 'name', title: 'Name', type: 'text' },
    { apiSlug: 'code', title: 'Code', type: 'text' },
    {
      apiSlug: 'amount',
      title: 'Amount',
      type: 'currency',
      currencyConfiguration: {
        defaultCurrencyCode: 'EUR',
        defaultDisplayType: 'symbol',
        defaultDecimalPlaces: 'two-decimals',
        defaultGroups: 'default',
      },
    },
    { apiSlug: 'score', title: 'Score', type: 'number' },
    { apiSlug: 'active', title: 'Active', type: 'checkbox' },
    { apiSlug: 'due', title: 'Due date', type: 'date' },
    { apiSlug: 'rating', title: 'Rating', type: 'rating' },
    {
      apiSlug: 'stage',
      title: 'Stage',
      type: 'pipeline',
      stages: STAGES.map((title) => ({ id: ids(`stage:${title}`), title })),
    },
    {
      apiSlug: 'tag',
      title: 'Tag',
      type: 'select',
      options: TAGS.map((title) => ({ id: ids(`tag:${title}`), title })),
    },
    { apiSlug: 'notes', title: 'Notes', type: 'text' },
  ];
  const attrs = new Map<string, AttributeDefinition>();
  for (const spec of specs) {
    attrs.set(
      spec.apiSlug as string,
      await domain.schema.createAttribute(ctx, {
        ...spec,
        id: ids(`attr:${spec.apiSlug}`),
        entityDefinitionId: object.id,
        description: '',
      }),
    );
  }
  const path = (a: string) => [
    { entityDefinitionId: object.id, attributeDefinitionId: (attrs.get(a) as AttributeDefinition).id },
  ];
  await domain.views.create(ctx, {
    id: ids('view'),
    entityDefinitionId: object.id,
    type: 'table',
    title: `All ${args.plural as string}`,
    columns: ['code', 'amount', 'score', 'active', 'due', 'rating', 'stage', 'tag', 'notes'].map((a) => ({
      id: ids(`column:${a}`),
      path: path(a),
    })),
    sorts: [],
  });

  const started = Date.now();
  let created = 0;
  let next = 0;
  const worker = async () => {
    while (next < count) {
      const i = next++;
      const n = String(i + 1).padStart(5, '0');
      const values: ValuesMap = {
        name: [{ value: `${WORDS[i % WORDS.length]} ${WORDS[(i * 7) % WORDS.length]} ${n}` }],
        code: [{ value: `BIG-${n}` }],
        amount: [{ value: { currencyValue: ((i * 37) % 1000) * 100 } }],
        score: [{ value: (i * 13) % 101 }],
        active: [{ value: i % 3 === 0 }],
        due: [{ value: `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}` }],
        rating: [{ value: i % 6 }],
        stage: [{ value: { pipelineStageId: ids(`stage:${STAGES[i % STAGES.length]}`) } }],
        tag: [{ value: { selectOptionId: ids(`tag:${TAGS[i % TAGS.length]}`) } }],
        ...(i % 4 === 0
          ? { notes: [{ value: `Row ${n} has a longer note to exercise ellipsis in narrow cells` }] }
          : {}),
      };
      const r = await domain.records.create(ctx, {
        entityDefinitionId: object.id,
        entityInstanceId: ids(`record:${i}`),
        values,
      });
      if (r.created) created += 1;
      if ((i + 1) % 1000 === 0) console.log(`[seed-big] ${i + 1}/${count}`);
    }
  };
  await Promise.all(Array.from({ length: Number(args.concurrency) }, worker));
  console.log(
    `[seed-big] ${slug}: ${created} records created (${count} total) in ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
} finally {
  await database.destroy();
}
