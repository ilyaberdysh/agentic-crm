// Record and member search for pickers (CROSS-DOMAIN B.8, C.4 #8): ranking by name / domain / email / phone, typo
// tolerance, the empty-query default set, object restriction, exclusions and the permission hook.
import { flagsForScope } from '@agentic-crm/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDomain, type PolicyResolver } from '../src/index.ts';
import { createUser, createWorkspace, database, domain, newId, type TestWorkspace } from './support/harness.ts';

let ws: TestWorkspace;
const rec: Record<string, string> = {};
let peopleId: string;
let companiesId: string;
let projectsId: string;

async function company(key: string, name: string, domains: string[] = []) {
  rec[key] = newId();
  await domain.records.create(ws.ctx, {
    entityDefinitionId: 'companies',
    entityInstanceId: rec[key] as string,
    values: { name: [{ value: name }], domains: domains.map((d) => ({ value: d })) },
  });
}
async function person(key: string, first: string, last: string, email?: string, phone?: string) {
  rec[key] = newId();
  await domain.records.create(ws.ctx, {
    entityDefinitionId: 'people',
    entityInstanceId: rec[key] as string,
    values: {
      name: [{ value: { firstName: first, lastName: last, fullName: `${first} ${last}` } }],
      email_addresses: email ? [{ value: email }] : [],
      phone_numbers: phone ? [{ value: phone }] : [],
    },
  });
}

beforeAll(async () => {
  ws = await createWorkspace();
  await company('acme', 'Acme', ['acme.com']);
  await company('holdings', 'Acme Holdings', ['acmeholdings.com']);
  await company('bacme', 'Bacme Labs');
  await company('globex', 'Globex', ['globex.io']);
  await company('initech', 'Initech');
  await person('ada', 'Ada', 'Lovelace', 'ada@acme.com', '+49 151 12345678');
  await person('robot', 'Acme', 'Robot');
  await person('grace', 'Grace', 'Hopper', 'grace@globex.io');
  peopleId = (await domain.schema.getObject(ws.ctx, 'people')).id;
  companiesId = (await domain.schema.getObject(ws.ctx, 'companies')).id;
  // A custom object whose records are labelled by a `name` text attribute.
  projectsId = (
    await domain.schema.createObject(ws.ctx, {
      id: newId(),
      apiSlug: 'projects',
      singularNoun: 'Project',
      pluralNoun: 'Projects',
    })
  ).id;
  await domain.schema.createAttribute(ws.ctx, {
    id: newId(),
    entityDefinitionId: projectsId,
    title: 'Name',
    type: 'text',
  });
  rec.widget = newId();
  await domain.records.create(ws.ctx, {
    entityDefinitionId: projectsId,
    entityInstanceId: rec.widget,
    values: { name: [{ value: 'Widget Prime' }] },
  });
});

const keys = (hits: { entityInstanceId: string }[]) =>
  hits.map((h) => Object.entries(rec).find(([, id]) => id === h.entityInstanceId)?.[0] ?? h.entityInstanceId);

