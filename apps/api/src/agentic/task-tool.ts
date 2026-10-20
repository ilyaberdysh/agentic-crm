import {
  type Domain,
  executeTaskCreateResultSchema,
  executeTaskCreateSchema,
  type ServiceContext,
} from '@agentic-crm/domain';
import { z } from 'zod';
import { withSeq } from '../trpc/mutation';

/** Curated MCP-shaped contract only. No network transport, SDK, discovery ecosystem, or caller identity input. */
export const taskCreateTool = {
  name: 'crm.task.create',
  description: 'Execute the exact task diff in a current, human-approved durable action and return its receipt.',
  inputSchema: z.toJSONSchema(executeTaskCreateSchema),
  outputSchema: z.toJSONSchema(executeTaskCreateResultSchema.extend({ seq: z.string().regex(/^\d+$/).nullable() })),
} as const;

/** A future authenticated tool host supplies context out of band, using the same authority as product APIs. */
export async function invokeTaskCreateTool(domain: Domain, context: ServiceContext, input: unknown) {
  const parsed = executeTaskCreateSchema.parse(input);
  const { result, seq } = await withSeq(context, (ctx) => domain.agentic.taskCreate.execute(ctx, parsed));
  const structuredContent = { ...result, seq };
  return { content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }], structuredContent };
}
