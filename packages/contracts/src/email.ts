// Email (slice 7a; BACKLOG 7.01–7.03, 7.06–7.08; specs F README §2.2–2.3, §4, F composer §2–6, F settings §1–4;
// decisions in research/architecture/decisions/slice7-contracts.md). Procedure contracts for mailboxes, workspace
// email settings, record suppression, protected contacts, synced emails with visibility levels and sharing grants,
// drafts (autosave per field), review, outbox, templates, signatures and variables.
import { z } from 'zod';
import { recordRefInputSchema, recordRefSchema } from './collab.ts';
import { acceptAfterSchema, actorSchema, timestampSchema, uuidSchema } from './common.ts';

// ---------------------------------------------------------------------------------------------------------------
// Levels and enums

/** Visibility levels of synced email and calendar (decision C.4 #13), most to least visible. */
export const visibilityLevels = ['full-access', 'subject-line', 'metadata-only'] as const;
export const visibilityLevelSchema = z.enum(visibilityLevels);
export type VisibilityLevel = z.infer<typeof visibilityLevelSchema>;

/** What a member may see of one email or meeting: a visibility level, or nothing (protected contacts). */
export const emailAccessSchema = z.enum(['full-access', 'subject-line', 'metadata-only', 'none']);
export type EmailAccess = z.infer<typeof emailAccessSchema>;

/** Rank of a level: none 0 < metadata-only 1 < subject-line 2 < full-access 3. */
export const ACCESS_RANK: Record<EmailAccess, number> = {
  none: 0,
  'metadata-only': 1,
  'subject-line': 2,
  'full-access': 3,
};

/** Workspace record creation (F settings §4.2; Attio `automatic_record_creation_mode` all | enhanced | none). */
export const recordCreationModes = ['all', 'selective', 'none'] as const;
export const recordCreationModeSchema = z.enum(recordCreationModes);
export type RecordCreationMode = z.infer<typeof recordCreationModeSchema>;

export const providerTypes = ['test', 'gmail'] as const;
export const providerTypeSchema = z.enum(providerTypes);
export type ProviderType = z.infer<typeof providerTypeSchema>;

export const participantRoles = ['from', 'reply-to', 'to', 'cc', 'bcc'] as const;
export const participantRoleSchema = z.enum(participantRoles);
export type ParticipantRole = z.infer<typeof participantRoleSchema>;

const emailAddressSchema = z.string().trim().min(3).max(320);

// ---------------------------------------------------------------------------------------------------------------
// Workspace email settings, record suppression, protected contacts

export const workspaceEmailSettingsSchema = z.object({
  /** Visibility level given to newly connected mailboxes. */
  defaultVisibility: visibilityLevelSchema,
  recordCreation: recordCreationModeSchema,
  autoCreateCompanies: z.boolean(),
  /** Internal domains (members' address domains, public providers excluded): protected by system default. */
  internalDomains: z.array(z.string()),
  /** Internal domains whose system protection was switched off. */
  unprotectedDomains: z.array(z.string()),
  updatedAt: timestampSchema.nullable(),
});
export type WorkspaceEmailSettings = z.infer<typeof workspaceEmailSettingsSchema>;

export const updateWorkspaceEmailSettingsInputSchema = z.object({
  defaultVisibility: visibilityLevelSchema.optional(),
  recordCreation: recordCreationModeSchema.optional(),
  autoCreateCompanies: z.boolean().optional(),
  unprotectedDomains: z.array(z.string().max(253)).max(100).optional(),
});
export type UpdateWorkspaceEmailSettingsInput = z.infer<typeof updateWorkspaceEmailSettingsInputSchema>;

export const contactKindSchema = z.enum(['domain', 'email']);
export type ContactKind = z.infer<typeof contactKindSchema>;

export const suppressionEntrySchema = z.object({
  id: uuidSchema,
  kind: contactKindSchema,
  value: z.string(),
  createdBy: actorSchema,
  createdAt: timestampSchema,
});
export type SuppressionEntry = z.infer<typeof suppressionEntrySchema>;

export const listSuppressionOutputSchema = z.object({
  domains: z.array(suppressionEntrySchema),
  emailAddresses: z.array(suppressionEntrySchema),
});
export type ListSuppressionOutput = z.infer<typeof listSuppressionOutputSchema>;

