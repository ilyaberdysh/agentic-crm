// Notifications (BACKLOG 5.05–5.06; B-shell/notifications.md; CROSS-DOMAIN B.27; slice5-contracts "Notifications").
// The v2 data model: typed entries grouped into inbox rows (groups) per recipient; 24 Attio types in 11 topics, plus
// our `list-shared` (lists are the shareable resource we have; topic shared-with-you). Each type names its topic,
// preference group, channels, grouping key (a payload field) and max gap: consecutive entries with the same key within
// the gap merge into one row (multi-actor phrasing). Preferences are per preference group × channel; our channels are
// `in-app` (the inbox; Attio's "App" column is mobile push, which we do not build — web only) and `email` (stored now,
// delivered by the worker from slice 7). Row titles are the spec's UI copy; `{…}` placeholders are filled by the UI.
import { z } from 'zod';
import { actorSchema, timestampSchema, uuidSchema } from './common.ts';

/** Topic filter values, in the v2 inbox filter order (notifications §3). */
export const notificationTopics = [
  'mentions',
  'replies',
  'task-assignments',
  'shared-with-you',
  'email-access-requests',
  'sending-invites',
  'app-requests',
  'permission-requests',
  'request-updates',
  'workflow-messages',
  'workflow-requests',
] as const;
export const notificationTopicSchema = z.enum(notificationTopics);
export type NotificationTopic = z.infer<typeof notificationTopicSchema>;

export const NOTIFICATION_TOPIC_LABELS: Record<NotificationTopic, string> = {
  mentions: 'Mentions',
  replies: 'Replies',
  'task-assignments': 'Assignments',
  'shared-with-you': 'Shared with you',
  'email-access-requests': 'Email requests',
  'sending-invites': 'Sequence invites',
  'app-requests': 'App requests',
  'permission-requests': 'Permission requests',
  'request-updates': 'Request updates',
  'workflow-messages': 'Workflow messages',
  'workflow-requests': 'Workflow requests',
};

/** Preference groups (Attio `notification_group` of GET /notification-preferences, plus `workflows`). */
export const notificationPreferenceGroups = [
  'mentions',
  'replies',
  'grants',
  'tasks',
  'shared',
  'sequence-delegated-sender-invites',
  'permission-requests',
  'daily-digest',
  'app-updates',
  'workflows',
] as const;
export const notificationPreferenceGroupSchema = z.enum(notificationPreferenceGroups);
export type NotificationPreferenceGroup = z.infer<typeof notificationPreferenceGroupSchema>;

export const notificationChannels = ['in-app', 'email'] as const;
export const notificationChannelSchema = z.enum(notificationChannels);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

export interface NotificationPreferenceGroupInfo {
  group: NotificationPreferenceGroup;
  /** Settings row copy (notifications §5). */
  title: string;
  description: string;
  /** Shown as a row in Settings → Notifications (Attio hides app-updates; workflows arrive with slice 8). */
  visible: boolean;
  /** Channels the group can be delivered on. */
  channels: readonly NotificationChannel[];
  /** Defaults when the member never changed the group. */
  defaults: Record<NotificationChannel, boolean>;
}

