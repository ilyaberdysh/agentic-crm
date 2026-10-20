// Agentic CRM REST schemas, maintained alongside the implemented apps/api/src/v2 handlers.
// Wire names remain stable for existing clients. OpenAPI is a projection of these schemas, not their source.
import { z } from 'zod';
import { publicWebhookEventTypes, webhookEventTypes, webhookFilterSchema } from '../webhooks.ts';

export const PUBLIC_API_ISSUER = 'agentic-crm';
export const BUILTIN_STORAGE_PROVIDER = 'agentic-crm';
export const LEGACY_STORAGE_PROVIDER = 'attio';
const id = z.guid();
const text = z.string();
const nullableText = text.nullable();
const numericQuery = z.coerce.number().int().optional();
const paginationFields = { limit: numericQuery, offset: numericQuery };
export const cursorPaginationSchema = z.object({ next_cursor: nullableText });
export const emptyResponse = z.strictObject({});
const data = <T extends z.ZodType>(schema: T) => z.object({ data: schema });
const many = <T extends z.ZodType>(schema: T) => data(z.array(schema));
const workspaceId = { workspace_id: id };
const objectId = { ...workspaceId, object_id: id };
const attributeId = { ...objectId, attribute_id: id };
const recordId = { ...objectId, record_id: id };

export const publicActorSchema = z.object({
  type: z.enum(['workspace-member', 'api-token', 'system', 'app']).nullable(),
  id: nullableText,
});
export const publicAttributeTypeSchema = z.enum([
  'text',
  'number',
  'checkbox',
  'currency',
  'date',
  'timestamp',
  'rating',
  'status',
  'select',
  'record-reference',
  'actor-reference',
  'location',
  'domain',
  'email-address',
  'phone-number',
  'interaction',
  'personal-name',
]);
export const selectOptionSchema = z.object({
  id: z.object({ ...attributeId, option_id: id }),
  title: text,
  is_archived: z.boolean(),
});
export const statusSchema = z.object({
  id: z.object({ ...attributeId, status_id: id }),
  title: text,
  is_archived: z.boolean(),
  celebration_enabled: z.boolean(),
  target_time_in_status: nullableText,
});
const locationFields = {
  line_1: nullableText,
  line_2: nullableText,
  line_3: nullableText,
  line_4: nullableText,
  locality: nullableText,
  region: nullableText,
  postcode: nullableText,
  country_code: nullableText,
  latitude: nullableText,
  longitude: nullableText,
};
const outputValues = [
  z.object({ attribute_type: z.literal('text'), value: text }),
  z.object({ attribute_type: z.literal('number'), value: z.number() }),
  z.object({ attribute_type: z.literal('rating'), value: z.number() }),
  z.object({ attribute_type: z.literal('checkbox'), value: z.boolean() }),
  z.object({ attribute_type: z.literal('date'), value: text }),
  z.object({ attribute_type: z.literal('timestamp'), value: text }),
  z.object({ attribute_type: z.literal('currency'), currency_value: z.number(), currency_code: nullableText }),
  z.object({ attribute_type: z.literal('status'), status: z.union([id, statusSchema]) }),
  z.object({ attribute_type: z.literal('select'), option: z.union([id, selectOptionSchema]) }),
  z.object({ attribute_type: z.literal('record-reference'), target_object: text, target_record_id: id }),
  z.object({
    attribute_type: z.literal('actor-reference'),
    referenced_actor_type: publicActorSchema.shape.type,
    referenced_actor_id: id.nullable(),
  }),
  z.object({ attribute_type: z.literal('location'), ...locationFields }),
  z.object({ attribute_type: z.literal('domain'), domain: text, root_domain: text }),
  z.object({
    attribute_type: z.literal('email-address'),
    original_email_address: text,
    email_address: text,
    email_domain: text,
    email_root_domain: text,
    email_local_specifier: text,
  }),
  z.object({
    attribute_type: z.literal('phone-number'),
    original_phone_number: text,
    country_code: text,
    phone_number: text,
  }),
  z.object({
    attribute_type: z.literal('interaction'),
    interaction_type: z.enum(['activity', 'email', 'meeting', 'calendar-event']),
    interacted_at: text,
    owner_actor: publicActorSchema,
  }),
  z.object({ attribute_type: z.literal('personal-name'), first_name: text, last_name: text, full_name: text }),
] as const;
export const outputValueSchema = z.discriminatedUnion('attribute_type', outputValues);
const valueHistory = { active_from: text, active_until: nullableText, created_by_actor: publicActorSchema };
export const recordValueSchema = z.discriminatedUnion('attribute_type', [
  outputValues[0].extend(valueHistory),
  ...outputValues.slice(1).map((schema) => schema.extend(valueHistory)),
]);
export const recordSchema = z.object({
  id: z.object(recordId),
  created_at: text,
  web_url: text,
  values: z.record(text, z.array(recordValueSchema)),
});
const defaultValue = z
  .union([
    z.object({ type: z.literal('dynamic'), template: text }),
    z.object({ type: z.literal('static'), template: z.array(outputValueSchema) }),
  ])
  .nullable();
