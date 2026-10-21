// /v2 contract tests (BACKLOG 4.10): lists (list, create, get, update with access levels), list attributes and
// statuses, entries (create, assert by parent, get, PATCH append, PUT overwrite, delete, query with filters and sorts
// through parent_record, attribute values with history) and a record's entries. Every 200 is validated against
// the public API's OpenAPI response schema and the generated Zod schema.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from '../support/harness';
import { expectError, expectOk, type V2Fixture, v2Fixture } from './support';

let h: Harness;
let f: V2Fixture;
let acme: string;
let globex: string;
let initech: string;

async function company(name: string): Promise<string> {
  const body = expectOk(
    'createRecord',
    await f.call('POST', '/objects/companies/records', { body: { data: { values: { name } } } }),
  );
  return body.data.id.record_id as string;
}

beforeAll(async () => {
  h = await startHarness({}, { publicApi: { rateLimits: { readsPerSecond: 5000, writesPerSecond: 5000 } } });
  f = await v2Fixture(h, 'lists');
  acme = await company('Acme');
  globex = await company('Globex');
  initech = await company('Initech');
});
afterAll(async () => {
  await h?.close();
});

describe('lists', () => {
  it('creates, gets, lists and updates lists with access levels', async () => {
    const created = expectOk(
      'createList',
      await f.call('POST', '/lists', {
        body: {
          data: {
            name: 'Sales',
            api_slug: 'sales',
            parent_object: 'companies',
            workspace_access: 'read-and-write',
            workspace_member_access: [{ workspace_member_id: f.memberId, level: 'full-access' }],
          },
        },
      }),
    );
    expect(created.data).toMatchObject({
      api_slug: 'sales',
      name: 'Sales',
      parent_object: ['companies'],
      workspace_access: 'read-and-write',
      workspace_member_access: [{ workspace_member_id: f.memberId, level: 'full-access' }],
      created_by_actor: { type: 'api-token', id: f.tokenId },
    });
    const listId = created.data.id.list_id as string;
    // Lists created through the API have no view (C2 §6).
    expect(
      await h.domain.views.list(
        { workspaceId: f.workspaceId, actor: { type: 'system', id: null } },
        { entityDefinitionId: listId },
      ),
    ).toEqual([]);

    const bySlug = expectOk('getList', await f.call('GET', '/lists/sales'));
    expect(bySlug.data.id.list_id).toBe(listId);
    expect(expectOk('getList', await f.call('GET', `/lists/${listId}`)).data.api_slug).toBe('sales');
    const missing = expectError('getList', await f.call('GET', '/lists/nope'), 404, 'not_found');
    expect(missing.message).toBe('List with slug/ID "nope" not found.');
    expect(
      expectOk('listLists', await f.call('GET', '/lists')).data.map((l: { api_slug: string }) => l.api_slug),
    ).toContain('sales');

    const updated = expectOk(
      'updateList',
      await f.call('PATCH', '/lists/sales', {
        body: { data: { name: 'Sales pipeline', workspace_access: null, workspace_member_access: [] } },
      }),
    );
    expect(updated.data).toMatchObject({ name: 'Sales pipeline', workspace_access: null, workspace_member_access: [] });
    expectOk(
      'updateList',
      await f.call('PATCH', '/lists/sales', { body: { data: { workspace_access: 'full-access' } } }),
    );

    expectError(
      'createList',
      await f.call('POST', '/lists', {
        body: {
          data: {
            name: 'Dup',
            api_slug: 'sales',
            parent_object: 'companies',
            workspace_access: 'read-only',
            workspace_member_access: [],
          },
        },
      }),
      409,
      'slug_conflict',
    );
    expectError(
      'createList',
      await f.call('POST', '/lists', {
        body: {
          data: {
            name: 'Bad',
            api_slug: 'bad',
            parent_object: 'nothing',
            workspace_access: 'read-only',
            workspace_member_access: [],
          },
        },
      }),
      400,
      'value_not_found',
    );
    const noScope = await f.mint(['list_entry:read']);
    expectError('listLists', await f.call('GET', '/lists', { token: noScope }), 403, 'unauthorized');
  });

  it('manages list attributes and statuses through /lists/{list}/attributes', async () => {
    const attrs = expectOk('listAttributes', await f.call('GET', '/lists/sales/attributes'));
    expect(attrs.data.map((a: { api_slug: string }) => a.api_slug)).toEqual([
      'entry_id',
      'parent_record',
      'created_at',
      'created_by',
    ]);
    const parent = attrs.data.find((a: { api_slug: string }) => a.api_slug === 'parent_record');
    expect(parent).toMatchObject({
      type: 'record-reference',
      is_system_attribute: true,
      is_writable: false,
      is_required: true,
    });
    for (const data of [
      { title: 'Stage', api_slug: 'stage', type: 'status' },
      {
        title: 'Value',
        api_slug: 'value',
        type: 'currency',
        config: { currency: { default_currency_code: 'EUR', display_type: 'symbol' } },
      },
      { title: 'Tags', api_slug: 'tags', type: 'select', is_multiselect: true },
    ]) {
      expectOk(
        'createAttribute',
        await f.call('POST', '/lists/sales/attributes', {
          body: {
            data: {
              description: null,
              is_required: false,
              is_unique: false,
              is_multiselect: false,
              config: {},
              ...data,
            },
          },
        }),
      );
    }
    for (const title of ['Lead', 'Won']) {
      expectOk(
        'createStatus',
        await f.call('POST', '/lists/sales/attributes/stage/statuses', { body: { data: { title } } }),
      );
    }
    for (const title of ['Hot', 'Big']) {
      expectOk(
        'createSelectOption',
        await f.call('POST', '/lists/sales/attributes/tags/options', { body: { data: { title } } }),
      );
    }
    const statuses = expectOk('listStatuses', await f.call('GET', '/lists/sales/attributes/stage/statuses'));
    expect(statuses.data.map((s: { title: string }) => s.title)).toEqual(['Lead', 'Won']);
  });
});

