// /v2 contract tests: records (create, assert, get, PATCH append, PUT overwrite, delete), value transforms of every
// attribute type, attribute values with history, query with filters and sorts, and search. Payloads follow the
// attribute-type docs (rest-api/attribute-types/*) and the filtering guide (rest-api/guides/filtering-and-sorting).
import { systemContext } from '@agentic-crm/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from '../support/harness';
import { expectError, expectOk, type V2Fixture, v2Fixture } from './support';

let h: Harness;
let f: V2Fixture;
const TS_9 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z$/;

type Values = Record<string, Record<string, unknown>[]>;
const values = (body: { data: { values: Values } }) => body.data.values;

async function attribute(data: Record<string, unknown>, object = 'projects') {
  const response = await f.call('POST', `/objects/${object}/attributes`, {
    body: {
      data: { description: null, is_required: false, is_unique: false, is_multiselect: false, config: {}, ...data },
    },
  });
  return expectOk('createAttribute', response);
}

beforeAll(async () => {
  h = await startHarness({}, { publicApi: { rateLimits: { readsPerSecond: 5000, writesPerSecond: 5000 } } });
  f = await v2Fixture(h, 'records');
  expectOk(
    'createObject',
    await f.call('POST', '/objects', {
      body: { data: { api_slug: 'projects', singular_noun: 'Project', plural_noun: 'Projects' } },
    }),
  );
  await attribute({ title: 'Name', api_slug: 'name', type: 'text' });
  await attribute({ title: 'Code', api_slug: 'code', type: 'text', is_unique: true });
  await attribute({ title: 'Hours', api_slug: 'hours', type: 'number' });
  await attribute({ title: 'Active', api_slug: 'active', type: 'checkbox' });
  await attribute({
    title: 'Budget',
    api_slug: 'budget',
    type: 'currency',
    config: { currency: { default_currency_code: 'EUR', display_type: 'symbol' } },
  });
  await attribute({ title: 'Kickoff', api_slug: 'kickoff', type: 'date' });
  await attribute({ title: 'Started at', api_slug: 'started_at', type: 'timestamp' });
  await attribute({ title: 'Score', api_slug: 'score', type: 'rating' });
  await attribute({ title: 'Stage', api_slug: 'stage', type: 'status' });
  await attribute({ title: 'Tags', api_slug: 'tags', type: 'select', is_multiselect: true });
  await attribute({
    title: 'Lead',
    api_slug: 'lead',
    type: 'record-reference',
    config: { record_reference: { allowed_objects: ['people'] } },
  });
  await attribute({ title: 'Owner', api_slug: 'owner', type: 'actor-reference' });
  await attribute({ title: 'Site', api_slug: 'site', type: 'location' });
  await attribute({ title: 'Hotline', api_slug: 'hotline', type: 'phone-number' });
  for (const title of ['Planned', 'In Progress', 'Done']) {
    expectOk(
      'createStatus',
      await f.call('POST', '/objects/projects/attributes/stage/statuses', { body: { data: { title } } }),
    );
  }
  for (const title of ['Red', 'Green', 'Blue']) {
    expectOk(
      'createSelectOption',
      await f.call('POST', '/objects/projects/attributes/tags/options', { body: { data: { title } } }),
    );
  }
});
afterAll(async () => {
  await h?.close();
});

let ada: string;
let acme: string;

