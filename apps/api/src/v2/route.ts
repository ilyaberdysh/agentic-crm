// Route definition shared by the /v2 handlers: each route names its required scopes (from the generated operation
// table, or computed from the path for `/{target}/…` routes) and gets a V2Context for the authenticated token.
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { V2Context } from './context';
import { describeZodError, publicErrors } from './errors';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteSpec {
  method: Method;
  /** Path under /v2, Fastify syntax (e.g. `/objects/:object`). */
  url: string;
  scopes: readonly string[] | ((params: Record<string, string>) => readonly string[]);
  /** Rate-limit class; defaults to read for GET and write otherwise. */
  kind?: 'read' | 'write';
  /** Request body limit in bytes (default: the app's 1 MiB). */
  bodyLimit?: number;
  handler: (v2: V2Context, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
}

/** Validates input with a generated schema; failures are Attio's 400 validation_type. */
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
