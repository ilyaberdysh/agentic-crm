// Realtime contract shared by packages/domain (writer of change_log) and apps/api (WS gateway) and apps/web (client).
// See ARCHITECTURE.md I4 for the transaction and delivery contract.

/**
 * One row of `change_log` (outbox), written in the same transaction as the change it describes (I1).
 * Table (owned by packages/db, migration range 0200–0299):
 *   change_log(id bigint generated always as identity primary key, workspace_id uuid not null,
 *              xid xid8 not null default pg_current_xact_id(), resource text not null, resource_id uuid,
 *              scope jsonb not null default '{}', actor jsonb, audience jsonb, created_at timestamptz not null default now())
 * After commit the writer issues `NOTIFY change_log, '<id>'`; the gateway reads rows by id cursor.
 */
export interface ChangeLogRow {
  id: string; // bigint as string
  workspaceId: string;
  resource: InvalidationResource;
  resourceId: string | null;
  /** Extra keys that narrow the invalidation, e.g. { entityDefinitionId, attributeDefinitionId, entityInstanceIds } */
  scope: Record<string, unknown>;
  actor: Actor | null;
  /** null = every member of the workspace who can read the resource; otherwise explicit user ids */
  audience: { userIds: string[] } | null;
  createdAt: string;
}

export type Actor =
  | { type: 'workspace-member'; id: string }
  | { type: 'api-token'; id: string }
  | { type: 'system'; id: string | null }
  | { type: 'workflow'; id: string };