describe('create and get', () => {
  it('creates a company: domains are normalised and the root domain inferred', async () => {
    const body = expectOk(
      'createRecord',
      await f.call('POST', '/objects/companies/records', {
        body: { data: { values: { name: 'Acme', domains: ['https://www.acme.co.uk/about', 'app.acme.test'] } } },
      }),
    );
    acme = body.data.id.record_id;
    expect(values(body).domains).toMatchObject([
      { domain: 'acme.co.uk', root_domain: 'acme.co.uk', attribute_type: 'domain' },
      { domain: 'app.acme.test', root_domain: 'acme.test', attribute_type: 'domain' },
    ]);
    expect(body.data.web_url).toBe(`${'http://localhost:5173'}/${f.slug}/company/${acme}`);
  });

  it('creates a person with the documented write forms', async () => {
    const body = expectOk(
      'createRecord',
      await f.call('POST', '/objects/people/records', {
        body: {
          data: {
            values: {
              name: [{ first_name: 'Ada', last_name: 'Lovelace', full_name: 'Ada Lovelace' }],
              email_addresses: ['Ada@Example.com'],
              job_title: 'Countess',
              phone_numbers: [{ original_phone_number: '+44 20 7946 0958', country_code: 'GB' }],
              primary_location: '1 Infinite Loop, Cupertino, CA, 95014, US',
              company: [{ target_object: 'companies', target_record_id: acme }],
            },
          },
        },
      }),
    );
    ada = body.data.id.record_id;
    const v = values(body);
    expect(body.data.id).toMatchObject({ workspace_id: f.workspaceId, record_id: ada });
    expect(body.data.created_at).toMatch(TS_9);
    expect(v.record_id).toMatchObject([{ value: ada, attribute_type: 'text' }]);
    expect(v.name).toMatchObject([
      { first_name: 'Ada', last_name: 'Lovelace', full_name: 'Ada Lovelace', attribute_type: 'personal-name' },
    ]);
    expect(v.email_addresses).toMatchObject([
      {
        original_email_address: 'Ada@Example.com',
        email_address: 'ada@example.com',
        email_domain: 'example.com',
        email_root_domain: 'example.com',
        email_local_specifier: '',
        attribute_type: 'email-address',
      },
    ]);
    expect(v.phone_numbers).toMatchObject([
      { original_phone_number: '+44 20 7946 0958', country_code: 'GB', phone_number: '+442079460958' },
    ]);
    expect(v.primary_location).toMatchObject([
      {
        line_1: '1 Infinite Loop',
        locality: 'Cupertino',
        region: 'CA',
        postcode: '95014',
        country_code: 'US',
        latitude: null,
      },
    ]);
    expect(v.company).toMatchObject([
      { target_object: 'companies', target_record_id: acme, attribute_type: 'record-reference' },
    ]);
    expect(v.created_by).toMatchObject([
      { referenced_actor_type: 'api-token', referenced_actor_id: f.tokenId, attribute_type: 'actor-reference' },
    ]);
    expect(v.job_title?.[0]).toMatchObject({
      value: 'Countess',
      active_until: null,
      created_by_actor: { type: 'api-token', id: f.tokenId },
    });
    expect(v.job_title?.[0]?.active_from).toMatch(TS_9);
    expect(v.description).toEqual([]);
    // The relationship is mirrored on the company.
    const company = expectOk('getRecord', await f.call('GET', `/objects/companies/records/${acme}`));
    expect(values(company).team).toMatchObject([{ target_object: 'people', target_record_id: ada }]);
  });

  it('gets a record; 404 with the documented message', async () => {
    const body = expectOk('getRecord', await f.call('GET', `/objects/people/records/${ada}`));
    expect(body.data.web_url).toContain(`/person/${ada}`);
    const id = '891dcbfc-9141-415d-9b2a-2238a6cc012d';
    const missing = await f.call('GET', `/objects/people/records/${id}`);
    expect(expectError('getRecord', missing, 404, 'not_found').message).toBe(`Record with ID "${id}" not found.`);
    expectError('getRecord', await f.call('GET', `/objects/people/records/not-a-uuid`), 404, 'not_found');
    const object = await f.call('GET', `/objects/peoples/records/${id}`);
    expect(expectError('getRecord', object, 404, 'not_found').message).toBe('Object with slug/ID "peoples" not found.');
  });

  it('writes every attribute type on a custom object', async () => {
    const body = expectOk(
      'createRecord',
      await f.call('POST', '/objects/projects/records', {
        body: {
          data: {
            values: {
              name: { value: 'Apollo' },
              code: 'AP-1',
              hours: '12.5',
              active: 'true',
              budget: 499.99,
              kickoff: '2023-01-02T23:00:00-10:00',
              started_at: '2023',
              score: 4,
              stage: 'In Progress',
              tags: ['Red', { option: 'Blue' }],
              lead: 'ada@example.com',
              owner: f.user.email,
              site: {
                line_1: '1 Main St',
                line_2: null,
                line_3: null,
                line_4: null,
                locality: 'London',
                region: null,
                postcode: 'N1',
                country_code: 'GB',
                latitude: '51.5',
                longitude: '-0.12',
              },
              hotline: '+1 415 555 0100',
            },
          },
        },
      }),
    );
    const v = values(body);
    expect(v.name).toMatchObject([{ value: 'Apollo', attribute_type: 'text' }]);
    expect(v.hours).toMatchObject([{ value: 12.5, attribute_type: 'number' }]);
    expect(v.active).toMatchObject([{ value: true, attribute_type: 'checkbox' }]);
    expect(v.budget).toMatchObject([{ currency_value: 499.99, currency_code: 'EUR', attribute_type: 'currency' }]);
    expect(v.kickoff).toMatchObject([{ value: '2023-01-03', attribute_type: 'date' }]);
    expect(v.started_at).toMatchObject([{ value: '2023-01-01T00:00:00.000000000Z', attribute_type: 'timestamp' }]);
    expect(v.score).toMatchObject([{ value: 4, attribute_type: 'rating' }]);
    expect(v.stage).toMatchObject([
      { status: { title: 'In Progress', is_archived: false, celebration_enabled: false }, attribute_type: 'status' },
    ]);
    expect(v.tags?.map((t) => (t.option as { title: string }).title)).toEqual(['Red', 'Blue']);
    expect(v.lead).toMatchObject([{ target_object: 'people', target_record_id: ada }]);
    expect(v.owner).toMatchObject([{ referenced_actor_type: 'workspace-member', referenced_actor_id: f.memberId }]);
    expect(v.site).toMatchObject([
      { line_1: '1 Main St', locality: 'London', postcode: 'N1', country_code: 'GB', latitude: '51.5' },
    ]);
    expect(v.hotline).toMatchObject([
      { phone_number: '+14155550100', country_code: 'US', attribute_type: 'phone-number' },
    ]);
  });

  it('creates a deal once Deals is activated: status, actor, currency and relationship values', async () => {
    const disabled = await f.call('POST', '/objects/deals/records', { body: { data: { values: { name: 'X' } } } });
    expectError('createRecord', disabled, 400, 'standard_object_disabled', {
      deviation: 'createRecord declares value_not_found and particle_gate_violation for 400',
    });
    await h.domain.schema.updateObject(systemContext(f.workspaceId, 'test'), {
      entityDefinitionId: 'deals',
      isArchived: false,
    });
    const body = expectOk(
      'createRecord',
      await f.call('POST', '/objects/deals/records', {
        body: {
          data: {
            values: {
              name: 'Contract with Apple',
              stage: { status: 'In progress' },
              owner: [{ workspace_member_email_address: f.user.email }],
              value: { currency_value: '1000' },
              associated_company: { target_object: 'companies', domains: [{ domain: 'acme.co.uk' }] },
            },
          },
        },
      }),
    );
    const v = values(body);
    expect(v.stage).toMatchObject([{ status: { title: 'In progress' } }]);
    expect(v.owner).toMatchObject([{ referenced_actor_type: 'workspace-member', referenced_actor_id: f.memberId }]);
    expect(v.value).toMatchObject([{ currency_value: 1000, currency_code: 'USD' }]);
    expect(v.associated_company).toMatchObject([{ target_object: 'companies', target_record_id: acme }]);
    expect(body.data.web_url).toContain('/deals/record/');
  });

  it('rejects invalid writes with Attio error codes', async () => {
    const post = (object: string, vals: Record<string, unknown>) =>
      f.call('POST', `/objects/${object}/records`, { body: { data: { values: vals } } });
    const option = await post('projects', { tags: ['Purple'] });
    expect(expectError('createRecord', option, 400, 'value_not_found').message).toBe(
      'Cannot find select attribute with select option title "Purple".',
    );
    expectError('createRecord', await post('projects', { hours: 'many' }), 400, 'validation_type', {
      deviation: 'createRecord declares value_not_found and particle_gate_violation for 400',
    });
    expectError('createRecord', await post('projects', { nope: 'x' }), 400, 'value_not_found');
    expectError('createRecord', await post('projects', { lead: 'nobody@example.com' }), 400, 'value_not_found');
    expectError('createRecord', await post('projects', { owner: 'stranger@example.com' }), 400, 'value_not_found');
    expectError('createRecord', await post('projects', { site: { locality: 'Paris' } }), 400, 'validation_type', {
      deviation: 'createRecord declares value_not_found and particle_gate_violation for 400',
    });
    expectError('createRecord', await post('projects', { record_id: 'x' }), 400, 'system_edit_unauthorized', {
      deviation: 'createRecord declares value_not_found and particle_gate_violation for 400',
    });
    expectError('createRecord', await post('nothing', { name: 'x' }), 404, 'not_found');
  });

  it('409 uniqueness_conflict when a unique value is taken', async () => {
    const response = await f.call('POST', '/objects/people/records', {
      body: { data: { values: { email_addresses: ['ada@example.com'] } } },
    });
    const error = expectError('createRecord', response, 409, 'uniqueness_conflict', {
      deviation:
        'createRecord declares only concurrent_write_conflict for 409 (uniqueness_conflict is 400/409 in the code table)',
    });
    expect(error.message).toContain(ada);
  });

  it('400 missing_value when a required attribute has no value', async () => {
    await attribute({ title: 'Region', api_slug: 'region', type: 'text' });
    await f.call('PATCH', '/objects/projects/attributes/region', { body: { data: { is_required: true } } });
    const response = await f.call('POST', '/objects/projects/records', {
      body: { data: { values: { name: 'No region' } } },
    });
    const error = expectError('createRecord', response, 400, 'missing_value', {
      deviation:
        'createRecord declares value_not_found and particle_gate_violation for 400 (missing_value is PATCH/PUT)',
    });
    expect(error.message).toMatch(/^Required value for attribute with ID "[0-9a-f-]+" was not provided\.$/);
    await f.call('PATCH', '/objects/projects/attributes/region', { body: { data: { is_required: false } } });
  });
});

