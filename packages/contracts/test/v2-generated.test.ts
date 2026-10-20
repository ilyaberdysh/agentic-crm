import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_STORAGE_PROVIDER,
  buildOpenApiDocument,
  createAttributeBody,
  createFileEntryBody,
  createRecordBody,
  fileEntrySchema,
  getOperationRoute,
  getSelfResponse,
  listAttributesQuery,
  listFilesQuery,
  missingScopes,
  normalizeScopes,
  PUBLIC_API_ISSUER,
  producedWebhookEventTypes,
  publicErrorSchema,
  queryRecordsBody,
  recordSchema,
  renderOpenApiDocument,
  scopeSatisfies,
  selfResponseExamples,
  updateNoteBody,
  v2Operations,
  v2Routes,
} from '../src/v2/index.ts';

const uuid = '00000000-0000-4000-8000-000000000001';

describe('Agentic CRM public REST contract', () => {
  it('has 76 logical operations and 86 unique implemented HTTP routes', () => {
    expect(Object.keys(v2Operations)).toHaveLength(76);
    expect(v2Routes).toHaveLength(86);
    expect(new Set(v2Routes.map((route) => `${route.method} ${route.path}`)).size).toBe(86);
    expect(new Set(v2Routes.map((route) => route.operationId)).size).toBe(86);
    for (const route of v2Routes) {
      expect(Object.keys(route.pathParams.shape).sort()).toEqual(
        [...route.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).sort(),
      );
      if (route.responseStatus !== 204 && route.responseStatus !== 302)
        expect(route.responseSchema, route.operationId).toBeDefined();
    }
  });

  it('assigns each attribute route the concrete target permissions', () => {
    const attributeRoutes = v2Routes.filter((route) => route.target);
    expect(attributeRoutes).toHaveLength(20);
    for (const route of attributeRoutes) {
      expect(route.path).not.toContain('{target}');
      expect(route.scopes).toEqual([
        `${route.target === 'objects' ? 'object_configuration' : 'list_configuration'}:${route.method === 'GET' ? 'read' : 'read-write'}`,
      ]);
    }
    expect(getOperationRoute('listAttributes', 'lists').path).toBe('/v2/lists/{list}/attributes');
    expect(() => getOperationRoute('listAttributes')).toThrow(/target/);
    expect(getOperationRoute('getSelf').scopes).toEqual([]);
    for (const name of ['queryRecords', 'queryEntries', 'searchRecords'] as const)
      expect(getOperationRoute(name).rateClass).toBe('read');
    expect(getOperationRoute('createRecord').rateClass).toBe('write');
  });

  it('preserves attribute-dependent JSON, optional query bodies and HTTP query coercion', () => {
    const filter = { $and: [{ name: { first_name: { $eq: 'Ada' } } }, { email_addresses: 'ada@example.com' }] };
    expect(queryRecordsBody.parse({ filter }).filter).toEqual(filter);
    const values = { [uuid]: 'Text value', choices: ['A', 'B'], budget: { currency_value: 12, currency_code: 'USD' } };
    expect(createRecordBody.parse({ data: { values } }).data.values).toEqual(values);
    expect(queryRecordsBody.parse({})).toEqual({});
    expect(getOperationRoute('queryRecords').bodyRequired).toBe(false);
    expect(listAttributesQuery.parse({ limit: '10', offset: '0', show_archived: 'false' })).toEqual({
      limit: 10,
      offset: 0,
      show_archived: false,
    });
  });

  it('retains required and strict input boundaries', () => {
    const fields = {
      title: 'Budget',
      description: null,
      api_slug: 'budget',
      type: 'currency',
      is_required: false,
      is_unique: false,
      is_multiselect: false,
      config: { currency: { default_currency_code: 'USD', display_type: 'symbol' } },
    };
    expect(createAttributeBody.safeParse({ data: fields }).success).toBe(true);
    const { description: _description, ...withoutDescription } = fields;
    expect(createAttributeBody.safeParse({ data: withoutDescription }).success).toBe(false);
    expect(createAttributeBody.safeParse({ data: { ...fields, unknown: 1 } }).success).toBe(false);
    expect(updateNoteBody.safeParse({ data: { title: 'Updated', unsupported: true } }).success).toBe(false);
  });

  it('validates records through value history and type-specific output fields', () => {
    const record = {
      id: { workspace_id: uuid, object_id: uuid, record_id: uuid },
      created_at: '2026-10-20T00:00:00.000000000Z',
      web_url: 'https://example.com/record',
      values: {
        name: [
          {
            attribute_type: 'text',
            value: 'Ada',
            active_from: '2026-10-20T00:00:00Z',
            active_until: null,
            created_by_actor: { type: 'system', id: null },
          },
        ],
      },
    };
    expect(recordSchema.safeParse(record).success).toBe(true);
    expect(
      recordSchema.safeParse({ ...record, values: { name: [{ ...record.values.name[0], value: 5 }] } }).success,
    ).toBe(false);
    expect(recordSchema.safeParse({ ...record, id: { ...record.id, record_id: 'bad' } }).success).toBe(false);
  });

  it('uses its own issuer and file provider, without connected-storage output capabilities', () => {
    for (const example of Object.values(selfResponseExamples))
      expect(getSelfResponse.safeParse(example.value).success).toBe(true);
    expect(selfResponseExamples.workspace.value.iss).toBe(PUBLIC_API_ISSUER);
    expect(getSelfResponse.safeParse({ ...selfResponseExamples.workspace.value, iss: 'example.com' }).success).toBe(
      false,
    );
    const folder = {
      id: { workspace_id: uuid, file_id: uuid },
      object_id: uuid,
      object_slug: 'companies',
      record_id: uuid,
      storage_provider: BUILTIN_STORAGE_PROVIDER,
      created_by_actor: { type: 'system', id: null },
      created_at: '2026-10-20T00:00:00Z',
      name: 'Documents',
      parent_folder_id: null,
      file_type: 'folder',
    };
    expect(fileEntrySchema.safeParse(folder).success).toBe(true);
    expect(fileEntrySchema.safeParse({ ...folder, file_type: 'connected-folder' }).success).toBe(false);
    expect(fileEntrySchema.safeParse({ ...folder, storage_provider: 'dropbox' }).success).toBe(false);
    expect(listFilesQuery.safeParse({ object: 'companies', record_id: uuid, storage_provider: 'attio' }).success).toBe(
      true,
    );
    // Preserve the handler's explicit rejection path without advertising a supported request capability in OpenAPI.
    expect(
      createFileEntryBody.safeParse({
        object: 'companies',
        record_id: uuid,
        file_type: 'connected-file',
        storage_provider: 'dropbox',
        external_provider_file_id: 'legacy',
      }).success,
    ).toBe(true);
  });

  it('uses one strict error envelope for every failure class', () => {
    expect(
      publicErrorSchema.safeParse({
        status_code: 500,
        type: 'api_error',
        code: 'internal_error',
        message: 'Request failed',
      }).success,
    ).toBe(true);
    expect(
      publicErrorSchema.safeParse({
        statusCode: 400,
        type: 'invalid_request_error',
        code: 'validation_type',
        message: 'Invalid input',
      }).success,
    ).toBe(false);
  });
});

