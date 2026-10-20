// /v2 contract tests: objects, attributes, select options and statuses. Request bodies follow the examples of the
// endpoint reference (api.json property examples) with workspace-specific slugs.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from '../support/harness';
import { expectError, expectOk, type V2Fixture, v2Fixture } from './support';

let h: Harness;
let f: V2Fixture;

beforeAll(async () => {
  h = await startHarness({}, { publicApi: { rateLimits: { readsPerSecond: 1000, writesPerSecond: 1000 } } });
  f = await v2Fixture(h, 'catalog');
});
afterAll(async () => {
  await h?.close();
});

describe('objects', () => {
  it('lists the standard objects (people, companies; deals, users, workspaces off by default) and nothing internal', async () => {
    const body = expectOk('listObjects', await f.call('GET', '/objects'));
    const slugs = body.data.map((o: { api_slug: string }) => o.api_slug);
    expect(slugs).toEqual(expect.arrayContaining(['people', 'companies', 'deals', 'users', 'workspaces']));
    expect(slugs).not.toContain('workspace_members');
    expect(slugs).not.toContain('entities');
    const people = body.data.find((o: { api_slug: string }) => o.api_slug === 'people');
    expect(people).toMatchObject({
      singular_noun: 'Person',
      plural_noun: 'People',
      id: { workspace_id: f.workspaceId },
    });
    expect(people.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z$/);
  });

  it('gets an object by slug or id; 404 with the documented message', async () => {
    const bySlug = expectOk('getObject', await f.call('GET', '/objects/people'));
    const byId = expectOk('getObject', await f.call('GET', `/objects/${bySlug.data.id.object_id}`));
    expect(byId.data.api_slug).toBe('people');
    const error = expectError('getObject', await f.call('GET', '/objects/peoples'), 404, 'not_found');
    expect(error.message).toBe('Object with slug/ID "peoples" not found.');
  });

  it('creates a custom object; duplicate slug → 409 slug_conflict', async () => {
    const body = { data: { api_slug: 'projects', singular_noun: 'Project', plural_noun: 'Projects' } };
    const created = expectOk('createObject', await f.call('POST', '/objects', { body }));
    expect(created.data).toMatchObject({ api_slug: 'projects', singular_noun: 'Project', plural_noun: 'Projects' });
    const again = await f.call('POST', '/objects', { body });
    const error = expectError('createObject', again, 409, 'slug_conflict');
    expect(error.message).toBe('Failed to create object. Please ensure your api_slug and names are unique.');
    expectError(
      'createObject',
      await f.call('POST', '/objects', { body: { data: { api_slug: 'x' } } }),
      400,
      'validation_type',
      {
        deviation: 'createObject declares only quota_exceeded for 400',
      },
    );
  });

  it('updates an object; empty payload and slug conflicts follow the documented errors', async () => {
    await f.call('POST', '/objects', {
      body: { data: { api_slug: 'vendors', singular_noun: 'Vendor', plural_noun: 'Vendors' } },
    });
    const updated = expectOk(
      'updateObject',
      await f.call('PATCH', '/objects/vendors', {
        body: { data: { plural_noun: 'Suppliers', api_slug: 'suppliers' } },
      }),
    );
    expect(updated.data).toMatchObject({ api_slug: 'suppliers', plural_noun: 'Suppliers' });
    const empty = expectError(
      'updateObject',
      await f.call('PATCH', '/objects/suppliers', { body: { data: {} } }),
      400,
      'validation_type',
    );
    expect(empty.message).toBe(
      'You passed an empty payload. Please ensure you are updating at least one property in your request.',
    );
    const conflict = await f.call('PATCH', '/objects/suppliers', { body: { data: { api_slug: 'projects' } } });
    expect(expectError('updateObject', conflict, 409, 'slug_conflict').message).toBe(
      'Failed to update object. Please ensure api_slug is unique.',
    );
    expectError(
      'updateObject',
      await f.call('PATCH', '/objects/nothing', { body: { data: { plural_noun: 'X' } } }),
      404,
      'not_found',
    );
  });
});

