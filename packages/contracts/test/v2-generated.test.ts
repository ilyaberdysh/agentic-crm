import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createAttributeBody,
  createRecordBody,
  getSelfResponse,
  missingScopes,
  normalizeScopes,
  queryRecordsBody,
  scopeSatisfies,
  v2Operations,
} from '../src/v2/index.ts';

const slice = JSON.parse(readFileSync(new URL('../src/v2/openapi.gen.json', import.meta.url), 'utf8')) as {
  errata: string[];
  operations: Record<
    string,
    {
      method: string;
      path: string;
      scopes: string[];
      examples: { request?: Record<string, unknown>; response?: Record<string, unknown> };
    }
  >;
};

describe('generated /v2 contracts', () => {
  it('cover the 26 slice-1, 21 slice-3, 13 slice-4, 5 slice-6 and 11 slice-7 operations with the spec method, path and scopes', () => {
    expect(Object.keys(v2Operations)).toHaveLength(76);
    for (const [name, op] of Object.entries(v2Operations)) {
      const spec = slice.operations[name];
      expect(spec, name).toBeDefined();
      expect(op.method).toBe(spec?.method.toUpperCase());
      expect(op.path).toBe(spec?.path);
      expect([...op.scopes]).toEqual(spec?.scopes);
    }
    expect(v2Operations.createRecord.scopes).toEqual(['record_permission:read-write', 'object_configuration:read']);
    expect(v2Operations.getSelf.scopes).toEqual([]);
    expect(v2Operations.createNote.scopes).toEqual([
      'note:read-write',
      'object_configuration:read',
      'record_permission:read',
    ]);
    expect(v2Operations.deleteComment.scopes).toEqual(['comment:read-write']);
    expect(v2Operations.createWebhook.scopes).toEqual(['webhook:read-write']);
    expect(v2Operations.listWebhooks.scopes).toEqual(['webhook:read']);
    expect(v2Operations.createMeeting.scopes).toEqual(['meeting:read-write', 'record_permission:read']);
    expect(v2Operations.createCallRecording.scopes).toEqual(['meeting:read', 'call_recording:read-write']);
  });

  it('record the spec errata they apply', () => {
    expect(slice.errata.map((e) => e.slice(0, 2))).toEqual(expect.arrayContaining(['E1', 'E2', 'E3', 'E4', 'E6']));
  });

  it("accept the spec's documented examples", () => {
    for (const example of Object.values(slice.operations.getSelf?.examples.response ?? {})) {
      expect(getSelfResponse.safeParse(example).success).toBe(true);
    }
    const queries = Object.values(slice.operations.queryRecords?.examples.request ?? {});
    expect(queries.length).toBeGreaterThan(0);
    for (const example of queries) expect(queryRecordsBody.parse(example)).toEqual(example);
  });

  it('keep free-form filters and single values (errata E4) intact', () => {
    const filter = { $and: [{ name: { first_name: { $eq: 'Ada' } } }, { email_addresses: 'ada@example.com' }] };
    expect(queryRecordsBody.parse({ filter }).filter).toEqual(filter);
    const values = { '41252299-f8c7-4b5e-99c9-4ff8321d2f96': 'Text value', multiselect_attribute: ['A', 'B'] };
    expect(createRecordBody.parse({ data: { values } }).data.values).toEqual(values);
  });

  it('require the documented create-attribute fields, description included (erratum E3)', () => {
    const data = {
      title: 'Budget',
      description: null,
      api_slug: 'budget',
      type: 'currency',
      is_required: false,
      is_unique: false,
      is_multiselect: false,
      config: { currency: { default_currency_code: 'USD', display_type: 'symbol' } },
    };
    expect(createAttributeBody.safeParse({ data }).success).toBe(true);
    const { description: _description, ...withoutDescription } = data;
    expect(createAttributeBody.safeParse({ data: withoutDescription }).success).toBe(false);
    expect(createAttributeBody.safeParse({ data: { ...data, unknown: 1 } }).success).toBe(false);
  });
});

describe('API scopes', () => {
  it('read-write includes read; missing scopes are reported', () => {
    expect(scopeSatisfies(['record_permission:read-write'], 'record_permission:read')).toBe(true);
    expect(scopeSatisfies(['record_permission:read'], 'record_permission:read-write')).toBe(false);
    expect(missingScopes(['note:read'], ['note:read', 'task:read'])).toEqual(['task:read']);
    expect(normalizeScopes(['note:read', 'note:read-write', 'task:read', 'task:read'])).toEqual([
      'task:read',
      'note:read-write',
    ]);
  });
});