const both = ['in-app', 'email'] as const;
export const NOTIFICATION_PREFERENCE_GROUPS: readonly NotificationPreferenceGroupInfo[] = [
  {
    group: 'mentions',
    title: 'Mentions',
    description: 'Notify me when someone cites me with an @mention in notes or comments.',
    visible: true,
    channels: both,
    defaults: { 'in-app': true, email: true },
  },
  {
    group: 'replies',
    title: 'Replies',
    description: 'Notify me when someone replies to my comments.',
    visible: true,
    channels: both,
    defaults: { 'in-app': true, email: true },
  },
  {
    group: 'grants',
    title: 'Email Grants',
    description: 'Notify me of email access requested or when my requests are accepted or denied.',
    visible: true,
    channels: both,
    defaults: { 'in-app': true, email: true },
  },
  {
    group: 'tasks',
    title: 'Task Assignments',
    description: "Notify me when I'm assigned a task.",
    visible: true,
    channels: both,
    defaults: { 'in-app': true, email: true },
  },
  {
    group: 'shared',
    title: 'Shared Resources',
    description: 'Notify me when someone shares a resource, such as an email, with me.',
    visible: true,
    channels: both,
    defaults: { 'in-app': true, email: true },
  },
  {
    group: 'sequence-delegated-sender-invites',
    title: 'Sequence delegated sender invites',
    description: 'Notify me when someone invites me to be a sequence delegated sender.',
    visible: true,
    channels: both,
    defaults: { 'in-app': true, email: true },
  },
  {
    group: 'permission-requests',
    title: 'Permission requests',
    description:
      'Notify me when someone requests access to a resource I manage, or when my own requests are approved or declined.',
    visible: true,
    channels: both,
    defaults: { 'in-app': true, email: true },
  },
  {
    group: 'daily-digest',
    title: 'Enable daily digest',
    description: 'Includes tasks overdue and due today. Sent every morning if any tasks are due or overdue.',
    visible: true,
    channels: ['email'],
    defaults: { 'in-app': false, email: true },
  },
  {
    group: 'app-updates',
    title: 'App updates',
    description: 'Notify me about app installation requests and app updates that need my approval.',
    visible: false,
    channels: both,
    defaults: { 'in-app': true, email: true },
  },
  {
    group: 'workflows',
    title: 'Workflows',
    description: 'Notify me when a workflow sends me a message or needs an action from me.',
    visible: false,
    channels: ['in-app'],
    defaults: { 'in-app': true, email: false },
  },
];

export const notificationTypes = [
  'comment-mentioned',
  'comment-replied',
  'note-mentioned',
  'task-assigned',
  'email-shared',
  'email-grant-request',
  'email-grant-request-response',
  'missing-email-grants-delegate',
  'missing-email-grants-delegate-access-request',
  'app-installation-request',
  'app-installation-request-response',
  'app-update-approval-required',
  'app-user-scopes-approved',
  'connection-sharing-request',
  'connection-sharing-request-response',
  'entity-definition-permission-request',
  'entity-definition-permission-request-response',
  'sequence-permission-request',
  'sequence-permission-request-response',
  'sequence-delegated-sender-invite',
  'sequence-delegated-sender-invite-response',
  'system-tools-sharing-request',
  'workflow-block-action-request',
  'workflow-message',
  // Ours: a list shared with a member (access grant), topic shared-with-you.
  'list-shared',
  // Ours (slice 8): a workflow run failed (Settings tab "Get notified when this workflow fails"; at most once a day
  // per workflow and unique failure reason, G runs.md §6).
  'workflow-run-failed',
] as const;
export const notificationTypeSchema = z.enum(notificationTypes);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

/** Channels of Attio's registry (`mobile-push` is recorded for parity; we deliver in-app and email only). */
export type RegistryChannel = 'app' | 'email' | 'mobile-push';

export interface NotificationTypeInfo {
  type: NotificationType;
  topic: NotificationTopic;
  preferenceGroup: NotificationPreferenceGroup;
  channels: readonly RegistryChannel[];
  /** Payload field whose value keys the inbox row; 'constant' = one row per recipient; null = never grouped. */
  groupBy: string | null;
  /** Max gap between consecutive entries of one row (ms). */
  maxGapMs: number;
  /** Request types: the row needs an action (Action needed tab) until resolved. */
  actionable: boolean;
  /** Payload fields (camelCase forms of Attio's payload keys). */
  payload: readonly string[];
  /** Row title (UI copy from notifications §4; `{record}` etc. filled by the UI). */
  title: string;
}