export const attributeSchema = z.object({
  id: z.object(attributeId),
  title: text,
  description: nullableText,
  api_slug: text,
  type: publicAttributeTypeSchema,
  is_system_attribute: z.boolean(),
  is_writable: z.boolean(),
  is_required: z.boolean(),
  is_unique: z.boolean(),
  is_multiselect: z.boolean(),
  is_default_value_enabled: z.boolean(),
  is_archived: z.boolean(),
  default_value: defaultValue,
  relationship: z
    .object({ id: z.object(attributeId), object_slug: text, title: text, api_slug: text, is_multiselect: z.boolean() })
    .nullable(),
  created_at: text,
  config: z.object({
    currency: z.object({
      default_currency_code: nullableText,
      display_type: z.enum(['symbol', 'code', 'name', 'narrowSymbol']).nullable(),
    }),
    record_reference: z.object({ allowed_object_ids: z.array(id).nullable() }),
  }),
});
export const objectSchema = z.object({
  id: z.object(objectId),
  api_slug: text,
  singular_noun: text,
  plural_noun: text,
  created_at: text,
});
export const workspaceMemberSchema = z.object({
  id: z.object({ ...workspaceId, workspace_member_id: id }),
  first_name: text,
  last_name: text,
  avatar_url: nullableText,
  email_address: text,
  created_at: text,
  access_level: z.enum(['admin', 'member', 'suspended']),
});
export const getSelfResponse = z.union([
  z.object({ active: z.literal(false) }),
  z.object({
    active: z.literal(true),
    scope: text,
    client_id: text,
    token_type: z.literal('Bearer'),
    exp: z.number().nullable(),
    iat: z.number(),
    sub: id,
    aud: text,
    iss: z.literal(PUBLIC_API_ISSUER),
    token_level: z.enum(['workspace', 'user']),
    authorized_by_workspace_member_id: id.optional(),
    workspace_id: id,
    workspace_name: text,
    workspace_slug: text,
    workspace_logo_url: nullableText,
  }),
]);
export const listWorkspaceMembersResponse = many(workspaceMemberSchema);
export const getWorkspaceMemberPathParams = z.object({ workspace_member_id: id });
export const getWorkspaceMemberResponse = data(workspaceMemberSchema);
export const listObjectsResponse = many(objectSchema);
export const getObjectPathParams = z.object({ object: text });
export const getObjectResponse = data(objectSchema);
const objectWrite = { api_slug: text, singular_noun: text.min(1), plural_noun: text.min(1) };
export const createObjectBody = data(z.object(objectWrite));
export const updateObjectBody = data(z.object(objectWrite).partial());
export const createObjectResponse = getObjectResponse;
export const updateObjectResponse = getObjectResponse;

const targetPath = { target: z.enum(['objects', 'lists']), identifier: text };
export const listAttributesPathParams = z.object(targetPath);
export const listAttributesQuery = z.object({ ...paginationFields, show_archived: z.stringbool().optional() });
export const listAttributesResponse = many(attributeSchema);
export const getAttributePathParams = z.object({ ...targetPath, attribute: text });
export const getAttributeResponse = data(attributeSchema);
const attributeConfigWrite = z.object({
  currency: z
    .object({
      default_currency_code: text.optional(),
      display_type: z.enum(['symbol', 'code', 'name', 'narrowSymbol']).optional(),
    })
    .optional(),
  record_reference: z.object({ allowed_objects: z.array(text) }).optional(),
});
// Values and filters are attribute-dependent JSON; their semantic validation belongs to the handlers/domain.
export const valueMapSchema = z.record(text, z.unknown());
const defaultValueWrite = z
  .union([
    z.object({ type: z.literal('dynamic'), template: text }),
    z.object({ type: z.literal('static'), template: z.array(z.unknown()) }),
  ])
  .nullable();