/** Token dialogs (suppression, blocklist, protected contacts): domains and addresses, comma/space separated. */
export const addContactsInputSchema = z.object({
  values: z.array(z.string().max(320)).min(1).max(1000),
});
export type AddContactsInput = z.infer<typeof addContactsInputSchema>;

export const addContactsOutputSchema = z.object({
  added: z.array(suppressionEntrySchema),
  /** Values already in the list. */
  duplicates: z.array(z.string()),
  /** "Invalid email/domain". */
  invalid: z.array(z.string()),
});
export type AddContactsOutput = z.infer<typeof addContactsOutputSchema>;

export const removeEntryInputSchema = z.object({ id: uuidSchema });

export const protectedContactSchema = suppressionEntrySchema.extend({
  enforcement: z.enum(['protected', 'blocked']),
  updatedAt: timestampSchema,
});
export type ProtectedContact = z.infer<typeof protectedContactSchema>;

export const addProtectedContactsInputSchema = addContactsInputSchema.extend({
  enforcement: z.enum(['protected', 'blocked']).default('protected'),
});
export type AddProtectedContactsInput = z.input<typeof addProtectedContactsInputSchema>;

export const updateProtectedContactInputSchema = z.object({
  id: uuidSchema,
  enforcement: z.enum(['protected', 'blocked']),
});

// ---------------------------------------------------------------------------------------------------------------
// Mailboxes

export const mailboxStatusSchema = z.enum(['in-sync', 'syncing', 'sync-error', 'archived']);

export const mailboxSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  memberId: uuidSchema,
  connectedAccountId: uuidSchema,
  providerType: providerTypeSchema,
  emailAddress: z.string(),
  aliases: z.array(z.string()),
  isDefault: z.boolean(),
  mailSyncEnabled: z.boolean(),
  calendarSyncEnabled: z.boolean(),
  mailDeliveryEnabled: z.boolean(),
  defaultVisibility: visibilityLevelSchema,
  syncState: z.enum(['pre-sync', 'historic', 'realtime']),
  /** Settings row chip: "In Sync" / "Syncing..." / "Sync Error" / "Archived". */
  status: mailboxStatusSchema,
  credentialState: z.enum(['active', 'error-detected', 'disconnected']),
  messagesSynced: z.number().int(),
  eventsSynced: z.number().int(),
  lastSyncedAt: timestampSchema.nullable(),
  syncError: z.string().nullable(),
  defaultSignatureId: uuidSchema.nullable(),
  createdAt: timestampSchema,
  archivedAt: timestampSchema.nullable(),
});
export type Mailbox = z.infer<typeof mailboxSchema>;

export const listMailboxesInputSchema = z
  .object({
    /** Another member's mailboxes (admins only, settings → members → accounts). Default: the caller's. */
    memberId: uuidSchema.optional(),
    includeArchived: z.boolean().default(false),
    acceptAfter: acceptAfterSchema,
  })
  .optional();
export type ListMailboxesInput = z.input<typeof listMailboxesInputSchema>;

export const mailboxIdInputSchema = z.object({ mailboxId: uuidSchema, acceptAfter: acceptAfterSchema });

export const connectMailboxInputSchema = z.object({
  /** Client-minted mailbox id (I3); replays return the mailbox. */
  id: uuidSchema.optional(),
  provider: providerTypeSchema,
  /** test provider: the mailbox address (Gmail takes it from OAuth in 7b). */
  emailAddress: emailAddressSchema.optional(),
  aliases: z.array(emailAddressSchema).max(20).optional(),
  syncCalendar: z.boolean().default(true),
});
export type ConnectMailboxInput = z.input<typeof connectMailboxInputSchema>;

export const updateMailboxInputSchema = z.object({
  mailboxId: uuidSchema,
  defaultVisibility: visibilityLevelSchema.optional(),
  isDefault: z.literal(true).optional(),
  mailSyncEnabled: z.boolean().optional(),
  calendarSyncEnabled: z.boolean().optional(),
  defaultSignatureId: uuidSchema.nullable().optional(),
});
export type UpdateMailboxInput = z.infer<typeof updateMailboxInputSchema>;

