// Contract-test support for /v2: a running app (agentic_crm_test_api), a workspace with an API token, an HTTP helper, and
// validators that check every response against Attio's OpenAPI response schema (ajv, from the generated slice of
// api.json) and against the generated Zod schema of the operation.
import { readFileSync } from 'node:fs';
import { type ApiScope, apiScopeResources } from '@agentic-crm/contracts';
import type { V2OperationName } from '@agentic-crm/contracts/v2';
import * as v2 from '@agentic-crm/contracts/v2';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { expect } from 'vitest';
import { createWorkspaceToken } from '../../src/cli/token-create';
import { createWorkspaceWithMembers, type Harness, signUp, type TestUser } from '../support/harness';

const SLICE_PATH = new URL('../../../../packages/contracts/src/v2/openapi.gen.json', import.meta.url);
export const slice = JSON.parse(readFileSync(SLICE_PATH, 'utf8')) as {
  operations: Record<string, { method: string; path: string; responses: Record<string, Record<string, unknown>> }>;
};

// ajv-formats is CommonJS; its default export arrives wrapped depending on the loader.
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ?? addFormatsModule) as (
  ajv: Ajv2020,
) => void;
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(slice, 'slice');

/** Every error code in Attio's spec (data-model-documented §3.6) plus the documented auth and rate-limit codes. */
export const DOCUMENTED_ERROR_CODES = [
  'billing_error',
  'concurrent_write_conflict',
  'duplicate_values',
  'filter_error',
  'formula_edit_unauthorized',
  'immutable_value',
  'limit_reached',
  'matching_attribute_definition_not_unique',
  'merge_in_progress',
  'missing_value',
  'multiple_match_results',
  'multiple_values_for_single_value_attribute',
  'not_found',
  'particle_gate_violation',
  'quota_exceeded',
  'self_merge',
  'slug_conflict',
  'standard_object_disabled',
  'system_edit_unauthorized',
  'unauthorized',
  'uniqueness_conflict',
  'validation_type',
  'value_not_found',
  'rate_limit_exceeded',
];

const genericError = ajv.compile({
  type: 'object',
  properties: {
    status_code: { type: 'number' },
    type: { enum: ['invalid_request_error', 'auth_error', 'rate_limit_error'] },
    code: { enum: DOCUMENTED_ERROR_CODES },
    message: { type: 'string', minLength: 1 },
  },
  required: ['status_code', 'type', 'code', 'message'],
  additionalProperties: false,
});

const compiled = new Map<string, ValidateFunction | null>();
function responseValidator(op: V2OperationName, status: number): ValidateFunction | null {
  const key = `${op}:${status}`;
  if (!compiled.has(key)) {
    const declared = slice.operations[op]?.responses[String(status)];
    compiled.set(key, declared ? (ajv.getSchema(`slice#/operations/${op}/responses/${status}`) ?? null) : null);
  }
  return compiled.get(key) ?? null;
}

function describe(validate: ValidateFunction): string {
  return ajv.errorsText(validate.errors, { separator: '\n' });
}

export interface ApiResponse<T = any> {
  status: number;
  headers: Headers;
  body: T;
}

/** A 200 response that matches Attio's schema for the operation (ajv) and the generated Zod schema. */
export function expectOk<T = any>(op: V2OperationName, response: ApiResponse<T>): T {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const validate = responseValidator(op, 200);
  if (!validate) throw new Error(`No 200 schema for ${op}`);
  if (!validate(response.body)) throw new Error(`${op} 200 does not match the OpenAPI schema:\n${describe(validate)}`);
  const zod = (v2 as unknown as Record<string, { safeParse(x: unknown): { success: boolean; error?: unknown } }>)[
    `${op}Response`
  ];
  const parsed = zod?.safeParse(response.body);
  if (!parsed?.success) throw new Error(`${op} 200 does not match the generated Zod schema: ${String(parsed?.error)}`);
  return response.body;
}

/**
 * An error response with the given status and code, in Attio's error shape. When the operation declares a schema
 * for the status that lists the code, the body must match it exactly; otherwise it must match the generic documented
 * error shape (status not declared, e.g. 401) or the call must name the documented deviation it relies on.
 */
export function expectError(
  op: V2OperationName,
  response: ApiResponse,
  status: number,
  code: string,
  options: { deviation?: string } = {},
): { message: string } {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(response.body).toMatchObject({ status_code: status, code });
  if (!genericError(response.body)) throw new Error(`Not Attio's error shape:\n${describe(genericError)}`);
  const validate = responseValidator(op, status);
  if (validate && !validate(response.body)) {
    if (!options.deviation) {
      throw new Error(`${op} ${status} does not match the OpenAPI schema:\n${describe(validate)}`);
    }
  }
  return response.body as { message: string };
}

export interface V2Fixture {
  h: Harness;
  user: TestUser;
  workspaceId: string;
  memberId: string;
  slug: string;
  /** Token with every scope (read-write). */
  token: string;
  tokenId: string;
  call<T = any>(
    method: string,
    path: string,
    options?: {
      token?: string | null;
      body?: unknown;
      query?: Record<string, string>;
      headers?: Record<string, string>;
    },
  ): Promise<ApiResponse<T>>;
  /** Mints another token for the workspace. */
  mint(scopes: ApiScope[], name?: string): Promise<string>;
}

let seq = 0;

export async function v2Fixture(h: Harness, label: string): Promise<V2Fixture> {
  const user = await signUp(h, 'Ada Lovelace');
  const slug = `${label}-${Date.now().toString(36)}-${seq++}`;
  const { workspaceId, memberIds } = await createWorkspaceWithMembers(h, slug, [{ user, admin: true }]);
  const mint = async (scopes: ApiScope[], name = 'Contract tests') =>
    (await createWorkspaceToken(h.database, h.domain, slug, name, scopes)).token;
  const all = apiScopeResources.map((r) => `${r}:read-write` as ApiScope);
  const created = await createWorkspaceToken(h.database, h.domain, slug, 'All scopes', all);
  const fixture: V2Fixture = {
    h,
    user,
    workspaceId,
    memberId: memberIds.get(user.id) as string,
    slug,
    token: created.token,
    tokenId: created.id,
    mint,
    async call(method, path, options = {}) {
      const url = new URL(`${h.baseUrl}/v2${path}`);
      for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, v);
      const token = options.token === undefined ? created.token : options.token;
      const response = await fetch(url, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...options.headers,
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
      const text = await response.text();
      return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
    },
  };
  return fixture;
}
