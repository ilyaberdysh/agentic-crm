// Query keys of the calls feature (slice 10). Every key lives under ['ws', workspaceId, <resource>, …] where <resource>
// is the realtime invalidation vocabulary (packages/realtime InvalidationResource), so a server invalidation refetches
// exactly the queries that show the changed data (data/realtime/invalidation.ts maps the message onto a prefix).
import { keys } from '../../data/keys';

export const callKeys = {
  /** Everything of the Calls list and the Calls tabs (`call-recording-list`: create, completion, delete, meeting edits). */
  lists: (ws: string) => keys.resource(ws, 'call-recording-list'),
  list: (ws: string, params: unknown) => [...keys.resource(ws, 'call-recording-list'), 'list', params] as const,
  recordCalls: (ws: string, recordId: string, params: unknown = {}) =>
    [...keys.resource(ws, 'call-recording-list'), 'record', recordId, params] as const,
  byMeetings: (ws: string, meetingIds: readonly string[]) =>
    [...keys.resource(ws, 'call-recording-list'), 'by-meetings', [...meetingIds].sort()] as const,

  /** One call (`call-recording`, resourceId = recording id): detail, transcript, speakers. */
  call: (ws: string, recordingId: string) => [...keys.resource(ws, 'call-recording'), recordingId, 'detail'] as const,
  transcript: (ws: string, recordingId: string) =>
    [...keys.resource(ws, 'call-recording'), recordingId, 'transcript'] as const,
  speakers: (ws: string, recordingId: string) =>
    [...keys.resource(ws, 'call-recording'), recordingId, 'speakers'] as const,
  insights: (ws: string, recordingId: string) => [...keys.resource(ws, 'call-insight-list'), recordingId] as const,

  templates: (ws: string, params: unknown = {}) => [...keys.resource(ws, 'insight-template-list'), params] as const,
  template: (ws: string, templateId: string) => [...keys.resource(ws, 'insight-template'), templateId] as const,
  /** Our preset catalogue is static: it is not tied to an invalidation resource. */
  presets: (ws: string) => ['ws', ws, 'insight-presets'] as const,
  settings: (ws: string) => keys.resource(ws, 'member-call-settings'),
};
