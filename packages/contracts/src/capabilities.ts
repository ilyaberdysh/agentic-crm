// Capabilities: feature flags and quotas (CROSS-DOMAIN B.13, J README §4.3, K sessions §1.2). For our internal
// product every feature is on and every quota unlimited; the keys retain compatibility names so gated features can be
// switched per workspace later.
import { z } from 'zod';

export const featureKeys = [
  'user_level_object_permissions',
  'workspace_level_object_permissions',
  'user_level_collection_permissions',
  'workspace_level_collection_permissions',
  'user_level_dashboard_permissions',
  'workspace_level_dashboard_permissions',
  'user_level_workflow_permissions',
  'workspace_level_workflow_permissions',
  'user_level_sequence_permissions',
  'workspace_level_sequence_permissions',
  'relationship_attributes',
  'formula_attributes',
  'custom_objects',
  'attribute_value_history',
  'custom_forms',
  'audit_log',
  'advanced_admin_tools',
  'advanced_data_controls',
  'import_via_import2',
  'sequences',
  'call_recording',
  'merlin',
  'particle_sql',
  'particle_gates',
  'particle_gate_custom_identity_triggers',
  'standard_activities',
  'custom_activities',
  'entity_report_funnel',
  'entity_report_historical',
  'saml_authentication',
  'scim',
] as const;
export type FeatureKey = (typeof featureKeys)[number];

export const quotaKeys = [
  'seats_per_workspace_hard',
  'objects_per_workspace_hard',
  'reports_per_workspace_hard',
  'entity_reports_per_workspace_hard',
  'teams_per_workspace_hard',
  'particle_gates_per_object_hard',
  'records_per_workspace_soft',
  'file_storage_gb_per_workspace_hard',
  'workflow_credits_per_month_hard',
  'workspace_membership_credits_per_month_hard',
  'call_recording_hours_per_seat_hard',
  'mailboxes_per_user_hard',
  'select_options_per_attribute_hard',
  'attributes_per_object_hard',
  'views_per_object_hard',
] as const;
export type QuotaKey = (typeof quotaKeys)[number];

/**
 * Data-model limits. Every other quota
 * defaults to unlimited. A workspace override in settings.capabilities.quotas replaces the default (null = default).
 *   • 500 options or stages per attribute — 409 ATTRIBUTE_SELECT_OPTIONS_LIMIT_EXCEEDED.
 *   • 500 attributes per object, archived ones included: each keeps up to three projection columns and Postgres
 *     caps a table at 1,600 columns, so overrides are clamped to 500 — 409 OVER_USAGE_LIMIT.
 *   • 500 views per object — 409 OVER_USAGE_LIMIT.
 * Filters: 6 levels, 200 conditions, `in` lists of 1,000; sorts: 5; paths: 5 hops (contracts and compiler).
 */
export const quotaDefaults: Partial<Record<QuotaKey, number>> = {
  /** Requirement rules per object: 8. */
  particle_gates_per_object_hard: 8,
  select_options_per_attribute_hard: 500,
  attributes_per_object_hard: 500,
  views_per_object_hard: 500,
  /**
   * Credits as a cost guard (C.4 #14; slice 10): monthly Ask Agentic seat credits per member and the monthly workspace
   * pool shared by workflows, AI attributes and members over their seat credits.
   * 1 credit = $0.01 of provider cost. Exhausted → 402 CREDITS_EXHAUSTED.
   */
  workspace_membership_credits_per_month_hard: 1000,
  workflow_credits_per_month_hard: 10000,
};

export const capabilitiesSchema = z.object({
  /** Feature key → enabled. Unknown keys are treated as enabled by hasFeature(). */
  features: z.record(z.string(), z.boolean()),
  /** Quota key → limit; null = unlimited. */
  quotas: z.record(z.string(), z.number().int().nullable()),
});
export type Capabilities = z.infer<typeof capabilitiesSchema>;