export const blocklistEntrySchema = suppressionEntrySchema.extend({ mailboxId: uuidSchema });
export type BlocklistEntry = z.infer<typeof blocklistEntrySchema>;

export const addBlocklistInputSchema = addContactsInputSchema.extend({ mailboxId: uuidSchema });
export type AddBlocklistInput = z.infer<typeof addBlocklistInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Sharing (email grants)

export const grantResourceSchema = z.discriminatedUnion('type', [
  /** Mailbox settings "Individuals with full access" (and workspace-wide mailbox sharing). */
  z.object({ type: z.literal('mailbox'), mailboxId: uuidSchema }),
  /** Email modal "Share" (the whole thread). */
  z.object({ type: z.literal('thread'), threadId: uuidSchema }),
  /** Record Emails tab "Manage access": the caller's emails on this record. */
  z.object({ type: z.literal('record'), record: recordRefInputSchema }),
]);
export type GrantResource = z.input<typeof grantResourceSchema>;

export const grantTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('member'), memberId: uuidSchema }),
  z.object({ type: z.literal('workspace') }),
]);
export type GrantTarget = z.infer<typeof grantTargetSchema>;

export const emailGrantSchema = z.object({
  id: uuidSchema,
  ownerMemberId: uuidSchema,
  resource: z.discriminatedUnion('type', [
    z.object({ type: z.literal('mailbox'), mailboxId: uuidSchema }),
    z.object({ type: z.literal('thread'), threadId: uuidSchema }),
    z.object({ type: z.literal('record'), record: recordRefSchema }),
  ]),
  target: grantTargetSchema,
  level: visibilityLevelSchema,
  createdBy: actorSchema,
  createdAt: timestampSchema,
});
export type EmailGrant = z.infer<typeof emailGrantSchema>;

export const listGrantsInputSchema = z.object({ resource: grantResourceSchema, acceptAfter: acceptAfterSchema });
export type ListGrantsInput = z.input<typeof listGrantsInputSchema>;

export const putGrantInputSchema = z.object({
  resource: grantResourceSchema,
  target: grantTargetSchema,
  /** Default full access ("Grant access"). */
  level: visibilityLevelSchema.default('full-access'),
});
export type PutGrantInput = z.input<typeof putGrantInputSchema>;

export const removeGrantInputSchema = z.object({ grantId: uuidSchema });

// ---------------------------------------------------------------------------------------------------------------
// Synced emails (record Emails tab, email modal)

export const emailParticipantSchema = z.object({
  role: participantRoleSchema,
  emailAddress: z.string(),
  name: z.string().nullable(),
  memberId: uuidSchema.nullable(),
  personId: uuidSchema.nullable(),
  companyId: uuidSchema.nullable(),
});
export type EmailParticipant = z.infer<typeof emailParticipantSchema>;

export const emailAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  contentType: z.string(),
  size: z.number().int(),
});
export type EmailAttachment = z.infer<typeof emailAttachmentSchema>;

/** One mailbox copy of a message ("via <owner>" / "via N mailboxes"). */
export const emailCopySchema = z.object({
  mailboxId: uuidSchema,
  memberId: uuidSchema,
  direction: z.enum(['inbound', 'outbound']),
});

/**
 * A message with the viewer's access applied: metadata (participants, time) for every level; `subject` from
 * subject-line up (null below — "Private subject line"); snippet, bodies and attachments with full access only.
 */
export const emailMessageViewSchema = z.object({
  id: uuidSchema,
  threadId: uuidSchema,
  access: emailAccessSchema,
  /** The viewer owns one of the copies (always full access). */
  isOwn: z.boolean(),
  sentAt: timestampSchema,
  participants: z.array(emailParticipantSchema),
  subject: z.string().nullable(),
  snippet: z.string().nullable(),
  bodyText: z.string().nullable(),
  bodyHtml: z.string().nullable(),
  hasAttachments: z.boolean().nullable(),
  attachments: z.array(emailAttachmentSchema).nullable(),
  copies: z.array(emailCopySchema),
});
export type EmailMessageView = z.infer<typeof emailMessageViewSchema>;

