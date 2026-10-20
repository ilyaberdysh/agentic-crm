// Room authorisation beyond workspace membership (I4b rooms; C1 README §5 view presence, BACKLOG 2.15, 3.11).
//   view:<workspaceId>:<viewId>                       presence on a table / kanban view: the member must be able to
//                                                     read the records of the view's object.
//   record:<workspaceId>:<entityDefinitionId>:<id>    presence on a record page (D §3.12 facepile): the record must be
//                                                     live and readable by the member.
//   note:<workspaceId>:<noteId>                       presence on a note window / card: the note must be readable.
//   collection:<workspaceId>:<listId>                 presence on a list page (header avatars): the list must be
//                                                     readable (list access levels, J permissions §2). Entry presence
//                                                     uses record:<ws>:<listId>:<entryId> (same list check).
//   reporting-dashboard:<workspaceId>:<dashboardId>   presence on a dashboard: the dashboard must be readable.
//   thread:<workspaceId>:<threadId>                   an Ask Agentic chat (slice 10): streamed answer parts for other
//                                                     tabs; only the chat's creator (threads are private).
// Other namespaces need workspace membership only (checked by the gateway before this hook).
import { type Domain, memberContext } from '@agentic-crm/domain';
import type { RoomAuthorizer } from './gateway';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function domainRoomAuthorizer(
  domain: Pick<Domain, 'views' | 'policies' | 'recordPage' | 'notes' | 'dashboards' | 'ai'>,
): RoomAuthorizer {
  return async ({ workspaceId, memberId, namespace, params }) => {
    const ctx = memberContext(workspaceId, memberId);
    if (namespace === 'record') {
      const [entityDefinitionId, entityInstanceId, ...rest] = params;
      if (
        !entityDefinitionId ||
        !entityInstanceId ||
        rest.length > 0 ||
        !UUID.test(entityDefinitionId) ||
        !UUID.test(entityInstanceId)
      ) {
        return false;
      }
      try {
        // state() checks read access to the object (403 → refused) and tells whether the record is live.
        const state = await domain.recordPage.state(ctx, { entityDefinitionId, entityInstanceId });
        return state.state === 'live';
      } catch {
        return false;
      }
    }
    if (namespace === 'note') {
      const [noteId, ...rest] = params;
      if (!noteId || rest.length > 0 || !UUID.test(noteId)) return false;
      try {
        await domain.notes.get(ctx, noteId);
        return true;
      } catch {
        return false;
      }
    }
    if (namespace === 'collection') {
      // The member must have read access before joining a list's presence room.
      const [listId, ...rest] = params;
      if (!listId || rest.length > 0 || !UUID.test(listId)) return false;
      const { policies } = await domain.policies.resolve(ctx, { entityDefinitionIds: [listId] });
      const entry = policies[listId];
      return entry?.state === 'complete' && entry.value.read_entity_instance === true;
    }
    if (namespace === 'reporting-dashboard') {
      const [dashboardId, ...rest] = params;
      if (!dashboardId || rest.length > 0 || !UUID.test(dashboardId)) return false;
      try {
        await domain.dashboards.get(ctx, { dashboardId });
        return true;
      } catch {
        return false;
      }
    }
    if (namespace === 'thread') {
      const [threadId, ...rest] = params;
      if (!threadId || rest.length > 0 || !UUID.test(threadId)) return false;
      try {
        await domain.ai.threads.get(ctx, threadId);
        return true;
      } catch {
        return false;
      }
    }
    if (namespace !== 'view') return true;
    const [viewId, ...rest] = params;
    if (!viewId || rest.length > 0 || !UUID.test(viewId)) return false;
    let entityDefinitionId: string;
    try {
      entityDefinitionId = (await domain.views.get(ctx, viewId)).entityDefinitionId;
    } catch {
      return false; // unknown view (or another workspace's)
    }
    const { policies } = await domain.policies.resolve(ctx, { entityDefinitionIds: [entityDefinitionId] });
    const entry = policies[entityDefinitionId];
    return entry?.state === 'complete' && entry.value.read_entity_instance === true;
  };
}
