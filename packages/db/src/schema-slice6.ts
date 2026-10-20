// Kysely table types for migrations 0650–0699 (slice 6: teams, grants of every resource kind, member administration,
// requirement rules, webhooks). Same conventions as schema.ts; merged into `DB` by interface augmentation.
import type { ColumnType, Generated } from 'kysely';
import type { CreatedAt, Json, Timestamp } from './schema.ts';

type Scope = 'full-access' | 'read-write' | 'read-only' | 'no-access';
type TargetType = 'workspace' | 'team' | 'workspace-member' | 'workflow';

export interface WorkspaceTeamsTable {
  id: string;
  workspace_id: string;
  name: string;
  description: ColumnType<string, string | undefined, string>;
  icon: Json;
  sort_order: string;
  created_by: Json;
  created_at: CreatedAt;
  updated_at: CreatedAt;
  archived_at: Timestamp | null;
  archived_by: Json;
}

export interface WorkspaceTeamMembershipsTable {
  id: string;
  workspace_id: string;
  team_id: string;
  member_id: string;
  created_by: Json;
  created_at: CreatedAt;
}

export interface ResourcePermissionsTable {
  id: string;
  workspace_id: string;
  resource_kind: 'dashboard' | 'workflow' | 'sequence';
  resource_id: string;
  target_type: TargetType;
  target_id: string;
  scope: Scope;
  created_by: Json;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface RequirementRulesTable {
  id: string;
  workspace_id: string;
  entity_definition_id: string;
  name: string;
  sort_order: string;
  condition: Json;
  requirements: ColumnType<Json, Json, Json>;
  applies_to: ColumnType<Json, Json | undefined, Json>;
  created_by: Json;
  created_at: CreatedAt;
  updated_at: CreatedAt;
  deleted_at: Timestamp | null;
  deleted_by: Json;
}

export interface WebhooksTable {
  id: string;
  workspace_id: string;
  target_url: string;
  status: ColumnType<'active' | 'degraded' | 'inactive', 'active' | 'degraded' | 'inactive' | undefined>;
  secret: string;
  created_by: Json;
  created_at: CreatedAt;
  updated_at: CreatedAt;
  degraded_at: Timestamp | null;
  last_delivery_at: Timestamp | null;
  deleted_at: Timestamp | null;
}

export interface WebhookSubscriptionsTable {
  id: string;
  workspace_id: string;
  webhook_id: string;
  event_type: string;
  filter: Json;
  filter_key: string;
  position: number;
}

export interface WebhookDeliveriesTable {
  id: string;
  workspace_id: string;
  webhook_id: string;
  event_type: string;
  payload: ColumnType<Json, Json, Json>;
  is_test: ColumnType<boolean, boolean | undefined, boolean>;
  status: ColumnType<'pending' | 'succeeded' | 'failed', 'pending' | 'succeeded' | 'failed' | undefined>;
  attempts: ColumnType<number, number | undefined, number>;
  next_attempt_at: Timestamp | null;
  last_status_code: number | null;
  last_error: string | null;
  attempt_log: ColumnType<Json, Json | undefined, Json>;
  change_log_id: string | null;
  created_at: CreatedAt;
  completed_at: Timestamp | null;
}

export interface WebhookFanoutStateTable {
  id: Generated<number>;
  xid_cursor: string;
  updated_at: CreatedAt;
}

declare module './schema.ts' {
  interface DB {
    workspace_teams: WorkspaceTeamsTable;
    workspace_team_memberships: WorkspaceTeamMembershipsTable;
    resource_permissions: ResourcePermissionsTable;
    requirement_rules: RequirementRulesTable;
    webhooks: WebhooksTable;
    webhook_subscriptions: WebhookSubscriptionsTable;
    webhook_deliveries: WebhookDeliveriesTable;
    webhook_fanout_state: WebhookFanoutStateTable;
  }
  interface WorkspaceMembersTable {
    removed_at: ColumnType<Timestamp | null, Timestamp | null | undefined, Timestamp | null>;
    avatar_file_id: ColumnType<string | null, string | null | undefined, string | null>;
  }
  interface WorkspacesTable {
    logo_file_id: ColumnType<string | null, string | null | undefined, string | null>;
  }
  interface WorkspaceInvitesTable {
    team_ids: ColumnType<string[], string[] | undefined, string[]>;
  }
}
