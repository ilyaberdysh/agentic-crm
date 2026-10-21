// Routes of the lists feature:
// /$ws/collection/$listId → the list's first view (or "Start with a view")
// /$ws/collection/$listId/view/$viewId the list page
// /$ws/collection/$listId/entry/$entryId → the entry's parent record page (there is no entry page)
// /$ws/collection/$listId/entry/$entryId/comments → the list's default view with that entry's comments open
// /$ws/settings/data/lists lists in settings
// /$ws/settings/data/lists/$listId[/$tab] list settings (general · permissions · attributes · …)
import type { RecordRef } from '@agentic-crm/contracts';
import { useQuery } from '@tanstack/react-query';
import { type AnyRoute, createRoute, Navigate, redirect } from '@tanstack/react-router';
import { valuesQuery } from '../../data/records';
import { useObjectDefinition } from '../attributes/data/queries';
import { recordPath } from '../attributes/ui/primitives';
import { ContentSpinner } from '../shell/AppShell';
import { useWorkspace } from '../shell/workspaceContext';
import { parentRecordAttribute, useList, useListAttributes } from './data';
import { parentOf } from './entryRows';
import { ListPage } from './ListPage';
import { LIST_TAB_IDS, ListSettingsPage, type ListTabId } from './settings/ListSettingsPage';
import { ListsSettingsPage } from './settings/ListsSettingsPage';

/** Pass the main (`_main`) route. */
export function listRoutes(getParentRoute: () => AnyRoute): AnyRoute[] {
  const index = createRoute({
    getParentRoute,
    path: 'collection/$listId',
    component: function ListIndexRoute() {
      return <ListPage listId={(index.useParams() as { listId: string }).listId} />;
    },
  });
  const view = createRoute({
    getParentRoute,
    path: 'collection/$listId/view/$viewId',
    component: function ListViewRoute() {
      const { listId, viewId } = view.useParams() as { listId: string; viewId: string };
      return <ListPage listId={listId} viewId={viewId} />;
    },
  });
  const entry = createRoute({
    getParentRoute,
    path: 'collection/$listId/entry/$entryId',
    component: function EntryRoute() {
      const { listId, entryId } = entry.useParams() as { listId: string; entryId: string };
      return <EntryRedirect listId={listId} entryId={entryId} />;
    },
  });
  const entryComments = createRoute({
    getParentRoute,
    path: 'collection/$listId/entry/$entryId/comments',
    component: function EntryCommentsRoute() {
      const { listId, entryId } = entryComments.useParams() as { listId: string; entryId: string };
      return <ListPage listId={listId} commentsEntryId={entryId} />;
    },
  });
  return [index, view, entry, entryComments];
}

/** `/collection/<list>/entry/<entry>` → the parent record's overview (observed L:s45). */
function EntryRedirect({ listId, entryId }: { listId: string; entryId: string }) {
  const { workspace, href } = useWorkspace();
  const list = useList(workspace, listId);
  const attributes = useListAttributes(workspace, list.data?.id);
  const parentAttribute = parentRecordAttribute(attributes.data ?? [], list.data?.parentRecordAttributeId);
  const values = useQuery({
    ...valuesQuery({
      workspace,
      entityDefinitionId: list.data?.id ?? '',
      attributeDefinitionId: parentAttribute?.id ?? '',
      entityInstanceId: entryId,
    }),
    enabled: Boolean(list.data && parentAttribute),
  });
  const parent: RecordRef | null = values.data ? parentOf(values.data.values) : null;
  const definition = useObjectDefinition(parent?.entityDefinitionId);
  if (list.isError || values.isError || (values.data && !parent)) {
    return <Navigate to={href(list.data ? `collection/${list.data.id}` : 'home')} replace />;
  }
  if (!parent || !definition) return <ContentSpinner />;
  const path = recordPath(workspace.slug, definition, parent.entityInstanceId);
  return <Navigate to={path ? `${path}/overview` : href('home')} replace />;
}

const TAB_ALIASES: Record<string, ListTabId> = { configuration: 'general', integrations: 'app' };

/** Pass the settings route. */
export function listSettingsRoutes(getParentRoute: () => AnyRoute): AnyRoute[] {
  const lists = createRoute({ getParentRoute, path: 'data/lists', component: ListsSettingsPage });
  const listIndex = createRoute({
    getParentRoute,
    path: 'data/lists/$listId',
    beforeLoad: ({ location }) => {
      throw redirect({ href: `${location.pathname.replace(/\/$/, '')}/general`, replace: true });
    },
  });
  const listTab = createRoute({
    getParentRoute,
    path: 'data/lists/$listId/$tab',
    beforeLoad: ({ params, location }) => {
      const { tab } = params as { tab: string };
      const alias = TAB_ALIASES[tab];
      if (alias || !(LIST_TAB_IDS as string[]).includes(tab)) {
        const base = location.pathname.slice(0, location.pathname.lastIndexOf('/'));
        throw redirect({ href: `${base}/${alias ?? 'general'}`, replace: true });
      }
    },
    component: function ListTabRoute() {
      const { listId, tab } = listTab.useParams() as { listId: string; tab: ListTabId };
      return <ListSettingsPage listId={listId} tab={tab} />;
    },
  });
  return [lists, listIndex, listTab];
}