export const createAttributeBody = data(
  z.strictObject({
    title: text,
    description: nullableText,
    api_slug: text,
    type: publicAttributeTypeSchema.exclude(['interaction', 'personal-name']),
    is_required: z.boolean(),
    is_unique: z.boolean(),
    is_multiselect: z.boolean(),
    config: attributeConfigWrite,
    default_value: defaultValueWrite.optional(),
    relationship: z
      .object({ object: text, title: text, api_slug: text, is_multiselect: z.boolean() })
      .nullable()
      .optional(),
  }),
);
export const updateAttributeBody = data(
  z.strictObject({
    title: text.optional(),
    description: nullableText.optional(),
    api_slug: text.optional(),
    is_required: z.boolean().optional(),
    is_unique: z.boolean().optional(),
    is_archived: z.boolean().optional(),
    config: attributeConfigWrite.optional(),
    default_value: defaultValueWrite.optional(),
  }),
);
export const createAttributeResponse = getAttributeResponse;
export const updateAttributeResponse = getAttributeResponse;
export const listSelectOptionsQuery = z.object({ show_archived: z.stringbool().optional() });
export const listStatusesQuery = listSelectOptionsQuery;
export const listSelectOptionsResponse = many(selectOptionSchema);
export const listStatusesResponse = many(statusSchema);
export const createSelectOptionBody = data(z.object({ title: text }));
export const updateSelectOptionBody = data(z.object({ title: text.optional(), is_archived: z.boolean().optional() }));
export const createSelectOptionResponse = data(selectOptionSchema);
export const updateSelectOptionResponse = createSelectOptionResponse;
export const createStatusBody = data(
  z.object({
    title: text,
    celebration_enabled: z.boolean().optional(),
    target_time_in_status: nullableText.optional(),
  }),
);
export const updateStatusBody = data(
  createStatusBody.shape.data.extend({ is_archived: z.boolean().optional() }).partial(),
);
export const createStatusResponse = data(statusSchema);
export const updateStatusResponse = createStatusResponse;

export const queryRecordsBody = z.object({
  filter: valueMapSchema.optional(),
  filter_view_id: id.optional(),
  sorts: z
    .array(
      z.union([
        z.object({ attribute: text, field: text.optional(), direction: z.enum(['asc', 'desc']) }),
        z.object({
          path: z.array(z.array(text).length(2)),
          field: text.optional(),
          direction: z.enum(['asc', 'desc']),
        }),
      ]),
    )
    .optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});
export const queryRecordsResponse = many(recordSchema);
export const createRecordBody = data(z.strictObject({ values: valueMapSchema }));
export const assertRecordBody = createRecordBody;
export const updateRecordBody = createRecordBody;
export const replaceRecordBody = createRecordBody;
export const assertRecordQuery = z.object({ matching_attribute: text });
export const createRecordResponse = data(recordSchema);
export const assertRecordResponse = createRecordResponse;
export const getRecordResponse = createRecordResponse;
export const updateRecordResponse = createRecordResponse;
export const replaceRecordResponse = createRecordResponse;
export const deleteRecordResponse = emptyResponse;
export const listRecordAttributeValuesQuery = z.object({
  ...paginationFields,
  show_historic: z.stringbool().optional(),
});
export const listRecordAttributeValuesResponse = many(recordValueSchema);
export const searchRecordsBody = z.object({
  query: text.max(256),
  objects: z.array(text).min(1),
  limit: z.number().min(1).max(25).optional(),
  request_as: z.union([
    z.object({ type: z.literal('workspace') }),
    z.object({ type: z.literal('workspace-member'), workspace_member_id: id }),
    z.object({ type: z.literal('workspace-member'), email_address: text }),
  ]),
});
export const searchRecordsResponse = many(
  z.object({
    id: z.object(recordId),
    record_text: text,
    record_image: nullableText,
    object_slug: text,
    email_addresses: z.array(text).optional(),
    phone_numbers: z.array(text).optional(),
    domains: z.array(text).optional(),
  }),
);

