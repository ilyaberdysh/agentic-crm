import { type Domain, executeTaskCreateSchema, memberContext } from '@agentic-crm/domain';
import type { FastifyInstance } from 'fastify';
import type { Auth } from '../auth/auth';
import { getRequestSession } from '../auth/session';
import { envelope, UNAUTHENTICATED_MESSAGE } from '../errors';
import { withSeq } from '../trpc/mutation';
import { WORKSPACE_SLUG_HEADER } from '../trpc/trpc';
import type { WorkspaceResolver } from '../workspaces/resolver';

/** Cookie-authenticated product REST, separate from the Attio-compatible /v2 contract. */
export async function registerAgenticRoutes(
  app: FastifyInstance,
  deps: { auth: Auth; workspaces: WorkspaceResolver; domain: Domain },
) {
  app.post('/api/agentic/capabilities/crm.task.create/execute', async (request, reply) => {
    const session = await getRequestSession(deps.auth, request.headers, reply);
    if (!session) return reply.status(401).send(envelope(401, UNAUTHENTICATED_MESSAGE));
    const slug = request.headers[WORKSPACE_SLUG_HEADER];
    if (typeof slug !== 'string' || !slug)
      return reply.status(400).send(envelope(400, `A workspace is required: send the ${WORKSPACE_SLUG_HEADER} header`));
    const resolution = await deps.workspaces.resolve(session.user.id, { slug });
    if (resolution.status === 'not-found') return reply.status(404).send(envelope(404, 'Workspace not found'));
    if (resolution.status === 'not-member')
      return reply.status(403).send(envelope(403, 'You are not a member of this workspace'));
    const input = executeTaskCreateSchema.parse(request.body);
    const { result, seq } = await withSeq(memberContext(resolution.workspace.id, resolution.membership.id), (ctx) =>
      deps.domain.agentic.taskCreate.execute(ctx, input),
    );
    return { ...result, seq };
  });
}
