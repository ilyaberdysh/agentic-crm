import { z } from 'zod';
import type { InferenceRequest, InferenceResponse, InferenceUsage } from '../ai/inference.ts';

export const targetIdSchema = z.uuid().transform((id) => id.toLowerCase());
const version = z.number().int().positive();
const model = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/);
const common = {
  id: targetIdSchema,
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[^\x00-\x1f\x7f]+$/),
  model,
};
export const localFeaturesSchema = z.strictObject({
  text: z.literal(true),
  clientTools: z.boolean(),
  structuredOutput: z.enum(['none', 'native']),
  streaming: z.boolean(),
});

/** Only loopback endpoints are accepted. The cloud never resolves or fetches this URL. */
export function normalizeLocalEndpoint(value: string): string {
  const url = new URL(value);
  const loopback =
    url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.(\d{1,3}\.){2}\d{1,3}$/.test(url.hostname);
  if (
    !loopback ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Invalid local endpoint');
  return url.toString().replace(/\/+$/, '');
}

const localEndpoint = z
  .string()
  .max(512)
  .transform((value, ctx) => {
    try {
      return normalizeLocalEndpoint(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'A loopback runner endpoint is required' });
      return z.NEVER;
    }
  });

const cloudTargetSchema = z.strictObject({
  ...common,
  kind: z.literal('cloud-api'),
  ownerKind: z.enum(['member', 'workspace']),
  provider: z.enum(['openai', 'anthropic']),
  connectionId: targetIdSchema,
  connectionVersion: version,
});
const localTargetSchema = z.strictObject({
  ...common,
  kind: z.literal('runner-local'),
  ownerKind: z.literal('member'),
  provider: z.literal('openai-compatible'),
  runnerId: targetIdSchema,
  endpoint: localEndpoint,
  features: localFeaturesSchema,
});
export const createModelTargetSchema = z.discriminatedUnion('kind', [cloudTargetSchema, localTargetSchema]);
export const configureModelTargetSchema = z.discriminatedUnion('kind', [
  cloudTargetSchema.extend({ expectedVersion: version }),
  localTargetSchema.extend({ expectedVersion: version }),
]);
export type CreateModelTargetInput = z.input<typeof createModelTargetSchema>;
export type ConfigureModelTargetInput = z.input<typeof configureModelTargetSchema>;

export interface ModelTargetMetadata {
  id: string;
  workspaceId: string;
  owner: { kind: 'member' | 'workspace'; id: string };
  name: string;
  kind: 'cloud-api' | 'runner-local';
  provider: 'openai' | 'anthropic' | 'openai-compatible';
  model: string;
  enabled: boolean;
  version: number;
  adapterKind: 'anthropic-api' | 'openai-compatible';
  executionHost: 'cloud-worker' | 'runner';
  dataDestination: 'cloud' | 'runner-loopback';
  connection: { id: string; version: number } | null;
  runner: { id: string; endpoint: string; features: z.output<typeof localFeaturesSchema> } | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvokeModelTargetInput {
  targetId: string;
  expectedVersion: number;
  request: Omit<InferenceRequest, 'model'>;
}
export type ModelInvocationResult =
  | { kind: 'completed'; invocationId: string; response: InferenceResponse }
  | {
      kind: 'runner-required';
      code: 'RUNNER_REQUIRED';
      invocationId: string;
    };

export interface ClaimedRunnerModelInvocation {
  invocationId: string;
  leaseGeneration: string;
  targetId: string;
  targetVersion: number;
  provider: 'openai-compatible';
  model: string;
  endpoint: string;
  features: z.output<typeof localFeaturesSchema>;
  request: InferenceRequest;
}

export interface CompleteRunnerInvocationInput {
  invocationId: string;
  leaseGeneration: string;
  outcome: 'completed' | 'failed' | 'canceled';
  /** Local runner output; sealed at rest, and read only by the invoking member. */
  text?: string;
  usage?: InferenceUsage;
  /** An allowlisted inference code; provider error text is never persisted. */
  failureCode?: string;
}

export interface ModelInvocationState {
  invocationId: string;
  outcome: 'pending' | 'completed' | 'failed' | 'canceled';
  failureCode: string | null;
  text: string | null;
  usage: InferenceUsage;
}