export const noteSchema = z.object({
  id: z.object({ ...workspaceId, note_id: id }),
  parent_object: text,
  parent_record_id: id,
  title: text,
  meeting_id: id.nullable(),
  content_plaintext: text,
  content_markdown: text,
  tags: z.array(
    z.union([
      z.object({ type: z.literal('workspace-member'), workspace_member_id: id }),
      z.object({ type: z.literal('record'), object: text, record_id: id }),
    ]),
  ),
  created_by_actor: publicActorSchema,
  created_at: text,
});
export const listNotesQuery = z.object({
  ...paginationFields,
  parent_object: text.optional(),
  parent_record_id: id.optional(),
});
export const listNotesResponse = many(noteSchema);
export const getNotePathParams = z.object({ note_id: id });
export const updateNotePathParams = getNotePathParams;
export const getNoteResponse = data(noteSchema);
export const createNoteResponse = getNoteResponse;
export const updateNoteResponse = getNoteResponse;
export const deleteNoteResponse = emptyResponse;
export const createNoteBody = data(
  z.object({
    parent_object: text,
    parent_record_id: id,
    title: text,
    format: z.enum(['plaintext', 'markdown']),
    content: text,
    created_at: text.optional(),
    meeting_id: id.nullable().optional(),
  }),
);
export const updateNoteBody = data(
  z.strictObject({
    title: text.optional(),
    format: z.enum(['plaintext', 'markdown']).optional(),
    content: text.optional(),
  }),
);
const memberAssignee = z.object({ referenced_actor_type: z.literal('workspace-member'), referenced_actor_id: id });
const taskAssignee = z.union([memberAssignee, z.strictObject({ workspace_member_email_address: text })]);
const linkedTaskRecord = z.union([
  text,
  z.object({ target_object: text, target_record_id: id }),
  z.object({ target_object: text }).catchall(z.array(valueMapSchema)),
]);
export const taskSchema = z.object({
  id: z.object({ ...workspaceId, task_id: id }),
  content_plaintext: text,
  deadline_at: nullableText,
  is_completed: z.boolean(),
  completed_at: nullableText,
  linked_records: z.array(z.object({ target_object_id: id, target_record_id: id })),
  assignees: z.array(memberAssignee),
  created_by_actor: publicActorSchema,
  created_at: text,
});
export const listTasksQuery = z.object({
  ...paginationFields,
  sort: z.enum(['created_at:asc', 'created_at:desc', 'completed_at:asc', 'completed_at:desc']).optional(),
  linked_object: text.optional(),
  linked_record_id: id.optional(),
  assignee: nullableText.optional(),
  is_completed: z.stringbool().optional(),
});
export const getTaskPathParams = z.object({ task_id: id });
export const createTaskBody = data(
  z.object({
    content: text.max(2000),
    format: z.literal('plaintext'),
    deadline_at: nullableText,
    is_completed: z.boolean(),
    linked_records: z.array(linkedTaskRecord),
    assignees: z.array(taskAssignee),
  }),
);
export const updateTaskBody = data(
  z.strictObject({
    deadline_at: nullableText.optional(),
    is_completed: z.boolean().optional(),
    linked_records: z.array(linkedTaskRecord).optional(),
    assignees: z.array(taskAssignee).optional(),
  }),
);
export const listTasksResponse = many(taskSchema);
export const getTaskResponse = data(taskSchema);
export const createTaskResponse = getTaskResponse;
export const updateTaskResponse = getTaskResponse;
export const deleteTaskResponse = emptyResponse;