describe('OpenAPI generation', () => {
  it('generates standard OpenAPI 3.1 from the implemented route manifest', () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Agentic CRM API');
    expect(doc).not.toHaveProperty('source');
    expect(doc).not.toHaveProperty('operations');
    for (const route of v2Routes) {
      const operation = doc.paths[route.path]?.[route.method.toLowerCase()];
      expect(operation?.operationId).toBe(route.operationId);
      expect(operation?.['x-required-scopes']).toEqual(route.scopes);
      expect(operation?.responses[String(route.responseStatus)]).toBeDefined();
      expect(operation?.responses['422']).toHaveProperty('content.application/json');
    }
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(doc['x-produced-webhook-events']).toEqual(producedWebhookEventTypes);
    expect(doc['x-produced-webhook-events']).toHaveLength(27);
  });

  it('describes multipart uploads, redirect headers, bodyless deletes and supported file creation', () => {
    const doc = buildOpenApiDocument();
    const upload = doc.paths['/v2/files/upload']?.post;
    expect(upload?.requestBody).toHaveProperty('content.multipart/form-data');
    expect(upload?.responses['201']).toHaveProperty('content.application/json');
    expect(doc.paths['/v2/files/{file_id}/download']?.get?.responses['302']).toHaveProperty('headers.Location');
    expect(
      doc.paths['/v2/meetings/{meeting_id}/call_recordings/{call_recording_id}']?.delete?.responses['204'],
    ).not.toHaveProperty('content');
    const body = doc.components.schemas.createFileEntryBody;
    expect(JSON.stringify(body)).toContain('folder');
    expect(JSON.stringify(body)).not.toContain('connected-file');
  });

  it('has no dangling component references', () => {
    const doc = buildOpenApiDocument();
    const refs = [...JSON.stringify(doc).matchAll(/"\$ref":"#\/components\/schemas\/([^"/]+)"/g)];
    expect(refs.length).toBeGreaterThan(70);
    for (const ref of refs) expect(doc.components.schemas[ref[1] as string], ref[1]).toBeDefined();
  });

  it('is deterministic, committed, and reproducible in check mode', () => {
    const committed = readFileSync(new URL('../src/v2/openapi.gen.json', import.meta.url), 'utf8');
    expect(renderOpenApiDocument()).toBe(committed);
    execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/generate-v2.ts', import.meta.url)), '--check']);
  });
});

describe('API scopes', () => {
  it('read-write includes read and keeps stable normalized scope names', () => {
    expect(scopeSatisfies(['record_permission:read-write'], 'record_permission:read')).toBe(true);
    expect(scopeSatisfies(['record_permission:read'], 'record_permission:read-write')).toBe(false);
    expect(missingScopes(['note:read'], ['note:read', 'task:read'])).toEqual(['task:read']);
    expect(normalizeScopes(['note:read', 'note:read-write', 'task:read', 'task:read'])).toEqual([
      'task:read',
      'note:read-write',
    ]);
  });
});
