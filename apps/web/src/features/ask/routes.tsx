// Chat routes under the main shell (ask-agentic §1; internals §7.1): `/<ws>/chats` redirects to `/chats/new`, `/chats/new`
// (search `i` = page context) and `/chats/<threadId>`.
import { type AnyRoute, createRoute, redirect } from '@tanstack/react-router';
import { ChatPage } from './ChatPage';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pass the main shell route (`getParentRoute`). */
export function askRoutes(getParentRoute: () => AnyRoute): AnyRoute[] {
  const toNew = ({ params }: { params: unknown }): never => {
    throw redirect({ href: `/${(params as { workspaceSlug: string }).workspaceSlug}/chats/new`, replace: true });
  };

  const index = createRoute({ getParentRoute, path: 'chats', beforeLoad: toNew });

  const fresh: AnyRoute = createRoute({
    getParentRoute,
    path: 'chats/new',
    validateSearch: (search: Record<string, unknown>) => ({
      i: typeof search.i === 'string' && search.i ? search.i : undefined,
    }),
    component: function NewChatRoute() {
      const { i } = fresh.useSearch() as { i?: string };
      return <ChatPage threadId={null} interests={i} />;
    },
  });

  const thread: AnyRoute = createRoute({
    getParentRoute,
    path: 'chats/$threadId',
    beforeLoad: ({ params }) => {
      const id = (params as { threadId: string }).threadId;
      // `/chats/<garbage>` is "Chat not found" server-side; a non-uuid id never reaches it.
      if (!UUID.test(id)) toNew({ params });
    },
    component: function ChatThreadRoute() {
      const { threadId } = thread.useParams() as { threadId: string };
      return <ChatPage threadId={threadId} />;
    },
  });

  const splat = createRoute({ getParentRoute, path: 'chats/$', beforeLoad: toNew });
  return [index, fresh, thread, splat];
}