export const commentSchema = z.object({
  id: z.object({ ...workspaceId, comment_id: id }),
  thread_id: id,
  content_plaintext: text,
  entry: z.object({ list_id: id, entry_id: id }).nullable(),
  record: z.object({ object_id: id, record_id: id }),
  resolved_at: nullableText,
  resolved_by: publicActorSchema,
  created_at: text,
  author: publicActorSchema,
});
export const threadSchema = z.object({
  id: z.object({ ...workspaceId, thread_id: id }),
  created_at: text,
  comments: z.array(commentSchema),
});
export const listThreadsQuery = z.object({
  ...paginationFields,
  record_id: id.optional(),
  object: text.optional(),
  entry_id: id.optional(),
  list: text.optional(),
});
export const getThreadPathParams = z.object({ thread_id: id });
export const getThreadQuery = z.object({
  limit: numericQuery,
  cursor: text.min(1).optional(),
  created_after: nullableText.optional(),
});
export const listThreadsResponse = many(threadSchema.extend({ has_more_comments: z.boolean() }));
export const getThreadResponse = z.object({ data: threadSchema, pagination: cursorPaginationSchema });
const commentWrite = {
  format: z.literal('plaintext'),
  content: text,
  author: z.object({ type: z.literal('workspace-member'), id }),
  created_at: text.optional(),
};
export const createCommentBody = data(
  z.union([
    z.strictObject({ ...commentWrite, thread_id: id }),
    z.strictObject({ ...commentWrite, record: z.object({ object: text, record_id: id }) }),
    z.strictObject({ ...commentWrite, entry: z.object({ list: text, entry_id: text }) }),
  ]),
);
export const getCommentPathParams = z.object({ comment_id: id });
export const getCommentResponse = data(commentSchema);
export const createCommentResponse = getCommentResponse;
export const deleteCommentResponse = emptyResponse;

const fileFields = {
  id: z.object({ ...workspaceId, file_id: id }),
  object_id: id,
  object_slug: text,
  record_id: id,
  storage_provider: z.literal(BUILTIN_STORAGE_PROVIDER),
  created_by_actor: publicActorSchema,
  created_at: text,
  name: text,
  parent_folder_id: id.nullable(),
};
export const fileSchema = z.object({
  ...fileFields,
  file_type: z.literal('file'),
  content_type: nullableText,
  content_size: z.number().nullable(),
});
export const folderSchema = z.object({ ...fileFields, file_type: z.literal('folder') });
export const fileEntrySchema = z.discriminatedUnion('file_type', [fileSchema, folderSchema]);
// Legacy provider filters remain accepted, but only the built-in provider has storage capabilities.
export const listFilesQuery = z.object({
  object: text.min(1),
  record_id: id,
  storage_provider: z
    .enum([BUILTIN_STORAGE_PROVIDER, LEGACY_STORAGE_PROVIDER, 'dropbox', 'box', 'google-drive', 'microsoft-onedrive'])
    .optional()
    .describe(
      'Only agentic-crm stores files. attio is a compatibility alias; other legacy provider filters return an empty result.',
    ),
  parent_folder_id: id.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: text.optional(),
});
export const createFileEntryBody = z.union([
  z.strictObject({
    object: text.min(1),
    record_id: id,
    file_type: z.literal('folder'),
    name: text.min(1),
    parent_folder_id: id.optional(),
  }),
  // Accepted only to preserve the existing explicit "provider not connected" error; never a successful capability.
  z.strictObject({
    object: text.min(1),
    record_id: id,
    file_type: z.enum(['connected-file', 'connected-folder']),
    storage_provider: z.enum(['dropbox', 'box', 'google-drive', 'microsoft-onedrive']),
    external_provider_file_id: text,
    microsoft_drive_id: nullableText.optional(),
  }),
]);
export const createFolderBody = z.strictObject({
  object: text.min(1),
  record_id: id,
  file_type: z.literal('folder'),
  name: text.min(1),
  parent_folder_id: id.optional(),
});
export const uploadFileBody = z.object({
  object: text.min(1),
  record_id: id,
  parent_folder_id: id.optional(),
  file: text.meta({ format: 'binary' }),
});
export const getFilePathParams = z.object({ file_id: id });
export const listFilesResponse = z.object({ data: z.array(fileEntrySchema), pagination: cursorPaginationSchema });
export const createFileEntryResponse = data(folderSchema);
export const uploadFileResponse = data(fileSchema);
export const getFileResponse = data(
  z.discriminatedUnion('file_type', [fileSchema, folderSchema.extend({ has_children: z.boolean() })]),
);
export const deleteFileResponse = emptyResponse;

