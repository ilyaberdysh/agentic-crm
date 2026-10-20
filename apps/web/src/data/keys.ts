// Normalised query keys (D-03, BACKLOG 1.07). Workspace data lives under ['ws', workspaceId, <resource>, …] where
// <resource> is the realtime invalidation vocabulary (packages/realtime InvalidationResource), so an invalidation
// message maps onto key prefixes without a lookup table per screen. Entities are cached once per id (a list query
// holds ids and writes each entity into its own key), so one invalidation refreshes every screen showing it.
import type { InvalidationResource } from '@agentic-crm/realtime';
import type { QueryKey } from '@tanstack/react-query';

export type WorkspaceResource = InvalidationResource | 'workspace-member-list' | 'snapshot';

export const keys = {
  /** The signed-in user (null when signed out). */
  me: () => ['me'] as const,
  /** Workspaces the user belongs to (picker, switcher, routing). */
  workspaces: () => ['workspaces'] as const,

  /** Everything cached for one workspace. */
  ws: (workspaceId: string) => ['ws', workspaceId] as const,
  resource: (workspaceId: string, resource: WorkspaceResource) => ['ws', workspaceId, resource] as const,

  workspace: (workspaceId: string) => ['ws', workspaceId, 'workspace'] as const,
  members: (workspaceId: string) => ['ws', workspaceId, 'workspace-member-list'] as const,
  member: (workspaceId: string, memberId: string) => ['ws', workspaceId, 'workspace-member', memberId] as const,
  invites: (workspaceId: string) => ['ws', workspaceId, 'workspace-invite-list'] as const,

  objects: (workspaceId: string) => ['ws', workspaceId, 'entity-definition-list'] as const,
  object: (workspaceId: string, definitionId: string) =>
    ['ws', workspaceId, 'entity-definition', definitionId] as const,
  attributes: (workspaceId: string, definitionId: string) =>
    ['ws', workspaceId, 'attribute-definition-list', definitionId] as const,
  attribute: (workspaceId: string, definitionId: string, attributeId: string) =>
    ['ws', workspaceId, 'attribute-definition', definitionId, attributeId] as const,
  options: (workspaceId: string, definitionId: string, attributeId: string) =>
    ['ws', workspaceId, 'select-option-list', definitionId, attributeId] as const,

  record: (workspaceId: string, definitionId: string, recordId: string) =>
    ['ws', workspaceId, 'entity-instance', definitionId, recordId] as const,
  /** Values of one attribute on one record (per-attribute pending state and history hang off this key). */
  values: (workspaceId: string, definitionId: string, attributeId: string, recordId: string) =>
    ['ws', workspaceId, 'attribute-value-list', definitionId, attributeId, recordId] as const,

  views: (workspaceId: string, definitionId: string) => ['ws', workspaceId, 'entity-view-list', definitionId] as const,
  view: (workspaceId: string, viewId: string) => ['ws', workspaceId, 'entity-view', viewId] as const,
  /** Query snapshots (first chunk + later chunks) of one definition; `params` = view id / filter hash. */
  snapshot: (workspaceId: string, definitionId: string, params: string) =>
    ['ws', workspaceId, 'snapshot', definitionId, params] as const,

  collections: (workspaceId: string) => ['ws', workspaceId, 'collection-list'] as const,
  collection: (workspaceId: string, collectionId: string) => ['ws', workspaceId, 'collection', collectionId] as const,
  /** A rich-text document's projections (blocks / markdown) — note bodies, template bodies. */
  document: (workspaceId: string, documentId: string) => ['ws', workspaceId, 'document', documentId] as const,

  // Record page (slice 3). Everything derived from a record's history and children (timeline pages, tab counters,
  // the Overview's notes / tasks rows) lives below its timeline key: every child write emits `record-timeline`.
  recordTimeline: (workspaceId: string, definitionId: string, recordId: string) =>
    ['ws', workspaceId, 'record-timeline', definitionId, recordId] as const,
  customLayout: (workspaceId: string, definitionId: string) =>
    ['ws', workspaceId, 'custom-layout', definitionId] as const,
  storageEntries: (workspaceId: string, definitionId: string, recordId: string) =>
    ['ws', workspaceId, 'storage-entry-list', definitionId, recordId] as const,
  memberPreferences: (workspaceId: string) => ['ws', workspaceId, 'member-preferences'] as const,

  // Slice 6 (settings): teams, requirement rules, developer tokens and webhooks (packages/realtime slice-6 resources).
  teams: (workspaceId: string) => ['ws', workspaceId, 'workspace-team-list'] as const,
  team: (workspaceId: string, teamId: string) => ['ws', workspaceId, 'workspace-team', teamId] as const,
  rules: (workspaceId: string, definitionId: string) =>
    ['ws', workspaceId, 'requirement-rule-list', definitionId] as const,
  apiTokens: (workspaceId: string) => ['ws', workspaceId, 'api-token-list'] as const,
  webhooks: (workspaceId: string) => ['ws', workspaceId, 'webhook-list'] as const,
  webhook: (workspaceId: string, webhookId: string) => ['ws', workspaceId, 'webhook', webhookId] as const,
} satisfies Record<string, (...args: never[]) => QueryKey>;

/** Overlay key of a value write: the coalescing unit (record × attribute). */
export function valueOverlayKey(recordId: string, attributeId: string): string {
  return `value:${recordId}:${attributeId}`;
}