describe('update: PATCH appends, PUT overwrites multiselect values', () => {
  let project: string;

  it('PATCH prepends new multiselect values and keeps existing ones', async () => {
    const created = expectOk(
      'createRecord',
      await f.call('POST', '/objects/projects/records', {
        body: { data: { values: { name: 'Gemini', tags: ['Red'] } } },
      }),
    );
    project = created.data.id.record_id;
    const patched = expectOk(
      'updateRecord',
      await f.call('PATCH', `/objects/projects/records/${project}`, {
        body: { data: { values: { tags: ['Green', 'Red'], hours: 3 } } },
      }),
    );
    expect(values(patched).tags?.map((t) => (t.option as { title: string }).title)).toEqual(['Green', 'Red']);
    expect(values(patched).hours).toMatchObject([{ value: 3 }]);
  });

  it('PUT replaces multiselect values (removing the ones not given)', async () => {
    const put = expectOk(
      'replaceRecord',
      await f.call('PUT', `/objects/projects/records/${project}`, { body: { data: { values: { tags: ['Blue'] } } } }),
    );
    expect(values(put).tags?.map((t) => (t.option as { title: string }).title)).toEqual(['Blue']);
    expect(values(put).hours).toMatchObject([{ value: 3 }]);
  });

  it('PATCH clears a single value with null or []', async () => {
    const cleared = expectOk(
      'updateRecord',
      await f.call('PATCH', `/objects/projects/records/${project}`, { body: { data: { values: { hours: null } } } }),
    );
    expect(values(cleared).hours).toEqual([]);
  });

  it('404 for a missing record', async () => {
    const id = '891dcbfc-9141-415d-9b2a-2238a6cc012d';
    const response = await f.call('PATCH', `/objects/projects/records/${id}`, {
      body: { data: { values: { hours: 1 } } },
    });
    expect(expectError('updateRecord', response, 404, 'not_found').message).toBe(`Record with ID "${id}" not found.`);
  });
});

