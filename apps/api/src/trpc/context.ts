import type { Domain } from '@agentic-crm/domain';
import { ACCEPT_AFTER_HEADER } from '@agentic-crm/realtime';
import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import type { Auth } from '../auth/auth';
import { getRequestSession } from '../auth/session';
import type { WorkspaceResolver } from '../workspaces/resolver';
import { type Context, WORKSPACE_SLUG_HEADER } from './trpc';

function header(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.length > 0 ? first : null;
}

export function createContextFactory(deps: { auth: Auth; workspaces: WorkspaceResolver; domain: Domain }) {
  return async ({ req, res }: CreateFastifyContextOptions): Promise<Context> => {
    const session = await getRequestSession(deps.auth, req.headers, res);
    const acceptAfter = header(req.headers[ACCEPT_AFTER_HEADER]);
    return {
      requestId: req.id,
      log: req.log,
      user: session?.user ?? null,
      session: session?.session ?? null,
      workspaces: deps.workspaces,
      domain: deps.domain,
      policies: new Map(),
      workspaceResolutions: new Map(),
      workspaceSlug: header(req.headers[WORKSPACE_SLUG_HEADER]),
      acceptAfter: acceptAfter && /^\d{1,19}$/.test(acceptAfter) ? acceptAfter : null,
      markEmailVerified: async (userId) => {
        const auth = await deps.auth.$context;
        await auth.internalAdapter.updateUser(userId, { emailVerified: true });
      },
      updateUserName: async (userId, name) => {
        const auth = await deps.auth.$context;
        await auth.internalAdapter.updateUser(userId, { name });
      },
    };
  };
}