const HOUR = 3_600_000;
const t = (
  type: NotificationType,
  topic: NotificationTopic,
  preferenceGroup: NotificationPreferenceGroup,
  channels: readonly RegistryChannel[],
  groupBy: string | null,
  maxGapMs: number,
  payload: readonly string[],
  title: string,
  actionable = false,
): NotificationTypeInfo => ({ type, topic, preferenceGroup, channels, groupBy, maxGapMs, actionable, payload, title });

const APP = ['app'] as const;
const APP_PUSH = ['app', 'mobile-push'] as const;
const ALL = ['app', 'email', 'mobile-push'] as const;
const APP_EMAIL = ['app', 'email'] as const;

/** The type registry (notifications §4). */
export const NOTIFICATION_TYPES: Record<NotificationType, NotificationTypeInfo> = {
  'comment-mentioned': t(
    'comment-mentioned',
    'mentions',
    'mentions',
    ALL,
    'commentId',
    24 * HOUR,
    ['entityDefinitionId', 'entityInstanceId', 'commentId', 'threadId'],
    'Mentioned you in a comment on {record}',
  ),
  // Grouped by thread: replies in one thread within 8 h merge into one row ("{a} and {b} replied…").
  'comment-replied': t(
    'comment-replied',
    'replies',
    'replies',
    APP_PUSH,
    'threadId',
    8 * HOUR,
    ['entityDefinitionId', 'entityInstanceId', 'commentId', 'threadId'],
    'Replied to your comment on {record}',
  ),
  'note-mentioned': t(
    'note-mentioned',
    'mentions',
    'mentions',
    ALL,
    'noteId',
    8 * HOUR,
    ['entityDefinitionId', 'entityInstanceId', 'noteId'],
    'Mentioned you in a note on {record}',
  ),
  'task-assigned': t(
    'task-assigned',
    'task-assignments',
    'tasks',
    ALL,
    'taskId',
    8 * HOUR,
    ['taskId'],
    'Assigned a task to you',
  ),
  'email-shared': t(
    'email-shared',
    'shared-with-you',
    'shared',
    ALL,
    'emailId',
    8 * HOUR,
    ['emailId'],
    'Shared an email',
  ),
  'email-grant-request': t(
    'email-grant-request',
    'email-access-requests',
    'grants',
    ALL,
    'emailGrantRequestId',
    8 * HOUR,
    ['emailGrantRequestId'],
    'Requested access to your email {subject}',
    true,
  ),
  'email-grant-request-response': t(
    'email-grant-request-response',
    'request-updates',
    'grants',
    APP_PUSH,
    'emailGrantRequestId',
    8 * HOUR,
    ['emailGrantRequestId', 'status'],
    'Accepted your email access request',
  ),
  'missing-email-grants-delegate': t(
    'missing-email-grants-delegate',
    'email-access-requests',
    'grants',
    APP,
    'constant',
    24 * HOUR,
    ['workspaceMembershipId'],
    'Retained email data has no access handler',
    true,
  ),
  'missing-email-grants-delegate-access-request': t(
    'missing-email-grants-delegate-access-request',
    'email-access-requests',
    'grants',
    APP,
    'workspaceMembershipId',
    8 * HOUR,
    ['workspaceMembershipId'],
    'Requested access to a retained email',
    true,
  ),
  'app-installation-request': t(
    'app-installation-request',
    'app-requests',
    'app-updates',
    APP,
    'appId',
    8 * HOUR,
    ['appId', 'appInstallationRequestId'],
    'Requested to install {app}',
    true,
  ),
  'app-installation-request-response': t(
    'app-installation-request-response',
    'request-updates',
    'app-updates',
    APP_EMAIL,
    'appInstallationRequestId',
    8 * HOUR,
    ['appId', 'appInstallationRequestId', 'status'],
    '{app} has been installed in this workspace',
  ),
  'app-update-approval-required': t(
    'app-update-approval-required',
    'app-requests',
    'app-updates',
    APP_EMAIL,
    'appId',
    8 * HOUR,
    ['appId'],
    'An app update requires your approval',
    true,
  ),
  'app-user-scopes-approved': t(
    'app-user-scopes-approved',
    'request-updates',
    'app-updates',
    APP,
    'appId',
    8 * HOUR,
    ['appId'],
    'Create a new OAuth token to access the latest scopes',
    true,
  ),
  'connection-sharing-request': t(
    'connection-sharing-request',
    'permission-requests',
    'permission-requests',
    APP,
    'connectionSharingRequestId',
    8 * HOUR,
    ['appId', 'appInstallationId', 'connectionSharingRequestId'],
    'Requested to run {app} blocks on your behalf in the {workflow} workflow',
    true,
  ),
  'connection-sharing-request-response': t(
    'connection-sharing-request-response',
    'request-updates',
    'permission-requests',
    APP,
    'connectionSharingRequestId',
    8 * HOUR,
    ['appId', 'appInstallationId', 'connectionSharingRequestId', 'status'],
    '{app} connection sharing request was accepted',
  ),
  'entity-definition-permission-request': t(
    'entity-definition-permission-request',
    'permission-requests',
    'permission-requests',
    APP,
    'entityDefinitionPermissionRequestId',
    8 * HOUR,
    ['entityDefinitionId', 'entityDefinitionPermissionRequestId'],
    'Requested permission for the {workflow} workflow to have {level} access to {object}',
    true,
  ),
  'entity-definition-permission-request-response': t(
    'entity-definition-permission-request-response',
    'request-updates',
    'permission-requests',
    APP,
    'entityDefinitionPermissionRequestId',
    8 * HOUR,
    ['entityDefinitionId', 'entityDefinitionPermissionRequestId', 'status'],
    'Your permission request has been approved',
  ),
  'sequence-permission-request': t(
    'sequence-permission-request',
    'permission-requests',
    'permission-requests',
    APP,
    'sequencePermissionRequestId',
    8 * HOUR,
    ['sequenceId', 'sequencePermissionRequestId'],
    'Requested permission for the {workflow} workflow to have {level} access to {sequence}',
    true,
  ),
  'sequence-permission-request-response': t(
    'sequence-permission-request-response',
    'request-updates',
    'permission-requests',
    APP,
    'sequencePermissionRequestId',
    8 * HOUR,
    ['sequenceId', 'sequencePermissionRequestId', 'status'],
    'Your permission request has been approved',
  ),
  'sequence-delegated-sender-invite': t(
    'sequence-delegated-sender-invite',
    'sending-invites',
    'sequence-delegated-sender-invites',
    APP,
    'sequenceDelegatedSenderInviteId',
    8 * HOUR,
    ['sequenceId', 'sequenceDelegatedSenderInviteId'],
    'Invited you as delegated sender on {sequence}',
    true,
  ),
  'sequence-delegated-sender-invite-response': t(
    'sequence-delegated-sender-invite-response',
    'request-updates',
    'sequence-delegated-sender-invites',
    APP,
    'sequenceDelegatedSenderInviteId',
    8 * HOUR,
    ['sequenceId', 'sequenceDelegatedSenderInviteId', 'status'],
    'Accepted your delegated sender invite to {sequence}',
  ),
  'system-tools-sharing-request': t(
    'system-tools-sharing-request',
    'permission-requests',
    'permission-requests',
    APP,
    'systemToolsSharingRequestId',
    8 * HOUR,
    ['systemToolsSharingRequestId'],
    'Requested permission to use Attio tools on your behalf in the {workflow} workflow',
    true,
  ),
  'workflow-block-action-request': t(
    'workflow-block-action-request',
    'workflow-requests',
    'workflows',
    APP,
    'workflowBlockNotificationRootId',
    8 * HOUR,
    ['workflowBlockNotificationRootId'],
    'A workflow needs an action from you to continue',
    true,
  ),
  'workflow-message': t(
    'workflow-message',
    'workflow-messages',
    'workflows',
    APP,
    null,
    0,
    ['workflowBlockNotificationRootId'],
    'Sent you a message',
  ),
  'workflow-run-failed': t(
    'workflow-run-failed',
    'workflow-messages',
    'workflows',
    APP,
    null,
    0,
    ['workflowId', 'workflowTitle', 'workflowVersionId', 'workflowRunId', 'failureReason', 'errorMessage'],
    'The {workflow} workflow failed',
  ),
  'list-shared': t(
    'list-shared',
    'shared-with-you',
    'shared',
    APP_EMAIL,
    'listId',
    8 * HOUR,
    ['listId', 'level'],
    'Shared the list {list} with you',
  ),
};

