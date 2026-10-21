import type { ColumnType } from 'kysely';
import type { CreatedAt, Json } from './schema.ts';

export interface ProviderConnectionsTable {
  id: string;
  workspace_id: string;
  owner_kind: 'workspace' | 'member';
  owner_id: string;
  provider: 'anthropic' | 'openai';
  encrypted_credentials: Json;
  enabled: ColumnType<boolean, boolean | undefined, boolean>;
  version: ColumnType<number, number | undefined, number>;
  created_by_member_id: string;
  created_at: CreatedAt;
  updated_at: CreatedAt;
  rotated_at: string | null;
  disabled_at: string | null;
}
export interface ModelTargetsTable {
  id: string;
  workspace_id: string;
  owner_kind: 'workspace' | 'member';
  owner_id: string;
  name: string;
  kind: 'cloud-api' | 'runner-local';
  provider: 'anthropic' | 'openai' | 'openai-compatible';
  model: string;
  connection_id: string | null;
  connection_version: number | null;
  runner_id: string | null;
  endpoint: string | null;
  features: Json | null;
  enabled: ColumnType<boolean, boolean | undefined, boolean>;
  version: ColumnType<number, number | undefined, number>;
  created_by_member_id: string;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}
export interface ProviderConnectionEventsTable {
  id: string;
  workspace_id: string;
  connection_id: string;
  connection_version: number;
  kind: 'created' | 'rotated' | 'disabled';
  actor_member_id: string;
  created_at: CreatedAt;
}
export interface ModelInvocationsTable {
  id: string;
  workspace_id: string;
  target_id: string;
  target_version: number;
  member_id: string;
  provider: 'anthropic' | 'openai' | 'openai-compatible';
  model: string;
  connection_id: string | null;
  connection_version: number | null;
  runner_id: string | null;
  outcome: 'pending' | 'completed' | 'failed' | 'canceled';
  failure_code: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cost_status: 'known' | 'unknown';
  cost_reason: 'unknown_model_price' | 'usage_unavailable' | null;
  micro_usd: ColumnType<string | null, string | number | null, string | number | null>;
  created_at: CreatedAt;
  completed_at: string | null;
}
declare module './schema.ts' {
  interface DB {
    provider_connections: ProviderConnectionsTable;
    provider_connection_events: ProviderConnectionEventsTable;
    model_targets: ModelTargetsTable;
    model_invocations: ModelInvocationsTable;
  }
}
