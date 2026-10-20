// Query keys for email and calendar resources. Every key lives under
// ['ws', workspaceId, <resource>, …] where <resource> is the realtime invalidation vocabulary
// (packages/realtime InvalidationResource; data/realtime/invalidation.ts maps a message onto a key prefix), so a
// server invalidation refetches exactly the queries that show the changed data.
import { keys } from './keys';

export const emailKeys = {
  // ---- mailboxes and workspace email settings (settings, composer sender) ----
  mailboxes: (ws: string, params: unknown = {}) => [...keys.resource(ws, 'mailbox-list'), params] as const,
  mailbox: (ws: string, mailboxId: string) => [...keys.resource(ws, 'mailbox'), mailboxId] as const,
  blocklist: (ws: string, mailboxId: string) => [...keys.resource(ws, 'mailbox-blocklist'), mailboxId] as const,
  /** "Individuals with full access" of a mailbox. */
  mailboxSharing: (ws: string, mailboxId: string) =>
    [...keys.resource(ws, 'email-grant-list'), 'mailbox', mailboxId] as const,
  signatures: (ws: string, mailboxId: string) => [...keys.resource(ws, 'mailbox-signature-list'), mailboxId] as const,
  workspaceSettings: (ws: string) => [...keys.resource(ws, 'workspace-email-settings'), 'settings'] as const,
  protectedContacts: (ws: string) => [...keys.resource(ws, 'workspace-email-settings'), 'protected'] as const,
  suppression: (ws: string) => [...keys.resource(ws, 'workspace-email-settings'), 'suppression'] as const,

  // ---- synced mail (record Emails tab, email modal, sharing) ----
  recordThreads: (ws: string, recordId: string, params: unknown = {}) =>
    [...keys.resource(ws, 'email-thread-list'), 'record', recordId, params] as const,
  thread: (ws: string, threadId: string) => [...keys.resource(ws, 'email-thread-list'), 'thread', threadId] as const,
  message: (ws: string, messageId: string) =>
    [...keys.resource(ws, 'email-thread-list'), 'message', messageId] as const,
  grants: (ws: string, resource: unknown) => [...keys.resource(ws, 'email-grant-list'), 'grants', resource] as const,

  // ---- composer, drafts, outbox, templates ----
  drafts: (ws: string) => keys.resource(ws, 'message-draft-list'),
  draft: (ws: string, draftId: string) => [...keys.resource(ws, 'message-draft'), draftId] as const,
  draftReview: (ws: string, draftId: string) => [...keys.resource(ws, 'message-draft'), draftId, 'review'] as const,
  outbox: (ws: string) => keys.resource(ws, 'outbox'),
  templates: (ws: string) => keys.resource(ws, 'email-template-list'),
  template: (ws: string, templateId: string) => [...keys.resource(ws, 'email-template'), templateId] as const,
  /** Merge-field values of recipient records (reads attribute values: refreshed when they change). */
  variableValues: (ws: string, params: unknown) =>
    [...keys.resource(ws, 'attribute-value-list'), 'email-variables', params] as const,

  // ---- meetings ----
  meeting: (ws: string, meetingId: string) => [...keys.resource(ws, 'meeting'), meetingId] as const,
  meetings: (ws: string, params: unknown = {}) => [...keys.resource(ws, 'meeting-list'), params] as const,
  recordings: (ws: string, meetingId: string) => [...keys.resource(ws, 'call-recording-list'), meetingId] as const,
};
