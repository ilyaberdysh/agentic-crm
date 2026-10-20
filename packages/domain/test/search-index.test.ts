// Slice 5 record search (BACKLOG 5.01; command-palette §5; decision "Search ranking" in slice5-contracts.md): the
// search index fields (descriptions, handles, locations), ranking tiers with recency tie-break, short queries,
// matched field + highlights, list memberships, requestSeq echo and index maintenance on delete / restore / merge.
import { flagsForScope } from '@agentic-crm/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDomain, type PolicyResolver } from '../src/index.ts';
import { highlightRanges } from '../src/search/service.ts';
import { createWorkspace, database, domain, newId, type TestWorkspace } from './support/harness.ts';

let ws: TestWorkspace;
const rec: Record<string, string> = {};

async function company(key: string, name: string, values: Record<string, unknown[]> = {}) {
  rec[key] = newId();
  await domain.records.create(ws.ctx, {
    entityDefinitionId: 'companies',
    entityInstanceId: rec[key] as string,
    values: { name: [{ value: name }], ...values },
  });
}

async function person(key: string, first: string, last: string, values: Record<string, unknown[]> = {}) {
  rec[key] = newId();
  await domain.records.create(ws.ctx, {
    entityDefinitionId: 'people',
    entityInstanceId: rec[key] as string,
    values: { name: [{ value: { firstName: first, lastName: last, fullName: `${first} ${last}` } }], ...values },
  });
}

const keys = (hits: { entityInstanceId: string }[]) =>
  hits.map((h) => Object.entries(rec).find(([, id]) => id === h.entityInstanceId)?.[0] ?? h.entityInstanceId);

const search = (query: string, extra: Record<string, unknown> = {}) =>
  domain.search.records(ws.ctx, { query, ...extra });

beforeAll(async () => {
  ws = await createWorkspace();
  await company('initech', 'Initech', {
    description: [{ value: 'Makers of TPS report software' }],
    linkedin: [{ value: 'https://www.linkedin.com/company/initech-corp/' }],
    primary_location: [{ value: { locality: 'Austin', region: 'Texas', countryCode: 'US' } }],
    domains: [{ value: 'initech.com' }],
    logo_url: [{ value: 'https://img.example/initech.png' }],
  });
  await company('casanova', 'Casanova');
  await company('superNova', 'Super Nova');
  await company('novaB', 'Nova Beta');
  await company('novaA', 'Nova Alpha');
  await company('nova', 'Nova');
  await person('ada', 'Ada', 'Lovelace', {
    email_addresses: [{ value: 'ada.lovelace@analytical.org' }],
    phone_numbers: [{ value: '+44 20 7946 0958' }],
    twitter: [{ value: '@countess_ada' }],
  });
  await person('ivan', 'Иван', 'Ёлкин', { email_addresses: [{ value: 'ivan@example.ru' }] });
});

describe('search index fields', () => {
  it('matches descriptions, social handles, locations and identifiers with matched field and highlights', async () => {
    const tps = await search('tps');
    expect(keys(tps.hits)).toEqual(['initech']);
    expect(tps.hits[0]).toMatchObject({
      matchedField: 'description',
      matchedValue: 'Makers of TPS report software',
      highlights: [{ start: 10, length: 3 }],
      score: 500,
      subtitle: 'initech.com',
      avatar: 'https://img.example/initech.png',
      domains: ['initech.com'],
    });
    const handle = await search('initech-corp');
    expect(handle.hits[0]).toMatchObject({ entityInstanceId: rec.initech, matchedField: 'handle', score: 1000 });
    const city = await search('austin');
    expect(city.hits[0]).toMatchObject({ entityInstanceId: rec.initech, matchedField: 'location' });
    const twitter = await search('countess_ada');
    expect(twitter.hits[0]).toMatchObject({ entityInstanceId: rec.ada, matchedField: 'handle', score: 1000 });

    const email = await search('ada.love');
    expect(email.hits[0]).toMatchObject({
      entityInstanceId: rec.ada,
      matchedField: 'email',
      matchedValue: 'ada.lovelace@analytical.org',
      highlights: [{ start: 0, length: 8 }],
      score: 800,
      emailAddresses: ['ada.lovelace@analytical.org'],
      phoneNumbers: ['+442079460958'],
    });
    const phone = await search('020 7946');
    expect(phone.hits[0]).toMatchObject({ entityInstanceId: rec.ada, matchedField: 'phone' });
    expect(phone.hits[0]?.highlights).toEqual([{ start: 3, length: 6 }]); // "207946" inside "+442079460958"
    const word = await search('analytical');
    expect(word.hits[0]).toMatchObject({ entityInstanceId: rec.ada, matchedField: 'email', score: 600 });
  });

  it('folds case and accents (Cyrillic included) and highlights the original characters', async () => {
    const hits = (await search('елкин')).hits;
    expect(hits[0]).toMatchObject({
      entityInstanceId: rec.ivan,
      title: 'Иван Ёлкин',
      matchedField: 'name',
      highlights: [{ start: 5, length: 5 }],
      score: 600,
    });
    expect(highlightRanges('Müller & Söhne', ['sohne'])).toEqual([{ start: 9, length: 5 }]);
  });
});

