// Realtime invalidation → TanStack Query (BACKLOG 1.08 client side, ARCHITECTURE I4a).
// A message says *what is stale* ({resource, resourceId, scope, seq}); we record `seq` as the workspace's accept-after
// watermark (sent as `x-accept-after` on the refetch) and invalidate the matching key prefixes. Active queries refetch
// at once; inactive ones refetch when next used. Continuity loss invalidates everything cached for the workspace.
import type { InvalidationMessage } from '@agentic-crm/realtime';
import { compareSeq } from '@agentic-crm/realtime/client';
import type { QueryClient, QueryFilters, QueryKey } from '@tanstack/react-query';
import { keys } from '../keys';
import { noteAcceptAfter } from '../trpc';

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];

/** Matches ['ws', ws, resource, <any>, id] — an entity keyed by id under a definition we were not told. */
function byIdAt(workspaceId: string, resource: string, index: number, id: string): QueryFilters {
  return {
    predicate: (q) =>
      q.queryKey[0] === 'ws' && q.queryKey[1] === workspaceId && q.queryKey[2] === resource && q.queryKey[index] === id,
  };
}

/** Resolved policies / permission rows below any entity-definition key (['ws', ws, 'entity-definition', id, 'policy' | 'permissions']). */
function accessQueries(workspaceId: string): QueryFilters {
  return {
    predicate: (q) =>
      q.queryKey[0] === 'ws' &&
      q.queryKey[1] === workspaceId &&
      q.queryKey[2] === 'entity-definition' &&
      (q.queryKey[4] === 'policy' || q.queryKey[4] === 'permissions'),
  };
}

// ---- raw message taps ---------------------------------------------------------------------------------------------
// Some resources are signals consumed directly by a feature rather than cache invalidations, such as `report-stale`.
// marks dashboard cells "New data" instead of refetching them). Features register a tap; every message reaches it.

type MessageTap = (message: InvalidationMessage) => void;
const taps = new Set<MessageTap>();

/** Calls `tap` with every invalidation message the tab receives; returns the unsubscribe function. */
export function tapInvalidations(tap: MessageTap): () => void {
  taps.add(tap);
  return () => taps.delete(tap);
}