export const notificationTypesOf = (topic: NotificationTopic): NotificationType[] =>
  notificationTypes.filter((type) => NOTIFICATION_TYPES[type].topic === topic);

// ---------------------------------------------------------------------------------------------------------------
// Inbox procedures

export const notificationStateSchema = z.enum(['unread', 'all', 'archived']);
export type NotificationState = z.infer<typeof notificationStateSchema>;

export const listNotificationsInputSchema = z.object({
  /** One topic, or several (the v2 inbox's "Notification type" checkboxes); omitted = every topic. */
  topic: notificationTopicSchema.optional(),
  topics: z.array(notificationTopicSchema).max(notificationTopics.length).optional(),
  /** unread: rows with an unread entry; all: every row not archived; archived: archived rows. */
  state: notificationStateSchema.default('all'),
  /** Only rows that still need an action (the "Action needed" tab). */
  actionNeeded: z.boolean().optional(),
  /** `nextCursor` of the previous page. */
  cursor: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(100).default(25),
});
export type ListNotificationsInput = z.input<typeof listNotificationsInputSchema>;

export const notificationRecordSummarySchema = z.object({
  entityDefinitionId: uuidSchema,
  entityInstanceId: uuidSchema,
  /** Record label; null when the record has none. */
  title: z.string().nullable(),
  /** Deleted, merged away or no longer readable by the recipient. */
  isUnavailable: z.boolean(),
});
export type NotificationRecordSummary = z.infer<typeof notificationRecordSummarySchema>;

