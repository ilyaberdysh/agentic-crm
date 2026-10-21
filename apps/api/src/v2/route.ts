// Public routes bind a logical operation to a concrete method/path in the product-owned route manifest.
import { type V2OperationName, type V2Route, v2Routes } from '@agentic-crm/contracts/v2';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { V2Context } from './context';
import { describeZodError, publicErrors } from './errors';

declare module 'fastify' {
  interface FastifyContextConfig {
    operationId?: string;
    logicalOperationId?: V2OperationName;
    requiredScopes?: readonly string[];
    rateClass?: 'read' | 'write';
  }
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteSpec {
  method: Method;
  /** Path under /v2, Fastify syntax (e.g. `/objects/:object`). */
  url: string;
  /** Shared attribute handlers use one logical ID for the object and list variants. */
  operationId: V2OperationName;
  scopes: readonly string[];
  /** Rate-limit class; defaults to read for GET and write otherwise. */
  kind?: 'read' | 'write';
  /** Request body limit in bytes (default: the app's 1 MiB). */
  bodyLimit?: number;
  handler: (v2: V2Context, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
}

export interface RegisteredRouteSpec extends Omit<RouteSpec, 'operationId' | 'kind'> {
  /** Unique OpenAPI operation ID of this concrete route. */
  operationId: V2Route['operationId'];
  logicalOperationId: V2OperationName;
  kind: 'read' | 'write';
}

export function openApiPath(url: string): string {
  return `/v2${url.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}')}`;
}

/** Fail startup when runtime routes and the owned contract differ, including scopes and rate-limit class. */
export function bindRoutes(
  specs: readonly RouteSpec[],
  manifest: readonly V2Route[] = v2Routes,
): RegisteredRouteSpec[] {
  const seen = new Set<string>();
  const registered = specs.map((spec): RegisteredRouteSpec => {
    const path = openApiPath(spec.url);
    const key = `${spec.method} ${path}`;
    if (seen.has(key)) throw new Error(`Duplicate public API route: ${key}`);
    seen.add(key);
    const matches = manifest.filter((route) => route.method === spec.method && route.path === path);
    const contract = matches[0];
    if (matches.length !== 1 || !contract || contract.logicalOperationId !== spec.operationId) {
      throw new Error(`Public API operation mismatch: ${key} (${spec.operationId})`);
    }
    if ([...spec.scopes].sort().join('\n') !== [...contract.scopes].sort().join('\n')) {
      throw new Error(`Public API scope mismatch: ${key} (${contract.operationId})`);
    }
    const kind = spec.kind ?? (spec.method === 'GET' ? 'read' : 'write');
    if (kind !== contract.rateClass) {
      throw new Error(`Public API rate-limit mismatch: ${key} (${contract.operationId})`);
    }
    return { ...spec, operationId: contract.operationId, logicalOperationId: spec.operationId, kind };
  });
  for (const route of manifest) {
    const key = `${route.method} ${route.path}`;
    if (!seen.has(key)) throw new Error(`Missing public API route: ${key} (${route.operationId})`);
  }
  const ids = registered.map((route) => route.operationId);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate public API operation ID');
  return registered;
}

/** Validates input with a generated schema; failures are the public API's 400 validation_type. */
export function parseInput<S extends z.ZodType>(schema: S, value: unknown, what: string): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw publicErrors.validation(`Invalid ${what}: ${describeZodError(result.error)}.`);
  return result.data;
}

export function params(request: FastifyRequest): Record<string, string> {
  return request.params as Record<string, string>;
}

/** `limit`/`offset` slicing for the GET endpoints documented with them (no defaults: everything). */
export function page<T>(items: T[], query: { limit?: number | undefined; offset?: number | undefined }): T[] {
  const offset = Math.max(0, Math.trunc(query.offset ?? 0));
  const limit = query.limit === undefined ? undefined : Math.max(0, Math.trunc(query.limit));
  return limit === undefined ? items.slice(offset) : items.slice(offset, offset + limit);
}