describe('assert (PUT …/records?matching_attribute=)', () => {
  it('creates when nothing matches, then updates the match: the matching multiselect is appended, others overwritten', async () => {
    const assert = (vals: Record<string, unknown>) =>
      f.call('PUT', '/objects/people/records', {
        query: { matching_attribute: 'email_addresses' },
        body: { data: { values: vals } },
      });
    const created = expectOk(
      'assertRecord',
      await assert({
        email_addresses: ['grace@example.com'],
        job_title: 'Rear admiral',
        phone_numbers: ['+12025550111'],
      }),
    );
    const id = created.data.id.record_id;
    const updated = expectOk(
      'assertRecord',
      await assert({ email_addresses: ['grace@example.com', 'grace@navy.test'], phone_numbers: ['+12025550199'] }),
    );
    expect(updated.data.id.record_id).toBe(id);
    expect(values(updated).email_addresses?.map((e) => e.email_address)).toEqual([
      'grace@example.com',
      'grace@navy.test',
    ]);
    expect(values(updated).phone_numbers?.map((p) => p.phone_number)).toEqual(['+12025550199']);
    expect(values(updated).job_title).toMatchObject([{ value: 'Rear admiral' }]);
    // Matching on the newly added address finds the same record.
    const third = expectOk(
      'assertRecord',
      await assert({ email_addresses: ['grace@navy.test'], job_title: 'Admiral' }),
    );
    expect(third.data.id.record_id).toBe(id);
    expect(values(third).email_addresses).toHaveLength(2);
  });

  it('matching attribute errors', async () => {
    const unknown = await f.call('PUT', '/objects/people/records', {
      query: { matching_attribute: 'my_attribute' },
      body: { data: { values: { job_title: 'x' } } },
    });
    expect(expectError('assertRecord', unknown, 400, 'value_not_found').message).toBe(
      'No attribute was found for matching_attribute slug/ID "my_attribute".',
    );
    const notUnique = await f.call('PUT', '/objects/people/records', {
      query: { matching_attribute: 'job_title' },
      body: { data: { values: { job_title: 'x' } } },
    });
    expectError('assertRecord', notUnique, 400, 'matching_attribute_definition_not_unique', {
      deviation: 'assertRecord declares value_not_found, merge_in_progress and particle_gate_violation for 400',
    });
    const missing = await f.call('PUT', '/objects/people/records', { body: { data: { values: { job_title: 'x' } } } });
    expectError('assertRecord', missing, 400, 'validation_type', {
      deviation: 'assertRecord declares value_not_found, merge_in_progress and particle_gate_violation for 400',
    });
  });
});

