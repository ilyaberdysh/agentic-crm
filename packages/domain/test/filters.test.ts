// Filter engine, sorts and footer calculations of slice 2 (C1 filters-sorts-calcs §3–8, attribute-types §3, S1 §9):
// every operator of every attribute type against a fixture whose expected results are computed in JS, history
// ("was") filters, path filters and sorts through record references (up to 5 hops), relative dates in a time zone,
// the UI sentence table (contracts filter-sentences.ts) and every calculation kind.
import {
  type AttributeDefinition,
  type Constraint,
  daysAgo,
  filterFieldsFor,
  leafToSentence,
  type Path,
  type Predicate,
  type PredicateLeaf,
  type Sort,
  sentenceToLeaf,
} from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { beforeAll, describe, expect, it } from 'vitest';
import { memberContext, type ServiceContext } from '../src/index.ts';
import {
  createUser,
  createWorkspace,
  database,
  domain,
  expectCode,
  newId,
  type TestWorkspace,
} from './support/harness.ts';

// ---------------------------------------------------------------------------------------------------------------
// Fixture

type M = 'A' | 'B';
type Co = 'C1' | 'C2';
type Pe = 'P1' | 'P2' | 'P3';
interface Row {
  key: string;
  title: string | null;
  count: number | null;
  price: number | null;
  flag: boolean | null;
  day: number | null; // days from today (UTC)
  at: number | null; // hours from now
  stars: number | null;
  stage: number | null; // index into STAGES (current)
  color: number | null;
  tags: number[];
  owner: M | null;
  watchers: M[];
  company: Co | null;
  contacts: Pe[];
  city: string | null;
  region: string | null;
  country: string | null;
  phones: [string, string][];
}

// biome-ignore format: fixture table
const ROWS: Row[] = [
  { key: 's1', title: 'Alpha Centauri', count: 10, price: 100.5, flag: true, day: -40, at: -480, stars: 5, stage: 0, color: 0, tags: [0, 1], owner: 'A', watchers: ['A', 'B'], company: 'C1', contacts: ['P1', 'P2'], city: 'Berlin', region: 'Berlin', country: 'DE', phones: [['+4915112345678', 'DE']] },
  { key: 's2', title: 'beta Orionis', count: 20, price: 2000, flag: false, day: -10, at: -50, stars: 3, stage: 1, color: 1, tags: [1], owner: 'B', watchers: ['B'], company: 'C2', contacts: ['P3'], city: 'München', region: 'Bavaria', country: 'DE', phones: [['+12025550101', 'US'], ['+4930123456', 'DE']] },
  { key: 's3', title: 'Gamma Ray', count: -5, price: 0, flag: true, day: -3, at: -2, stars: 0, stage: 2, color: 2, tags: [2], owner: 'A', watchers: [], company: 'C1', contacts: [], city: 'Paris', region: 'Île-de-France', country: 'FR', phones: [] },
  { key: 's4', title: 'delta 50% off', count: 0, price: null, flag: null, day: 0, at: 3, stars: null, stage: 3, color: null, tags: [], owner: null, watchers: [], company: null, contacts: ['P1'], city: 'Zürich', region: null, country: 'CH', phones: [['+41441234567', 'CH']] },
  { key: 's5', title: 'Épsilon', count: 3.5, price: 999.99, flag: false, day: 2, at: 120, stars: 1, stage: null, color: 0, tags: [0, 1, 2], owner: 'B', watchers: ['A'], company: 'C2', contacts: ['P1', 'P2', 'P3'], city: null, region: null, country: null, phones: [] },
  { key: 's6', title: null, count: null, price: null, flag: true, day: 10, at: null, stars: 2, stage: 0, color: 1, tags: [0], owner: 'A', watchers: ['A'], company: null, contacts: [], city: 'Berlin', region: null, country: 'DE', phones: [] },
  { key: 's7', title: 'zeta_under', count: 1_000_000, price: 5, flag: false, day: null, at: -720, stars: 4, stage: 1, color: 2, tags: [], owner: null, watchers: ['B'], company: 'C1', contacts: ['P2'], city: 'New York', region: 'NY', country: 'US', phones: [['+12125550199', 'US']] },
  { key: 's8', title: 'Eta', count: 7, price: 70, flag: true, day: -1, at: -30, stars: null, stage: 2, color: 0, tags: [2], owner: 'B', watchers: [], company: null, contacts: [], city: null, region: 'Texas', country: 'US', phones: [] },
  { key: 's9', title: 'theta', count: 42, price: 42, flag: null, day: -400, at: -9600, stars: 5, stage: 3, color: null, tags: [1, 2], owner: 'A', watchers: ['A', 'B'], company: 'C2', contacts: ['P3'], city: 'Austin', region: 'Texas', country: 'US', phones: [['+447911123456', 'GB']] },
  { key: 's10', title: 'Iota', count: 1, price: 1, flag: false, day: 5, at: 480, stars: null, stage: null, color: null, tags: [], owner: null, watchers: [], company: null, contacts: [], city: null, region: null, country: null, phones: [] },
];
const STAGES = ['Lead', 'Doing', 'Won', 'Lost'];
const COLORS = ['Red', 'Green', 'Blue'];
const TAGS = ['alpha', 'beta', 'gamma'];

let ws: TestWorkspace;
let ctxB: ServiceContext;
let objectId: string;
const attr: Record<string, AttributeDefinition> = {};
const stageIds: string[] = [];
const colorIds: string[] = [];
const tagIds: string[] = [];
const member: Record<M, string> = { A: '', B: '' };
const company: Record<Co | 'C3', string> = { C1: '', C2: '', C3: '' };
const person: Record<Pe, string> = { P1: '', P2: '', P3: '' };
const ids: Record<string, string> = {};
const people: Record<string, AttributeDefinition> = {};
const companies: Record<string, AttributeDefinition> = {};
let peopleId: string;
let companiesId: string;
let nowMs: number;