export const emailThreadSummarySchema = z.object({
  threadId: uuidSchema,
  /** The message shown on the row (latest one the viewer can see). */
  displayMessageId: uuidSchema,
  access: emailAccessSchema,
  subject: z.string().nullable(),
  snippet: z.string().nullable(),
  lastMessageAt: timestampSchema,
  messageCount: z.number().int(),
  participants: z.array(emailParticipantSchema),
  hasAttachments: z.boolean().nullable(),
  /** Distinct mailboxes that synced the thread ("via N mailboxes" when > 1). */
  mailboxCount: z.number().int(),
  viaMemberIds: z.array(uuidSchema),
});
export type EmailThreadSummary = z.infer<typeof emailThreadSummarySchema>;

export const listRecordThreadsInputSchema = z.object({
  record: recordRefInputSchema,
  cursor: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  hasAttachments: z.boolean().optional(),
  sentAfter: timestampSchema.optional(),
  sentBefore: timestampSchema.optional(),
  acceptAfter: acceptAfterSchema,
});
export type ListRecordThreadsInput = z.input<typeof listRecordThreadsInputSchema>;

export const listRecordThreadsOutputSchema = z.object({
  threads: z.array(emailThreadSummarySchema),
  /** Emails tab count (threads the viewer can see). */
  total: z.number().int(),
  nextCursor: z.string().nullable(),
});
export type ListRecordThreadsOutput = z.infer<typeof listRecordThreadsOutputSchema>;

export const getEmailInputSchema = z.object({ messageId: uuidSchema, acceptAfter: acceptAfterSchema });
export const getThreadInputSchema = z.object({ threadId: uuidSchema, acceptAfter: acceptAfterSchema });

export const emailThreadViewSchema = z.object({
  threadId: uuidSchema,
  access: emailAccessSchema,
  subject: z.string().nullable(),
  messages: z.array(emailMessageViewSchema),
});
export type EmailThreadView = z.infer<typeof emailThreadViewSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Variables (B.11), text with annotations, drafts

export const variableRefSchema = z.object({
  start: z.number().int().min(0),
  length: z.literal(1),
  path: z
    .array(z.object({ entityDefinitionId: z.string().nullable().optional(), attributeDefinitionId: z.string().min(1) }))
    .min(1)
    .max(5),
  field: z.string().nullable(),
  fallback: z.string().max(1000).nullable(),
  label: z.string().max(500).optional(),
});
export type VariableRefInput = z.infer<typeof variableRefSchema>;

/** Single-line text with variables (draft subject). */
export const annotatedTextSchema = z.object({
  text: z.string().max(2000),
  variables: z.array(variableRefSchema).max(100).default([]),
});
export type AnnotatedText = z.infer<typeof annotatedTextSchema>;

/** Body blocks (packages/editor block model with `variables`); validated by the domain with the editor schema. */
export const emailBodySchema = z.array(z.record(z.string(), z.unknown())).max(5000);

export const draftRecipientSchema = z.object({
  emailAddress: emailAddressSchema,
  name: z.string().max(500).nullable().optional(),
  /** The person record the address belongs to (variables merge from it). */
  record: recordRefInputSchema.nullable().optional(),
});
export type DraftRecipientInput = z.input<typeof draftRecipientSchema>;

export const draftRecipientViewSchema = z.object({
  emailAddress: z.string(),
  name: z.string().nullable(),
  record: recordRefSchema.nullable(),
});

export const draftAttachmentSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  contentType: z.string(),
  size: z.number().int(),
  state: z.enum(['pending', 'committed']),
});
export type DraftAttachment = z.infer<typeof draftAttachmentSchema>;

/** Fields autosaved independently (each one written on its own, stamped in `fieldUpdatedAt`). */
export const draftFields = [
  'subject',
  'body',
  'to',
  'cc',
  'bcc',
  'isMassSend',
  'senderMailboxId',
  'signatureId',
] as const;
export type DraftField = (typeof draftFields)[number];