describe('attribute values and history', () => {
  it('returns current values, or the full history oldest first with show_historic', async () => {
    for (const title of ['Analyst', 'Engineer']) {
      expectOk(
        'updateRecord',
        await f.call('PATCH', `/objects/people/records/${ada}`, { body: { data: { values: { job_title: title } } } }),
      );
    }
    const path = `/objects/people/records/${ada}/attributes/job_title/values`;
    const current = expectOk('listRecordAttributeValues', await f.call('GET', path));
    expect(current.data).toMatchObject([{ value: 'Engineer', active_until: null, attribute_type: 'text' }]);
    const history = expectOk(
      'listRecordAttributeValues',
      await f.call('GET', path, { query: { show_historic: 'true' } }),
    );
    expect(history.data.map((v: { value: string }) => v.value)).toEqual(['Countess', 'Analyst', 'Engineer']);
    expect(history.data[0].active_until).toMatch(TS_9);
    expect(history.data[0].active_until).toBe(history.data[1].active_from);
    const paged = expectOk(
      'listRecordAttributeValues',
      await f.call('GET', path, { query: { show_historic: 'true', limit: '1', offset: '1' } }),
    );
    expect(paged.data.map((v: { value: string }) => v.value)).toEqual(['Analyst']);
    const stage = expectOk(
      'listRecordAttributeValues',
      await f.call('GET', `/objects/people/records/${ada}/attributes/email_addresses/values`),
    );
    expect(stage.data).toHaveLength(1);
  });

  it('COMINT attributes have no history; unknown attributes are 404', async () => {
    const comint = await f.call('GET', `/objects/people/records/${ada}/attributes/last_email_interaction/values`, {
      query: { show_historic: 'true' },
    });
    expect(expectError('listRecordAttributeValues', comint, 400, 'validation_type').message).toBe(
      'Cannot set show_historic param to true when querying a COMINT attribute.',
    );
    const missing = await f.call('GET', `/objects/people/records/${ada}/attributes/my_attribute/values`);
    expect(expectError('listRecordAttributeValues', missing, 404, 'not_found').message).toBe(
      'Attribute with slug/ID "my_attribute" not found.',
    );
  });
});

