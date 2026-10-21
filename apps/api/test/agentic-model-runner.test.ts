import { type Domain, newId } from '@agentic-crm/domain';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { registerModelRunnerRoutes } from '../src/agentic/model-routes';

const workspaceId = newId();
const runnerId = newId();
const token = `acrm_run.${workspaceId}.${runnerId}.${'A'.repeat(43)}`;
const claimRunnerInvocations = vi.fn(async () => []);
const heartbeatRunnerInvocation = vi.fn(async () => ({ expiresAt: '2099-01-01T00:00:00Z' }));
const completeRunnerInvocation = vi.fn(async () => {});
const app = Fastify();

beforeAll(async () => {
  await registerModelRunnerRoutes(app, {
    agentic: {
      models: {
        claimRunnerInvocations,
        heartbeatRunnerInvocation,
        completeRunnerInvocation,
      },
    },
  } as unknown as Domain);
  await app.ready();
});
afterAll(async () => app.close());

describe('paired local model transport', () => {
  it('requires bearer authentication before a runner can poll', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/agentic/models/runner/claim', payload: {} });
    expect(response.statusCode).toBe(401);
    expect(claimRunnerInvocations).not.toHaveBeenCalled();
  });

  it('accepts a bounded 100k-character encrypted-result handoff', async () => {
    const input = {
      invocationId: newId(),
      leaseGeneration: '1',
      outcome: 'completed',
      text: 'a'.repeat(100_000),
    };
    const response = await app.inject({
      method: 'POST',
      url: '/api/agentic/models/runner/complete',
      headers: { authorization: `Bearer ${token}` },
      payload: input,
    });
    expect(response.statusCode).toBe(200);
    expect(completeRunnerInvocation).toHaveBeenCalledWith(input, token);
  });
});
