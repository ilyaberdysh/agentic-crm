// The implemented public REST surface. Attribute endpoints have separate object/list routes and permissions.
import { z } from 'zod';
import * as schemas from './api.ts';

export type V2Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const operation = (method: V2Method, path: string, scopes: readonly string[]) => ({
  method,
  path: `/v2${path}`,
  scopes,
});
const configuration = (level: 'read' | 'read-write') => [`object_configuration:${level}`];
const records = (level: 'read' | 'read-write') => [`record_permission:${level}`, 'object_configuration:read'];
const entries = (level: 'read' | 'read-write') => [`list_entry:${level}`, 'list_configuration:read'];
const notes = (level: 'read' | 'read-write') => [
  `note:${level}`,
  'object_configuration:read',
  'record_permission:read',
];
const tasks = (level: 'read' | 'read-write') => [
  `task:${level}`,
  'object_configuration:read',
  'record_permission:read',
  'user_management:read',
];
const files = (level: 'read' | 'read-write') => [
  `file:${level}`,
  'object_configuration:read',
  'record_permission:read',
];
const attributePath = '/{target}/{identifier}/attributes';
const recordPath = '/objects/{object}/records';
const entryPath = '/lists/{list}/entries';
const meetingPath = '/meetings/{meeting_id}';
const recordingPath = `${meetingPath}/call_recordings`;

export const v2Operations = {
  getSelf: operation('GET', '/self', []),
  listWorkspaceMembers: operation('GET', '/workspace_members', ['user_management:read']),
  getWorkspaceMember: operation('GET', '/workspace_members/{workspace_member_id}', ['user_management:read']),
  listObjects: operation('GET', '/objects', configuration('read')),
  createObject: operation('POST', '/objects', configuration('read-write')),
  getObject: operation('GET', '/objects/{object}', configuration('read')),
  updateObject: operation('PATCH', '/objects/{object}', configuration('read-write')),
  // The concrete target determines these scopes; v2Routes is the authoritative registration/security manifest.
  listAttributes: operation('GET', attributePath, []),
  createAttribute: operation('POST', attributePath, []),
  getAttribute: operation('GET', `${attributePath}/{attribute}`, []),
  updateAttribute: operation('PATCH', `${attributePath}/{attribute}`, []),
  listSelectOptions: operation('GET', `${attributePath}/{attribute}/options`, []),
  createSelectOption: operation('POST', `${attributePath}/{attribute}/options`, []),
  updateSelectOption: operation('PATCH', `${attributePath}/{attribute}/options/{option}`, []),
  listStatuses: operation('GET', `${attributePath}/{attribute}/statuses`, []),
  createStatus: operation('POST', `${attributePath}/{attribute}/statuses`, []),
  updateStatus: operation('PATCH', `${attributePath}/{attribute}/statuses/{option}`, []),
  queryRecords: operation('POST', `${recordPath}/query`, records('read')),
  createRecord: operation('POST', recordPath, records('read-write')),
  assertRecord: operation('PUT', recordPath, records('read-write')),
  getRecord: operation('GET', `${recordPath}/{record_id}`, records('read')),
  updateRecord: operation('PATCH', `${recordPath}/{record_id}`, records('read-write')),
  replaceRecord: operation('PUT', `${recordPath}/{record_id}`, records('read-write')),
  deleteRecord: operation('DELETE', `${recordPath}/{record_id}`, [
    'object_configuration:read',
    'record_permission:read-write',
  ]),
  listRecordAttributeValues: operation(
    'GET',
    `${recordPath}/{record_id}/attributes/{attribute}/values`,
    records('read'),
  ),
  searchRecords: operation('POST', '/objects/records/search', records('read')),
  listNotes: operation('GET', '/notes', notes('read')),
  createNote: operation('POST', '/notes', notes('read-write')),
  getNote: operation('GET', '/notes/{note_id}', notes('read')),
  updateNote: operation('PATCH', '/notes/{note_id}', notes('read-write')),
  deleteNote: operation('DELETE', '/notes/{note_id}', ['note:read-write']),
  listTasks: operation('GET', '/tasks', tasks('read')),
  createTask: operation('POST', '/tasks', tasks('read-write')),
  getTask: operation('GET', '/tasks/{task_id}', tasks('read')),
  updateTask: operation('PATCH', '/tasks/{task_id}', tasks('read-write')),
  deleteTask: operation('DELETE', '/tasks/{task_id}', ['task:read-write']),
  listThreads: operation('GET', '/threads', ['comment:read']),
  getThread: operation('GET', '/threads/{thread_id}', ['comment:read']),
  createComment: operation('POST', '/comments', ['comment:read-write']),
  getComment: operation('GET', '/comments/{comment_id}', ['comment:read']),
  deleteComment: operation('DELETE', '/comments/{comment_id}', ['comment:read-write']),
  listFiles: operation('GET', '/files', ['object_configuration:read', 'record_permission:read', 'file:read']),
  createFileEntry: operation('POST', '/files', files('read-write')),
  uploadFile: operation('POST', '/files/upload', files('read-write')),
  getFile: operation('GET', '/files/{file_id}', files('read')),
  deleteFile: operation('DELETE', '/files/{file_id}', files('read-write')),
  downloadFile: operation('GET', '/files/{file_id}/download', [
    'object_configuration:read',
    'record_permission:read',
    'file:read',
  ]),
  listLists: operation('GET', '/lists', ['list_configuration:read']),
  createList: operation('POST', '/lists', ['list_configuration:read-write']),
  getList: operation('GET', '/lists/{list}', ['list_configuration:read']),
  updateList: operation('PATCH', '/lists/{list}', ['list_configuration:read-write']),
  queryEntries: operation('POST', `${entryPath}/query`, entries('read')),
  createEntry: operation('POST', entryPath, entries('read-write')),
  assertEntry: operation('PUT', entryPath, entries('read-write')),
  getEntry: operation('GET', `${entryPath}/{entry_id}`, entries('read')),
  updateEntry: operation('PATCH', `${entryPath}/{entry_id}`, entries('read-write')),
  replaceEntry: operation('PUT', `${entryPath}/{entry_id}`, entries('read-write')),
  deleteEntry: operation('DELETE', `${entryPath}/{entry_id}`, entries('read-write')),
  listEntryAttributeValues: operation('GET', `${entryPath}/{entry_id}/attributes/{attribute}/values`, entries('read')),
  listRecordEntries: operation('GET', `${recordPath}/{record_id}/entries`, [...records('read'), 'list_entry:read']),
  listWebhooks: operation('GET', '/webhooks', ['webhook:read']),
  createWebhook: operation('POST', '/webhooks', ['webhook:read-write']),
  getWebhook: operation('GET', '/webhooks/{webhook_id}', ['webhook:read']),
  updateWebhook: operation('PATCH', '/webhooks/{webhook_id}', ['webhook:read-write']),
  deleteWebhook: operation('DELETE', '/webhooks/{webhook_id}', ['webhook:read-write']),
  listMeetings: operation('GET', '/meetings', ['meeting:read', 'record_permission:read']),
  createMeeting: operation('POST', '/meetings', ['meeting:read-write', 'record_permission:read']),
  getMeeting: operation('GET', meetingPath, ['meeting:read', 'record_permission:read']),
  updateMeeting: operation('PATCH', meetingPath, ['meeting:read-write', 'record_permission:read']),
  replaceMeeting: operation('PUT', meetingPath, ['meeting:read-write', 'record_permission:read']),
  deleteMeeting: operation('DELETE', meetingPath, ['meeting:read-write']),
  listCallRecordings: operation('GET', recordingPath, ['meeting:read', 'call_recording:read']),
  createCallRecording: operation('POST', recordingPath, ['meeting:read', 'call_recording:read-write']),
  getCallRecording: operation('GET', `${recordingPath}/{call_recording_id}`, ['meeting:read', 'call_recording:read']),
  deleteCallRecording: operation('DELETE', `${recordingPath}/{call_recording_id}`, [
    'meeting:read',
    'call_recording:read-write',
  ]),
  getCallRecordingTranscript: operation('GET', `${recordingPath}/{call_recording_id}/transcript`, [
    'meeting:read',
    'call_recording:read',
  ]),
} as const;
export type V2OperationName = keyof typeof v2Operations;