describe('attributes', () => {
  it('lists attributes in UI order with Attio fields; hidden system attributes are not listed', async () => {
    const body = expectOk('listAttributes', await f.call('GET', '/objects/people/attributes'));
    const slugs = body.data.map((a: { api_slug: string }) => a.api_slug);
    expect(slugs.slice(0, 3)).toEqual(['record_id', 'name', 'email_addresses']);
    expect(slugs).not.toContain('list_entries');
    expect(slugs).not.toContain('next_due_task');
    const email = body.data.find((a: { api_slug: string }) => a.api_slug === 'email_addresses');
    expect(email).toMatchObject({
      type: 'email-address',
      is_system_attribute: true,
      is_writable: true,
      is_unique: true,
      is_multiselect: true,
      config: {
        currency: { default_currency_code: null, display_type: null },
        record_reference: { allowed_object_ids: null },
      },
    });
    const company = body.data.find((a: { api_slug: string }) => a.api_slug === 'company');
    expect(company).toMatchObject({
      type: 'record-reference',
      relationship: { object_slug: 'companies', api_slug: 'team', title: 'Team', is_multiselect: true },
    });
    const recordId = body.data.find((a: { api_slug: string }) => a.api_slug === 'record_id');
    expect(recordId.is_writable).toBe(false);
    const paged = expectOk(
      'listAttributes',
      await f.call('GET', '/objects/people/attributes', { query: { limit: '2', offset: '1' } }),
    );
    expect(paged.data.map((a: { api_slug: string }) => a.api_slug)).toEqual(['name', 'email_addresses']);
  });

  it('creates attributes of the creatable types with config, relationships and defaults', async () => {
    const make = (data: Record<string, unknown>) =>
      f.call('POST', '/objects/projects/attributes', {
        body: {
          data: { description: null, is_required: false, is_unique: false, is_multiselect: false, config: {}, ...data },
        },
      });
    const budget = expectOk(
      'createAttribute',
      await make({
        title: 'Budget',
        api_slug: 'budget',
        type: 'currency',
        config: { currency: { default_currency_code: 'EUR', display_type: 'code' } },
      }),
    );
    expect(budget.data).toMatchObject({
      type: 'currency',
      config: { currency: { default_currency_code: 'EUR', display_type: 'code' } },
      is_system_attribute: false,
      description: null,
    });
    const owner = expectOk(
      'createAttribute',
      await make({
        title: 'Owner',
        api_slug: 'owner',
        type: 'actor-reference',
        default_value: { type: 'dynamic', template: 'current-user' },
      }),
    );
    expect(owner.data.default_value).toEqual({ type: 'dynamic', template: 'current-user' });
    expect(owner.data.is_default_value_enabled).toBe(true);
    const client = expectOk(
      'createAttribute',
      await make({
        title: 'Client',
        api_slug: 'client',
        type: 'record-reference',
        relationship: { object: 'companies', title: 'Projects', api_slug: 'projects', is_multiselect: true },
      }),
    );
    expect(client.data.relationship).toMatchObject({
      object_slug: 'companies',
      api_slug: 'projects',
      is_multiselect: true,
    });
    const companies = expectOk('getObject', await f.call('GET', '/objects/companies'));
    expect(client.data.config.record_reference.allowed_object_ids).toEqual([companies.data.id.object_id]);
    const inverse = expectOk('getAttribute', await f.call('GET', '/objects/companies/attributes/projects'));
    expect(inverse.data.relationship).toMatchObject({ object_slug: 'projects', api_slug: 'client' });
    expectOk('createAttribute', await make({ title: 'Stage', api_slug: 'stage', type: 'status' }));
    expectOk('createAttribute', await make({ title: 'Tags', api_slug: 'tags', type: 'select', is_multiselect: true }));
    expectOk('createAttribute', await make({ title: 'Code', api_slug: 'code', type: 'text', is_unique: true }));
    expectOk(
      'createAttribute',
      await make({
        title: 'Lead',
        api_slug: 'lead',
        type: 'record-reference',
        config: { record_reference: { allowed_objects: ['people'] } },
      }),
    );
    for (const [title, type] of [
      ['Kickoff', 'date'],
      ['Started at', 'timestamp'],
      ['Score', 'rating'],
      ['Hours', 'number'],
      ['Active', 'checkbox'],
      ['Site', 'location'],
      ['Hotline', 'phone-number'],
    ] as const) {
      expectOk('createAttribute', await make({ title, api_slug: title.toLowerCase().replace(' ', '_'), type }));
    }
  });

  it('rejects invalid attributes: 409 slug_conflict, 400 validation_type, 404 object', async () => {
    const base = {
      title: 'Budget',
      description: null,
      api_slug: 'budget',
      type: 'text',
      is_required: false,
      is_unique: false,
      is_multiselect: false,
      config: {},
    };
    const conflict = await f.call('POST', '/objects/projects/attributes', { body: { data: base } });
    expect(expectError('createAttribute', conflict, 409, 'slug_conflict').message).toBe(
      'An attribute with the same API slug already exists on this object. Please choose a different API slug.',
    );
    for (const data of [
      { ...base, api_slug: 'full_name', type: 'personal-name' },
      { ...base, api_slug: 'opt', type: 'select', is_unique: true },
      { ...base, api_slug: 'nums', type: 'number', is_multiselect: true },
      { ...base, api_slug: 'bogus', type: 'formula' },
      {
        ...base,
        api_slug: 'ref',
        type: 'record-reference',
        config: { record_reference: { allowed_objects: ['nope'] } },
      },
    ]) {
      expectError(
        'createAttribute',
        await f.call('POST', '/objects/projects/attributes', { body: { data } }),
        400,
        'validation_type',
      );
    }
    const onPeople = await f.call('POST', '/objects/people/attributes', {
      body: { data: { ...base, api_slug: 'nickname', default_value: { type: 'static', template: ['x'] } } },
    });
    expect(expectError('createAttribute', onPeople, 400, 'validation_type').message).toContain('people or company');
    expectError(
      'createAttribute',
      await f.call('POST', '/objects/nothing/attributes', { body: { data: base } }),
      404,
      'not_found',
    );
  });

  it('gets and updates attributes; system attributes cannot be updated', async () => {
    const got = expectOk('getAttribute', await f.call('GET', '/objects/projects/attributes/code'));
    const updated = expectOk(
      'updateAttribute',
      await f.call('PATCH', `/objects/projects/attributes/${got.data.id.attribute_id}`, {
        body: { data: { title: 'Project code', description: 'Internal code', is_required: true } },
      }),
    );
    expect(updated.data).toMatchObject({ title: 'Project code', description: 'Internal code', is_required: true });
    const archived = expectOk(
      'updateAttribute',
      await f.call('PATCH', '/objects/projects/attributes/hours', { body: { data: { is_archived: true } } }),
    );
    expect(archived.data.is_archived).toBe(true);
    const visible = expectOk('listAttributes', await f.call('GET', '/objects/projects/attributes'));
    expect(visible.data.map((a: { api_slug: string }) => a.api_slug)).not.toContain('hours');
    const all = expectOk(
      'listAttributes',
      await f.call('GET', '/objects/projects/attributes', { query: { show_archived: 'true' } }),
    );
    expect(all.data.map((a: { api_slug: string }) => a.api_slug)).toContain('hours');
    const system = await f.call('PATCH', '/objects/people/attributes/name', { body: { data: { title: 'Full name' } } });
    expect(expectError('updateAttribute', system, 400, 'system_edit_unauthorized').message).toBe(
      'Cannot update a System attribute.',
    );
    const missing = await f.call('GET', '/objects/projects/attributes/my_attribute');
    expect(expectError('getAttribute', missing, 404, 'not_found').message).toBe(
      'Attribute with slug/ID "my_attribute" not found.',
    );
  });
});