/** Query filters to invalidate for one message. Pure: unit-tested against a seeded QueryClient. */
export function invalidationFilters(message: InvalidationMessage): QueryFilters[] {
  const ws = message.workspaceId;
  const id = message.resourceId ?? undefined;
  const scope = message.scope ?? {};
  const def = str(scope.entityDefinitionId);
  const prefix = (queryKey: QueryKey): QueryFilters => ({ queryKey });

  switch (message.resource) {
    case 'workspace':
      // Name/slug/logo changes show in the picker, the switcher and the shell.
      return [prefix(keys.workspaces()), prefix(keys.workspace(ws))];
    case 'workspace-member':
      // Access level changes also change the workspace list entry (membership) of that user.
      return [
        prefix(keys.members(ws)),
        ...(id ? [prefix(keys.member(ws, id))] : [prefix(keys.resource(ws, 'workspace-member'))]),
        prefix(keys.workspaces()),
      ];
    case 'workspace-invite-list':
      return [prefix(keys.invites(ws))];
    case 'entity-definition':
      return [
        ...(id ? [prefix(keys.object(ws, id))] : [prefix(keys.resource(ws, 'entity-definition'))]),
        prefix(keys.objects(ws)),
      ];
    case 'entity-definition-list':
      // Team membership and grant changes also change what the caller may do: resolved policies and permission
      // rows hang below the definition keys.
      return [prefix(keys.objects(ws)), accessQueries(ws)];
    case 'attribute-definition': {
      const owner = def;
      if (owner && id) return [prefix(keys.attribute(ws, owner, id)), prefix(keys.attributes(ws, owner))];
      if (id)
        return [byIdAt(ws, 'attribute-definition', 4, id), prefix(keys.resource(ws, 'attribute-definition-list'))];
      return [
        prefix(keys.resource(ws, 'attribute-definition')),
        prefix(keys.resource(ws, 'attribute-definition-list')),
      ];
    }
    case 'attribute-definition-list': {
      const owner = def ?? id;
      return owner ? [prefix(keys.attributes(ws, owner))] : [prefix(keys.resource(ws, 'attribute-definition-list'))];
    }
    case 'select-option-list': {
      const attr = str(scope.attributeDefinitionId) ?? id;
      if (def && attr) return [prefix(keys.options(ws, def, attr))];
      if (attr) return [byIdAt(ws, 'select-option-list', 4, attr)];
      return [prefix(keys.resource(ws, 'select-option-list'))];
    }
    case 'entity-instance': {
      if (!id) return [prefix(keys.resource(ws, 'entity-instance'))];
      // The record, every value list of it (a merge/delete changes all of them) and its activity.
      return def
        ? [
            prefix(keys.record(ws, def, id)),
            byIdAt(ws, 'attribute-value-list', 5, id),
            prefix(keys.recordTimeline(ws, def, id)),
          ]
        : [
            byIdAt(ws, 'entity-instance', 4, id),
            byIdAt(ws, 'attribute-value-list', 5, id),
            byIdAt(ws, 'record-timeline', 4, id),
          ];
    }
    case 'attribute-value-list': {
      const attr = str(scope.attributeDefinitionId) ?? id;
      const records = strList(scope.entityInstanceIds);
      // Value changes are activity too (record page timeline, D).
      if (def && attr && records.length > 0)
        return records.flatMap((r) => [prefix(keys.values(ws, def, attr, r)), prefix(keys.recordTimeline(ws, def, r))]);
      if (def && attr)
        return [prefix(['ws', ws, 'attribute-value-list', def, attr]), prefix(['ws', ws, 'record-timeline', def])];
      if (def) return [prefix(['ws', ws, 'attribute-value-list', def]), prefix(['ws', ws, 'record-timeline', def])];
      return [prefix(keys.resource(ws, 'attribute-value-list')), prefix(keys.resource(ws, 'record-timeline'))];
    }
    case 'record-timeline': {
      // resourceId = the entity definition; scope.entityInstanceIds = the records whose activity / children changed.
      const owner = def ?? id;
      const records = strList(scope.entityInstanceIds);
      if (owner && records.length > 0) return records.map((r) => prefix(keys.recordTimeline(ws, owner, r)));
      if (owner) return [prefix(['ws', ws, 'record-timeline', owner])];
      return [prefix(keys.resource(ws, 'record-timeline'))];
    }
    case 'custom-layout':
      return def ? [prefix(keys.customLayout(ws, def))] : [prefix(keys.resource(ws, 'custom-layout'))];
    case 'storage-entry-list': {
      const record = str(scope.entityInstanceId) ?? id;
      if (def && record) return [prefix(keys.storageEntries(ws, def, record))];
      if (record) return [byIdAt(ws, 'storage-entry-list', 4, record)];
      return [prefix(keys.resource(ws, 'storage-entry-list'))];
    }
    case 'upload-session':
      // Sessions are not cached; the file entry arrives with `storage-entry-list`.
      return [];
    case 'member-preferences':
      return [prefix(keys.memberPreferences(ws))];
    case 'entity-view':
      return [
        ...(id ? [prefix(keys.view(ws, id))] : [prefix(keys.resource(ws, 'entity-view'))]),
        ...(def ? [prefix(keys.views(ws, def))] : []),
      ];
    case 'entity-view-list': {
      const owner = def ?? id;
      return owner ? [prefix(keys.views(ws, owner))] : [prefix(keys.resource(ws, 'entity-view-list'))];
    }
    case 'snapshot-selection': {
      // Any snapshot over the definition may be stale (row set or order changed). When the change names the
      // attributes it touched, queries that declare `meta.snapshotDeps` (the attributes their filter/sorts or
      // aggregation read) refetch only if they depend on one of them; a value edit outside the filter and sorts
      // leaves the row set and order unchanged.
      const owner = def ?? id;
      if (!owner) return [prefix(keys.resource(ws, 'snapshot'))];
      const changed = strList(scope.attributeDefinitionIds);
      if (changed.length === 0) return [prefix(['ws', ws, 'snapshot', owner])];
      return [
        {
          queryKey: ['ws', ws, 'snapshot', owner],
          predicate: (q) => {
            const deps = (q.meta as { snapshotDeps?: unknown } | undefined)?.snapshotDeps;
            return !Array.isArray(deps) || deps.some((d) => changed.includes(d as string));
          },
        },
      ];
    }
    case 'collection':
      return [
        ...(id ? [prefix(keys.collection(ws, id))] : [prefix(keys.resource(ws, 'collection'))]),
        prefix(keys.collections(ws)),
      ];
    case 'collection-list':
      return [prefix(keys.collections(ws))];
    //  notes / tasks / comments (features/{notes,tasks,comments}): every query of the resource lives under
    // ['ws', ws, <resource>, …] and the domain emits the item and its list together, so a prefix per resource is
    // enough. Favorites change the `favoriteId` carried by note and template reads.
    case 'note':
    case 'note-list':
    case 'note-template':
    case 'note-template-list':
    case 'task':
    case 'task-list':
    case 'comment-thread':
    case 'comment-thread-list':
    case 'member-preferences':
      return [prefix(keys.resource(ws, message.resource))];
    case 'favorite-list':
      // Dashboards carry the member's `favoriteId` (index rows, dashboard detail).
      return (
        [
          'favorite-list',
          'note',
          'note-list',
          'note-template',
          'note-template-list',
          'reporting-dashboard',
          'reporting-dashboard-list',
        ] as const
      ).map((r) => prefix(keys.resource(ws, r)));
    case 'document': {
      // Persisted body of a note/template changed (debounced collab saves): that document's projections, plus the
      // note / template reads that carry the projection for previews (cards, rows, record tabs).
      const owner = str(scope.docType);
      const parent = str(scope.parentRef);
      const filters = [id ? prefix(keys.document(ws, id)) : prefix(keys.resource(ws, 'document'))];
      if (owner === 'note') {
        filters.push(prefix(keys.resource(ws, 'note-list')));
        if (parent) filters.push(prefix([...keys.resource(ws, 'note'), parent]));
      } else if (owner === 'note-template') {
        filters.push(prefix(keys.resource(ws, 'note-template-list')));
        if (parent) filters.push(prefix([...keys.resource(ws, 'note-template'), parent]));
      }
      return filters;
    }
    //: a notification for me arrived, or rows were read / unread / archived (my other tabs): the inbox list and
    // the unread count live under the resource prefix; preferences are their own resource.
    case 'notification':
    case 'notification-preferences':
      return [prefix(keys.resource(ws, message.resource))];
    //  (settings, packages/realtime): teams, requirement rules, developer tokens and webhooks.
    case 'workspace-team':
      return [
        ...(id ? [prefix(keys.team(ws, id))] : [prefix(keys.resource(ws, 'workspace-team'))]),
        prefix(keys.teams(ws)),
      ];
    case 'workspace-team-list':
      return [prefix(keys.teams(ws))];
    case 'requirement-rule-list': {
      const owner = def ?? id;
      return owner ? [prefix(keys.rules(ws, owner))] : [prefix(keys.resource(ws, 'requirement-rule-list'))];
    }
    case 'api-token-list':
      return [prefix(keys.apiTokens(ws))];
    case 'webhook':
      return [
        ...(id ? [prefix(keys.webhook(ws, id))] : [prefix(keys.resource(ws, 'webhook'))]),
        prefix(keys.webhooks(ws)),
      ];
    case 'webhook-list':
      return [prefix(keys.webhooks(ws))];
    //  (features/{email,mailboxes,meetings,composer}): every query of a resource lives under
    // ['ws', ws, <resource>, …]. Synced mail and meetings are invalidated per record (scope.entityInstanceIds) or per
    // thread / mailbox; the cached lists are few, so a prefix per resource is enough. Meetings are timeline events.
    case 'mailbox':
    case 'mailbox-list':
    case 'mailbox-signature-list':
    case 'mailbox-blocklist':
    case 'message-draft':
    case 'message-draft-list':
    case 'outbox':
    case 'email-template':
    case 'email-template-list':
    case 'workspace-email-settings':
    case 'call-recording-list':
      return [prefix(keys.resource(ws, message.resource))];
    case 'email-thread-list':
      return [prefix(keys.resource(ws, 'email-thread-list'))];
    case 'email-grant-list':
      // Grants change what a viewer may see of threads.
      return [prefix(keys.resource(ws, 'email-grant-list')), prefix(keys.resource(ws, 'email-thread-list'))];
    case 'meeting':
    case 'meeting-list': {
      const records = strList(scope.entityInstanceIds);
      const timelines =
        def && records.length > 0
          ? records.map((r) => prefix(keys.recordTimeline(ws, def, r)))
          : [prefix(keys.resource(ws, 'record-timeline'))];
      return [prefix(keys.resource(ws, 'meeting')), prefix(keys.resource(ws, 'meeting-list')), ...timelines];
    }
    //  (features/calls): one call (resourceId = recording id: detail, transcript, speakers), its insights, one
    // insight template (also shown in the templates index), the index, and the member's default template.
    case 'call-recording':
    case 'call-insight-list':
      return [prefix(id ? [...keys.resource(ws, message.resource), id] : keys.resource(ws, message.resource))];
    case 'insight-template':
      return [
        prefix(id ? [...keys.resource(ws, 'insight-template'), id] : keys.resource(ws, 'insight-template')),
        prefix(keys.resource(ws, 'insight-template-list')),
        // Insights carry `isOutdated` (a newer published version of their template).
        prefix(keys.resource(ws, 'call-insight-list')),
      ];
    case 'insight-template-list':
    case 'member-call-settings':
      return [prefix(keys.resource(ws, message.resource))];
    //  Ask AI (features/ask): threads and turns share the `ai-thread` / `ai-thread-list` prefixes (the thread
    // detail carries its turns); prompts, settings, credits and record summaries each own a prefix.
    case 'ai-thread':
    case 'ai-thread-list':
    case 'ai-turn':
    case 'ai-turn-list':
      return [
        prefix(keys.resource(ws, 'ai-thread')),
        prefix(keys.resource(ws, 'ai-thread-list')),
        prefix(keys.resource(ws, 'ai-turn')),
      ];
    case 'ai-prompt':
    case 'ai-prompt-list':
      return [prefix(keys.resource(ws, 'ai-prompt')), prefix(keys.resource(ws, 'ai-prompt-list'))];
    case 'ai-settings':
    case 'credit-usage':
    case 'record-ai-summary':
      return [prefix(keys.resource(ws, message.resource))];
    //  workflows (features/workflows/data.ts): one workflow's reads live under ['ws', ws, 'workflow', id, …];
    // the index under 'workflow-list'; runs of a workflow under ['ws', ws, 'workflow-run-list', workflowId, …] (run
    // counts and "Last failed run" show in the index too); one run under ['ws', ws, 'workflow-run', runId].
    case 'workflow':
      return [
        prefix(id ? [...keys.resource(ws, 'workflow'), id] : keys.resource(ws, 'workflow')),
        prefix(keys.resource(ws, 'workflow-list')),
      ];
    case 'workflow-list':
      return [prefix(keys.resource(ws, 'workflow-list'))];
    case 'workflow-run-list':
      return [
        prefix(id ? [...keys.resource(ws, 'workflow-run-list'), id] : keys.resource(ws, 'workflow-run-list')),
        prefix([...keys.resource(ws, 'workflow-run-list'), 'usage']),
        prefix(keys.resource(ws, 'workflow-list')),
      ];
    case 'workflow-run': {
      const workflowId = str(scope.workflowId);
      return [
        prefix(id ? [...keys.resource(ws, 'workflow-run'), id] : keys.resource(ws, 'workflow-run')),
        ...(workflowId ? [prefix([...keys.resource(ws, 'workflow-run-list'), workflowId])] : []),
      ];
    }
    case 'workflow-broadcast':
      return [prefix(keys.resource(ws, 'workflow-broadcast'))];
    case 'workflow-events':
    //  (features/reports). Everything about one dashboard (detail with cells and reports, grants, the editor's
    // report read) lives under ['ws', ws, 'reporting-dashboard', <dashboardId>, …]; the index under
    // 'reporting-dashboard-list'. Datasets are never refetched by an invalidation: `report-stale` only marks them
    // ("New data" pill, tap below), and a changed report gets a new dataset key.
    case 'reporting-dashboard':
    case 'reporting-dashboard-cells':
      return [
        prefix(id ? [...keys.resource(ws, 'reporting-dashboard'), id] : keys.resource(ws, 'reporting-dashboard')),
        prefix(keys.resource(ws, 'reporting-dashboard-list')),
      ];
    case 'reporting-dashboard-list':
      return [prefix(keys.resource(ws, 'reporting-dashboard-list'))];
    case 'report-stale':
      return [];
    //  formula and AI attributes (features/formulas, features/ai-attributes): per-record annotations of one
    // attribute ("Calculating...", "AI is thinking...", errors), AI composer requests, AI runs.
    case 'entity-annotation': {
      const attr = str(scope.attributeDefinitionId) ?? id;
      const records = strList(scope.entityInstanceIds);
      if (attr && records.length > 0 && records.length <= 100)
        return records.map((r) => prefix(['ws', ws, 'entity-annotation', attr, r]));
      if (attr) return [prefix(['ws', ws, 'entity-annotation', attr])];
      return [prefix(keys.resource(ws, 'entity-annotation'))];
    }
    case 'formula-generation-request':
      return [
        prefix(id ? ['ws', ws, 'formula-generation-request', id] : keys.resource(ws, 'formula-generation-request')),
      ];
    case 'ai-attribute-run':
      return [prefix(keys.resource(ws, 'ai-attribute-run'))];
    default:
      // Unknown resource (newer server): be safe and refetch the workspace.
      return [prefix(keys.ws(ws))];
  }
}

