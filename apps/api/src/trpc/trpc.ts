// tRPC 11 (D-04): context, error envelope, and the auth / workspace-member / admin procedure builders.
import type { ResolvedActionPolicy } from '@agentic-crm/contracts';
import { type Domain, memberContext, type ServiceContext } from '@agentic-crm/domain';
import { initTRPC, TRPCError } from '@trpc/server';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';
import type { FastifyBaseLogger } from 'fastify';
import type { AuthSessionRecord, AuthUser } from '../auth/auth';
import {
  ApiError,
  type ErrorEnvelope,
  toApiError,
  toEnvelope,
  UNAUTHENTICATED_MESSAGE,
  validationInfo,
} from '../errors';
import type { MembershipRef, WorkspaceRef, WorkspaceResolution, WorkspaceResolver } from '../workspaces/resolver';

export const WORKSPACE_SLUG_HEADER = 'x-workspace-slug';

export interface Context {
  requestId: string;
  log: FastifyBaseLogger;
  user: AuthUser | null;
  session: AuthSessionRecord | null;
  workspaces: WorkspaceResolver;
  /** Domain services (packages/domain): the only way procedures read and write data (I1, I5). */
  domain: Domain;
  /** Per-request memo of resolved action policies, keyed `<workspaceId>:<entity definition id or slug>`. */
  policies: Map<string, ResolvedActionPolicy | null>;
  /** Per-request memo of workspace resolutions by slug (a batched request resolves its workspace once). */
  workspaceResolutions?: Map<string, Promise<WorkspaceResolution>>;
  /** From the `x-workspace-slug` header; procedures may also take `workspaceSlug` in their input. */
  workspaceSlug: string | null;
  /** `x-accept-after`: the invalidation seq that triggered this refetch (realtime I4a); null on normal reads. */
  acceptAfter: string | null;
  /**
   * Marks the auth user's email as verified (Better Auth's user table). Used when the user proves control of the
   * address by accepting the invite link that was sent to it.
   */
  markEmailVerified?: (userId: string) => Promise<void>;
  /** Profile → First/Last name also renames the auth user (the account menu, other workspaces' join pages). */
  updateUserName?: (userId: string, name: string) => Promise<void>;
}

type TrpcCode = TRPCError['code'];

const STATUS_TO_TRPC: Record<number, TrpcCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  402: 'PAYMENT_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_SUPPORTED',
  408: 'TIMEOUT',
  409: 'CONFLICT',
  412: 'PRECONDITION_FAILED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_CONTENT',
  428: 'PRECONDITION_REQUIRED',
  429: 'TOO_MANY_REQUESTS',
  501: 'NOT_IMPLEMENTED',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT',
};

export function apiErrorToTRPC(err: ApiError): TRPCError {
  return new TRPCError({
    code: STATUS_TO_TRPC[err.statusCode] ?? 'INTERNAL_SERVER_ERROR',
    message: err.message,
    cause: err,
  });
}

/** Builds the public API envelope for a tRPC error (its cause carries additional_information when there is one). */
export function trpcErrorEnvelope(error: TRPCError): ErrorEnvelope {
  const status = getHTTPStatusCodeFromError(error);
  const cause = error.cause;
  if (cause instanceof ApiError) return toEnvelope(new ApiError(status, cause.message, cause.additionalInformation));
  if (cause && error.code === 'BAD_REQUEST' && Array.isArray((cause as { issues?: unknown }).issues)) {
    return toEnvelope(
      new ApiError(status, 'Invalid request', validationInfo(cause as unknown as Parameters<typeof validationInfo>[0])),
    );
  }
  const message = status >= 500 ? 'An unexpected error occurred' : error.message;
  return toEnvelope(new ApiError(status, message));
}

const t = initTRPC.context<Context>().create({
  isDev: false,
  errorFormatter({ shape, error }) {
    // shape.message is replaced by the envelope's (generic for 5xx, so internals never leak).
    return { ...shape, data: { ...shape.data, stack: undefined }, ...trpcErrorEnvelope(error) };
  },
});

export const router = t.router;
export const middleware = t.middleware;
export const createCallerFactory = t.createCallerFactory;

/**
 * Maps errors thrown by domain services (or anything else) to the right tRPC code / HTTP status.
 * 5xx are logged once by the adapter's onError (app.ts), with the original error as cause.
 */
const mapErrors = t.middleware(async ({ next }) => {
  const result = await next();
  if (result.ok) return result;
  const { error } = result;
  if (error.code !== 'INTERNAL_SERVER_ERROR') return result;
  throw apiErrorToTRPC(toApiError(error.cause ?? error));
});

export const publicProcedure = t.procedure.use(mapErrors);

export const authedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.user || !ctx.session) throw new TRPCError({ code: 'UNAUTHORIZED', message: UNAUTHENTICATED_MESSAGE });
  return next({ ctx: { user: ctx.user, session: ctx.session } });
});

function slugFromInput(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = (raw as { workspaceSlug?: unknown }).workspaceSlug;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Requires an active membership of the workspace named by `x-workspace-slug` or `input.workspaceSlug` (I2). */
export const workspaceProcedure = authedProcedure.use(async ({ ctx, next, getRawInput }) => {
  const slug = slugFromInput(await getRawInput()) ?? ctx.workspaceSlug;
  if (!slug) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `A workspace is required: send the ${WORKSPACE_SLUG_HEADER} header or a workspaceSlug input`,
    });
  }
  let pending = ctx.workspaceResolutions?.get(slug);
  if (!pending) {
    pending = ctx.workspaces.resolve(ctx.user.id, { slug });
    ctx.workspaceResolutions?.set(slug, pending);
  }
  const resolution = await pending;
  if (resolution.status === 'not-found') throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
  if (resolution.status === 'not-member') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not a member of this workspace' });
  }
  const workspace: WorkspaceRef = resolution.workspace;
  const membership: MembershipRef = resolution.membership;
  // The acting member for every domain call of this procedure (I2: the workspace scopes the transaction).
  const service: ServiceContext = memberContext(workspace.id, membership.id);
  return next({ ctx: { workspace, membership, service } });
});

export const adminProcedure = workspaceProcedure.use(({ ctx, next }) => {
  if (ctx.membership.accessLevel !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Only workspace admins can do this' });
  }
  return next();
});
