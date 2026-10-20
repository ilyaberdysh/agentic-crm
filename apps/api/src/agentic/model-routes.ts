import { type Domain, runnerTokenWorkspace } from '@agentic-crm/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { envelope, UNAUTHENTICATED_MESSAGE } from '../errors';

const usage = z.strictObject({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  cacheReadTokens: z.number().int().nonnegative().nullable(),
  cacheWriteTokens: z.number().int().nonnegative().nullable(),
  serverToolRequests: z.record(z.string(), z.number().int().nonnegative().nullable()),
  cost: z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('known'), microUsd: z.number().int().nonnegative() }),
    z.strictObject({ status: z.literal('unknown'), reason: z.enum(['unknown_model_price', 'usage_unavailable']) }),
  ]),
});
const completion = z.strictObject({
  invocationId: z.uuid(),
  leaseGeneration: z.string().regex(/^[1-9]\d*$/),
  outcome: z.enum(['completed', 'failed', 'canceled']),
  text: z.string().max(100_000).optional(),
  usage: usage.optional(),
  failureCode: z.string().max(40).optional(),
});
const claim = z.strictObject({ limit: z.number().int().min(1).max(10).optional() });
const lease = z.strictObject({ invocationId: z.uuid(), leaseGeneration: z.string().regex(/^[1-9]\d*$/) });

function bearer(request: FastifyRequest): string | null {
  const value = request.headers.authorization;
  const match = typeof value === 'string' ? /^Bearer (acrm_run\.[A-Za-z0-9._-]+)$/.exec(value) : null;
  const token = match?.[1];
  return token && runnerTokenWorkspace(token, 'run') ? token : null;
}

/** Outbound-only delivery; the browser never receives a local prompt or endpoint dispatch. */
export async function registerModelRunnerRoutes(app: FastifyInstance, domain: Domain) {
  app.post('/api/agentic/models/runner/claim', { bodyLimit: 1024 }, async (request, reply) => {
    const token = bearer(request);
    if (!token) return reply.status(401).send(envelope(401, UNAUTHENTICATED_MESSAGE));
    const input = claim.parse(request.body ?? {});
    return domain.agentic.models.claimRunnerInvocations(token, input.limit);
  });
  app.post('/api/agentic/models/runner/complete', { bodyLimit: 512 * 1024 }, async (request, reply) => {
    const token = bearer(request);
    if (!token) return reply.status(401).send(envelope(401, UNAUTHENTICATED_MESSAGE));
    await domain.agentic.models.completeRunnerInvocation(completion.parse(request.body), token);
    return { completed: true };
  });
  app.post('/api/agentic/models/runner/heartbeat', { bodyLimit: 1024 }, async (request, reply) => {
    const token = bearer(request);
    if (!token) return reply.status(401).send(envelope(401, UNAUTHENTICATED_MESSAGE));
    return domain.agentic.models.heartbeatRunnerInvocation(lease.parse(request.body), token);
  });
}