describe('select options and statuses', () => {
  it('creates, lists and updates select options', async () => {
    const created = expectOk(
      'createSelectOption',
      await f.call('POST', '/objects/projects/attributes/tags/options', { body: { data: { title: 'Medium' } } }),
    );
    expect(created.data).toMatchObject({ title: 'Medium', is_archived: false });
    expectOk(
      'createSelectOption',
      await f.call('POST', '/objects/projects/attributes/tags/options', { body: { data: { title: 'High' } } }),
    );
    const dup = await f.call('POST', '/objects/projects/attributes/tags/options', {
      body: { data: { title: 'Medium' } },
    });
    expect(expectError('createSelectOption', dup, 409, 'slug_conflict').message).toBe(
      'There is already another select option with the title "Medium".',
    );
    const renamed = expectOk(
      'updateSelectOption',
      await f.call('PATCH', '/objects/projects/attributes/tags/options/Medium', { body: { data: { title: 'Mid' } } }),
    );
    expect(renamed.data.title).toBe('Mid');
    expectOk(
      'updateSelectOption',
      await f.call('PATCH', `/objects/projects/attributes/tags/options/${renamed.data.id.option_id}`, {
        body: { data: { is_archived: true } },
      }),
    );
    const listed = expectOk('listSelectOptions', await f.call('GET', '/objects/projects/attributes/tags/options'));
    expect(listed.data.map((o: { title: string }) => o.title)).toEqual(['High']);
    const withArchived = expectOk(
      'listSelectOptions',
      await f.call('GET', '/objects/projects/attributes/tags/options', { query: { show_archived: 'true' } }),
    );
    expect(withArchived.data.map((o: { title: string }) => o.title)).toEqual(['Mid', 'High']);
    const unknown = await f.call('PATCH', '/objects/projects/attributes/tags/options/Medium', {
      body: { data: { title: 'X' } },
    });
    expect(expectError('updateSelectOption', unknown, 400, 'value_not_found').message).toBe(
      'Cannot find select attribute with select option title "Medium".',
    );
    const notSelect = await f.call('POST', '/objects/projects/attributes/code/options', {
      body: { data: { title: 'A' } },
    });
    expect(expectError('createSelectOption', notSelect, 400, 'validation_type').message).toBe(
      'This attribute is not a select attribute.',
    );
    const companyCategories = expectOk(
      'listSelectOptions',
      await f.call('GET', '/objects/companies/attributes/employee_range/options'),
    );
    expect(companyCategories.data.length).toBeGreaterThan(0);
  });

  it('creates, lists and updates statuses', async () => {
    const created = expectOk(
      'createStatus',
      await f.call('POST', '/objects/projects/attributes/stage/statuses', {
        body: { data: { title: 'In Progress', celebration_enabled: false, target_time_in_status: 'P14D' } },
      }),
    );
    expect(created.data).toMatchObject({
      title: 'In Progress',
      celebration_enabled: false,
      target_time_in_status: 'P14D',
    });
    expectOk(
      'createStatus',
      await f.call('POST', '/objects/projects/attributes/stage/statuses', { body: { data: { title: 'Done' } } }),
    );
    const dup = await f.call('POST', '/objects/projects/attributes/stage/statuses', {
      body: { data: { title: 'In Progress' } },
    });
    expect(expectError('createStatus', dup, 409, 'slug_conflict').message).toBe(
      'There is already another status with the title "In Progress".',
    );
    const updated = expectOk(
      'updateStatus',
      await f.call('PATCH', '/objects/projects/attributes/stage/statuses/Done', {
        body: { data: { celebration_enabled: true, target_time_in_status: null } },
      }),
    );
    expect(updated.data).toMatchObject({ title: 'Done', celebration_enabled: true, target_time_in_status: null });
    const listed = expectOk('listStatuses', await f.call('GET', '/objects/projects/attributes/stage/statuses'));
    expect(listed.data.map((s: { title: string }) => s.title)).toEqual(['In Progress', 'Done']);
    const unknown = await f.call('PATCH', '/objects/projects/attributes/stage/statuses/Medium', {
      body: { data: { title: 'X' } },
    });
    expect(expectError('updateStatus', unknown, 400, 'value_not_found').message).toBe(
      'Cannot find status attribute with status option title "Medium".',
    );
    const notStatus = await f.call('POST', '/objects/projects/attributes/tags/statuses', {
      body: { data: { title: 'A' } },
    });
    expect(expectError('createStatus', notStatus, 400, 'validation_type').message).toBe(
      'This attribute is not a status attribute.',
    );
  });

  it('a static default can reference an existing status by title', async () => {
    const updated = expectOk(
      'updateAttribute',
      await f.call('PATCH', '/objects/projects/attributes/stage', {
        body: { data: { default_value: { type: 'static', template: ['In Progress'] } } },
      }),
    );
    expect(updated.data.default_value).toMatchObject({
      type: 'static',
      template: [{ attribute_type: 'status', status: { title: 'In Progress' } }],
    });
  });
});
