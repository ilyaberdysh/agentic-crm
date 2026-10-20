// "Webhook received" trigger (block-catalog §3 `on-inbound-webhook`; README §6): Attio's hook URL is
// `https://hooks.attio.com/w/{workspace_id}/{workflow_id}`; ours is `POST /hooks/w/{workspaceId}/{workflowId}` on the
// API. The body (any content type, ≤ 1 MB) is passed to the run as the raw string `request_body`. No session: the
// unguessable workflow id is the capability. 202 when a run started; 404 for unknown workflows; 409 when the workflow
// is not live or has no webhook trigger.
import type { Domain } from '@agentic-crm/domain';
import type { FastifyInstance } from 'fastify';
import { envelope } from '../../errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function registerWorkflowWebhookRoute(app: FastifyInstance, domain: Domain): Promise<void> {
  await app.register(async (scope) => {
    // Raw body for every content type (the run receives it verbatim).
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'string', bodyLimit: 1024 * 1024 }, (_req, body, done) =>
      done(null, body),
    );
    scope.post<{ Params: { workspaceId: string; workflowId: string } }>(
      '/hooks/w/:workspaceId/:workflowId',
      async (request, reply) => {
        const { workspaceId, workflowId } = request.params;
        if (!UUID.test(workspaceId) || !UUID.test(workflowId)) {
          return reply.status(404).send(envelope(404, 'The requested Workflow could not be found'));
        }
        const body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? null);
        try {
          const started = await domain.workflows.trigger.webhook(workspaceId, workflowId, body);
          if (!started)
            return reply.status(409).send(envelope(409, 'This workflow is not live or has no webhook trigger'));
          return reply.status(202).send({ status: 'accepted', run_id: started.runId });
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404) return reply.status(404).send(envelope(404, 'The requested Workflow could not be found'));
          throw err;
        }
      },
    );
  });
}