describe('query', () => {
  const people: Record<string, string> = {};

  beforeAll(async () => {
    const make = async (first: string, last: string, extra: Record<string, unknown> = {}) => {
      const body = expectOk(
        'createRecord',
        await f.call('POST', '/objects/people/records', {
          body: {
            data: { values: { name: { first_name: first, last_name: last, full_name: `${first} ${last}` }, ...extra } },
          },
        }),
      );
      people[first] = body.data.id.record_id;
    };
    await make('John', 'Smith', {
      email_addresses: ['john@smith.com'],
      phone_numbers: ['+447700900798'],
      twitter_follower_count: 150,
    });
    await make('Jane', 'Smith', { email_addresses: ['jane@apple.com'], twitter_follower_count: 2500, company: acme });
    await make('Johnny', 'Appleseed', { job_title: 'Head of things', twitter_follower_count: 90 });
  });

  const query = (body: Record<string, unknown>, object = 'people') =>
    f.call('POST', `/objects/${object}/records/query`, { body });
  const ids = (body: { data: { id: { record_id: string } }[] }) => body.data.map((r) => r.id.record_id);
  const names = (body: { data: { values: Values }[] }) =>
    body.data.map((r) => (r.values.name?.[0] as { full_name: string } | undefined)?.full_name);

  it('documented shorthand: name and email (implicit $and)', async () => {
    const body = expectOk(
      'queryRecords',
      await query({ filter: { name: 'John Smith', email_addresses: 'john@smith.com' } }),
    );
    expect(ids(body)).toEqual([people.John]);
  });

  it('documented verbose form of the same filter', async () => {
    const body = expectOk(
      'queryRecords',
      await query({
        filter: {
          $and: [
            { name: { full_name: { $eq: 'John Smith' } } },
            { email_addresses: { email_address: { $eq: 'john@smith.com' } } },
          ],
        },
      }),
    );
    expect(ids(body)).toEqual([people.John]);
  });

  it('comparison, string and logical operators', async () => {
    const between = expectOk(
      'queryRecords',
      await query({ filter: { twitter_follower_count: { $gte: 100, $lt: 200 } } }),
    );
    expect(ids(between)).toEqual([people.John]);
    const contains = expectOk(
      'queryRecords',
      await query({
        filter: { name: { $contains: 'SMITH' } },
        sorts: [{ direction: 'asc', attribute: 'name', field: 'first_name' }],
      }),
    );
    expect(names(contains)).toEqual(['Jane Smith', 'John Smith']);
    const phone = expectOk(
      'queryRecords',
      await query({ filter: { phone_numbers: { $starts_with: '+44', $ends_with: '798' } } }),
    );
    expect(ids(phone)).toEqual([people.John]);
    const ends = expectOk('queryRecords', await query({ filter: { job_title: { $ends_with: 'of things' } } }));
    expect(ids(ends)).toEqual([people.Johnny]);
    const or = expectOk(
      'queryRecords',
      await query({ filter: { $or: [{ name: { first_name: 'Jane' } }, { name: { first_name: 'Johnny' } }] } }),
    );
    expect(new Set(ids(or))).toEqual(new Set([people.Jane, people.Johnny]));
    const not = expectOk(
      'queryRecords',
      await query({ filter: { $and: [{ name: { last_name: 'Smith' } }, { $not: { name: { first_name: 'John' } } }] } }),
    );
    expect(ids(not)).toEqual([people.Jane]);
    const inIds = expectOk('queryRecords', await query({ filter: { record_id: { $in: [people.John, people.Jane] } } }));
    expect(new Set(ids(inIds))).toEqual(new Set([people.John, people.Jane]));
    const notEmpty = expectOk('queryRecords', await query({ filter: { domains: { $not_empty: true } } }, 'companies'));
    expect(ids(notEmpty)).toEqual([acme]);
  });

  it('root_domain, record references and path filters', async () => {
    const apple = expectOk(
      'queryRecords',
      await query({ filter: { email_addresses: { email_root_domain: 'apple.com' } } }),
    );
    expect(ids(apple)).toEqual([people.Jane]);
    const notAcme = expectOk(
      'queryRecords',
      await query({ filter: { $not: { domains: { root_domain: 'acme.test' } } } }, 'companies'),
    );
    expect(ids(notAcme)).toEqual([]);
    const byCompany = expectOk(
      'queryRecords',
      await query({ filter: { company: { target_object: 'companies', target_record_id: acme } } }),
    );
    expect(new Set(ids(byCompany))).toEqual(new Set([ada, people.Jane]));
    const path = expectOk(
      'queryRecords',
      await query({
        filter: {
          path: [
            ['people', 'company'],
            ['companies', 'name'],
          ],
          constraints: { value: 'Acme' },
        },
      }),
    );
    expect(new Set(ids(path))).toEqual(new Set([ada, people.Jane]));
    const deep = expectOk(
      'queryRecords',
      await query(
        {
          filter: {
            path: [
              ['companies', 'team'],
              ['people', 'email_addresses'],
            ],
            constraints: { email_domain: 'apple.com' },
          },
        },
        'companies',
      ),
    );
    expect(ids(deep)).toEqual([acme]);
  });

  it('sorts, limit and offset', async () => {
    const filter = { name: { last_name: 'Smith' } };
    const desc = expectOk(
      'queryRecords',
      await query({ filter, sorts: [{ direction: 'desc', attribute: 'name', field: 'first_name' }] }),
    );
    expect(names(desc)).toEqual(['John Smith', 'Jane Smith']);
    const second = expectOk(
      'queryRecords',
      await query({
        filter,
        sorts: [{ direction: 'desc', attribute: 'name', field: 'first_name' }],
        limit: 1,
        offset: 1,
      }),
    );
    expect(names(second)).toEqual(['Jane Smith']);
    const followers = expectOk(
      'queryRecords',
      await query({
        filter: { twitter_follower_count: { $gte: 0 } },
        sorts: [{ direction: 'asc', path: [['people', 'twitter_follower_count']] }],
      }),
    );
    expect(ids(followers)).toEqual([people.Johnny, people.John, people.Jane]);
    const all = expectOk('queryRecords', await query({}));
    expect(all.data.length).toBeGreaterThanOrEqual(5);
  });

  it('filter_view_id uses the saved view filter; errors are 400 filter_error', async () => {
    const views = await h.domain.views.list(systemContext(f.workspaceId, 'test'), { entityDefinitionId: 'people' });
    const view = views[0];
    if (!view) throw new Error('no default people view');
    expectOk('queryRecords', await query({ filter_view_id: view.id, limit: 2 }));
    expectError('queryRecords', await query({ filter: { nope: 1 } }), 400, 'filter_error');
    expectError('queryRecords', await query({ filter: { name: { $neq: 'x' } } }), 400, 'filter_error');
    expectError('queryRecords', await query({ filter: { primary_location: { postcode: '1' } } }), 400, 'filter_error');
    expectError('queryRecords', await query({ filter: { name: 'x' }, filter_view_id: view.id }), 400, 'filter_error');
    expectError(
      'queryRecords',
      await query({ filter_view_id: '00000000-0000-4000-8000-000000000000' }),
      400,
      'filter_error',
    );
    expectError(
      'queryRecords',
      await query({
        sorts: [
          {
            direction: 'asc',
            path: [
              ['people', 'company'],
              ['companies', 'name'],
            ],
          },
        ],
      }),
      400,
      'filter_error',
    );
    expectError('queryRecords', await query({}, 'nothing'), 404, 'not_found');
  });
});