const accessLevel = z.enum(['full-access', 'read-and-write', 'read-only']);
const memberAccess = z.array(z.object({ workspace_member_id: id, level: accessLevel }));
export const listSchema = z.object({
  id: z.object({ ...workspaceId, list_id: id }),
  api_slug: text,
  name: text,
  parent_object: z.array(text),
  workspace_access: accessLevel.nullable(),
  workspace_member_access: memberAccess,
  created_by_actor: publicActorSchema,
  created_at: text,
});
const listWrite = z.object({
  name: text,
  api_slug: text,
  parent_object: text,
  workspace_access: accessLevel.nullable(),
  workspace_member_access: memberAccess,
});
export const createListBody = data(listWrite);
export const updateListBody = data(listWrite.omit({ parent_object: true }).partial());
export const getListPathParams = z.object({ list: text });
export const listListsResponse = many(listSchema);
export const getListResponse = data(listSchema);
export const createListResponse = getListResponse;
export const updateListResponse = getListResponse;
export const entrySchema = z.object({
  id: z.object({ ...workspaceId, list_id: id, entry_id: id }),
  parent_record_id: id,
  parent_object: text,
  created_at: text,
  entry_values: z.record(text, z.array(recordValueSchema)),
});
export const queryEntriesBody = queryRecordsBody;
export const queryEntriesResponse = many(entrySchema);
export const createEntryBody = data(
  z.strictObject({ parent_record_id: id, parent_object: text, entry_values: valueMapSchema }),
);
export const assertEntryBody = createEntryBody;
export const updateEntryBody = data(z.strictObject({ entry_values: valueMapSchema }));
export const replaceEntryBody = updateEntryBody;
export const getEntryResponse = data(entrySchema);
export const createEntryResponse = getEntryResponse;
export const assertEntryResponse = getEntryResponse;
export const updateEntryResponse = getEntryResponse;
export const replaceEntryResponse = getEntryResponse;
export const deleteEntryResponse = emptyResponse;
export const listEntryAttributeValuesQuery = listRecordAttributeValuesQuery;
export const listEntryAttributeValuesResponse = listRecordAttributeValuesResponse;
export const listRecordEntriesQuery = z.object(paginationFields);
export const listRecordEntriesResponse = many(
  z.object({ list_id: id, entry_id: id, created_at: text, list_api_slug: text }),
);

const subscriptionEvent = z
  .enum(publicWebhookEventTypes)
  .describe(
    'Accepted subscription values. Only x-produced-webhook-events are emitted; legacy activity events remain accepted for compatibility and are not emitted.',
  );
