// Contract tests exercise the running API and validate responses against standard OpenAPI 3.1 and Zod schemas.
import { readFileSync } from 'node:fs';
import { type ApiScope, apiScopeResources } from '@agentic-crm/contracts';
import type { V2OperationName } from '@agentic-crm/contracts/v2';
import * as v2 from '@agentic-crm/contracts/v2';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { expect } from 'vitest';
import { createWorkspaceToken } from '../../src/cli/token-create';
import { createWorkspaceWithMembers, type Harness, signUp, type TestUser } from '../support/harness';

interface OpenApiResponse {
  content?: Record<
    string,
    {
      schema?: Record<string, unknown>;
      examples?: Record<string, { value: unknown }>;
    }
  >;
}

export interface OpenApiOperation {
  operationId: string;
  'x-logical-operation-id': V2OperationName;
  'x-required-scopes': string[];
  'x-rate-class': 'read' | 'write';
  responses: Record<string, OpenApiResponse>;
}

const OPENAPI_PATH = new URL('../../../../packages/contracts/src/v2/openapi.gen.json', import.meta.url);
export const openapi = JSON.parse(readFileSync(OPENAPI_PATH, 'utf8')) as {
  openapi: string;
  paths: Record<string, Record<string, OpenApiOperation>>;
};

export function operationResponse(op: V2OperationName, status: number): OpenApiResponse | undefined {
  const route = v2.v2Routes.find((entry) => entry.logicalOperationId === op);
  return route ? openapi.paths[route.path]?.[route.method.toLowerCase()]?.responses[String(status)] : undefined;
}

// ajv-formats is CommonJS; its default export arrives wrapped depending on the loader.
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ?? addFormatsModule) as (
  ajv: Ajv2020,
) => void;
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(openapi, 'public-api');

const genericError = ajv.compile({ $ref: 'public-api#/components/schemas/PublicError' });

const compiled = new Map<string, ValidateFunction | null>();
function responseValidator(op: V2OperationName, status: number): ValidateFunction | null {
  const key = `${op}:${status}`;
  if (!compiled.has(key)) {
    const escapePointer = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1');
    const references = v2.v2Routes
      .filter((route) => route.logicalOperationId === op)
      .flatMap((route) => {
        const method = route.method.toLowerCase();
        const response = openapi.paths[route.path]?.[method]?.responses[String(status)];
        if (!response?.content?.['application/json']?.schema) return [];
        return [
          {
            $ref: `public-api#/paths/${escapePointer(route.path)}/${method}/responses/${status}/content/application~1json/schema`,
          },
        ];
      });
    compiled.set(key, references.length > 0 ? ajv.compile({ anyOf: references }) : null);
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

/** A 200 response that matches both the owned OpenAPI schema and the runtime Zod response schema. */
export function expectOk<T = any>(op: V2OperationName, response: ApiResponse<T>): T {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const validate = responseValidator(op, 200);
  if (!validate) throw new Error(`No 200 schema for ${op}`);
  if (!validate(response.body)) throw new Error(`${op} 200 does not match the OpenAPI schema:\n${describe(validate)}`);
  const zod = (v2 as unknown as Record<string, { safeParse(x: unknown): { success: boolean; error?: unknown } }>)[
    `${op}Response`
  ];
  const parsed = zod?.safeParse(response.body);
  if (!parsed?.success) throw new Error(`${op} 200 does not match the Zod schema: ${String(parsed?.error)}`);
  return response.body;
}

/** Every error must match the shared envelope and the operation's standard OpenAPI response schema. */
export function expectError(
  op: V2OperationName,
  response: ApiResponse,
  status: number,
  code: string,
): { message: string } {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(response.body).toMatchObject({ status_code: status, code });
  if (!genericError(response.body)) throw new Error(`Invalid public API error shape:\n${describe(genericError)}`);
  const validate = responseValidator(op, status);
  if (!validate) throw new Error(`No ${status} schema for ${op}`);
  if (!validate(response.body))
    throw new Error(`${op} ${status} does not match the OpenAPI schema:\n${describe(validate)}`);
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