describe('ranking', () => {
  it('orders exact > prefix > word prefix > substring, ties by most recent update', async () => {
    const order = keys((await search('nova', { entityDefinitionIds: ['companies'] })).hits);
    expect(order).toEqual(['nova', 'novaA', 'novaB', 'superNova', 'casanova']);
    const scores = (await search('nova', { entityDefinitionIds: ['companies'] })).hits.map((h) => h.score);
    expect(scores).toEqual([1000, 800, 800, 600, 300]);
    // Updating "Nova Beta" makes it the most recent of the prefix tier.
    await domain.records.update(ws.ctx, {
      entityDefinitionId: 'companies',
      entityInstanceId: rec.novaB as string,
      values: { description: [{ value: 'Second fund' }] },
    });
    expect(keys((await search('nova', { entityDefinitionIds: ['companies'] })).hits).slice(1, 3)).toEqual([
      'novaB',
      'novaA',
    ]);
  });

  it('matches every word in any order, and typos by trigram similarity', async () => {
    const reversed = await search('lovelace ada');
    expect(reversed.hits[0]).toMatchObject({ entityInstanceId: rec.ada, score: 550, matchedField: 'name' });
    const typo = await search('lovelaec');
    expect(keys(typo.hits)).toContain('ada');
    const hit = typo.hits.find((h) => h.entityInstanceId === rec.ada);
    expect(hit?.score).toBeGreaterThan(100);
    expect(hit?.score).toBeLessThan(200);
  });

  it('serves 1–2 character queries from word prefixes only', async () => {
    expect(keys((await search('no', { entityDefinitionIds: ['companies'] })).hits).sort()).toEqual(
      ['nova', 'novaA', 'novaB', 'superNova'].sort(),
    );
    expect(keys((await search('su')).hits)).toEqual(['superNova']);
  });

  it('finds a record by its id and returns the most recent records for an empty query', async () => {
    const byId = await search(rec.casanova as string);
    expect(byId.hits).toEqual([
      expect.objectContaining({ entityInstanceId: rec.casanova, matchedField: 'record-id', score: 2000 }),
    ]);
    const recent = await search('', { entityDefinitionIds: ['companies'], limit: 2 });
    expect(keys(recent.hits)).toEqual(['novaB', 'nova']);
    expect(recent.hits.every((h) => h.score === 0 && h.matchedField === null)).toBe(true);
  });

  it('echoes requestSeq and groups hits by object in rank order', async () => {
    const out = await search('a', { requestSeq: 41 });
    expect(out.requestSeq).toBe(41);
    expect((await search('nova')).requestSeq).toBeNull();
    const mixed = await search('ada');
    expect(mixed.groups[0]?.entityDefinitionId).toBe(mixed.hits[0]?.entityDefinitionId);
    expect(mixed.groups.flatMap((g) => g.entityInstanceIds).sort()).toEqual(
      mixed.hits.map((h) => h.entityInstanceId).sort(),
    );
  });

  it('defaults to 20 hits', async () => {
    const many = await createWorkspace();
    for (let i = 0; i < 23; i++) {
      await domain.records.create(many.ctx, {
        entityDefinitionId: 'companies',
        entityInstanceId: newId(),
        values: { name: [{ value: `Bulk ${i}` }] },
      });
    }
    expect((await domain.search.records(many.ctx, { query: 'bulk' })).hits).toHaveLength(20);
    expect((await domain.search.records(many.ctx, { query: '' })).hits).toHaveLength(20);
  });
});

describe('list memberships and index maintenance', () => {
  it('attaches the lists a record is in (readable lists only)', async () => {
    const { list } = await domain.lists.create(ws.ctx, { name: 'Pipeline', parentEntityDefinitionIds: ['companies'] });
    const added = await domain.entries.add(ws.ctx, {
      listId: list.id,
      parentRecords: [{ entityDefinitionId: 'companies', entityInstanceId: rec.initech as string }],
    });
    const hit = (await search('initech')).hits[0];
    expect(hit?.lists).toEqual([
      { listId: list.id, name: 'Pipeline', icon: list.icon, entryIds: [added.entries[0]?.id] },
    ]);
    const noLists: PolicyResolver = {
      async resolve(_tx, _subject, definitions) {
        return new Map(
          definitions.map((d) => [
            d.id,
            flagsForScope(d.entityType === 'collection-entry' ? 'no-access' : 'full-access'),
          ]),
        );
      },
    };
    const restricted = createDomain({ database, policyResolver: noLists });
    const hidden = (await restricted.search.records(ws.ctx, { query: 'initech' })).hits[0];
    expect(hidden).toMatchObject({ entityInstanceId: rec.initech, lists: [] });
  });

  it('drops deleted records, brings restored ones back, replaces merged ones', async () => {
    await domain.records.delete(ws.ctx, { entityDefinitionId: 'companies', entityInstanceId: rec.casanova as string });
    expect(keys((await search('casanova')).hits)).toEqual([]);
    await domain.records.restore(ws.ctx, { entityDefinitionId: 'companies', entityInstanceId: rec.casanova as string });
    expect(keys((await search('casanova')).hits)).toEqual(['casanova']);

    const merged = await domain.records.merge(ws.ctx, {
      entityDefinitionId: 'companies',
      baseEntityInstanceId: rec.novaA as string,
      targetEntityInstanceId: rec.casanova as string,
    });
    const ids = (await search('casanova')).hits.map((h) => h.entityInstanceId);
    expect(ids).toEqual([merged.record.entityInstanceId]);
    expect(ids).not.toContain(rec.casanova);
  });

  it('rebuilds the index of a workspace', async () => {
    const result = await domain.search.rebuildIndex(ws.ctx);
    expect(result.indexed).toBe(7); // 8 records, two merged into one
    expect(keys((await search('initech')).hits)).toEqual(['initech']);
  });
});