export const webhookSchema = z.object({
  id: z.object({ ...workspaceId, webhook_id: id }),
  target_url: text,
  subscriptions: z.array(z.object({ event_type: subscriptionEvent, filter: webhookFilterSchema })),
  status: z.enum(['active', 'degraded', 'inactive']),
  created_at: text,
});
export const producedWebhookEventTypes = webhookEventTypes;
const webhookWrite = z.object({
  target_url: z.url().regex(/^https:\/\//),
  subscriptions: z.array(z.object({ event_type: subscriptionEvent, filter: webhookFilterSchema.optional() })),
});
export const createWebhookBody = data(webhookWrite);
export const updateWebhookBody = data(webhookWrite.partial());
export const listWebhooksQuery = z.object(paginationFields);
export const getWebhookPathParams = z.object({ webhook_id: id });
export const listWebhooksResponse = many(webhookSchema);
export const getWebhookResponse = data(webhookSchema);
export const createWebhookResponse = data(webhookSchema.extend({ secret: text }));
export const updateWebhookResponse = getWebhookResponse;
export const deleteWebhookResponse = emptyResponse;

const meetingTime = z.union([
  z.strictObject({ datetime: text, timezone: nullableText.optional() }),
  z.strictObject({ date: text }),
]);
const participantStatus = z.enum(['accepted', 'tentative', 'declined', 'pending']);
export const meetingSchema = z.object({
  id: z.object({ ...workspaceId, meeting_id: id }),
  title: text,
  description: text,
  is_all_day: z.boolean(),
  start: meetingTime,
  end: meetingTime,
  participants: z.array(
    z.object({ status: participantStatus, is_organizer: z.boolean(), email_address: nullableText, name: nullableText }),
  ),
  linked_records: z.array(z.object({ object_slug: text, object_id: id, record_id: id })),
  created_at: text,
  created_by_actor: publicActorSchema,
});
export const listMeetingsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: text.optional(),
  linked_object: text.min(1).optional(),
  linked_record_id: id.optional(),
  participants: text.optional(),
  sort: z.enum(['start_asc', 'start_desc']).optional(),
  ends_from: nullableText.optional(),
  starts_before: nullableText.optional(),
  timezone: text.optional(),
});
export const createMeetingBody = data(
  z.object({
    title: text.max(1000),
    description: text.max(10000),
    start: meetingTime,
    end: meetingTime,
    is_all_day: z.boolean(),
    participants: z
      .array(
        z.object({
          email_address: text.optional(),
          name: text.min(1).optional(),
          is_organizer: z.union([z.boolean(), z.enum(['true', 'false'])]),
          status: participantStatus,
        }),
      )
      .max(500),
    linked_records: z
      .array(z.object({ object: text, record_id: id }))
      .max(50)
      .optional(),
  }),
);
export const updateMeetingBody = data(
  z.strictObject({ linked_records: z.array(z.object({ object: text, record_id: id })).max(50) }),
);
export const replaceMeetingBody = updateMeetingBody;
export const getMeetingPathParams = z.object({ meeting_id: id });
export const getMeetingResponse = data(meetingSchema);
export const createMeetingResponse = getMeetingResponse;
export const updateMeetingResponse = getMeetingResponse;
export const replaceMeetingResponse = getMeetingResponse;
export const deleteMeetingResponse = emptyResponse;
export const listMeetingsResponse = z.object({ data: z.array(meetingSchema), pagination: cursorPaginationSchema });
const recordingId = { ...workspaceId, meeting_id: id, call_recording_id: id };
export const callRecordingSchema = z.object({
  id: z.object(recordingId),
  status: z.enum(['processing', 'completed', 'failed']),
  web_url: text,
  created_by_actor: publicActorSchema,
  created_at: text,
});
const transcriptSegment = z.object({
  speech: text,
  start_time: z.number(),
  end_time: z.number(),
  speaker: z.object({ name: text }),
});
export const listCallRecordingsPathParams = getMeetingPathParams;
export const createCallRecordingPathParams = getMeetingPathParams;
export const getCallRecordingPathParams = z.object({ meeting_id: id, call_recording_id: id });
export const deleteCallRecordingPathParams = getCallRecordingPathParams;
export const getCallRecordingTranscriptPathParams = getCallRecordingPathParams;
export const listCallRecordingsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: text.optional(),
});
export const getCallRecordingTranscriptQuery = z.object({ cursor: text.optional() });
export const createCallRecordingBody = data(
  z.strictObject({
    video_url: text.optional(),
    transcript: z
      .array(transcriptSegment.extend({ speaker: z.object({ name: text, email_address: text.optional() }) }))
      .max(4000)
      .optional(),
  }),
);
export const createCallRecordingResponse = data(callRecordingSchema);
export const listCallRecordingsResponse = z.object({
  data: z.array(callRecordingSchema),
  pagination: cursorPaginationSchema,
});
export const getCallRecordingResponse = data(
  callRecordingSchema.extend({
    video_url: nullableText,
    transcript: z.object({ segments: z.array(transcriptSegment), raw_transcript: text }).nullable(),
  }),
);
export const getCallRecordingTranscriptResponse = z.object({
  data: z.object({
    id: z.object(recordingId),
    transcript: z.array(transcriptSegment),
    raw_transcript: text,
    web_url: text,
  }),
  pagination: cursorPaginationSchema,
});

export const publicErrorSchema = z.strictObject({
  status_code: z.number().int(),
  type: z.enum(['invalid_request_error', 'auth_error', 'rate_limit_error', 'api_error']),
  code: text.min(1),
  message: text.min(1),
});
export type GetSelfResponse = z.infer<typeof getSelfResponse>;
export type OutputValue = z.infer<typeof outputValueSchema>;
export type Attribute = z.infer<typeof attributeSchema>;
export type Status = z.infer<typeof statusSchema>;
export type SelectOption = z.infer<typeof selectOptionSchema>;
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;
export type CreateRecordBody = z.infer<typeof createRecordBody>;
export type QueryRecordsBody = z.infer<typeof queryRecordsBody>;