// ---- writes already reflected in the cache ---------------------------------------------------------------------
// A mutation response carries the canonical state and its change seq. Once that state is written into a key, an
// invalidation of exactly that key with seq ≤ the response seq is already reflected (custom write echoing back) and
// needs no refetch; anything newer is refetched. Snapshots are never marked: they always refetch.

const covered = new Map<string, string>();
const MAX_COVERED = 500;

/** Records that `queryKey` holds the server state as of `seq` (from a mutation response). */
export function markCovered(queryKey: QueryKey, seq: string | null | undefined): void {
  if (!seq) return;
  const hash = JSON.stringify(queryKey);
  const prev = covered.get(hash);
  if (prev !== undefined && compareSeq(prev, seq) >= 0) return;
  covered.delete(hash);
  covered.set(hash, seq);
  if (covered.size > MAX_COVERED) covered.delete(covered.keys().next().value as string);
}

function isCovered(filter: QueryFilters, seq: string): boolean {
  if (!filter.queryKey) return false;
  const coveredSeq = covered.get(JSON.stringify(filter.queryKey));
  return coveredSeq !== undefined && compareSeq(seq, coveredSeq) <= 0;
}

export function resetCovered(): void {
  covered.clear();
}

/** Applies an invalidation: accept-after watermark first, then invalidate (active queries refetch now). */
export function applyInvalidation(queryClient: QueryClient, message: InvalidationMessage): Promise<void> {
  noteAcceptAfter(message.workspaceId, message.seq);
  for (const tap of taps) tap(message);
  const filters = invalidationFilters(message).filter((f) => !isCovered(f, message.seq));
  return Promise.all(filters.map((f) => queryClient.invalidateQueries(f))).then(() => undefined);
}

/** Missed messages: refetch everything for the workspace (or everything when no workspace is named). */
export function applyContinuityLost(queryClient: QueryClient, workspaceId: string | undefined): Promise<void> {
  if (workspaceId) {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.ws(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: keys.workspaces() }),
    ]).then(() => undefined);
  }
  return queryClient.invalidateQueries();
}