/** Resources that can be invalidated. */
export type InvalidationResource =
  | 'workspace'
  | 'workspace-member'
  | 'workspace-invite-list' // pending invites of the workspace (settings → members)
  | 'entity-definition'
  | 'entity-definition-list'
  | 'attribute-definition'
  | 'attribute-definition-list'
  | 'select-option-list'
  | 'entity-instance'
  | 'attribute-value-list' // values of one attribute on one or many instances (scope.entityInstanceIds)
  | 'entity-view'
  | 'entity-view-list'
  | 'snapshot-selection' // any snapshot over the definition may be stale (scope.entityDefinitionId)
  | 'collection'
  | 'collection-list'
  // Slice 3 (record page, notes, tasks, comments, favorites, files, layouts). Scope keys name what to refetch.
  | 'note' // one note header (resourceId = note id)
  | 'note-list' // notes of records (scope.entityInstanceIds) and the notes index
  | 'note-template' // one template header
  | 'note-template-list'
  | 'task' // one task (resourceId = task id)
  | 'task-list' // task queries (scope.entityInstanceIds = linked records, scope.memberIds = assignees)
  | 'comment-thread' // one thread (resourceId = thread root id): comments, replies, reactions, resolution
  | 'comment-thread-list' // threads of a record / entry (scope.entityDefinitionId, scope.entityInstanceIds)
  | 'favorite-list' // the member's favorites and folders (audience: that member only)
  | 'storage-entry-list' // files of a record (scope.entityInstanceId, scope.parentFolderIds)
  | 'upload-session'
  | 'custom-layout' // record page layout of an object (scope.entityDefinitionId)
  | 'record-timeline' // activity of records (resourceId = entity definition id, scope.entityInstanceIds)
  | 'member-preferences' // the member's calendar preferences (audience: that member only)
  /** A rich-text document's projections changed (blocks/markdown; scope.docType, scope.parentRef, scope.version). */
  | 'document'
  | 'import-job' // one import (resourceId = job id): status, progress, plan, mapping, overrides (scope.importId)
  | 'import-job-list' // import history of the workspace / of an object or list (scope.entityDefinitionId)
  | 'entity-definition-export' // one view export (resourceId = export id; audience: its creator)
  // Slice 5 (notifications; audience: the recipient only). resourceId = the inbox row (group) id, or null when many
  // rows changed (read / unread / archive); scope.memberId, scope.groupIds, scope.topics. Clients refetch the inbox
  // Notifications track group changes and acknowledgement changes separately.
  | 'notification'
  | 'notification-preferences' // the member's notification preferences (audience: that member)
  // Slice 6 (settings). Grant changes invalidate 'entity-definition' (clients refetch resolved policies); team
  // membership changes invalidate 'entity-definition-list' for the same reason.
  | 'workspace-team' // one team (resourceId = team id): name, description, icon, members
  | 'workspace-team-list' // the teams of the workspace
  | 'requirement-rule-list' // rules of an object (resourceId = entity definition id)
  | 'api-token-list' // developer access tokens (admins)
  | 'webhook' // one webhook (resourceId = webhook id): settings, status, deliveries
  | 'webhook-list'
  | 'reporting-dashboard' // one dashboard header (resourceId = dashboard id): title, description, grants
  | 'reporting-dashboard-list' // the dashboards index (create, delete, rename)
  /** Cells, layout and reports of one dashboard (resourceId = dashboard id; scope.cellIds, scope.reportIds). */
  | 'reporting-dashboard-cells'
  /**
   * Report results over a definition may be stale (resourceId = entity definition id; scope.entityDefinitionId,
   * scope.attributeDefinitionIds = the changed attributes, null = records added/removed or unknown). Emitted only
   * for definitions some saved report depends on; a cell is stale when seq > its dataset's freshness.seq and the
   * definition/attributes intersect the dataset's freshness dependencies ("New data" pill, H README §3.7).
   */
  | 'report-stale'
  /**
   * Webhook events of a transaction (scope.events); audience nobody — consumed by the webhook fan-out in the worker,
   * never forwarded to clients.
   */
  | 'domain-events'
  // Slice 7 (email and calendar). Synced data is invalidated per record (scope.entityInstanceIds) so record pages
  // refetch their Emails tab / meetings; personal resources go to their owner only.
  | 'mailbox' // one mailbox (resourceId = mailbox id; audience: its owner) — settings, sync status
  | 'mailbox-list' // the member's mailboxes (audience: that member)
  | 'email-thread-list' // threads of records (scope.entityInstanceIds) or one thread (scope.threadIds)
  | 'email-grant-list' // sharing grants changed (scope.mailboxIds, scope.threadIds, scope.entityInstanceIds)
  | 'meeting' // one meeting (resourceId = meeting id)
  | 'meeting-list' // meetings of records (scope.entityInstanceIds) and calendar ranges
  /**
   * Call recordings changed (created, processed, deleted): the meeting's recordings, the Calls list and the Calls tab
   * of records (scope.meetingId, scope.recordingIds, scope.entityInstanceIds = linked records + participants' people
   * and companies). Slice 10 fires it on create, on processing completion and on delete (X-27).
   */
  | 'call-recording-list'
  // Slice 10 (calls, insight templates).
  | 'call-recording' // one call (resourceId = recording id; scope.meetingId): status, summaries, speakers, transcript
  | 'call-insight-list' // insights of a call (resourceId = recording id; scope.meetingId, scope.insightIds)
  | 'insight-template' // one template (resourceId = template id): header, draft / active versions, sections, previews
  | 'insight-template-list' // the templates index (create, publish, archive, delete, reorder)
  | 'member-call-settings' // the member's default insight template (audience: that member)
  | 'message-draft' // one draft (resourceId = draft id; audience: its creator)
  | 'message-draft-list' // the member's drafts (audience: that member)
  | 'outbox' // the member's outbox (audience: that member)
  | 'email-template' // one template (resourceId = template id)
  | 'email-template-list'
  | 'mailbox-signature-list' // signatures of a mailbox (scope.mailboxId; audience: its owner)
  | 'workspace-email-settings' // record creation / visibility defaults, suppression and protected contacts
  | 'mailbox-blocklist' // a mailbox's blocklist (scope.mailboxId; audience: its owner)
  // Slice 8 (workflows). 'workflow': one workflow (resourceId = workflow id): header, draft, versions, settings,
  // permissions; 'workflow-list': the index; 'workflow-run': one run (resourceId = run id, scope.workflowId): status,
  // frames, block executions; 'workflow-run-list': runs of a workflow (resourceId = workflow id);
  // 'workflow-broadcast': a broadcast message or celebration for the audience (resourceId = broadcast id).
  | 'workflow'
  | 'workflow-list'
  | 'workflow-run'
  | 'workflow-run-list'
  | 'workflow-broadcast'
  /**
   * Trigger events of a transaction (scope.events, scope.cause); audience nobody — consumed by the workflow trigger
   * fan-out in the worker, never forwarded to clients.
   */
  | 'workflow-events'
  // Threads are private: audience = owner.
  | 'ai-thread' // one thread header (resourceId = thread id): title, AI title, favourite, web search permission
  | 'ai-thread-list' // the member's threads (sidebar Chats, history)
  /** One turn (resourceId = turn id; scope.threadId): status, steps, parts, credit cost, feedback, suggestions. */
  | 'ai-turn'
  | 'ai-turn-list' // turns of a thread (resourceId = thread id)
  | 'ai-prompt' // one custom prompt (resourceId = prompt id): body, AI metadata, sharing
  | 'ai-prompt-list' // the member's prompts and saved curated prompts
  | 'ai-settings' // Ask Agentic settings: workspace (custom context, limit) or the member's (scope.memberId)
  | 'credit-usage' // credits spent (scope.source, scope.memberId): usage counters, ledger
  | 'record-ai-summary' // AI summary of a record (resourceId = entity definition id, scope.entityInstanceIds)
  /**
   * Per-record formula / AI autofill state of one attribute (resourceId = attribute id; scope.entityDefinitionId,
   * scope.attributeDefinitionId, scope.entityInstanceIds): "Calculating...", "AI is thinking...", errors.
   */
  | 'entity-annotation'
  /** One AI formula composer request (resourceId = request id; scope.entityDefinitionId). */
  | 'formula-generation-request'
  /** One AI recalculation run (resourceId = run id; scope.attributeDefinitionId): progress and credits used. */
  | 'ai-attribute-run'
  /**
   * A formula needs a full recompute (scope.attributeDefinitionId, scope.reason); audience nobody — consumed by the
   * formula recompute pump in the worker, never forwarded to clients.
   */
  | 'formula-recompute';