const todayUtc = () => new Date().toISOString().slice(0, 10);
const dateOffset = (days: number) =>
  new Date(Date.parse(`${todayUtc()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const localDay = (ms: number, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(ms),
  );

beforeAll(async () => {
  ws = await createWorkspace();
  member.A = ws.memberId;
  const bob = await createUser('Bob', 'Builder');
  await domain.invites.create(ws.ctx, { invites: [{ emailAddress: bob.emailAddress }] });
  member.B = (await domain.invites.accept(bob, { workspaceId: ws.workspaceId })).membership.id;
  ctxB = memberContext(ws.workspaceId, member.B);

  const listAttrs = async (slug: string, into: Record<string, AttributeDefinition>) => {
    for (const a of await domain.schema.listAttributes(ws.ctx, { entityDefinitionId: slug })) into[a.apiSlug] = a;
    return (await domain.schema.getObject(ws.ctx, slug)).id;
  };
  peopleId = await listAttrs('people', people);
  companiesId = await listAttrs('companies', companies);

  objectId = (
    await domain.schema.createObject(ws.ctx, {
      id: newId(),
      apiSlug: 'specimens',
      singularNoun: 'Specimen',
      pluralNoun: 'Specimens',
    })
  ).id;
  const create = async (title: string, type: string, extra: Record<string, unknown> = {}) => {
    const a = await domain.schema.createAttribute(ws.ctx, {
      id: newId(),
      entityDefinitionId: objectId,
      title,
      type: type as never,
      ...extra,
    });
    attr[a.apiSlug] = a;
  };
  await create('Title', 'text');
  await create('Count', 'number');
  await create('Price', 'currency', { currencyConfiguration: { defaultCurrencyCode: 'EUR' } });
  await create('Flag', 'checkbox');
  await create('Day', 'date');
  await create('At', 'timestamp');
  await create('Stars', 'rating');
  await create('Stage', 'pipeline', {
    stages: [
      { title: 'Lead', lifecyclePhase: 'ACTIVE' },
      { title: 'Doing', lifecyclePhase: 'ACTIVE' },
      { title: 'Won', lifecyclePhase: 'WON' },
      { title: 'Lost', lifecyclePhase: 'LOST' },
    ],
  });
  await create('Color', 'select', { options: COLORS.map((title) => ({ title })) });
  await create('Tags', 'select', { isMultiselect: true, options: TAGS.map((title) => ({ title })) });
  await create('Owner', 'actor-reference');
  await create('Watchers', 'actor-reference', { isMultiselect: true });
  await create('Company', 'entity-reference', {
    entityReferenceConfiguration: { allowedEntityDefinitionIds: [companiesId] },
  });
  await create('Contacts', 'entity-reference', {
    isMultiselect: true,
    entityReferenceConfiguration: { allowedEntityDefinitionIds: [peopleId] },
  });
  await create('Place', 'location');
  await create('Phones', 'phone-number', { isMultiselect: true });
  const ref = { entityDefinitionId: objectId };
  stageIds.push(
    ...(await domain.schema.listStages(ws.ctx, { ...ref, attributeDefinitionId: 'stage' })).map((s) => s.id),
  );
  colorIds.push(
    ...(await domain.schema.listOptions(ws.ctx, { ...ref, attributeDefinitionId: 'color' })).map((s) => s.id),
  );
  tagIds.push(...(await domain.schema.listOptions(ws.ctx, { ...ref, attributeDefinitionId: 'tags' })).map((s) => s.id));

  // Companies and people (relationship company ↔ team), with emails, phones, domains and interactions.
  company.C1 = newId();
  company.C2 = newId();
  company.C3 = newId();
  await domain.records.create(ws.ctx, {
    entityDefinitionId: 'companies',
    entityInstanceId: company.C1,
    values: {
      name: [{ value: 'Acme Corp' }],
      domains: [{ value: 'acme.com' }],
      funding_raised_usd: [{ value: { currencyValue: 1000 } }],
    },
  });
  await domain.records.create(ws.ctx, {
    entityDefinitionId: 'companies',
    entityInstanceId: company.C2,
    values: {
      name: [{ value: 'Globex' }],
      domains: [{ value: 'globex.io' }],
      funding_raised_usd: [{ value: { currencyValue: 500 } }],
    },
  });
  await domain.records.create(ws.ctx, {
    entityDefinitionId: 'companies',
    entityInstanceId: company.C3,
    values: { name: [{ value: 'Initech' }] },
  });
  const pdata: [Pe, string, string, string | null, Co][] = [
    ['P1', 'Ada', 'Lovelace', 'ada@acme.com', 'C1'],
    ['P2', 'Grace', 'Hopper', 'grace@globex.io', 'C2'],
    ['P3', 'Alan', 'Turing', null, 'C1'],
  ];
  for (const [key, first, last, email, co] of pdata) {
    person[key] = newId();
    await domain.records.create(ws.ctx, {
      entityDefinitionId: 'people',
      entityInstanceId: person[key],
      values: {
        name: [{ value: { firstName: first, lastName: last, fullName: `${first} ${last}` } }],
        email_addresses: email ? [{ value: email }] : [],
        company: [{ value: { entityInstanceId: company[co] } }],
      },
    });
  }
  nowMs = Date.now();
  await domain.records.update(ws.sys, {
    entityDefinitionId: 'companies',
    entityInstanceId: company.C1,
    values: {
      last_interaction: [
        {
          value: {
            interactionType: 'email',
            interactedAt: new Date(nowMs - 3 * 86_400_000).toISOString(),
            ownerMembershipId: member.A,
          },
        },
      ],
    },
  });
  await domain.records.update(ws.sys, {
    entityDefinitionId: 'companies',
    entityInstanceId: company.C2,
    values: {
      last_interaction: [
        { value: { interactionType: 'meeting', interactedAt: new Date(nowMs - 40 * 86_400_000).toISOString() } },
      ],
    },
  });

  // Status history: [stage written first, …, current]; `null` = cleared.
  const history: Record<string, (number | null)[]> = { s1: [2, 0], s2: [0, 1], s3: [0, 1, 2], s5: [1, null] };
  for (const r of ROWS) {
    const id = newId();
    ids[r.key] = id;
    const seq = history[r.key] ?? [r.stage];
    const first = seq[0] ?? null;
    const v: Record<string, { value: unknown }[]> = {
      title: r.title === null ? [] : [{ value: r.title }],
      count: r.count === null ? [] : [{ value: r.count }],
      price: r.price === null ? [] : [{ value: { currencyValue: r.price } }],
      flag: r.flag === null ? [] : [{ value: r.flag }],
      day: r.day === null ? [] : [{ value: dateOffset(r.day) }],
      at: r.at === null ? [] : [{ value: new Date(nowMs + r.at * 3_600_000).toISOString() }],
      stars: r.stars === null ? [] : [{ value: r.stars }],
      stage: first === null ? [] : [{ value: { pipelineStageId: stageIds[first] } }],
      color: r.color === null ? [] : [{ value: { selectOptionId: colorIds[r.color] } }],
      tags: r.tags.map((t) => ({ value: { selectOptionId: tagIds[t] } })),
      owner: r.owner
        ? [{ value: { referencedActorType: 'workspace-member', referencedActorId: member[r.owner] } }]
        : [],
      watchers: r.watchers.map((m) => ({
        value: { referencedActorType: 'workspace-member', referencedActorId: member[m] },
      })),
      company: r.company ? [{ value: { entityInstanceId: company[r.company] } }] : [],
      contacts: r.contacts.map((p) => ({ value: { entityInstanceId: person[p] } })),
      place:
        r.city || r.region || r.country
          ? [{ value: { locality: r.city, region: r.region, countryCode: r.country } }]
          : [],
      phones: r.phones.map(([n, cc]) => ({ value: { originalPhoneNumber: n, countryCode: cc } })),
    };
    await domain.records.create(ws.ctx, { entityDefinitionId: objectId, entityInstanceId: id, values: v });
    for (const next of seq.slice(1)) {
      await domain.records.update(ws.ctx, {
        entityDefinitionId: objectId,
        entityInstanceId: id,
        values: { stage: next === null ? [] : [{ value: { pipelineStageId: stageIds[next] } }] },
      });
    }
  }
  // Backdate retired stage values: entered 60 days ago, left 30 days ago (s3's "Doing": 20 → 10 days ago).
  await sql`UPDATE attribute_values SET active_from = now() - interval '60 days', active_until = now() - interval '30 days'
    WHERE attribute_id = ${attr.stage?.id}::uuid AND active_until IS NOT NULL`.execute(database.kysely);
  await sql`UPDATE attribute_values SET active_from = now() - interval '20 days', active_until = now() - interval '10 days'
    WHERE attribute_id = ${attr.stage?.id}::uuid AND instance_id = ${ids.s3}::uuid AND v_ref = ${stageIds[1]}::uuid`.execute(
    database.kysely,
  );
}, 120_000);

// ---------------------------------------------------------------------------------------------------------------
// Helpers

const p = (slug: string): Path => [{ entityDefinitionId: objectId, attributeDefinitionId: attr[slug]?.id as string }];
const c = (field: string, operator: Constraint['operator'], value?: unknown, dynamic = false): Constraint => ({
  field,
  operator,
  ...(value === undefined ? {} : { value }),
  valueType: dynamic ? 'dynamic' : 'static',
});
const L = (
  path: Path | string,
  mode: 'must' | 'must-not',
  constraints: Constraint[],
  history = false,
): PredicateLeaf => ({
  path: typeof path === 'string' ? p(path) : path,
  mode,
  constraints,
  ...(history ? { history: true } : {}),
});
const must = (path: Path | string, ...cs: Constraint[]) => L(path, 'must', cs);
const mustNot = (path: Path | string, ...cs: Constraint[]) => L(path, 'must-not', cs);
const was = (mode: 'must' | 'must-not', ...cs: Constraint[]) => L('stage', mode, cs, true);

async function keysOf(filter: Predicate, opts: { ctx?: ServiceContext; timeZone?: string; def?: string } = {}) {
  const snap = await domain.views.query(opts.ctx ?? ws.ctx, {
    entityDefinitionId: opts.def ?? objectId,
    filter,
    ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
  });
  const byId = new Map(Object.entries(ids).map(([k, v]) => [v, k]));
  return snap.ids.map((id) => byId.get(id) ?? id).sort();
}
const expected = (fn: (r: Row) => boolean) =>
  ROWS.filter(fn)
    .map((r) => r.key)
    .sort();
const has = <T>(list: T[], v: T) => list.includes(v);
const flagged = (r: Row) => r.flag === true;
const ratingEmpty = (r: Row) => !r.stars;

// ---------------------------------------------------------------------------------------------------------------
// Operators per type

type Case = [name: string, filter: () => Predicate, fn: (r: Row) => boolean];

const CASES: Case[] = [
  // text (norm_key: case- and accent-insensitive; LIKE wildcards literal)
  [
    'text contains',
    () => must('title', c('value', 'contains', 'ALPHA')),
    (r) => !!r.title && norm(r.title).includes('alpha'),
  ],
  [
    'text contains (several)',
    () => must('title', c('value', 'contains', 'eta')),
    (r) => !!r.title && norm(r.title).includes('eta'),
  ],
  [
    'text does not contain',
    () => mustNot('title', c('value', 'contains', 'eta')),
    (r) => !r.title || !norm(r.title).includes('eta'),
  ],
  [
    'text starts with (accent)',
    () => must('title', c('value', 'starts-with', 'eps')),
    (r) => !!r.title && norm(r.title).startsWith('eps'),
  ],
  [
    'text ends with',
    () => must('title', c('value', 'ends-with', 'RAY')),
    (r) => !!r.title && norm(r.title).endsWith('ray'),
  ],
  ['text is', () => must('title', c('value', 'eq', 'GAMMA RAY')), (r) => r.key === 's3'],
  ['text is not', () => mustNot('title', c('value', 'eq', 'gamma ray')), (r) => r.key !== 's3'],
  ['text is empty', () => mustNot('title'), (r) => r.title === null],
  ['text is not empty', () => must('title'), (r) => r.title !== null],
  ['text empty operator', () => must('title', c('value', 'empty')), (r) => r.title === null],
  ['text literal %', () => must('title', c('value', 'contains', '50%')), (r) => r.key === 's4'],
  ['text literal _', () => must('title', c('value', 'contains', '_')), (r) => r.key === 's7'],
  ['text in', () => must('title', c('value', 'in', ['eta', 'IOTA'])), (r) => r.key === 's8' || r.key === 's10'],
  [
    'text with implicit active_until',
    () => must('title', c('value', 'contains', 'alpha'), c('active_until', 'empty', 'null')),
    (r) => r.key === 's1',
  ],
  // number
  ['number is', () => must('count', c('value', 'eq', 10)), (r) => r.count === 10],
  ['number is (decimal, string)', () => must('count', c('value', 'eq', '3.5')), (r) => r.count === 3.5],
  ['number is not', () => mustNot('count', c('value', 'eq', 10)), (r) => r.count !== 10],
  ['number less than', () => must('count', c('value', 'lt', 0)), (r) => r.count !== null && r.count < 0],
  ['number greater than', () => must('count', c('value', 'gt', 100)), (r) => r.count !== null && r.count > 100],
  ['number gte', () => must('count', c('value', 'gte', 7)), (r) => r.count !== null && r.count >= 7],
  ['number lte', () => must('count', c('value', 'lte', 1)), (r) => r.count !== null && r.count <= 1],
  [
    'number range in one leaf',
    () => must('count', c('value', 'gte', 1), c('value', 'lt', 20)),
    (r) => r.count !== null && r.count >= 1 && r.count < 20,
  ],
  ['number in', () => must('count', c('value', 'in', [0, 42])), (r) => r.count === 0 || r.count === 42],
  ['number is empty', () => mustNot('count'), (r) => r.count === null],
  ['number is not empty', () => must('count'), (r) => r.count !== null],
  // currency (raw_value; code ignored)
  ['currency greater than', () => must('price', c('raw_value', 'gt', 100)), (r) => r.price !== null && r.price > 100],
  ['currency less than', () => must('price', c('raw_value', 'lt', 1)), (r) => r.price !== null && r.price < 1],
  ['currency is (value alias)', () => must('price', c('value', 'eq', 0)), (r) => r.price === 0],
  ['currency is (currency_value alias)', () => must('price', c('currency_value', 'eq', 42)), (r) => r.price === 42],
  ['currency is empty', () => mustNot('price'), (r) => r.price === null],
  [
    'currency range',
    () => must('price', c('raw_value', 'gte', 5), c('raw_value', 'lte', 100.5)),
    (r) => r.price !== null && r.price >= 5 && r.price <= 100.5,
  ],
  // checkbox (no value = false)
  ['checkbox is true', () => must('flag', c('value', 'eq', true)), flagged],
  ['checkbox is false', () => mustNot('flag', c('value', 'eq', 'true')), (r) => !flagged(r)],
  ['checkbox eq false', () => must('flag', c('value', 'eq', false)), (r) => !flagged(r)],
  // date (relative presets resolved server-side, UTC by default)
  ['date before today', () => must('day', c('value', 'lt', 'P0D', true)), (r) => r.day !== null && r.day < 0],
  ['date after today', () => must('day', c('value', 'gt', 'P0D', true)), (r) => r.day !== null && r.day > 0],
  ['date is today', () => must('day', c('value', 'eq', 'P0D', true)), (r) => r.day === 0],
  ['date after one week ago', () => must('day', c('value', 'gt', '-P7D', true)), (r) => r.day !== null && r.day > -7],
  [
    'date before one month ago',
    () => must('day', c('value', 'lt', '-P1M', true)),
    (r) => r.day !== null && r.day <= -40,
  ],
  [
    'date before 5 days ago',
    () => must('day', c('value', 'lt', '-P0Y0M5DT0H0M0S', true)),
    (r) => r.day !== null && r.day < -5,
  ],
  [
    'date before daysAgo(5)',
    () => must('day', c('value', 'lt', daysAgo(5), true)),
    (r) => r.day !== null && r.day < -5,
  ],
  ['date is (exact)', () => must('day', c('value', 'eq', dateOffset(2))), (r) => r.day === 2],
  ['date is not (exact)', () => mustNot('day', c('value', 'eq', dateOffset(2))), (r) => r.day !== 2],
  [
    'date in',
    () => must('day', c('value', 'in', [dateOffset(-3), dateOffset(-1)])),
    (r) => r.day === -3 || r.day === -1,
  ],
  ['date is empty', () => mustNot('day'), (r) => r.day === null],
  ['date is not empty', () => must('day', c('value', 'not-empty')), (r) => r.day !== null],
  // timestamp (relative: floored to the hour; "is" a day = the whole local day)
  ['timestamp after now', () => must('at', c('value', 'gt', 'P0D', true)), (r) => r.at !== null && r.at > 0],
  ['timestamp before yesterday', () => must('at', c('value', 'lt', '-P1D', true)), (r) => r.at !== null && r.at < -24],
  [
    'timestamp is today (relative)',
    () => must('at', c('value', 'eq', 'P0D', true)),
    (r) => r.at !== null && localDay(nowMs + r.at * 3_600_000, 'UTC') === todayUtc(),
  ],
  [
    'timestamp is a date (static)',
    () => must('at', c('value', 'eq', todayUtc())),
    (r) => r.at !== null && localDay(nowMs + r.at * 3_600_000, 'UTC') === todayUtc(),
  ],
  [
    'timestamp after a date (static)',
    () => must('at', c('value', 'gt', dateOffset(-1))),
    (r) => r.at !== null && localDay(nowMs + r.at * 3_600_000, 'UTC') > dateOffset(-1),
  ],
  [
    'timestamp before an instant',
    () => must('at', c('value', 'lt', new Date(nowMs - 100 * 3_600_000).toISOString())),
    (r) => r.at !== null && r.at < -100,
  ],
  ['timestamp is empty', () => mustNot('at'), (r) => r.at === null],
  // rating (0 counts as empty: must-not value > 0 / must value >= 1)
  ['rating is', () => must('stars', c('value', 'eq', 5)), (r) => r.stars === 5],
  ['rating is not', () => mustNot('stars', c('value', 'eq', 5)), (r) => r.stars !== 5],
  ['rating less than', () => must('stars', c('value', 'lt', 3)), (r) => r.stars !== null && r.stars < 3],
  ['rating greater than', () => must('stars', c('value', 'gt', 3)), (r) => r.stars !== null && r.stars > 3],
  ['rating is empty', () => mustNot('stars', c('value', 'gt', 0)), ratingEmpty],
  ['rating is not empty', () => must('stars', c('value', 'gte', 1)), (r) => !ratingEmpty(r)],
  ['rating is empty (presence)', () => mustNot('stars'), ratingEmpty],
  ['rating is not empty (presence)', () => must('stars'), (r) => !ratingEmpty(r)],
  ['rating empty operator', () => must('stars', c('value', 'empty')), ratingEmpty],
  // status: current
  ['status is', () => must('stage', c('pipeline_stage_id', 'eq', stageIds[0])), (r) => r.stage === 0],
  ['status is not', () => mustNot('stage', c('pipeline_stage_id', 'eq', stageIds[0])), (r) => r.stage !== 0],
  [
    'status in',
    () => must('stage', c('status', 'in', [stageIds[0], stageIds[3]])),
    (r) => r.stage === 0 || r.stage === 3,
  ],
  ['status is empty', () => mustNot('stage'), (r) => r.stage === null],
  [
    'status lifecycle is ACTIVE',
    () => must('stage', c('lifecycle_phase', 'eq', 'ACTIVE')),
    (r) => r.stage === 0 || r.stage === 1,
  ],
  [
    'status lifecycle is not ACTIVE',
    () => mustNot('stage', c('lifecycle_phase', 'eq', 'active')),
    (r) => r.stage !== 0 && r.stage !== 1,
  ],
  [
    'status lifecycle in',
    () => must('stage', c('lifecycle_phase', 'in', ['WON', 'LOST'])),
    (r) => r.stage === 2 || r.stage === 3,
  ],
  [
    'status stage order after Doing',
    () => must('stage', c('stage_sort_order', 'gt', stageIds[1])),
    (r) => r.stage !== null && r.stage > 1,
  ],
  [
    'status time entered after yesterday',
    () => must('stage', c('active_from', 'gt', '-P1D', true)),
    (r) => r.stage !== null,
  ],
  // status: history ("was" / "was not")
  [
    'status was Won',
    () => was('must', c('pipeline_stage_id', 'eq', stageIds[2])),
    (r) => ['s1', 's3', 's8'].includes(r.key),
  ],
  [
    'status was not Won',
    () => was('must-not', c('pipeline_stage_id', 'eq', stageIds[2])),
    (r) => !['s1', 's3', 's8'].includes(r.key),
  ],
  [
    'status was Lead',
    () => was('must', c('value', 'eq', stageIds[0])),
    (r) => ['s1', 's2', 's3', 's6'].includes(r.key),
  ],
  [
    'status was Doing before 15 days ago',
    () => was('must', c('pipeline_stage_id', 'eq', stageIds[1]), c('active_from', 'lt', '-P15D', true)),
    (r) => ['s3', 's5'].includes(r.key),
  ],
  [
    'status was Doing after 15 days ago',
    () => was('must', c('pipeline_stage_id', 'eq', stageIds[1]), c('active_from', 'gt', '-P15D', true)),
    (r) => ['s2', 's7'].includes(r.key),
  ],
  [
    'status was Won before 45 days ago',
    () => was('must', c('pipeline_stage_id', 'eq', stageIds[2]), c('active_from', 'lt', daysAgo(45), true)),
    (r) => r.key === 's1',
  ],
  [
    'status was lifecycle WON',
    () => was('must', c('lifecycle_phase', 'eq', 'WON')),
    (r) => ['s1', 's3', 's8'].includes(r.key),
  ],
  [
    'status was Lead and left it',
    () => was('must', c('pipeline_stage_id', 'eq', stageIds[0]), c('active_until', 'not-empty')),
    (r) => ['s2', 's3'].includes(r.key),
  ],
  [
    'status was any of',
    () => was('must', c('pipeline_stage_id', 'in', [stageIds[1], stageIds[3]])),
    (r) => ['s2', 's3', 's4', 's5', 's7', 's9'].includes(r.key),
  ],
  // select (single)
  ['select is', () => must('color', c('select_option_id', 'eq', colorIds[0])), (r) => r.color === 0],
  ['select is not', () => mustNot('color', c('option', 'eq', colorIds[0])), (r) => r.color !== 0],
  [
    'select any of',
    () => must('color', c('select_option_id', 'in', [colorIds[1], colorIds[2]])),
    (r) => r.color === 1 || r.color === 2,
  ],
  [
    'select none of',
    () => mustNot('color', c('select_option_id', 'in', [colorIds[1], colorIds[2]])),
    (r) => r.color !== 1 && r.color !== 2,
  ],
  ['select is empty', () => mustNot('color'), (r) => r.color === null],
  ['select is not empty', () => must('color'), (r) => r.color !== null],
  [
    'select greater than (option order)',
    () => must('color', c('option_sort_order', 'gt', colorIds[0])),
    (r) => r.color !== null && r.color > 0,
  ],
  [
    'select at most (option order)',
    () => must('color', c('option_sort_order', 'lte', colorIds[1])),
    (r) => r.color !== null && r.color <= 1,
  ],
  // select (multi)
  ['multiselect contains', () => must('tags', c('select_option_id', 'eq', tagIds[0])), (r) => has(r.tags, 0)],
  [
    'multiselect does not contain',
    () => mustNot('tags', c('select_option_id', 'eq', tagIds[0])),
    (r) => !has(r.tags, 0),
  ],
  [
    'multiselect any of',
    () => must('tags', c('select_option_id', 'in', [tagIds[0], tagIds[2]])),
    (r) => has(r.tags, 0) || has(r.tags, 2),
  ],
  [
    'multiselect none of',
    () => mustNot('tags', c('select_option_id', 'in', [tagIds[0], tagIds[2]])),
    (r) => !has(r.tags, 0) && !has(r.tags, 2),
  ],
  [
    'multiselect all of',
    () => must('tags', c('select_option_id', 'all', [tagIds[0], tagIds[1]])),
    (r) => has(r.tags, 0) && has(r.tags, 1),
  ],
  [
    'multiselect all of (other)',
    () => must('tags', c('select_option_id', 'all', [tagIds[1], tagIds[2]])),
    (r) => has(r.tags, 1) && has(r.tags, 2),
  ],
  [
    'multiselect not all of',
    () => mustNot('tags', c('select_option_id', 'all', [tagIds[1], tagIds[2]])),
    (r) => !(has(r.tags, 1) && has(r.tags, 2)),
  ],
  ['multiselect is empty', () => mustNot('tags'), (r) => r.tags.length === 0],
  ['multiselect is not empty', () => must('tags', c('select_option_id', 'not-empty')), (r) => r.tags.length > 0],
  // actor reference (single)
  ['actor is', () => must('owner', c('referenced_actor_id', 'eq', member.A)), (r) => r.owner === 'A'],
  ['actor is not', () => mustNot('owner', c('referenced_actor_id', 'eq', member.A)), (r) => r.owner !== 'A'],
  [
    'actor is current member',
    () => must('owner', c('referenced_actor_id', 'eq', 'current-member', true)),
    (r) => r.owner === 'A',
  ],
  [
    'actor in (with current member)',
    () => must('owner', c('referenced_actor_id', 'in', ['current-member', member.B], true)),
    (r) => r.owner !== null,
  ],
  ['actor is empty', () => mustNot('owner'), (r) => r.owner === null],
  [
    'actor type is member',
    () => must('owner', c('referenced_actor_type', 'eq', 'workspace-member')),
    (r) => r.owner !== null,
  ],
  ['actor type is API token', () => must('owner', c('referenced_actor_type', 'eq', 'api-token')), () => false],
  [
    'actor type is not member',
    () => mustNot('owner', c('referenced_actor_type', 'eq', 'workspace-member')),
    (r) => r.owner === null,
  ],
  // actor reference (multi)
  ['actors contain', () => must('watchers', c('referenced_actor_id', 'eq', member.B)), (r) => has(r.watchers, 'B')],
  [
    'actors contain current member',
    () => must('watchers', c('referenced_actor_id', 'eq', 'current-member', true)),
    (r) => has(r.watchers, 'A'),
  ],
  [
    'actors contain all',
    () => must('watchers', c('referenced_actor_id', 'all', [member.A, member.B])),
    (r) => r.watchers.length === 2,
  ],
  [
    'actors do not contain',
    () => mustNot('watchers', c('referenced_actor_id', 'eq', member.B)),
    (r) => !has(r.watchers, 'B'),
  ],
  ['actors are empty', () => mustNot('watchers'), (r) => r.watchers.length === 0],
  // record reference (single)
  ['record is', () => must('company', c('target_entity_instance_id', 'eq', company.C1)), (r) => r.company === 'C1'],
  [
    'record is (record pair)',
    () =>
      must(
        'company',
        c('target_entity_instance_id', 'eq', company.C1),
        c('target_entity_definition_id', 'eq', companiesId),
      ),
    (r) => r.company === 'C1',
  ],
  ['record is not', () => mustNot('company', c('target_record_id', 'eq', company.C1)), (r) => r.company !== 'C1'],
  [
    'record any of',
    () => must('company', c('target_entity_instance_id', 'in', [company.C1, company.C2])),
    (r) => r.company !== null,
  ],
  ['record is empty', () => mustNot('company'), (r) => r.company === null],
  [
    'record object is (slug)',
    () => must('company', c('target_entity_definition_id', 'eq', 'companies')),
    (r) => r.company !== null,
  ],
  [
    'record object is not',
    () => mustNot('company', c('target_entity_definition_id', 'eq', companiesId)),
    (r) => r.company === null,
  ],
  // record reference (multi)
  [
    'records contain',
    () => must('contacts', c('target_entity_instance_id', 'eq', person.P1)),
    (r) => has(r.contacts, 'P1'),
  ],
  [
    'records contain all',
    () => must('contacts', c('target_entity_instance_id', 'all', [person.P1, person.P2])),
    (r) => has(r.contacts, 'P1') && has(r.contacts, 'P2'),
  ],
  [
    'records contain any',
    () => must('contacts', c('target_entity_instance_id', 'in', [person.P2, person.P3])),
    (r) => has(r.contacts, 'P2') || has(r.contacts, 'P3'),
  ],
  ['records are empty', () => mustNot('contacts'), (r) => r.contacts.length === 0],
  // location sub-fields
  ['city contains (accent)', () => must('place', c('locality', 'contains', 'mün')), (r) => r.city === 'München'],
  ['city is', () => must('place', c('locality', 'eq', 'berlin')), (r) => r.city === 'Berlin'],
  ['city is not', () => mustNot('place', c('locality', 'eq', 'berlin')), (r) => r.city !== 'Berlin'],
  ['city starts with', () => must('place', c('locality', 'starts-with', 'new')), (r) => r.city === 'New York'],
  ['city ends with', () => must('place', c('locality', 'ends-with', 'RICH')), (r) => r.city === 'Zürich'],
  ['city is empty', () => must('place', c('locality', 'empty')), (r) => r.city === null],
  ['city is not empty', () => must('place', c('locality', 'not-empty')), (r) => r.city !== null],
  ['state contains', () => must('place', c('region', 'contains', 'tex')), (r) => r.region === 'Texas'],
  ['state is (accent)', () => must('place', c('region', 'eq', 'ile-de-france')), (r) => r.key === 's3'],
  ['state does not contain', () => mustNot('place', c('region', 'contains', 'tex')), (r) => r.region !== 'Texas'],
  ['country is', () => must('place', c('country_code', 'eq', 'de')), (r) => r.country === 'DE'],
  ['country is not', () => mustNot('place', c('country_code', 'eq', 'DE')), (r) => r.country !== 'DE'],
  [
    'country in',
    () => must('place', c('country_code', 'in', ['US', 'CH'])),
    (r) => r.country === 'US' || r.country === 'CH',
  ],
  ['country is empty', () => must('place', c('country_code', 'empty')), (r) => r.country === null],
  // phone numbers (multi; digits matched without formatting)
  [
    'phone contains digits',
    () => must('phones', c('normalized_phone_number', 'contains', '12-34')),
    (r) => r.phones.some(([n]) => n.includes('1234')),
  ],
  [
    'phone starts with',
    () => must('phones', c('phone_number', 'starts-with', '+1')),
    (r) => r.phones.some(([n]) => n.startsWith('+1')),
  ],
  [
    'phone is (formatted input)',
    () => must('phones', c('normalized_phone_number', 'eq', '+1 (202) 555-0101')),
    (r) => r.key === 's2',
  ],
  ['phone ends with', () => must('phones', c('normalized_phone_number', 'ends-with', '199')), (r) => r.key === 's7'],
  [
    'phone does not contain',
    () => mustNot('phones', c('normalized_phone_number', 'contains', '1234')),
    (r) => !r.phones.some(([n]) => n.includes('1234')),
  ],
  [
    'phone country is',
    () => must('phones', c('country_code', 'eq', 'US')),
    (r) => r.phones.some(([, cc]) => cc === 'US'),
  ],
  [
    'phone number and country of the same value',
    () => must('phones', c('normalized_phone_number', 'starts-with', '+49'), c('country_code', 'eq', 'US')),
    () => false,
  ],
  ['phones are empty', () => mustNot('phones'), (r) => r.phones.length === 0],
  // record id and system attributes
  [
    'record id is',
    () => must([{ entityDefinitionId: objectId, attributeDefinitionId: idAttr() }], c('value', 'eq', ids.s3)),
    (r) => r.key === 's3',
  ],
  [
    'record id in',
    () => must([{ entityDefinitionId: objectId, attributeDefinitionId: idAttr() }], c('value', 'in', [ids.s1, ids.s2])),
    (r) => r.key === 's1' || r.key === 's2',
  ],
  [
    'created by type is member',
    () =>
      must(
        [{ entityDefinitionId: objectId, attributeDefinitionId: sysAttr('created_by') }],
        c('referenced_actor_type', 'eq', 'workspace-member'),
      ),
    () => true,
  ],
  [
    'created by is current member',
    () =>
      must(
        [{ entityDefinitionId: objectId, attributeDefinitionId: sysAttr('created_by') }],
        c('referenced_actor_id', 'eq', 'current-member', true),
      ),
    () => true,
  ],
  [
    'created at after yesterday',
    () =>
      must(
        [{ entityDefinitionId: objectId, attributeDefinitionId: sysAttr('created_at') }],
        c('value', 'gt', '-P1D', true),
      ),
    () => true,
  ],
  // path filters through record references
  [
    'path: company name contains',
    () => must(companyPath('name'), c('value', 'contains', 'acme')),
    (r) => r.company === 'C1',
  ],
  [
    'path: company name does not contain',
    () => mustNot(companyPath('name'), c('value', 'contains', 'acme')),
    (r) => r.company !== 'C1',
  ],
  [
    'path: company domain is',
    () => must(companyPath('domains'), c('domain', 'eq', 'https://www.globex.io/')),
    (r) => r.company === 'C2',
  ],
  ['path: company has a domain', () => must(companyPath('domains')), (r) => r.company !== null],
  [
    'path: contact name contains',
    () => must(contactPath('name'), c('full_name', 'contains', 'LOVELACE')),
    (r) => has(r.contacts, 'P1'),
  ],
  [
    'path: contact last name is',
    () => must(contactPath('name'), c('last_name', 'eq', 'hopper')),
    (r) => has(r.contacts, 'P2'),
  ],
  [
    'path: contact email domain is',
    () => must(contactPath('email_addresses'), c('email_domain', 'eq', 'acme.com')),
    (r) => has(r.contacts, 'P1'),
  ],
  [
    'path 2 hops: contact company name is',
    () => must([...contactPath('company'), ...companyHop('name')], c('value', 'eq', 'globex')),
    (r) => has(r.contacts, 'P2'),
  ],
  [
    'path 2 hops: company team contains',
    () => must([...companyPath('team'), ...personHop('record_id')], c('value', 'eq', person.P3)),
    (r) => r.company === 'C1',
  ],
  [
    'path 5 hops: … team name contains turing',
    () => must(fiveHops(), c('full_name', 'contains', 'turing')),
    (r) => r.company === 'C1',
  ],
  [
    'path 5 hops: … team name contains hopper',
    () => must(fiveHops(), c('full_name', 'contains', 'hopper')),
    (r) => r.company === 'C2',
  ],
  [
    'path: company interaction with current member',
    () => must(companyPath('last_interaction'), c('owner_membership_id', 'eq', 'current-member', true)),
    (r) => r.company === 'C1',
  ],
  [
    'path: company was never in an interaction before 7 days ago',
    () => mustNot(companyPath('last_interaction'), c('interacted_at', 'lt', '-P7D', true)),
    (r) => r.company !== 'C2',
  ],
  // nested groups
  [
    'group: (red or gamma) and not owned by B',
    () => ({
      and: [
        {
          or: [
            must('color', c('select_option_id', 'eq', colorIds[0])),
            must('tags', c('select_option_id', 'eq', tagIds[2])),
          ],
        },
        mustNot('owner', c('referenced_actor_id', 'eq', member.B)),
      ],
    }),
    (r) => (r.color === 0 || has(r.tags, 2)) && r.owner !== 'B',
  ],
  [
    'group: three levels',
    () => ({
      or: [
        {
          and: [
            must('flag', c('value', 'eq', true)),
            { or: [must('count', c('value', 'gt', 5)), mustNot('place', c('country_code', 'eq', 'DE'))] },
          ],
        },
        must('title', c('value', 'eq', 'iota')),
      ],
    }),
    (r) => (flagged(r) && ((r.count ?? -Infinity) > 5 || r.country !== 'DE')) || r.key === 's10',
  ],
  ['group: empty and = everything', () => ({ and: [] }), () => true],
  ['group: empty or = nothing', () => ({ or: [] }), () => false],
];

function idAttr(): string {
  return sysAttr('record_id');
}
let objectAttrs: AttributeDefinition[] = [];
function sysAttr(slug: string): string {
  return objectAttrs.find((a) => a.apiSlug === slug)?.id as string;
}
const companyHop = (slug: string): Path => [
  { entityDefinitionId: companiesId, attributeDefinitionId: companies[slug]?.id as string },
];
const personHop = (slug: string): Path => [
  { entityDefinitionId: peopleId, attributeDefinitionId: people[slug]?.id as string },
];
const companyPath = (slug: string): Path => [...p('company'), ...companyHop(slug)];
const contactPath = (slug: string): Path => [...p('contacts'), ...personHop(slug)];
const fiveHops = (): Path => [
  ...p('company'),
  ...companyHop('team'),
  ...personHop('company'),
  ...companyHop('team'),
  ...personHop('name'),
];

describe('filter operators per attribute type', () => {
  beforeAll(async () => {
    objectAttrs = await domain.schema.listAttributes(ws.ctx, { entityDefinitionId: objectId });
  });

  it.each(CASES)('%s', async (_name, filter, fn) => {
    const want = expected(fn);
    expect(await keysOf(filter())).toEqual(want);
  });

  it('resolves current-member for the querying member', async () => {
    const filter = must('owner', c('referenced_actor_id', 'eq', 'current-member', true));
    expect(await keysOf(filter, { ctx: ctxB })).toEqual(expected((r) => r.owner === 'B'));
    // A system actor has no member: matches nothing.
    expect(await keysOf(filter, { ctx: ws.sys })).toEqual([]);
  });

  it('resolves relative dates in the viewer’s time zone', async () => {
    for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Tokyo', 'America/Los_Angeles']) {
      const localToday = localDay(Date.now(), zone);
      expect(await keysOf(must('day', c('value', 'eq', 'P0D', true)), { timeZone: zone })).toEqual(
        expected((r) => r.day !== null && dateOffset(r.day) === localToday),
      );
      expect(await keysOf(must('day', c('value', 'lt', 'P0D', true)), { timeZone: zone })).toEqual(
        expected((r) => r.day !== null && dateOffset(r.day) < localToday),
      );
      expect(await keysOf(must('at', c('value', 'eq', 'P0D', true)), { timeZone: zone })).toEqual(
        expected((r) => r.at !== null && localDay(nowMs + r.at * 3_600_000, zone) === localToday),
      );
      expect(await keysOf(must('at', c('value', 'eq', localToday)), { timeZone: zone })).toEqual(
        expected((r) => r.at !== null && localDay(nowMs + r.at * 3_600_000, zone) === localToday),
      );
    }
    await expectCode(
      keysOf(must('day', c('value', 'lt', 'P0D', true)), { timeZone: 'Mars/Olympus' }),
      'VALIDATION_ERROR',
      400,
    );
  });

  it('filters people and companies on name, email, domain, phone and interaction fields', async () => {
    const q = (def: string, filter: Predicate) =>
      domain.views.query(ws.ctx, { entityDefinitionId: def, filter }).then((s) => s.ids.sort());
    const name = personHop('name');
    expect(await q('people', must(name, c('first_name', 'eq', 'ADA')))).toEqual([person.P1]);
    expect(await q('people', must(name, c('last_name', 'starts-with', 'hop')))).toEqual([person.P2]);
    expect(await q('people', must(name, c('full_name', 'contains', 'an tur')))).toEqual([person.P3]);
    expect(await q('people', must(name, c('first_name', 'empty')))).toEqual([]);
    const email = personHop('email_addresses');
    expect(await q('people', must(email, c('normalized_email_address', 'contains', '@ACME')))).toEqual([person.P1]);
    expect(await q('people', must(email, c('email_domain', 'eq', 'Globex.io')))).toEqual([person.P2]);
    expect(await q('people', mustNot(email))).toEqual([person.P3]);
    const domains = companyHop('domains');
    expect(await q('companies', must(domains, c('normalized_domain', 'eq', 'www.acme.com')))).toEqual([company.C1]);
    expect(await q('companies', must(domains, c('normalized_domain', 'ends-with', '.io')))).toEqual([company.C2]);
    expect(await q('companies', mustNot(domains))).toEqual([company.C3]);
    const last = companyHop('last_interaction');
    expect(await q('companies', must(last, c('interacted_at', 'lt', '-P7D', true)))).toEqual([company.C2]);
    expect(await q('companies', must(last, c('interacted_at', 'gt', '-P7D', true)))).toEqual([company.C1]);
    expect(await q('companies', must(last, c('interacted_at', 'empty')))).toEqual([company.C3]);
    expect(await q('companies', must(last, c('owner_membership_id', 'eq', member.A)))).toEqual([company.C1]);
    expect(await q('companies', must(last, c('owner_membership_id', 'empty')))).toEqual(
      [company.C2, company.C3].sort(),
    );
  });

  it('rejects unsupported filters with UNSUPPORTED_FILTER', async () => {
    const bad: Predicate[] = [
      must('count', c('value', 'contains', 'x')),
      must('count', c('nope', 'eq', 1)),
      must('title', c('value', 'eq', 'P1D', true)),
      L('title', 'must', [c('value', 'eq', 'x')], true),
      L('stage', 'must', [c('stage_sort_order', 'eq', stageIds[0])], true),
      must('tags', c('select_option_id', 'all', [])),
      must('tags', c('select_option_id', 'in', 'not-a-list')),
      must('stage', c('lifecycle_phase', 'eq', 'MAYBE')),
      must('owner', c('referenced_actor_type', 'eq', 'robot')),
      must('day', c('value', 'gt', 'yesterday', true)),
      must([...p('title'), ...companyHop('name')], c('value', 'eq', 'x')),
      must([...p('company'), ...personHop('name')], c('value', 'eq', 'x')),
    ];
    for (const filter of bad) await expectCode(keysOf(filter), 'UNSUPPORTED_FILTER', 400);
    // More than five hops never reaches the compiler (contract: paths have at most 5 hops).
    await expect(keysOf(must([...fiveHops(), ...personHop('name')], c('full_name', 'eq', 'x')))).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The UI sentence table compiles on every type, and leaves read back as the same sentence

describe('sentence table', () => {
  it('every sentence of every field compiles, runs and round-trips', async () => {
    const targets: { def: string; a: AttributeDefinition }[] = [
      ...Object.values(attr).map((a) => ({ def: objectId, a })),
      ...['name', 'email_addresses', 'phone_numbers', 'last_interaction', 'company', 'list_entries'].map((s) => ({
        def: peopleId,
        a: people[s] as AttributeDefinition,
      })),
      ...['domains', 'employee_range', 'estimated_arr_usd', 'primary_location', 'created_by', 'created_at'].map(
        (s) => ({ def: companiesId, a: companies[s] as AttributeDefinition }),
      ),
    ];
    const optionsOf = async (a: AttributeDefinition) =>
      a.type === 'pipeline'
        ? (
            await domain.schema.listStages(ws.ctx, {
              entityDefinitionId: a.entityDefinitionId,
              attributeDefinitionId: a.id,
            })
          ).map((o) => o.id)
        : (
            await domain.schema.listOptions(ws.ctx, {
              entityDefinitionId: a.entityDefinitionId,
              attributeDefinitionId: a.id,
            })
          ).map((o) => o.id);
    let checked = 0;
    for (const { def, a } of targets) {
      const fields = filterFieldsFor(a);
      expect(fields.length).toBeGreaterThan(0);
      for (const field of fields) {
        for (const sentence of field.sentences) {
          const firstOption =
            sentence.editor === 'option' || sentence.editor === 'stage' ? (await optionsOf(a))[0] : null;
          const sample: Record<string, [unknown, 'static' | 'dynamic']> = {
            none: [undefined, 'static'],
            text: ['a', 'static'],
            number: [1, 'static'],
            rating: [3, 'static'],
            option: [firstOption, 'static'],
            stage: [firstOption, 'static'],
            lifecycle: ['WON', 'static'],
            record: [a.apiSlug === 'company' ? company.C1 : person.P1, 'static'],
            object: [companiesId, 'static'],
            member: ['current-member', 'dynamic'],
            'actor-type': ['workspace-member', 'static'],
            country: ['DE', 'static'],
            date: ['2026-01-01', 'static'],
            'relative-date': ['-P7D', 'dynamic'],
          };
          const [value, valueType] = sample[sentence.editor] as [unknown, 'static' | 'dynamic'];
          const extra: Constraint[] = sentence.history ? [c('active_from', 'lt', 'P0D', true)] : [];
          const leaf = sentenceToLeaf({
            path: [{ entityDefinitionId: def, attributeDefinitionId: a.id }],
            field,
            sentence,
            value,
            valueType,
            extra,
          });
          await domain.views.query(ws.ctx, { entityDefinitionId: def, filter: leaf });
          const back = leafToSentence(a, leaf);
          expect(back?.sentence.id, `${a.apiSlug} ${field.field} ${sentence.id}`).toBe(sentence.id);
          expect(back?.field.field).toBe(field.field);
          if (!('fixedValue' in sentence) && sentence.operator && sentence.editor !== 'none') {
            expect(back?.value).toEqual(value);
          }
          expect(back?.extra).toEqual(extra);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(150);
  });

  it('offers system-only sentences only where the spec does', () => {
    const ids = (a: AttributeDefinition) => filterFieldsFor(a).flatMap((f) => f.sentences.map((s) => s.id));
    expect(ids(attr.color as AttributeDefinition)).not.toContain('less-than');
    expect(ids(companies.employee_range as AttributeDefinition)).toContain('less-than');
    expect(ids(attr.company as AttributeDefinition)).not.toContain('is-type');
    expect(ids(people.list_entries as AttributeDefinition)).toContain('is-type');
    expect(ids(people.list_entries as AttributeDefinition)).not.toContain('empty');
    expect(ids(attr.stage as AttributeDefinition)).toEqual(expect.arrayContaining(['was', 'was-not']));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Sorts

describe('sorts', () => {
  async function order(sorts: Sort[], filter: Predicate | null = null, def = objectId) {
    const snap = await domain.views.query(ws.ctx, { entityDefinitionId: def, filter, sorts });
    const byId = new Map(Object.entries(ids).map(([k, v]) => [v, k]));
    return snap.ids.map((id) => byId.get(id) ?? id);
  }
  const s = (path: Path | string, direction: 'asc' | 'desc', field?: string): Sort => ({
    path: typeof path === 'string' ? p(path) : path,
    direction,
    ...(field ? { field } : {}),
  });
  /** Expected order: key asc/desc with empty last, ties by record id in the first sort's direction. */
  function want(key: (r: Row) => string | number | null, direction: 'asc' | 'desc', firstDir = direction) {
    const sign = direction === 'asc' ? 1 : -1;
    const tie = firstDir === 'asc' ? 1 : -1;
    return [...ROWS]
      .sort((a, b) => {
        const x = key(a);
        const y = key(b);
        if (x === null && y === null) return ((ids[a.key] as string) < (ids[b.key] as string) ? -1 : 1) * tie;
        if (x === null) return 1;
        if (y === null) return -1;
        if (x !== y) return (x < y ? -1 : 1) * sign;
        return ((ids[a.key] as string) < (ids[b.key] as string) ? -1 : 1) * tie;
      })
      .map((r) => r.key);
  }

  it.each([
    ['number asc', () => s('count', 'asc'), (r: Row) => r.count, 'asc'],
    ['number desc', () => s('count', 'desc'), (r: Row) => r.count, 'desc'],
    ['currency desc', () => s('price', 'desc'), (r: Row) => r.price, 'desc'],
    [
      'text asc (accent- and case-insensitive)',
      () => s('title', 'asc'),
      (r: Row) => (r.title ? norm(r.title) : null),
      'asc',
    ],
    ['date desc', () => s('day', 'desc'), (r: Row) => r.day, 'desc'],
    ['timestamp asc', () => s('at', 'asc'), (r: Row) => r.at, 'asc'],
    ['rating desc', () => s('stars', 'desc'), (r: Row) => r.stars, 'desc'],
    ['status by stage order', () => s('stage', 'asc'), (r: Row) => r.stage, 'asc'],
    ['status by stage order desc', () => s('stage', 'desc', 'stage_sort_order'), (r: Row) => r.stage, 'desc'],
    ['select by option order', () => s('color', 'asc'), (r: Row) => r.color, 'asc'],
    ['multiselect by first option', () => s('tags', 'desc'), (r: Row) => r.tags[0] ?? null, 'desc'],
    ['actor by member name', () => s('owner', 'asc'), (r: Row) => r.owner, 'asc'],
    ['location by city', () => s('place', 'asc', 'locality'), (r: Row) => (r.city ? norm(r.city) : null), 'asc'],
    ['location by country desc', () => s('place', 'desc', 'country_code'), (r: Row) => r.country, 'desc'],
    ['phone by number', () => s('phones', 'asc'), (r: Row) => r.phones[0]?.[0] ?? null, 'asc'],
    [
      'path: company name asc',
      () => s(companyPath('name'), 'asc'),
      (r: Row) => (r.company ? { C1: 'acme corp', C2: 'globex' }[r.company] : null),
      'asc',
    ],
    [
      'path: company name desc',
      () => s(companyPath('name'), 'desc'),
      (r: Row) => (r.company ? { C1: 'acme corp', C2: 'globex' }[r.company] : null),
      'desc',
    ],
    [
      'path: company funding',
      () => s(companyPath('funding_raised_usd'), 'asc'),
      (r: Row) => (r.company ? { C1: 1000, C2: 500 }[r.company] : null),
      'asc',
    ],
    [
      'path 2 hops: first contact’s company name desc',
      () => s([...contactPath('company'), ...companyHop('name')], 'desc'),
      (r: Row) => (r.contacts[0] ? { P1: 'acme corp', P2: 'globex', P3: 'acme corp' }[r.contacts[0]] : null),
      'desc',
    ],
  ] as const)('%s', async (_name, sort, key, dir) => {
    expect(await order([sort()])).toEqual(want(key, dir));
  });

  it('checkbox sorts unchecked (and unset) first', async () => {
    const got = await order([s('flag', 'asc')]);
    expect(got.slice(0, 6).sort()).toEqual(expected((r) => !flagged(r)));
    expect(got.slice(6).sort()).toEqual(expected(flagged));
  });

  it('multi-sort: color asc, then count desc', async () => {
    const got = await order([s('color', 'asc'), s('count', 'desc')]);
    const exp = [...ROWS]
      .sort((a, b) => {
        const ca = a.color ?? 99;
        const cb = b.color ?? 99;
        if (ca !== cb) return ca - cb;
        const na = a.count ?? -Infinity;
        const nb = b.count ?? -Infinity;
        if (na !== nb) return nb - na;
        return (ids[a.key] as string) < (ids[b.key] as string) ? -1 : 1;
      })
      .map((r) => r.key);
    expect(got).toEqual(exp);
  });

  it('sorts people by last and first name', async () => {
    const snap = await domain.views.query(ws.ctx, {
      entityDefinitionId: 'people',
      sorts: [{ path: personHop('name'), field: 'last_name', direction: 'asc' }],
    });
    expect(snap.ids).toEqual([person.P2, person.P1, person.P3]); // Hopper, Lovelace, Turing
    const byFirst = await domain.views.query(ws.ctx, {
      entityDefinitionId: 'people',
      sorts: [{ path: personHop('name'), field: 'first_name', direction: 'desc' }],
    });
    expect(byFirst.ids).toEqual([person.P2, person.P3, person.P1]); // Grace, Alan, Ada
  });

  it('rejects unsortable fields and saves sorts as a full array', async () => {
    await expectCode(order([s('company', 'asc')]), 'UNSUPPORTED_SORT', 400);
    await expectCode(order([s('tags', 'asc', 'nope')]), 'UNSUPPORTED_SORT', 400);
    await expectCode(order([s([...p('title'), ...companyHop('name')], 'asc')]), 'UNSUPPORTED_SORT', 400);
    const view = await domain.views.create(ws.ctx, { id: newId(), entityDefinitionId: objectId, title: 'Sorted' });
    const three = await domain.views.setSorts(ws.ctx, {
      viewId: view.id,
      sorts: [s('color', 'asc'), s(companyPath('name'), 'desc'), s('count', 'desc')],
    });
    expect(three.sorts.map((x) => x.path.length)).toEqual([1, 2, 1]);
    const one = await domain.views.setSorts(ws.ctx, { viewId: view.id, sorts: [s('title', 'asc')] });
    expect(one.sorts).toHaveLength(1);
    expect(one.sorts[0]?.id).not.toBe(three.sorts[0]?.id);
    const snap = await domain.views.query(ws.ctx, { entityDefinitionId: objectId, viewId: view.id });
    expect(snap.ids.map((id) => Object.entries(ids).find(([, v]) => v === id)?.[0])).toEqual(
      want((r) => (r.title ? norm(r.title) : null), 'asc'),
    );
    await expectCode(
      domain.views.setSorts(ws.ctx, { viewId: view.id, sorts: [s([...p('title'), ...companyHop('name')], 'asc')] }),
      'UNSUPPORTED_SORT',
      400,
    );
    expect((await domain.views.get(ws.ctx, view.id)).sorts).toHaveLength(1); // a rejected save changes nothing
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Footer calculations

describe('aggregates', () => {
  async function calc(path: Path | string, aggregation: string, filter: Predicate | null = null, field?: string) {
    const snap = await domain.views.query(ws.ctx, { entityDefinitionId: objectId, filter });
    return domain.views.aggregate(ws.ctx, {
      snapshotId: snap.snapshotId,
      path: typeof path === 'string' ? p(path) : path,
      aggregation: aggregation as never,
      ...(field ? { field } : {}),
    });
  }
  const nums = (f: (r: Row) => number | null, rows = ROWS) => rows.map(f).filter((x): x is number => x !== null);
  const round2 = (x: number) => Math.round(x * 100) / 100;

  it('counts and percentages (count/percent empty/filled, checked/unchecked)', async () => {
    const filled = nums((r) => r.count).length;
    expect(await calc('count', 'count_not_empty')).toMatchObject({ value: filled, total: 10, filled });
    expect((await calc('count', 'count_empty')).value).toBe(10 - filled);
    expect((await calc('count', 'percent_empty')).value).toBe(round2(((10 - filled) / 10) * 100));
    expect((await calc('count', 'percent_not_empty')).value).toBe(round2((filled / 10) * 100));
    expect((await calc('count', 'filled')).value).toBe(filled);
    const checked = ROWS.filter(flagged).length;
    expect((await calc('flag', 'count_checked')).value).toBe(checked);
    expect((await calc('flag', 'count_unchecked')).value).toBe(10 - checked);
    expect((await calc('flag', 'percent_checked')).value).toBe(round2((checked / 10) * 100));
    expect((await calc('flag', 'percent_unchecked')).value).toBe(round2(((10 - checked) / 10) * 100));
    expect((await calc('flag', 'count_not_empty')).value).toBe(checked); // checkbox "filled" = checked
    const tagged = ROWS.filter((r) => r.tags.length > 0).length;
    expect((await calc('tags', 'percent_not_empty')).value).toBe(round2((tagged / 10) * 100));
    // Ratings: 0 is empty.
    expect((await calc('stars', 'count_not_empty')).value).toBe(ROWS.filter((r) => !ratingEmpty(r)).length);
    // Percent of 3 rows rounds to two decimals.
    const third = await calc('flag', 'percent_checked', must('color', c('select_option_id', 'eq', colorIds[1])));
    expect(third.total).toBe(2);
    expect((await calc('count', 'percent_not_empty', must('flag', c('value', 'eq', true)))).value).toBe(75);
  });

  it('sum, mean, median, min, max on numbers, currency and ratings', async () => {
    const counts = nums((r) => r.count);
    expect((await calc('count', 'sum')).value).toBeCloseTo(
      counts.reduce((a, b) => a + b, 0),
      6,
    );
    expect((await calc('count', 'mean')).value).toBeCloseTo(counts.reduce((a, b) => a + b, 0) / counts.length, 6);
    expect((await calc('count', 'median')).value).toBe(7);
    expect((await calc('count', 'min')).value).toBe(-5);
    expect((await calc('count', 'max')).value).toBe(1_000_000);
    const prices = nums((r) => r.price);
    const sum = await calc('price', 'sum');
    expect(sum.value).toBeCloseTo(
      prices.reduce((a, b) => a + b, 0),
      6,
    );
    expect(sum.currencyCode).toBe('EUR');
    const stars = nums((r) => (r.stars ? r.stars : null));
    expect((await calc('stars', 'sum')).value).toBe(stars.reduce((a, b) => a + b, 0));
    expect((await calc('stars', 'mean')).value).toBeCloseTo(stars.reduce((a, b) => a + b, 0) / stars.length, 6);
    expect((await calc('stars', 'min')).value).toBe(1); // 0 is "no rating"
    // Over a filtered snapshot.
    const red = await calc('count', 'sum', must('color', c('select_option_id', 'eq', colorIds[0])));
    expect(red).toMatchObject({ total: 3, value: 20.5 });
    // No rows: sum 0, mean null.
    const none = must('title', c('value', 'eq', 'nothing matches'));
    expect(await calc('count', 'sum', none)).toMatchObject({ total: 0, value: 0 });
    expect(await calc('count', 'mean', none)).toMatchObject({ total: 0, value: null });
    expect(await calc('count', 'percent_empty', none)).toMatchObject({ total: 0, value: 0 });
  });

  it('earliest / latest on dates and timestamps, unique counts', async () => {
    expect(await calc('day', 'earliest')).toMatchObject({ value: null, valueText: dateOffset(-400) });
    expect((await calc('day', 'latest')).valueText).toBe(dateOffset(10));
    const earliest = (await calc('at', 'earliest')).valueText as string;
    expect(Math.abs(Date.parse(earliest) - (nowMs - 9600 * 3_600_000))).toBeLessThan(1000);
    expect(Date.parse((await calc('at', 'max')).valueText as string)).toBeGreaterThan(nowMs);
    expect((await calc('color', 'count_unique')).value).toBe(3);
    expect((await calc('tags', 'count_unique')).value).toBe(3);
    expect(await calc('tags', 'count_unique')).toMatchObject({ total: 10, filled: 7 });
    expect((await calc('owner', 'count_unique')).value).toBe(2);
    expect((await calc('place', 'count_unique', null, 'country_code')).value).toBe(4);
  });

  it('aggregates path columns over the first related record', async () => {
    const filled = await calc(companyPath('name'), 'count_not_empty');
    expect(filled).toMatchObject({ total: 10, value: ROWS.filter((r) => r.company).length });
    const funding = await calc(companyPath('funding_raised_usd'), 'sum');
    expect(funding).toMatchObject({ value: 3 * 1000 + 3 * 500, currencyCode: 'USD' });
  });

  it('re-evaluates the snapshot’s resolved filter (dynamic values fixed at query time)', async () => {
    // B's snapshot of "owner is current member", aggregated by A, still describes B's rows.
    const snap = await domain.views.query(ctxB, {
      entityDefinitionId: objectId,
      filter: must('owner', c('referenced_actor_id', 'eq', 'current-member', true)),
    });
    const agg = await domain.views.aggregate(ws.ctx, {
      snapshotId: snap.snapshotId,
      path: p('count'),
      aggregation: 'sum',
    });
    const bRows = ROWS.filter((r) => r.owner === 'B');
    expect(agg.total).toBe(bRows.length);
    expect(agg.value).toBeCloseTo(
      nums((r) => r.count, bRows).reduce((a, b) => a + b, 0),
      6,
    );
  });

  it('rejects kinds that do not fit the type', async () => {
    await expectCode(calc('title', 'sum'), 'VALIDATION_ERROR', 400);
    await expectCode(calc('count', 'count_checked'), 'VALIDATION_ERROR', 400);
    await expectCode(calc('count', 'earliest'), 'VALIDATION_ERROR', 400);
    await expectCode(calc('tags', 'sum'), 'VALIDATION_ERROR', 400);
    await expectCode(calc([...p('title'), ...companyHop('name')], 'count_not_empty'), 'VALIDATION_ERROR', 400);
  });
});
