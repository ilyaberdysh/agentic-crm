// The Ask Agentic tool registry (BACKLOG 10.02; ask-agentic-internals §4.1): tools over the domain services, executed
// in a transaction whose actor is the asking member, so every read and write goes through the same permission
// checks as the UI (I1, I5; "follows existing permissions"). Read tools run immediately; write tools put the call in
// `awaiting-approval` (the approval card) and run only after approve; web search asks once per thread unless the
// member's setting is "Allow" (and is not offered with "Don't allow").
//
// Each tool: identifier (the provider tool name), description (when to call it), Zod input schema (validated before
// running — inputs stream eagerly and may be truncated), kind, and `execute` → `{output, digest}`: `output` goes back
// to the model as the tool result, `digest` (ids / counts) is mirrored into the tool part for the UI row.
import type { z } from 'zod';
import { toJSONSchema } from 'zod';
import type { Policies } from '../../permissions.ts';
import type { Tx } from '../../tx.ts';
import type { LlmClient, LlmCustomTool, LlmUsage } from '../llm.ts';

export type ToolKind = 'read' | 'write' | 'web';

export interface ToolEnv {
  /** Transaction as the asking member (Ask Agentic) or the workflow (Custom agent block). */
  tx: Tx;
  policies: Policies;
  llm: LlmClient;
  /** The member the agent acts for (null: a workflow without "Run as"). */
  memberId: string | null;
  timeZone: string;
  /** Provider usage of tools that call the model themselves (web search); charged with the turn. */
  addUsage(usage: LlmUsage): void;
}

export interface ToolResult {
  output: unknown;
  digest: Record<string, unknown> | null;
}

export interface AiToolDef<I = unknown> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  kind: ToolKind;
  execute(env: ToolEnv, input: I): Promise<ToolResult>;
}

/** A tool's failure the model should see (bad input, not found, no access) instead of a failed turn. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export function defineTool<I>(def: AiToolDef<I>): AiToolDef<unknown> {
  return def as unknown as AiToolDef<unknown>;
}

/** Provider tool definition (JSON schema from the Zod schema; descriptions carried over). */
export function toProviderTool(tool: AiToolDef<unknown>): LlmCustomTool {
  const schema = toJSONSchema(tool.input, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  delete schema.$schema;
  return {
    name: tool.name,
    description: tool.description,
    input_schema: { ...schema, type: 'object' } as LlmCustomTool['input_schema'],
  };
}
