// Kysely table types for migrations 0900–0929 (slice 10, S10-ASK: AI settings, credits ledger, Ask Agentic threads,
// prompts, record summaries). Same conventions as schema.ts; merged into `DB` by interface augmentation.
import type { ColumnType } from 'kysely';
import type { CreatedAt, Json } from './schema.ts';

export type AiPermissionSetting = 'always-ask' | 'auto-approve' | 'disabled';

export interface WorkspaceAiSettingsTable {
  workspace_id: string;
  custom_context: string | null;
  ask_workspace_credits_limit: number | null;
  /** Model overrides per tier: {ask?, bulk?, fast?}. */
  models: ColumnType<Json, Json | undefined, Json>;
  updated_at: CreatedAt;
}

export interface MemberAiSettingsTable {
  member_id: string;
  workspace_id: string;
  allow_web_search: ColumnType<AiPermissionSetting, AiPermissionSetting | undefined, AiPermissionSetting>;
  share_thread_feedback: ColumnType<AiPermissionSetting, AiPermissionSetting | undefined, AiPermissionSetting>;
  default_model: string | null;
  custom_context: string | null;
  curated_defaults_saved: ColumnType<boolean, boolean | undefined, boolean>;
  updated_at: CreatedAt;
}

export interface CreditLedgerTable {
  id: string;
  workspace_id: string;
  member_id: string | null;
  pool: 'member' | 'workspace';
  spend: 'ask' | 'workspace';
  source: string;
  credits: number;
  micro_usd: ColumnType<string, string | number | undefined, string | number>;
  model: string | null;
  input_tokens: ColumnType<number, number | undefined, number>;
  output_tokens: ColumnType<number, number | undefined, number>;
  cache_read_tokens: ColumnType<number, number | undefined, number>;
  cache_write_tokens: ColumnType<number, number | undefined, number>;
  web_search_requests: ColumnType<number, number | undefined, number>;
  ref_type: string | null;
  ref_id: string | null;
  created_at: CreatedAt;
}

export interface AiThreadsTable {
  id: string;
  workspace_id: string;
  type: ColumnType<'chat', 'chat' | undefined, 'chat'>;
  title: string | null;
  ai_title: string | null;
  created_by_member_id: string;
  web_search_allowed: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: CreatedAt;
  updated_at: CreatedAt;
  deleted_at: string | null;
}

export type AiTurnStatus = 'executing' | 'completed' | 'canceled' | 'failed';

export interface AiTurnsTable {
  id: string;
  workspace_id: string;
  thread_id: string;
  parent_turn_id: string | null;
  role: 'user' | 'assistant';
  parts: ColumnType<Json, Json | undefined, Json>;
  /** User turns: the exact user message content sent to the model (JSON text). */
  llm_content: string | null;
  source: 'composer' | 'suggestion' | 'reply-suggestion' | null;
  time_zone: string | null;
  status: AiTurnStatus;
  model: string | null;
  model_mode: 'auto' | 'manual' | null;
  refinement: Json | null;
  micro_usd: ColumnType<string, string | number | undefined, string | number>;
  credit_cost: number | null;
  context_tokens: number | null;
  failure_reason: string | null;
  feedback: Json | null;
  reply_suggestions: Json | null;
  created_by_member_id: string;
  created_at: CreatedAt;
  updated_at: CreatedAt;
  completed_at: string | null;
  canceled_at: string | null;
  failed_at: string | null;
}

export type AiStepStatus = 'executing-llm' | 'executing-tools' | 'completed' | 'canceled' | 'failed';

export interface AiTurnStepsTable {
  id: string;
  workspace_id: string;
  turn_id: string;
  position: number;
  status: AiStepStatus;
  parts: ColumnType<Json, Json | undefined, Json>;
  /** JSON text (byte-stable replay). */
  llm_content: string | null;
  tool_results: string | null;
  usage: Json | null;
  created_at: CreatedAt;
  completed_at: string | null;
}

export type PromptAccess = 'full-access' | 'read-write' | 'read-only' | 'no-access';

export interface AiPromptsTable {
  id: string;
  workspace_id: string;
  title: string | null;
  prompt: string;
  icon_id: string | null;
  icon_color: string | null;
  ai_title: string | null;
  ai_summary: string | null;
  ai_icon_id: string | null;
  ai_icon_color: string | null;
  ai_targets: ColumnType<string[], string[] | undefined, string[]>;
  default_model: string | null;
  workspace_access: ColumnType<PromptAccess, PromptAccess | undefined, PromptAccess>;
  is_transient: ColumnType<boolean, boolean | undefined, boolean>;
  created_by_member_id: string;
  created_at: CreatedAt;
  updated_at: CreatedAt;
  deleted_at: string | null;
}

export interface AiPromptMemberAccessTable {
  prompt_id: string;
  member_id: string;
  workspace_id: string;
  access: PromptAccess;
}

export interface AiCuratedPromptSavesTable {
  member_id: string;
  curated_id: string;
  workspace_id: string;
  created_at: CreatedAt;
}

export interface RecordAiSummariesTable {
  entity_instance_id: string;
  workspace_id: string;
  entity_definition_id: string;
  summary: string;
  model: string;
  credit_cost: ColumnType<number, number | undefined, number>;
  generated_by_member_id: string | null;
  generated_at: CreatedAt;
}

declare module './schema.ts' {
  interface DB {
    record_ai_summaries: RecordAiSummariesTable;
    ai_prompts: AiPromptsTable;
    ai_prompt_member_access: AiPromptMemberAccessTable;
    ai_curated_prompt_saves: AiCuratedPromptSavesTable;
    workspace_ai_settings: WorkspaceAiSettingsTable;
    member_ai_settings: MemberAiSettingsTable;
    credit_ledger: CreditLedgerTable;
    ai_threads: AiThreadsTable;
    ai_turns: AiTurnsTable;
    ai_turn_steps: AiTurnStepsTable;
  }
}
