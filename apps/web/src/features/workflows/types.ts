// Server shapes as the client receives them (tRPC output types). Contracts' zod types differ in `unknown` fields (they
// become optional on the wire), so the client works with these aliases.
import type { RouterOutputs } from '../../data/trpc';

export type WorkflowDetail = RouterOutputs['workflows']['get'];
export type Workflow = WorkflowDetail['workflow'];
export type WorkflowVersion = WorkflowDetail['version'];
export type WorkflowBlock = WorkflowVersion['blocks'][number];
export type WorkflowPath = WorkflowVersion['paths'][number];
export type RunDetail = RouterOutputs['workflows']['runs']['get'];
export type BlockExecution = RunDetail['executions'][number];
export type WorkflowRun = RunDetail['run'];
export type PermissionGrant = RouterOutputs['permissions']['list']['grants'][number];