export interface V2Route {
  operationId: string;
  logicalOperationId: V2OperationName;
  method: V2Method;
  path: string;
  scopes: readonly string[];
  rateClass: 'read' | 'write';
  responseStatus: number;
  responseSchema?: z.ZodType;
  pathParams: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  bodyRequired?: boolean;
  contentType?: 'application/json' | 'multipart/form-data';
  target?: 'objects' | 'lists';
}
const schemaExports = schemas as unknown as Record<string, z.ZodType>;
function concreteRoute(name: V2OperationName, target?: 'objects' | 'lists'): V2Route {
  const op = v2Operations[name];
  const path = target
    ? op.path.replace('{target}', target).replace('{identifier}', `{${target === 'objects' ? 'object' : 'list'}}`)
    : op.path;
  const names = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] as string);
  const body = name === 'createFileEntry' ? schemas.createFolderBody : schemaExports[`${name}Body`];
  const query = schemaExports[`${name}Query`];
  return {
    ...op,
    path,
    logicalOperationId: name,
    operationId: target ? `${name}${target === 'objects' ? 'Objects' : 'Lists'}` : name,
    scopes: target
      ? [
          `${target === 'objects' ? 'object_configuration' : 'list_configuration'}:${op.method === 'GET' ? 'read' : 'read-write'}`,
        ]
      : op.scopes,
    rateClass:
      op.method === 'GET' || name === 'queryRecords' || name === 'queryEntries' || name === 'searchRecords'
        ? 'read'
        : 'write',
    responseStatus:
      name === 'uploadFile' ? 201 : name === 'downloadFile' ? 302 : name === 'deleteCallRecording' ? 204 : 200,
    responseSchema: schemaExports[`${name}Response`],
    pathParams: z.object(Object.fromEntries(names.map((key) => [key, key.endsWith('_id') ? z.guid() : z.string()]))),
    ...(query instanceof z.ZodObject ? { query } : {}),
    ...(body
      ? {
          body,
          bodyRequired: name !== 'queryRecords' && name !== 'queryEntries',
          contentType: name === 'uploadFile' ? ('multipart/form-data' as const) : ('application/json' as const),
        }
      : {}),
    ...(target ? { target } : {}),
  };
}
export const v2Routes: readonly V2Route[] = (Object.keys(v2Operations) as V2OperationName[]).flatMap((name) =>
  v2Operations[name].path.includes('{target}')
    ? [concreteRoute(name, 'objects'), concreteRoute(name, 'lists')]
    : [concreteRoute(name)],
);

export function getOperationRoute(name: V2OperationName, target?: 'objects' | 'lists'): V2Route {
  const routes = v2Routes.filter((route) => route.logicalOperationId === name && (!target || route.target === target));
  if (routes.length !== 1) throw new Error(`Operation ${name} requires an unambiguous route target`);
  return routes[0] as V2Route;
}