describe('search.records', () => {
  it('ranks exact name, then name prefix, then substring matches', async () => {
    const { hits } = await domain.search.records(ws.ctx, {
      query: 'acme',
      entityDefinitionIds: ['companies', 'people'],
    });
    const order = keys(hits);
    expect(order[0]).toBe('acme');
    expect(order.slice(1, 3).sort()).toEqual(['holdings', 'robot']);
    expect(order.slice(3).sort()).toEqual(['ada', 'bacme']); // email ada@acme.com, "Bacme"
    expect(hits[0]).toMatchObject({ entityDefinitionId: companiesId, title: 'Acme', subtitle: 'acme.com' });
    const ada = hits.find((h) => h.entityInstanceId === rec.ada);
    expect(ada).toMatchObject({ entityDefinitionId: peopleId, title: 'Ada Lovelace', subtitle: 'ada@acme.com' });
    expect(hits.map((h) => h.score)).toEqual([...hits.map((h) => h.score)].sort((a, b) => b - a));
  });

  it('matches domains and emails by prefix, phones by digits, record ids exactly', async () => {
    const domainHits = keys((await domain.search.records(ws.ctx, { query: 'globex.io' })).hits);
    expect(domainHits[0]).toBe('globex');
    expect(domainHits).toContain('grace');
    expect(keys((await domain.search.records(ws.ctx, { query: '+49 (151) 1234' })).hits)).toEqual(['ada']);
    expect(keys((await domain.search.records(ws.ctx, { query: '015112345678' })).hits)).toEqual(['ada']);
    expect(keys((await domain.search.records(ws.ctx, { query: rec.initech as string })).hits)).toEqual(['initech']);
    expect(keys((await domain.search.records(ws.ctx, { query: 'LOVELACE' })).hits)).toEqual(['ada']);
  });

  it('tolerates typos (word similarity) and accents', async () => {
    expect(keys((await domain.search.records(ws.ctx, { query: 'acmee' })).hits)).toContain('acme');
    expect(keys((await domain.search.records(ws.ctx, { query: 'glóbex' })).hits)[0]).toBe('globex');
  });

  it('restricts to objects, excludes ids, limits, and finds custom-object records by their name', async () => {
    const people = await domain.search.records(ws.ctx, { query: 'acme', entityDefinitionIds: ['people'] });
    expect(keys(people.hits).sort()).toEqual(['ada', 'robot']);
    const excluded = await domain.search.records(ws.ctx, { query: 'acme', excludeIds: [rec.acme as string] });
    expect(keys(excluded.hits)).not.toContain('acme');
    expect((await domain.search.records(ws.ctx, { query: 'acme', limit: 2 })).hits).toHaveLength(2);
    const widget = await domain.search.records(ws.ctx, { query: 'widget' });
    expect(widget.hits).toEqual([expect.objectContaining({ entityDefinitionId: projectsId, title: 'Widget Prime' })]);
  });

  it('returns the newest records for an empty query', async () => {
    const { hits } = await domain.search.records(ws.ctx, { query: '', entityDefinitionIds: ['companies'], limit: 2 });
    expect(keys(hits)).toEqual(['initech', 'globex']);
    expect(hits.every((h) => h.score === 0)).toBe(true);
  });

  it('keeps search_text current on writes and deletes', async () => {
    await domain.records.update(ws.ctx, {
      entityDefinitionId: 'companies',
      entityInstanceId: rec.initech as string,
      values: { name: [{ value: 'Initrode' }] },
    });
    expect(keys((await domain.search.records(ws.ctx, { query: 'initrode' })).hits)).toEqual(['initech']);
    expect((await domain.search.records(ws.ctx, { query: 'initech' })).hits).toEqual([]);
    await domain.records.delete(ws.ctx, { entityDefinitionId: 'companies', entityInstanceId: rec.bacme as string });
    expect(keys((await domain.search.records(ws.ctx, { query: 'bacme' })).hits)).toEqual([]);
  });

  it('never returns records of objects the caller may not read', async () => {
    const noPeople: PolicyResolver = {
      async resolve(_tx, _subject, definitions) {
        return new Map(
          definitions.map((d) => [d.id, flagsForScope(d.apiSlug === 'people' ? 'no-access' : 'full-access')]),
        );
      },
    };
    const restricted = createDomain({ database, policyResolver: noPeople });
    const all = await restricted.search.records(ws.ctx, { query: 'acme' });
    expect(all.hits.some((h) => h.entityDefinitionId === peopleId)).toBe(false);
    expect(all.hits.length).toBeGreaterThan(0);
    const named = await restricted.search.records(ws.ctx, { query: 'acme', entityDefinitionIds: ['people'] });
    expect(named.hits).toEqual([]);
  });
});

describe('search.members', () => {
  it('ranks members by name and email; suspended members only on request', async () => {
    const zed = await createUser('Zed', 'Adams');
    await domain.invites.create(ws.ctx, { invites: [{ emailAddress: zed.emailAddress }] });
    const joined = await domain.invites.accept(zed, { workspaceId: ws.workspaceId });
    const ada = await domain.search.members(ws.ctx, { query: 'ada' });
    // "Ada Lovelace" (name prefix) before "Zed Adams" (last-name prefix).
    expect(ada.hits.map((h) => h.id)).toEqual([ws.memberId, joined.membership.id]);
    expect(ada.hits[0]).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace', accessLevel: 'admin' });
    const byEmail = await domain.search.members(ws.ctx, { query: zed.emailAddress.slice(0, 6) });
    expect(byEmail.hits.map((h) => h.id)).toEqual([joined.membership.id]);
    expect((await domain.search.members(ws.ctx, { query: '' })).hits).toHaveLength(2);
    expect((await domain.search.members(ws.ctx, { query: 'nobody-here' })).hits).toEqual([]);
    await domain.members.updateAccessLevel(ws.ctx, { memberId: joined.membership.id, accessLevel: 'suspended' });
    expect((await domain.search.members(ws.ctx, { query: 'zed' })).hits).toEqual([]);
    const withSuspended = await domain.search.members(ws.ctx, { query: 'zed', includeSuspended: true });
    expect(withSuspended.hits).toEqual([
      expect.objectContaining({ id: joined.membership.id, accessLevel: 'suspended' }),
    ]);
  });
});
