import { v2Routes } from '@agentic-crm/contracts/v2';
import type { Domain } from '@agentic-crm/domain';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { publicApiPlugin, ROUTES } from '../../src/v2/plugin';
import { bindRoutes, openApiPath, type RouteSpec } from '../../src/v2/route';
import { openapi } from './support';

const specs = (): RouteSpec[] =>
  ROUTES.map(({ logicalOperationId, ...route }) => ({
    ...route,
    operationId: logicalOperationId,
  }));

describe('public API route contract', () => {
  it('registers every owned OpenAPI operation with matching IDs, scopes and rate limits, including introspection', async () => {
    const app = Fastify({ exposeHeadRoutes: false });
    const registered: { method: string; path: string; operationId: unknown; scopes: unknown; rateClass: unknown }[] =
      [];
    app.addHook('onRoute', (route) => {
      registered.push({
        method: String(route.method),
        path: openApiPath(route.url.replace(/^\/v2/, '')),
        operationId: route.config?.operationId,
        scopes: route.config?.requiredScopes,
        rateClass: route.config?.rateClass,
      });
    });
    try {
      // Registration has no database side effects; handlers are exercised with real identities in the API tests.
      await app.register(publicApiPlugin, { prefix: '/v2', domain: {} as Domain, webUrl: 'http://localhost' });
      await app.ready();
      expect(registered).toHaveLength(v2Routes.length);
      const methods = new Set(['get', 'post', 'put', 'patch', 'delete']);
      const documented = Object.entries(openapi.paths).flatMap(([path, operations]) =>
        Object.entries(operations)
          .filter(([method]) => methods.has(method))
          .map(([method, operation]) => ({
            method: method.toUpperCase(),
            path,
            operationId: operation.operationId,
            scopes: operation['x-required-scopes'],
            rateClass: operation['x-rate-class'],
          })),
      );
      const sorted = <T extends { method: string; path: string }>(routes: T[]) =>
        routes.sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
      expect(sorted(registered)).toEqual(sorted(documented));
      expect(registered.filter((route) => route.path === '/v2/self')).toEqual([
        { method: 'GET', path: '/v2/self', operationId: 'getSelf', scopes: [], rateClass: 'read' },
      ]);
      expect(new Set(registered.map((route) => route.operationId)).size).toBe(registered.length);
    } finally {
      await app.close();
    }
  });

  it('rejects missing, duplicate and mislabeled routes before registration', () => {
    const routes = specs();
    const first = routes[0] as RouteSpec;
    expect(() => bindRoutes(routes.slice(1))).toThrow(/Missing public API route/);
    expect(() => bindRoutes([...routes, first])).toThrow(/Duplicate public API route/);
    expect(() => bindRoutes([{ ...first, operationId: 'listObjects' }, ...routes.slice(1)])).toThrow(
      /operation mismatch/,
    );
  });

  it('rejects changes to authorization scopes and rate-limit classes', () => {
    const routes = specs();
    const first = routes[0] as RouteSpec;
    expect(() => bindRoutes([{ ...first, scopes: ['record_permission:read'] }, ...routes.slice(1)])).toThrow(
      /scope mismatch/,
    );
    expect(() => bindRoutes([{ ...first, kind: 'write' }, ...routes.slice(1)])).toThrow(/rate-limit mismatch/);
  });
});