/** Message on the per-user data channel: invalidation only (I4a). */
export interface InvalidationMessage {
  type: 'invalidate';
  seq: string; // change_log id; clients refetch with acceptAfter=seq
  workspaceId: string;
  resource: InvalidationResource;
  resourceId: string | null;
  scope: Record<string, unknown>;
}

/**
 * Messages on room channels: ephemeral only (I4b).
 * `clientId` = `<userId>.<connectionId>` (CROSS-DOMAIN X-04): one entry per tab; the UI shows one avatar per user.
 */
export type RoomMessage =
  | { type: 'presence'; room: string; members: PresenceMember[] }
  | { type: 'ephemeral'; room: string; from: string; clientId?: string; payload: Record<string, unknown> };

export interface PresenceMember {
  userId: string;
  clientId?: string;
  state: Record<string, unknown>;
}

/**
 * Room names are `<namespace>:<workspaceId>[:<param>...]`;
 * joining requires membership of that workspace.
 */
export type ClientToServer =
  /** `after` = the last `cursor` the client received; the server replays newer invalidations or says `continuity-lost`. */
  | { type: 'subscribe-workspace'; workspaceId: string; after?: string }
  | { type: 'unsubscribe-workspace'; workspaceId: string }
  | { type: 'join-room'; room: string; state?: Record<string, unknown> }
  | { type: 'leave-room'; room: string }
  | { type: 'room-state'; room: string; state: Record<string, unknown> }
  | { type: 'room-ephemeral'; room: string; payload: Record<string, unknown> }
  | { type: 'ping' };

/**
 * `cursor` is the gateway's resume point: every invalidation with seq <= cursor that this connection should
 * receive has already been sent on it. Clients store the latest cursor and pass it as `after` when resubscribing.
 */
export type ServerToClient =
  | InvalidationMessage
  | RoomMessage
  | { type: 'ready'; connectionId: string; userId: string; clientId: string; cursor: string }
  | { type: 'subscribed'; workspaceId: string; cursor: string }
  | { type: 'unsubscribed'; workspaceId: string; reason: 'requested' | 'not-a-member' }
  /** The server cannot prove nothing was missed: drop/refetch everything cached (for `workspaceId`, or all). */
  | { type: 'continuity-lost'; workspaceId?: string }
  | { type: 'pong'; cursor?: string }
  | { type: 'error'; code: RealtimeErrorCode; message: string };

export type RealtimeErrorCode = 'bad-message' | 'forbidden' | 'not-found' | 'rate-limited' | 'limit-exceeded';

/** WebSocket close codes used by the gateway (4000–4999 = application range). */
export const RealtimeCloseCode = {
  /** Session missing, expired or signed out: do not reconnect until signed in again. */
  unauthorized: 4401,
  /** Client fell too far behind (send buffer full): reconnect and resume with the last cursor. */
  slowConsumer: 4408,
  /** Server shutting down / restarting: reconnect with backoff. */
  serviceRestart: 1012,
  goingAway: 1001,
} as const;

/** Reconnect delays (ms) of the data channel, then repeat the last one [observed: A realtime.md §4]. */
export const RECONNECT_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000] as const;

/** Header carrying `acceptAfter` (an invalidation seq) on refetches: "don't serve data older than this change". */
export const ACCEPT_AFTER_HEADER = 'x-accept-after';

/** `pg_notify` channel the change_log writer notifies after commit. */
export const CHANGE_LOG_CHANNEL = 'change_log';