describe('search', () => {
  it('finds people and companies by name, email and domain', async () => {
    const body = expectOk(
      'searchRecords',
      await f.call('POST', '/objects/records/search', {
        body: { query: 'acme', objects: ['people', 'companies'], request_as: { type: 'workspace' } },
      }),
    );
    expect(body.data).toMatchObject([
      { object_slug: 'companies', record_text: 'Acme', domains: ['acme.co.uk', 'app.acme.test'] },
    ]);
    const person = expectOk(
      'searchRecords',
      await f.call('POST', '/objects/records/search', {
        body: {
          query: 'lovelace',
          objects: ['people'],
          request_as: { type: 'workspace-member', email_address: f.user.email },
          limit: 5,
        },
      }),
    );
    expect(person.data).toMatchObject([
      {
        object_slug: 'people',
        record_text: 'Ada Lovelace',
        email_addresses: ['ada@example.com'],
        phone_numbers: ['+442079460958'],
      },
    ]);
    const unknown = await f.call('POST', '/objects/records/search', {
      body: { query: 'x', objects: ['foobar'], request_as: { type: 'workspace' } },
    });
    expect(expectError('searchRecords', unknown, 400, 'value_not_found').message).toBe(
      'Object with slug/ID "foobar" not found.',
    );
  });
});

describe('delete', () => {
  it('deletes a record; it is then 404', async () => {
    const created = expectOk(
      'createRecord',
      await f.call('POST', '/objects/projects/records', { body: { data: { values: { name: 'Doomed' } } } }),
    );
    const id = created.data.id.record_id;
    expect(expectOk('deleteRecord', await f.call('DELETE', `/objects/projects/records/${id}`))).toEqual({});
    expectError('getRecord', await f.call('GET', `/objects/projects/records/${id}`), 404, 'not_found');
    const again = await f.call('DELETE', `/objects/projects/records/${id}`);
    expect(expectError('deleteRecord', again, 404, 'not_found').message).toBe(`Record with ID "${id}" not found.`);
  });
});
