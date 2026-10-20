// Kysely table types for migrations 0800–0849 (slice 8: workflows, versions, blocks, paths, triggers, schedules, runs,
// frames, block executions, credits, failure notification subscriptions). Same conventions as schema.ts; merged into
// `DB` by interface augmentation.
import type { ColumnType, Generated } from 'kysely';
import type { CreatedAt, Json, Timestamp } from './schema.ts';

type Opt<T> = ColumnType<T, T | undefined, T>;

export interface WorkflowsTable {
  id: string;
  workspace_id: string;
  title: string | null;
  description: string | null;
  ai_title: string | null;
  ai_description: string | null;
  status: Opt<'draft' | 'live' | 'paused'>;
  is_transient: Opt<boolean>;
  is_archived: Opt<boolean>;
  draft_version_id: string;
  active_version_id: string | null;
  first_set_live_at: Timestamp | null;
  last_published_at: Timestamp | null;
  last_status_change_at: Timestamp | null;
  last_run_failed_at: Timestamp | null;
  timezone: string | null;
  max_credits_per_run: Opt<number>;
  dismissed_cycle_warning: Opt<boolean>;
  run_count: Opt<number>;
  created_by: Json;
  created_at: CreatedAt;
  updated_at: CreatedAt;
  deleted_at: Timestamp | null;
}

export interface WorkflowVersionsTable {
  id: string;
  workspace_id: string;
  workflow_id: string;
  type: 'draft' | 'immutable';
  base_version_id: string | null;
  restored_from_version_id: string | null;
  published_at: Timestamp | null;
  published_by: Json;
  activation_status: 'activating' | 'completed' | 'deactivated' | null;
  activated_at: Timestamp | null;
  deactivated_at: Timestamp | null;
  created_by: Json;
  created_at: CreatedAt;
}

export interface WorkflowBlocksTable {
  version_id: string;
  id: string;
  workspace_id: string;
  workflow_id: string;
  block_type: 'trigger' | 'step';
  slug: string;
  block_version: number;
  description: string | null;
  position: ColumnType<Json, Json | undefined, Json>;
  config: ColumnType<Json, Json | undefined, Json>;
  created_by: Json;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface WorkflowPathsTable {
  version_id: string;
  id: string;
  workspace_id: string;
  workflow_id: string;
  source_block_id: string;
  source_outcome: string;
  target_block_id: string;
  created_at: CreatedAt;
}

export interface WorkflowTriggersTable {
  id: string;
  workspace_id: string;
  workflow_id: string;
  version_id: string;
  block_id: string;
  slug: string;
  entity_definition_id: string | null;
  attribute_id: string | null;
  created_at: CreatedAt;
}

export interface WorkflowSchedulesTable {
  id: string;
  workspace_id: string;
  workflow_id: string;
  version_id: string;
  block_id: string;
  cron: string;
  timezone: string;
  next_run_at: Timestamp;
  last_run_at: Timestamp | null;
  created_at: CreatedAt;
}

export type WorkflowRunStatus = 'queued' | 'executing' | 'completed' | 'failed' | 'canceled';

export interface WorkflowRunsTable {
  id: string;
  workspace_id: string;
  workflow_id: string;
  version_id: string;
  sequence_number: number;
  status: Opt<WorkflowRunStatus>;
  trigger_block_id: string;
  trigger_slug: string;
  trigger_payload: ColumnType<Json, Json, Json>;
  cascade_depth: Opt<number>;
  retried_from_run_id: string | null;
  created_by: Json;
  created_at: CreatedAt;
  started_at: Timestamp | null;
  completed_at: Timestamp | null;
  failed_at: Timestamp | null;
  canceled_at: Timestamp | null;
  canceled_by: Json;
  failure_reason: string | null;
  error_message: string | null;
  credits_used: ColumnType<string, string | number | undefined, string | number>;
  execution_count: Opt<number>;
  attempt_count: Opt<number>;
}

export interface WorkflowRunFramesTable {
  id: string;
  workspace_id: string;
  run_id: string;
  parent_frame_id: string | null;
  type: 'root' | 'retry' | 'loop-iteration';
  attempt: number;
  status: Opt<'executing' | 'completed' | 'failed' | 'canceled'>;
  loop_execution_id: string | null;
  iteration: number | null;
  created_at: CreatedAt;
  completed_at: Timestamp | null;
}

export type WorkflowExecutionStatus = 'queued' | 'executing' | 'delayed' | 'completed' | 'failed' | 'canceled';

export interface WorkflowBlockExecutionsTable {
  id: string;
  workspace_id: string;
  run_id: string;
  frame_id: string;
  block_id: string;
  slug: string;
  parent_execution_id: string | null;
  seq: Generated<string>;
  status: Opt<WorkflowExecutionStatus>;
  outcome: string | null;
  inputs: Json;
  outputs: Json;
  output_types: Json;
  state: Json;
  cost: ColumnType<string | null, string | number | null | undefined, string | number | null>;
  cost_is_final: boolean | null;
  failure_reason: string | null;
  error_message: string | null;
  resume_at: Timestamp | null;
  attempt: Opt<number>;
  created_at: CreatedAt;
  started_at: Timestamp | null;
  completed_at: Timestamp | null;
  failed_at: Timestamp | null;
}

export interface WorkflowCreditUsageTable {
  id: string;
  workspace_id: string;
  type: Opt<string>;
  amount: ColumnType<string, string | number, string | number>;
  workflow_id: string;
  run_id: string;
  execution_id: string;
  created_at: CreatedAt;
}

export interface WorkflowNotificationSubscriptionsTable {
  id: string;
  workspace_id: string;
  workflow_id: string;
  member_id: string;
  subscription_type: Opt<'workflow-run-failure'>;
  created_at: CreatedAt;
}

export interface WorkflowRoundRobinStateTable {
  workspace_id: string;
  workflow_id: string;
  block_id: string;
  last_member_id: string | null;
  updated_at: CreatedAt;
}

export interface WorkflowBroadcastsTable {
  id: string;
  workspace_id: string;
  workflow_id: string;
  run_id: string;
  kind: 'toast' | 'celebration';
  payload: ColumnType<Json, Json, Json>;
  recipient_member_ids: string[] | null;
  created_at: CreatedAt;
}

export interface WorkflowTriggerStateTable {
  id: Generated<number>;
  xid_cursor: string;
  updated_at: CreatedAt;
}

declare module './schema.ts' {
  interface DB {
    workflows: WorkflowsTable;
    workflow_versions: WorkflowVersionsTable;
    workflow_blocks: WorkflowBlocksTable;
    workflow_paths: WorkflowPathsTable;
    workflow_triggers: WorkflowTriggersTable;
    workflow_schedules: WorkflowSchedulesTable;
    workflow_runs: WorkflowRunsTable;
    workflow_run_frames: WorkflowRunFramesTable;
    workflow_block_executions: WorkflowBlockExecutionsTable;
    workflow_credit_usage: WorkflowCreditUsageTable;
    workflow_notification_subscriptions: WorkflowNotificationSubscriptionsTable;
    workflow_round_robin_state: WorkflowRoundRobinStateTable;
    workflow_broadcasts: WorkflowBroadcastsTable;
    workflow_trigger_state: WorkflowTriggerStateTable;
  }
}
