// tRPC client (D-04). One HTTP batch link (queries POSTed: batched value reads exceed URL limits) carries:
// - `x-workspace-slug`: the workspace of the current route (workspace procedures), overridable per call;
// - `x-accept-after`: the newest change seq seen for that workspace (realtime I4a: "don't serve older data").
import type { AppRouter } from '@agentic-crm/api';
import { ACCEPT_AFTER_HEADER } from '@agentic-crm/realtime';
import { compareSeq } from '@agentic-crm/realtime/client';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';

export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type RouterInputs = inferRouterInputs<AppRouter>;

/** Per-call options passed as tRPC `context`. */
export interface CallContext {
  workspaceSlug?: string;
  /** Workspace whose accept-after watermark applies (defaults to the current workspace). */
  workspaceId?: string;
  [key: string]: unknown;
}

export interface WorkspaceRef {
  id: string;
  slug: string;
}

let currentWorkspace: WorkspaceRef | null = null;

/** Set by the workspace route; scopes every call that does not name another workspace. */
export function setCurrentWorkspace(workspace: WorkspaceRef | null): void {
  currentWorkspace = workspace;
}

export function getCurrentWorkspace(): WorkspaceRef | null {
  return currentWorkspace;
}

/** tRPC call options for a workspace-scoped procedure. */
export function inWorkspace(workspace: WorkspaceRef): { context: CallContext } {
  return { context: { workspaceId: workspace.id, workspaceSlug: workspace.slug } };
}

// ---- accept-after watermarks --------------------------------------------------------------------------------

const watermarks = new Map<string, string>();

/** Records a change seq (invalidation or mutation response); later reads of the workspace send it. */
export function noteAcceptAfter(workspaceId: string, seq: string | null | undefined): void {
  if (!seq) return;
  const prev = watermarks.get(workspaceId);
  if (prev === undefined || compareSeq(seq, prev) > 0) watermarks.set(workspaceId, seq);
}

export function acceptAfterFor(workspaceId: string | undefined): string | undefined {
  return workspaceId ? watermarks.get(workspaceId) : undefined;
}

export function resetAcceptAfter(): void {
  watermarks.clear();
}

// ---- client ---------------------------------------------------------------------------------------------------

function trpcUrl(): string {
  return typeof window === 'undefined' ? 'http://localhost/trpc' : `${window.location.origin}/trpc`;
}

export const api = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink<AppRouter>({
      url: trpcUrl(),
      methodOverride: 'POST',
      maxItems: 50,
      headers({ opList }) {
        const headers: Record<string, string> = {};
        const first = (opList[0]?.context ?? {}) as CallContext;
        const slug = first.workspaceSlug ?? currentWorkspace?.slug;
        if (slug) headers['x-workspace-slug'] = slug;
        let acceptAfter: string | undefined;
        for (const op of opList) {
          const c = (op.context ?? {}) as CallContext;
          const seq = acceptAfterFor(c.workspaceId ?? currentWorkspace?.id);
          if (seq && (acceptAfter === undefined || compareSeq(seq, acceptAfter) > 0)) acceptAfter = seq;
        }
        if (acceptAfter) headers[ACCEPT_AFTER_HEADER] = acceptAfter;
        return headers;
      },
      fetch(url, init) {
        return fetch(url, { ...(init as RequestInit), credentials: 'include' });
      },
    }),
  ],
});

// ---- errors ---------------------------------------------------------------------------------------------------

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

interface EnvelopeShape {
  message?: string;
  statusCode?: number;
  additional_information?: { code?: string } | null;
  data?: { httpStatus?: number };
}

/** HTTP status of a tRPC / fetch error, or 0 for network failures. */
export function httpStatusOf(error: unknown): number {
  if (error instanceof TRPCClientError) {
    const data = error.data as EnvelopeShape['data'] | undefined;
    if (typeof data?.httpStatus === 'number') return data.httpStatus;
    const shape = error.shape as EnvelopeShape | undefined;
    if (typeof shape?.statusCode === 'number') return shape.statusCode;
    return 0;
  }
  if (error instanceof HttpError) return error.status;
  return 0;
}

/** the error envelope fields when the server sent one (`additional_information.code`, e.g. SLUG_IN_USE). */
export function errorEnvelopeOf(error: unknown): { message?: string; code?: string } {
  if (error instanceof TRPCClientError) {
    const shape = error.shape as EnvelopeShape | undefined;
    return { message: shape?.message ?? error.message, code: shape?.additional_information?.code ?? undefined };
  }
  if (error instanceof HttpError) return { message: error.message, code: error.code };
  return { message: error instanceof Error ? error.message : undefined };
}

export function isUnauthorized(error: unknown): boolean {
  return httpStatusOf(error) === 401;
}

/** Network failures, timeouts, rate limits and 5xx are worth retrying; other 4xx are final. */
export function isRetryable(error: unknown): boolean {
  const status = httpStatusOf(error);
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

/** JSON request to a non-tRPC endpoint (Better Auth under /api/auth). Throws HttpError with the envelope message. */
export async function requestJson<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'include',
      ...rest,
      headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch (err) {
    throw new HttpError(0, err instanceof Error ? err.message : 'Network error');
  }
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const env = (body ?? {}) as { message?: string; code?: string; additional_information?: { code?: string } };
    throw new HttpError(
      response.status,
      env.message ?? response.statusText,
      env.code ?? env.additional_information?.code,
    );
  }
  return body as T;
}