/** What the row is about, resolved at read time (fallback copy when `isUnavailable`). */
export const notificationSubjectSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('comment'),
    commentId: uuidSchema,
    threadId: uuidSchema,
    /** Comment text, at most 280 characters. */
    text: z.string().nullable(),
    /** The record the thread is on (for list-entry comments: the entry's parent record). */
    record: notificationRecordSummarySchema.nullable(),
    /** Set for list-entry comments. */
    listId: uuidSchema.nullable(),
    entryId: uuidSchema.nullable(),
    isUnavailable: z.boolean(),
  }),
  z.object({
    kind: z.literal('note'),
    noteId: uuidSchema,
    title: z.string().nullable(),
    record: notificationRecordSummarySchema.nullable(),
    isUnavailable: z.boolean(),
  }),
  z.object({
    kind: z.literal('task'),
    taskId: uuidSchema,
    title: z.string().nullable(),
    isCompleted: z.boolean(),
    deadlineAt: timestampSchema.nullable(),
    linkedRecordCount: z.number().int(),
    isUnavailable: z.boolean(),
  }),
  z.object({
    kind: z.literal('list'),
    listId: uuidSchema,
    name: z.string().nullable(),
    icon: z.string().nullable(),
    isUnavailable: z.boolean(),
  }),
]);
export type NotificationSubject = z.infer<typeof notificationSubjectSchema>;

export const notificationEntrySchema = z.object({
  id: uuidSchema,
  type: notificationTypeSchema,
  actor: actorSchema,
  payload: z.record(z.string(), z.unknown()),
  createdAt: timestampSchema,
  readAt: timestampSchema.nullable(),
  resolvedAt: timestampSchema.nullable(),
});
export type NotificationEntry = z.infer<typeof notificationEntrySchema>;