describe('entries', () => {
  let entryId: string;

  it('creates entries (duplicates allowed) and gets them', async () => {
    const created = expectOk(
      'createEntry',
      await f.call('POST', '/lists/sales/entries', {
        body: {
          data: {
            parent_record_id: acme,
            parent_object: 'companies',
            entry_values: { stage: 'Lead', value: 1000, tags: ['Hot'] },
          },
        },
      }),
    );
    entryId = created.data.id.entry_id;
    expect(created.data).toMatchObject({ parent_record_id: acme, parent_object: 'companies' });
    expect(created.data.entry_values.stage[0].status.title).toBe('Lead');
    expect(created.data.entry_values.value[0]).toMatchObject({ currency_value: 1000, currency_code: 'EUR' });
    expect(created.data.entry_values.created_by[0]).toMatchObject({ referenced_actor_type: 'api-token' });
    expect(created.data.entry_values.parent_record).toBeUndefined();

    const dup = expectOk(
      'createEntry',
      await f.call('POST', '/lists/sales/entries', {
        body: { data: { parent_record_id: acme, parent_object: 'companies', entry_values: {} } },
      }),
    );
    expect(dup.data.id.entry_id).not.toBe(entryId);
    expectOk('deleteEntry', await f.call('DELETE', `/lists/sales/entries/${dup.data.id.entry_id}`));
    expectError(
      'deleteEntry',
      await f.call('DELETE', `/lists/sales/entries/${dup.data.id.entry_id}`),
      404,
      'not_found',
    );

    const got = expectOk('getEntry', await f.call('GET', `/lists/sales/entries/${entryId}`));
    expect(got.data.id).toEqual({ workspace_id: f.workspaceId, list_id: created.data.id.list_id, entry_id: entryId });
    expectError('getEntry', await f.call('GET', `/lists/sales/entries/${crypto.randomUUID()}`), 404, 'not_found');

    expectError(
      'createEntry',
      await f.call('POST', '/lists/sales/entries', {
        body: { data: { parent_record_id: f.memberId, parent_object: 'people', entry_values: {} } },
      }),
      400,
      'validation_type',
    );
    expectError(
      'createEntry',
      await f.call('POST', '/lists/sales/entries', {
        body: { data: { parent_record_id: globex, parent_object: 'companies', entry_values: { parent_record: [] } } },
      }),
      400,
      'system_edit_unauthorized',
    );
  });

  it('PATCH appends to multiselects, PUT overwrites, values keep their history', async () => {
    const patched = expectOk(
      'updateEntry',
      await f.call('PATCH', `/lists/sales/entries/${entryId}`, {
        body: { data: { entry_values: { tags: ['Big'], stage: 'Won' } } },
      }),
    );
    expect(patched.data.entry_values.tags.map((t: { option: { title: string } }) => t.option.title).sort()).toEqual([
      'Big',
      'Hot',
    ]);
    const replaced = expectOk(
      'replaceEntry',
      await f.call('PUT', `/lists/sales/entries/${entryId}`, { body: { data: { entry_values: { tags: ['Big'] } } } }),
    );
    expect(replaced.data.entry_values.tags.map((t: { option: { title: string } }) => t.option.title)).toEqual(['Big']);
    const history = expectOk(
      'listEntryAttributeValues',
      await f.call('GET', `/lists/sales/entries/${entryId}/attributes/stage/values`, {
        query: { show_historic: 'true' },
      }),
    );
    expect(history.data.map((v: { status: { title: string } }) => v.status.title)).toEqual(['Lead', 'Won']);
    const current = expectOk(
      'listEntryAttributeValues',
      await f.call('GET', `/lists/sales/entries/${entryId}/attributes/stage/values`),
    );
    expect(current.data).toHaveLength(1);
  });

  it('asserts entries by parent: update one, create when missing, 400 on several', async () => {
    const updated = expectOk(
      'assertEntry',
      await f.call('PUT', '/lists/sales/entries', {
        body: { data: { parent_record_id: acme, parent_object: 'companies', entry_values: { value: 2500 } } },
      }),
    );
    expect(updated.data.id.entry_id).toBe(entryId);
    expect(updated.data.entry_values.value[0].currency_value).toBe(2500);
    const created = expectOk(
      'assertEntry',
      await f.call('PUT', '/lists/sales/entries', {
        body: {
          data: { parent_record_id: globex, parent_object: 'companies', entry_values: { stage: 'Lead', value: 500 } },
        },
      }),
    );
    expect(created.data.parent_record_id).toBe(globex);
    await f.call('POST', '/lists/sales/entries', {
      body: { data: { parent_record_id: initech, parent_object: 'companies', entry_values: { value: 10 } } },
    });
    await f.call('POST', '/lists/sales/entries', {
      body: { data: { parent_record_id: initech, parent_object: 'companies', entry_values: {} } },
    });
    expectError(
      'assertEntry',
      await f.call('PUT', '/lists/sales/entries', {
        body: { data: { parent_record_id: initech, parent_object: 'companies', entry_values: {} } },
      }),
      400,
      'multiple_match_results',
    );
  });

  it('queries entries with filters and sorts on list attributes and through parent_record', async () => {
    const all = expectOk('queryEntries', await f.call('POST', '/lists/sales/entries/query', { body: {} }));
    expect(all.data).toHaveLength(4);
    const won = expectOk(
      'queryEntries',
      await f.call('POST', '/lists/sales/entries/query', { body: { filter: { stage: 'Won' } } }),
    );
    expect(won.data.map((e: { parent_record_id: string }) => e.parent_record_id)).toEqual([acme]);
    const byParent = expectOk(
      'queryEntries',
      await f.call('POST', '/lists/sales/entries/query', {
        body: {
          filter: {
            path: [
              ['sales', 'parent_record'],
              ['companies', 'name'],
            ],
            constraints: { $contains: 'glob' },
          },
        },
      }),
    );
    expect(byParent.data.map((e: { parent_record_id: string }) => e.parent_record_id)).toEqual([globex]);
    const sorted = expectOk(
      'queryEntries',
      await f.call('POST', '/lists/sales/entries/query', {
        body: {
          sorts: [{ direction: 'desc', attribute: 'value' }],
          limit: 2,
          offset: 0,
        },
      }),
    );
    expect(
      sorted.data.map(
        (e: { entry_values: { value: { currency_value: number }[] } }) => e.entry_values.value[0]?.currency_value,
      ),
    ).toEqual([2500, 500]);
    expectError(
      'queryEntries',
      await f.call('POST', '/lists/sales/entries/query', { body: { filter: { nope: 1 } } }),
      400,
      'filter_error',
    );
  });

  it("lists a record's entries across lists", async () => {
    const body = expectOk('listRecordEntries', await f.call('GET', `/objects/companies/records/${acme}/entries`));
    expect(body.data).toEqual([
      { list_id: expect.any(String), list_api_slug: 'sales', entry_id: entryId, created_at: expect.any(String) },
    ]);
    expectOk('deleteEntry', await f.call('DELETE', `/lists/sales/entries/${entryId}`));
    const after = expectOk('listRecordEntries', await f.call('GET', `/objects/companies/records/${acme}/entries`));
    expect(after.data).toEqual([]);
  });
});
