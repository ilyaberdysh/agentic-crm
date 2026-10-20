// @agentic-crm/api — Fastify: tRPC (/trpc), public REST (/v2), auth (/api/auth), realtime WS (/realtime).
// Library surface (no side effects); the runnable entry is src/server.ts.
export { type ApiApp, type BuildAppOptions, buildApp } from './app';
export type { Auth, AuthSession, AuthUser } from './auth/auth';
export { type ApiConfig, loadConfig } from './config';
export { ApiError, type ErrorEnvelope, toApiError, toEnvelope } from './errors';
export type { AppRouter } from './trpc/router';
export type { Context } from './trpc/trpc';
export type {
  AccessLevel,
  MembershipRef,
  WorkspaceKey,
  WorkspaceRef,
  WorkspaceResolution,
  WorkspaceResolver,
  WorkspaceWithMembership,
} from './workspaces/resolver';