/** One inbox row (Attio notification group). */
export const notificationGroupSchema = z.object({
  id: uuidSchema,
  /** Type of the newest entry. */
  type: notificationTypeSchema,
  topic: notificationTopicSchema,
  preferenceGroup: notificationPreferenceGroupSchema,
  /** Every entry read. */
  isRead: z.boolean(),
  isArchived: z.boolean(),
  /** Actionable rows: every entry resolved; non-actionable rows are always resolved. */
  isResolved: z.boolean(),
  actionable: z.boolean(),
  firstAt: timestampSchema,
  latestAt: timestampSchema,
  entryCount: z.number().int(),
  unreadCount: z.number().int(),
  /** Distinct actors, newest first (at most 5); `actorCount` counts them all ("{name} and {count} more"). */
  actors: z.array(actorSchema),
  actorCount: z.number().int(),
  /** Newest entries first (at most 10). */
  entries: z.array(notificationEntrySchema),
  subject: notificationSubjectSchema.nullable(),
});
export type NotificationGroup = z.infer<typeof notificationGroupSchema>;

export const listNotificationsOutputSchema = z.object({
  items: z.array(notificationGroupSchema),
  nextCursor: z.string().nullable(),
});
export type ListNotificationsOutput = z.infer<typeof listNotificationsOutputSchema>;

export const notificationUnreadCountSchema = z.object({
  /** Unread rows (not archived) — the sidebar Inbox badge ("99+" from 100). */
  count: z.number().int(),
  byTopic: z.record(notificationTopicSchema, z.number().int()),
  /** Unresolved actionable rows (Action needed tab badge). */
  actionNeeded: z.number().int(),
  accurateAt: timestampSchema,
});
export type NotificationUnreadCount = z.infer<typeof notificationUnreadCountSchema>;

const idsOrAll = {
  /** Inbox row (group) ids. */
  ids: z.array(uuidSchema).min(1).max(500).optional(),
  /** Every row of the member (optionally of `topics`). */
  all: z.literal(true).optional(),
  topics: z.array(notificationTopicSchema).max(notificationTopics.length).optional(),
};
const oneOf = (v: { ids?: unknown; all?: unknown }) => (v.ids === undefined) !== (v.all === undefined);

export const markNotificationsReadInputSchema = z.object(idsOrAll).refine(oneOf, 'Pass either ids or all: true');
export type MarkNotificationsReadInput = z.input<typeof markNotificationsReadInputSchema>;

export const markNotificationsUnreadInputSchema = z.object({ ids: z.array(uuidSchema).min(1).max(500) });
export type MarkNotificationsUnreadInput = z.input<typeof markNotificationsUnreadInputSchema>;

export const archiveNotificationsInputSchema = z
  .object({ ...idsOrAll, /** false = move back to the inbox. */ archived: z.boolean().default(true) })
  .refine(oneOf, 'Pass either ids or all: true');
export type ArchiveNotificationsInput = z.input<typeof archiveNotificationsInputSchema>;

export const notificationsChangedOutputSchema = z.object({ updated: z.number().int() });
export type NotificationsChangedOutput = z.infer<typeof notificationsChangedOutputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Preferences

export const notificationPreferencesSchema = z.object({
  groups: z.array(
    z.object({
      group: notificationPreferenceGroupSchema,
      title: z.string(),
      description: z.string(),
      visible: z.boolean(),
      channels: z.array(z.object({ channel: notificationChannelSchema, available: z.boolean(), enabled: z.boolean() })),
    }),
  ),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const updateNotificationPreferenceInputSchema = z.object({
  group: notificationPreferenceGroupSchema,
  channel: notificationChannelSchema,
  enabled: z.boolean(),
});
export type UpdateNotificationPreferenceInput = z.input<typeof updateNotificationPreferenceInputSchema>;