export const messageDraftSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  memberId: uuidSchema,
  senderMailboxId: uuidSchema.nullable(),
  subject: annotatedTextSchema,
  body: emailBodySchema,
  to: z.array(draftRecipientViewSchema),
  cc: z.array(draftRecipientViewSchema),
  bcc: z.array(draftRecipientViewSchema),
  isMassSend: z.boolean(),
  signatureId: uuidSchema.nullable(),
  parentMessageId: uuidSchema.nullable(),
  templateId: uuidSchema.nullable(),
  attachments: z.array(draftAttachmentSchema),
  /** +1 per autosaved field write. */
  revision: z.number().int(),
  fieldUpdatedAt: z.record(z.string(), timestampSchema),
  hasVariables: z.boolean(),
  /** Drafts list: body plaintext preview with variables as `{{label}}`. */
  preview: z.string(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type MessageDraft = z.infer<typeof messageDraftSchema>;

export const createDraftInputSchema = z.object({
  id: uuidSchema,
  senderMailboxId: uuidSchema.optional(),
  subject: annotatedTextSchema.optional(),
  body: emailBodySchema.optional(),
  to: z.array(draftRecipientSchema).max(50).optional(),
  cc: z.array(draftRecipientSchema).max(50).optional(),
  bcc: z.array(draftRecipientSchema).max(50).optional(),
  isMassSend: z.boolean().optional(),
  /** Reply / forward source (email modal). */
  parentMessageId: uuidSchema.optional(),
  /** "Use template": subject and body are copied from the template (variables kept). */
  templateId: uuidSchema.optional(),
});
export type CreateDraftInput = z.input<typeof createDraftInputSchema>;

export const updateDraftInputSchema = z.object({
  draftId: uuidSchema,
  subject: annotatedTextSchema.optional(),
  body: emailBodySchema.optional(),
  to: z.array(draftRecipientSchema).max(50).optional(),
  cc: z.array(draftRecipientSchema).max(50).optional(),
  bcc: z.array(draftRecipientSchema).max(50).optional(),
  isMassSend: z.boolean().optional(),
  senderMailboxId: uuidSchema.optional(),
  signatureId: uuidSchema.nullable().optional(),
});
export type UpdateDraftInput = z.input<typeof updateDraftInputSchema>;

export const draftIdInputSchema = z.object({ draftId: uuidSchema, acceptAfter: acceptAfterSchema });

export const createDraftAttachmentInputSchema = z.object({
  draftId: uuidSchema,
  id: uuidSchema,
  name: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  size: z.number().int().min(0),
});
export type CreateDraftAttachmentInput = z.infer<typeof createDraftAttachmentInputSchema>;

export const draftAttachmentRefInputSchema = z.object({ draftId: uuidSchema, attachmentId: uuidSchema });

/** One unresolved variable: no value for the recipient and no fallback. */
export const variableIssueSchema = z.object({
  location: z.enum(['subject', 'body']),
  label: z.string(),
  path: variableRefSchema.shape.path,
  field: z.string().nullable(),
});

export const reviewRecipientSchema = z.object({
  recipient: draftRecipientViewSchema,
  subject: z.string(),
  bodyText: z.string(),
  bodyHtml: z.string(),
  missing: z.array(variableIssueSchema),
});

/** Review step (F composer §2.10): every email as it will be sent, and what blocks sending. */
export const reviewDraftOutputSchema = z.object({
  draftId: uuidSchema,
  isMassSend: z.boolean(),
  emails: z.array(reviewRecipientSchema),
  /** Blocking problems: no-recipients | no-sender | sender-disconnected | variables-need-mass-send |
   * too-many-recipients | unresolved-variables | pending-attachments | no-content. */
  issues: z.array(z.string()),
  canSend: z.boolean(),
});
export type ReviewDraftOutput = z.infer<typeof reviewDraftOutputSchema>;

export const sendDraftInputSchema = z.object({
  draftId: uuidSchema,
  /** Send although some variables resolve to empty values (the review step showed them). */
  allowEmptyVariables: z.boolean().default(false),
});
export type SendDraftInput = z.input<typeof sendDraftInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Outbox

export const deliveryStates = ['scheduled', 'error', 'completed', 'failed', 'canceled'] as const;
export const deliveryStateSchema = z.enum(deliveryStates);
export type DeliveryState = z.infer<typeof deliveryStateSchema>;

/** Failure reasons (F composer §5; Attio `delivery_last_attempt_error_code`). */
export const deliveryErrorCodes = [
  'account_access_error',
  'mailbox_disconnected',
  'provider_unreachable',
  'provider_rate_limited',
  'provider_rejected_request',
  'email_preparation_failed',
  'reply_message_unavailable',
  'recipient_not_found',
  'mailbox_email_address_not_found',
  'max_delivery_attempts_exceeded',
  'unknown',
] as const;
export const deliveryErrorCodeSchema = z.enum(deliveryErrorCodes);
export type DeliveryErrorCode = z.infer<typeof deliveryErrorCodeSchema>;

export const outboxItemSchema = z.object({
  id: uuidSchema,
  draftId: uuidSchema.nullable(),
  mailboxId: uuidSchema,
  parentType: z.enum(['message-draft', 'message-draft-mass-send']),
  /** List source label: "Single send" / "Mass send". */
  source: z.enum(['single-send', 'mass-send']),
  from: z.string(),
  to: z.array(draftRecipientViewSchema.pick({ emailAddress: true, name: true })),
  cc: z.array(draftRecipientViewSchema.pick({ emailAddress: true, name: true })),
  bcc: z.array(draftRecipientViewSchema.pick({ emailAddress: true, name: true })),
  subject: z.string(),
  bodyText: z.string(),
  deliveryState: deliveryStateSchema,
  deliveryScheduledAt: timestampSchema,
  attempts: z.number().int(),
  lastErrorCode: deliveryErrorCodeSchema.nullable(),
  /** Human-readable failure reason for failed / error items. */
  failureReason: z.string().nullable(),
  sentAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});
export type OutboxItem = z.infer<typeof outboxItemSchema>;

export const listOutboxInputSchema = z
  .object({ now: timestampSchema.optional(), acceptAfter: acceptAfterSchema })
  .optional();

export const cancelOutboxInputSchema = z.union([
  z.object({ ids: z.array(uuidSchema).min(1).max(1000) }),
  z.object({ all: z.literal(true) }),
]);
export type CancelOutboxInput = z.infer<typeof cancelOutboxInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Templates and signatures (bodies are rich-text documents, B.10)

export const emailTemplateSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  /** '' = "Untitled Template". */
  title: z.string(),
  subjectDocumentId: uuidSchema,
  bodyDocumentId: uuidSchema,
  subject: annotatedTextSchema,
  body: emailBodySchema,
  /** Card preview: body plaintext with variables as `{{label}}`. */
  preview: z.string(),
  isFavorite: z.boolean(),
  createdBy: actorSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type EmailTemplate = z.infer<typeof emailTemplateSchema>;

export const createTemplateInputSchema = z.object({
  id: uuidSchema,
  title: z.string().max(1000).default(''),
  subject: annotatedTextSchema.optional(),
  body: emailBodySchema.optional(),
});
export type CreateTemplateInput = z.input<typeof createTemplateInputSchema>;

export const updateTemplateInputSchema = z.object({
  templateId: uuidSchema,
  title: z.string().max(1000).optional(),
  subject: annotatedTextSchema.optional(),
  body: emailBodySchema.optional(),
});
export type UpdateTemplateInput = z.input<typeof updateTemplateInputSchema>;

export const templateIdInputSchema = z.object({ templateId: uuidSchema, acceptAfter: acceptAfterSchema });
export const favoriteTemplateInputSchema = z.object({ templateId: uuidSchema, favorite: z.boolean() });

export const mailboxSignatureSchema = z.object({
  id: uuidSchema,
  mailboxId: uuidSchema,
  title: z.string(),
  documentId: uuidSchema,
  body: emailBodySchema,
  isDefault: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type MailboxSignature = z.infer<typeof mailboxSignatureSchema>;

export const createSignatureInputSchema = z.object({
  id: uuidSchema,
  mailboxId: uuidSchema,
  title: z.string().max(200).default('New signature'),
  body: emailBodySchema.optional(),
});
export type CreateSignatureInput = z.input<typeof createSignatureInputSchema>;

export const updateSignatureInputSchema = z.object({
  signatureId: uuidSchema,
  title: z.string().max(200).optional(),
  body: emailBodySchema.optional(),
});
export type UpdateSignatureInput = z.input<typeof updateSignatureInputSchema>;

export const signatureIdInputSchema = z.object({ signatureId: uuidSchema });

// ---------------------------------------------------------------------------------------------------------------
// Variable values (merge-field preview)

export const variableValuesInputSchema = z.object({
  records: z.array(recordRefInputSchema).min(1).max(50),
  variables: z
    .array(variableRefSchema.pick({ path: true, field: true, fallback: true }))
    .min(1)
    .max(100),
  acceptAfter: acceptAfterSchema,
});
export type VariableValuesInput = z.input<typeof variableValuesInputSchema>;

/** Per record: one entry per requested variable, in order (null = empty, fallback not applied). */
export const variableValuesOutputSchema = z.object({
  values: z.record(z.string(), z.array(z.string().nullable())),
});
export type VariableValuesOutput = z.infer<typeof variableValuesOutputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Test connector (dev + tests)

export const connectorAddressSchema = z.object({
  emailAddress: emailAddressSchema,
  name: z.string().max(500).nullable().optional(),
});

export const injectMessageInputSchema = z.object({
  mailboxId: uuidSchema,
  message: z.object({
    providerMessageId: z.string().min(1).max(500).optional(),
    providerThreadId: z.string().min(1).max(500).optional(),
    rfcMessageId: z.string().min(1).max(998).optional(),
    inReplyTo: z.string().max(998).nullable().optional(),
    references: z.array(z.string().max(998)).max(100).optional(),
    subject: z.string().max(2000).default(''),
    bodyText: z.string().max(1_000_000).default(''),
    bodyHtml: z.string().max(2_000_000).nullable().optional(),
    sentAt: timestampSchema.optional(),
    from: connectorAddressSchema,
    replyTo: z.array(connectorAddressSchema).max(10).optional(),
    to: z.array(connectorAddressSchema).max(500).default([]),
    cc: z.array(connectorAddressSchema).max(500).optional(),
    bcc: z.array(connectorAddressSchema).max(500).optional(),
    attachments: z
      .array(z.object({ name: z.string(), contentType: z.string(), size: z.number().int().min(0) }))
      .max(50)
      .optional(),
    labels: z.array(z.string()).max(50).optional(),
  }),
  /** Run the mailbox sync right away (default: enqueue a sync job). */
  syncNow: z.boolean().default(false),
});
export type InjectMessageInput = z.input<typeof injectMessageInputSchema>;

const eventTimeSchema = z.union([
  z.object({ dateTime: timestampSchema, timeZone: z.string().max(100).nullable().optional() }),
  z.object({ date: z.iso.date() }),
]);

export const injectEventInputSchema = z.object({
  mailboxId: uuidSchema,
  event: z.object({
    providerEventId: z.string().min(1).max(500).optional(),
    icalUid: z.string().min(1).max(1000).optional(),
    title: z.string().max(1000).default(''),
    description: z.string().max(10_000).default(''),
    start: eventTimeSchema,
    end: eventTimeSchema,
    status: z.enum(['confirmed', 'tentative', 'cancelled']).default('confirmed'),
    conferenceUrl: z.string().max(2000).nullable().optional(),
    location: z.string().max(2000).nullable().optional(),
    attendees: z
      .array(
        connectorAddressSchema.extend({
          status: z.enum(['accepted', 'tentative', 'declined', 'pending']).default('pending'),
          isOrganizer: z.boolean().default(false),
        }),
      )
      .max(500)
      .default([]),
  }),
  syncNow: z.boolean().default(false),
});
export type InjectEventInput = z.input<typeof injectEventInputSchema>;

export const removeInjectedInputSchema = z.object({
  mailboxId: uuidSchema,
  kind: z.enum(['message', 'event']),
  providerId: z.string().min(1).max(500),
  syncNow: z.boolean().default(false),
});
export type RemoveInjectedInput = z.input<typeof removeInjectedInputSchema>;

/** Sync result (one sync pass over a mailbox). */
export const syncResultSchema = z.object({
  mailboxId: uuidSchema,
  messages: z.number().int(),
  events: z.number().int(),
  skipped: z.number().int(),
  deleted: z.number().int(),
  recordsCreated: z.number().int(),
});
export type SyncResult = z.infer<typeof syncResultSchema>;
