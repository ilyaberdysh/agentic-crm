// Code-based route tree mirroring Attio's URL structure (ARCHITECTURE D-02, 00-inventory/routes.md). Pathless
// layouts (`_main`) are route ids, not URL segments. Logged-out routing follows K README §2.1.
import {
  type AnyRoute,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Navigate,
  redirect,
} from '@tanstack/react-router';
import { queryClient } from '../data/queryClient';
// Window bodies of slice 7 (email modal, meeting modal, composer) register with the overlay host when loaded.
import '../features/composer';
import '../features/email';
import '../features/meetings';
import { setCurrentWorkspace } from '../data/trpc';
import { askRoutes } from '../features/ask/routes';
import { JoinWorkspacePage } from '../features/auth/JoinWorkspacePage';
import { SignInPage } from '../features/auth/SignInPage';
import { SignUpPage } from '../features/auth/SignUpPage';
import { callsRoutes } from '../features/calls';
import { openSearch } from '../features/command-palette';
import { CommentDeepLink } from '../features/comments/deepLink';
import { emailsRoutes } from '../features/composer/routes';
import { HomePage } from '../features/home/HomePage';
import { ImportHistoryPage, importRoutes, importSettingsRoutes } from '../features/imports';
import { listRoutes, listSettingsRoutes } from '../features/lists/routes';
import { MAILBOX_SETTINGS_PATHS, mailboxSettingsRoutes } from '../features/mailboxes/routes';
import { NotesPage } from '../features/notes/NotesPage';
import { TemplatesPage } from '../features/notes/TemplatesPage';
import { NotificationSettingsPage } from '../features/notifications/NotificationSettingsPage';
import { ObjectIndexPage } from '../features/objects/ObjectPages';
import { recordRoutes, recordSettingsRoutes } from '../features/record/routes';
import { reportRoutes, reportSettingsRoutes } from '../features/reports';
import { AppearancePage } from '../features/settings/AppearancePage';
import { askSettingsPaths, askSettingsRoutes } from '../features/settings/ask/routes';
import { CALL_SETTINGS_PATHS } from '../features/settings/calls/CallIntelligencePage';
import { callSettingsRoutes } from '../features/settings/calls/routes';
import { objectSettingsRoutes } from '../features/settings/objects/routes';
import { adminSettingsRoutes, ownedSettingsPaths } from '../features/settings/routes';
import { SettingsLayout } from '../features/settings/SettingsLayout';
import { SettingsPlaceholderPage } from '../features/settings/SettingsPage';
import { settingsEntries } from '../features/settings/settingsNav';
import { AppShell } from '../features/shell/AppShell';
import { BootScreen, ShellSkeleton } from '../features/shell/BootScreen';
import { placeholderPages, standardObjectSlugs } from '../features/shell/navigation';
import { PlaceholderPage } from '../features/shell/PlaceholderPage';
import { WorkspaceLayout } from '../features/shell/WorkspaceLayout';
import { TasksPage } from '../features/tasks/TasksPage';
import { createViewsDevRoute } from '../features/views/dev/route';
import { workflowRoutes, workflowSettingsRoutes } from '../features/workflows/routes';
import { CreateWorkspacePage } from '../features/workspaces/CreateWorkspacePage';
import { WorkspacesPage } from '../features/workspaces/WorkspacesPage';
import { ErrorPage } from './ErrorPage';
import { RootLayout } from './RootLayout';
import {
  afterSignInPath,
  getMe,
  getWorkspaces,
  homeRedirect,
  originOf,
  type RouterContext,
  requireMe,
  stringSearch,
} from './routeGuards';

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  errorComponent: ErrorPage,
  notFoundComponent: () => <Navigate to="/" replace />,
});

const originSearch = (search: Record<string, unknown>) => ({ origin: stringSearch(search, 'origin') });

// ---- `/` ----------------------------------------------------------------------------------------------------

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: async ({ context, location }) => {
    const me = await getMe(context);
    if (!me) throw redirect({ to: '/auth/sign-in', search: location.search, replace: true });
    await homeRedirect(context);
  },
});

// ---- `/auth/*` ----------------------------------------------------------------------------------------------

const authRoute = createRoute({ getParentRoute: () => rootRoute, path: 'auth' });

const authIndexRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/auth/sign-in', replace: true });
  },
});

const signInRoute = createRoute({
  getParentRoute: () => authRoute,
  path: 'sign-in',
  validateSearch: originSearch,
  beforeLoad: async ({ context, search }) => {
    // Already signed in → the origin (same-origin only) or `/`.
    if (await getMe(context)) throw redirect({ href: afterSignInPath(search.origin), replace: true });
  },
  component: function SignInRoute() {
    const { origin } = signInRoute.useSearch();
    return <SignInPage origin={origin} />;
  },
});

const joinRoute = createRoute({
  getParentRoute: () => authRoute,
  path: 'join/$workspaceSlug',
  validateSearch: (search: Record<string, unknown>) => ({ invite: stringSearch(search, 'invite') }),
  beforeLoad: ({ context, location }) => requireMe(context, location),
  component: function JoinRoute() {
    const { workspaceSlug } = joinRoute.useParams();
    const { invite } = joinRoute.useSearch();
    return <JoinWorkspacePage workspaceSlug={workspaceSlug} inviteId={invite} />;
  },
});

const authSplatRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '$',
  beforeLoad: () => {
    throw redirect({ to: '/auth/sign-in', replace: true });
  },
});

// ---- `/welcome/*` (sign-up and workspace creation) ----------------------------------------------------------

const welcomeRoute = createRoute({ getParentRoute: () => rootRoute, path: 'welcome' });

async function welcomeRedirect(context: RouterContext): Promise<never> {
  if (await getMe(context)) throw redirect({ to: '/welcome/workspace-details', replace: true });
  throw redirect({ to: '/welcome/sign-in', replace: true });
}

const welcomeIndexRoute = createRoute({
  getParentRoute: () => welcomeRoute,
  path: '/',
  beforeLoad: ({ context }) => welcomeRedirect(context),
});

const signUpRoute = createRoute({
  getParentRoute: () => welcomeRoute,
  path: 'sign-in',
  validateSearch: originSearch,
  beforeLoad: async ({ context, search }) => {
    if (await getMe(context)) {
      if (search.origin) throw redirect({ href: afterSignInPath(search.origin), replace: true });
      throw redirect({ to: '/welcome/workspace-details', replace: true });
    }
  },
  component: function SignUpRoute() {
    const { origin } = signUpRoute.useSearch();
    return <SignUpPage origin={origin} />;
  },
});

const workspaceDetailsRoute = createRoute({
  getParentRoute: () => welcomeRoute,
  path: 'workspace-details',
  beforeLoad: async ({ context }) => {
    if (!(await getMe(context))) throw redirect({ to: '/welcome/sign-in', replace: true });
    await getWorkspaces(context);
  },
  component: CreateWorkspacePage,
});

const welcomeSplatRoute = createRoute({
  getParentRoute: () => welcomeRoute,
  path: '$',
  beforeLoad: ({ context }) => welcomeRedirect(context),
});

// ---- `/workspaces`, `/onboarding/*`, `/deleting-account` ---------------------------------------------------

const workspacesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'workspaces',
  component: WorkspacesPage,
});

/** `/onboarding` and below (the agentic flow is not built): the classic `/welcome` flow. */
const onboardingSplatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'onboarding/$',
  beforeLoad: ({ context }) => welcomeRedirect(context),
});

const deletingAccountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'deleting-account',
  beforeLoad: () => {
    throw redirect({ to: '/workspaces', replace: true });
  },
});

// ---- `/$workspaceSlug/*` ------------------------------------------------------------------------------------

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspaceSlug',
  pendingComponent: ShellSkeleton,
  beforeLoad: async ({ context, location, params }) => {
    const me = await getMe(context);
    if (!me) {
      // `/<slug>/welcome…` goes to the sign-up entry, every other in-app URL to sign-in with return-to.
      if (/^\/[^/]+\/welcome(\/|$)/.test(location.pathname)) throw redirect({ to: '/welcome/sign-in', replace: true });
      throw redirect({ to: '/auth/sign-in', search: { origin: originOf(location) }, replace: true });
    }
    const workspace = (await getWorkspaces(context)).find((w) => w.slug === params.workspaceSlug) ?? null;
    setCurrentWorkspace(workspace ? { id: workspace.id, slug: workspace.slug } : null);
    return { me, workspace };
  },
  component: function WorkspaceRoute() {
    const { me, workspace } = workspaceRoute.useRouteContext();
    return <WorkspaceLayout me={me} workspace={workspace} />;
  },
});

/** Child redirects run only for workspaces the user can open (others render the no-access page in place). */
function toWorkspaceHome(context: { workspace: { slug: string } | null }): void {
  if (!context.workspace) return;
  throw redirect({
    to: '/$workspaceSlug/home',
    params: { workspaceSlug: context.workspace.slug },
    replace: true,
  });
}

const workspaceIndexRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/',
  beforeLoad: ({ context }) => toWorkspaceHome(context),
});

const workspaceWelcomeRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'welcome/$',
  beforeLoad: ({ context }) => toWorkspaceHome(context),
});

const mainRoute = createRoute({ getParentRoute: () => workspaceRoute, id: 'main', component: AppShell });

const homeRoute = createRoute({ getParentRoute: () => mainRoute, path: 'home', component: HomePage });

// ---- slice 3: notes, templates, tasks, deep links (E README §1) ----------------------------------------------------

const notesRoute = createRoute({ getParentRoute: () => mainRoute, path: 'notes', component: NotesPage });
const noteTemplatesRoute = createRoute({
  getParentRoute: () => mainRoute,
  path: 'notes/templates',
  component: TemplatesPage,
});
/** `/notes/$` has no distinct UI in Attio: it shows the notes page. */
const notesSplatRoute = createRoute({ getParentRoute: () => mainRoute, path: 'notes/$', component: NotesPage });
const tasksRoute = createRoute({ getParentRoute: () => mainRoute, path: 'tasks', component: TasksPage });
/** `/note/$noteId` → the note modal over Home (`/home?modal=note&id=…`). */
const noteDeepLinkRoute = createRoute({
  getParentRoute: () => mainRoute,
  path: 'note/$noteId',
  beforeLoad: ({ params }) => {
    const p = params as { workspaceSlug: string; noteId: string };
    throw redirect({ href: `/${p.workspaceSlug}/home?modal=note&id=${encodeURIComponent(p.noteId)}`, replace: true });
  },
});
/** `/comment/$commentHeaderId` → the commented record's object view with the thread open (B README §2.7). */
const commentDeepLinkRoute = createRoute({
  getParentRoute: () => mainRoute,
  path: 'comment/$commentHeaderId',
  component: function CommentDeepLinkRoute() {
    return <CommentDeepLink commentId={commentDeepLinkRoute.useParams().commentHeaderId} />;
  },
});

/** E3 contents outside the record page (dev builds only; e2e and parity). */
const recordTabsDevRoute = createRoute({
  getParentRoute: () => mainRoute,
  path: '__dev/record-tabs',
  component: lazyRouteComponent(() => import('../features/overlays/dev/RecordTabsDev'), 'RecordTabsDev'),
});

/** `/search?q=…` → Home with the Search records modal open and prefilled (command-palette.md §1). */
const searchRoute = createRoute({
  getParentRoute: () => mainRoute,
  path: 'search',
  validateSearch: (search: Record<string, unknown>) => ({ q: stringSearch(search, 'q') }),
  beforeLoad: ({ search, params }) => {
    openSearch(search.q ?? '');
    throw redirect({
      to: '/$workspaceSlug/home',
      params: { workspaceSlug: (params as { workspaceSlug: string }).workspaceSlug },
      replace: true,
    });
  },
});

const placeholderRoutes: AnyRoute[] = placeholderPages
  .filter((page) => page.path !== 'automations/workflows')
  .flatMap((page) => {
    const component = () => <PlaceholderPage title={page.title} icon={page.icon} description={page.slice} />;
    const routes: AnyRoute[] = [createRoute({ getParentRoute: () => mainRoute, path: page.path, component })];
    if (page.splat) routes.push(createRoute({ getParentRoute: () => mainRoute, path: `${page.path}/$`, component }));
    return routes;
  });

const objectRoutes: AnyRoute[] = standardObjectSlugs.flatMap((slug) => {
  const index = () => <ObjectIndexPage apiSlug={slug} />;
  return [
    createRoute({ getParentRoute: () => mainRoute, path: slug, component: index }),
    createRoute({ getParentRoute: () => mainRoute, path: `${slug}/view/$entityViewId`, component: index }),
  ];
});

/** Record pages (slice 3): /company/<id>, /person/<id>, /<std>/record/<id>, /custom/<slug>/record/<id>, page layouts. */
const recordPageRoutes = recordRoutes(() => mainRoute);

const customObjectRoute = createRoute({
  getParentRoute: () => mainRoute,
  path: 'custom/$entityApiSlug',
  component: function CustomObjectRoute() {
    return <ObjectIndexPage apiSlug={customObjectRoute.useParams().entityApiSlug} />;
  },
});
const customObjectViewRoute = createRoute({
  getParentRoute: () => mainRoute,
  path: 'custom/$entityApiSlug/view/$entityViewId',
  component: function CustomObjectViewRoute() {
    return <ObjectIndexPage apiSlug={customObjectViewRoute.useParams().entityApiSlug} />;
  },
});

/** Calls (slice 10): the Calls list, Insight Templates, the template editor and the call page. */
const callPageRoutes = callsRoutes(() => mainRoute);

/** Lists (slice 4): list pages, entry redirects and entry comments (features/lists). */
const collectionRoutes = listRoutes(() => mainRoute);

/** Ask AI chats: `/chats/new`, `/chats/<id>` (slice 10, features/ask). */
const chatRoutes = askRoutes(() => mainRoute);

/** The Emails page: Drafts, Outbox, Templates (slice 7, F composer §3, §5, §6). */
const emailsPageRoutes = emailsRoutes(() => mainRoute);
/** Dashboards, reports, the editor and the viewer (slice 9, features/reports). */
const dashboardRoutes = reportRoutes(() => mainRoute);

/** CSV import wizard (slice 4, C2 import.md §I1) for objects and lists. */
const importWizardRoutes = importRoutes(() => mainRoute);

/** Views UI against seeded objects, for visual checks and e2e (dev builds only). */
const viewsDevRoute = createViewsDevRoute(() => mainRoute);

/** Workflows (slice 8): index, editor, runs, settings tab (features/workflows). */
const workflowPageRoutes = workflowRoutes(() => mainRoute);

/** No in-workspace 404: unknown paths redirect to the workspace root (B README §2.6). */
const mainSplatRoute = createRoute({
  getParentRoute: () => mainRoute,
  path: '$',
  beforeLoad: ({ context }) => toWorkspaceHome(context),
});

// ---- `/$workspaceSlug/settings/*` -------------------------------------------------------------------------------

const settingsRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'settings',
  component: SettingsLayout,
});

function toSettingsHome(context: { workspace: { slug: string } | null }): void {
  if (!context.workspace) return;
  throw redirect({
    to: '/$workspaceSlug/settings/account',
    params: { workspaceSlug: context.workspace.slug },
    replace: true,
  });
}

const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/',
  beforeLoad: ({ context }) => toSettingsHome(context),
});

const appearanceRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'appearance',
  component: AppearancePage,
});

const notificationSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'notifications',
  component: NotificationSettingsPage,
});

/** Settings → Objects and object settings (slice 2, J objects-lists §1–3). */
const objectsSettingsRoutes = objectSettingsRoutes(() => settingsRoute);

/** Settings → Objects → record page layout editor (slice 3, D §2.8). */
const recordLayoutRoutes = recordSettingsRoutes(() => settingsRoute);

/** Settings → Import history and the settings variants of the import wizard (slice 4, C2 import.md §I8). */
const importHistoryRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'data/import-history',
  component: ImportHistoryPage,
});
const settingsImportRoutes = importSettingsRoutes(() => settingsRoute);

/** Settings → Lists and list settings (slice 4, J objects-lists §4). */
const listsSettingsRoutes = listSettingsRoutes(() => settingsRoute);

/** Settings → Profile, Workspace general, Members and teams, Developers, Security (slice 6, J workspace-admin). */
const adminRoutes = adminSettingsRoutes(() => settingsRoute);
/** Settings → Email and calendar accounts, mailbox settings, workspace email and calendar (slice 7, F settings). */
const mailboxRoutes = mailboxSettingsRoutes(() => settingsRoute);
/** Settings → Call intelligence (slice 10, I calls §5.1). */
const callIntelligenceRoutes = callSettingsRoutes(() => settingsRoute);
/** Settings → Dashboards and the legacy `data/reports` alias (slice 9, H README §3.11). */
const dashboardsSettingsRoutes = reportSettingsRoutes(() => settingsRoute);

/** Settings → Ask AI: personal (General, Prompts) and workspace (Usage, Custom context) (slice 10, J §10). */
const askSettings = askSettingsRoutes(() => settingsRoute);

const settingsPlaceholderRoutes: AnyRoute[] = settingsEntries
  .filter(
    (entry) =>
      entry.path !== 'appearance' &&
      entry.path !== 'notifications' &&
      entry.path !== 'data/objects' &&
      entry.path !== 'data/import-history' &&
      entry.path !== 'data/lists' &&
      !ownedSettingsPaths.has(entry.path) &&
      !(askSettingsPaths as readonly string[]).includes(entry.path) &&
      !MAILBOX_SETTINGS_PATHS.includes(entry.path) &&
      !CALL_SETTINGS_PATHS.includes(entry.path) &&
      entry.path !== 'automations/workflows' &&
      entry.path !== 'reports/dashboards',
  )
  .map((entry) =>
    createRoute({
      getParentRoute: () => settingsRoute,
      path: entry.path,
      component: () => <SettingsPlaceholderPage entry={entry} />,
    }),
  );

/** Settings → Workflows (admin list, permissions) and Billing → Credits usage (slice 8). */
const workflowAdminRoutes = workflowSettingsRoutes(() => settingsRoute);

const settingsSplatRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '$',
  beforeLoad: ({ context }) => toSettingsHome(context),
});

// ---- `/__dev/*` (dev builds only; dropped from production bundles) -----------------------------------------------

const devRoutes: AnyRoute[] = import.meta.env.DEV
  ? [
      createRoute({
        getParentRoute: () => rootRoute,
        path: '__dev/attributes',
        component: lazyRouteComponent(
          () => import('../features/attributes/dev/AttributesGallery'),
          'AttributesGallery',
        ),
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: '__dev/report-charts',
        component: lazyRouteComponent(() => import('../features/reports/charts/dev/ChartsGallery'), 'ChartsGallery'),
      }),
    ]
  : [];

// ---- tree -------------------------------------------------------------------------------------------------------

const routeTree = rootRoute.addChildren([
  indexRoute,
  authRoute.addChildren([authIndexRoute, signInRoute, joinRoute, authSplatRoute]),
  welcomeRoute.addChildren([welcomeIndexRoute, signUpRoute, workspaceDetailsRoute, welcomeSplatRoute]),
  workspacesRoute,
  ...devRoutes,
  onboardingSplatRoute,
  deletingAccountRoute,
  workspaceRoute.addChildren([
    workspaceIndexRoute,
    workspaceWelcomeRoute,
    mainRoute.addChildren([
      homeRoute,
      searchRoute,
      notesRoute,
      noteTemplatesRoute,
      notesSplatRoute,
      tasksRoute,
      noteDeepLinkRoute,
      commentDeepLinkRoute,
      ...placeholderRoutes,
      ...objectRoutes,
      ...recordPageRoutes,
      customObjectRoute,
      customObjectViewRoute,
      ...emailsPageRoutes,
      ...callPageRoutes,
      ...chatRoutes,
      ...importWizardRoutes,
      ...collectionRoutes,
      ...workflowPageRoutes,
      ...dashboardRoutes,
      ...(import.meta.env.DEV ? [viewsDevRoute, recordTabsDevRoute] : []),
      mainSplatRoute,
    ]),
    settingsRoute.addChildren([
      settingsIndexRoute,
      appearanceRoute,
      notificationSettingsRoute,
      ...objectsSettingsRoutes,
      ...recordLayoutRoutes,
      importHistoryRoute,
      ...settingsImportRoutes,
      ...listsSettingsRoutes,
      ...adminRoutes,
      ...mailboxRoutes,
      ...callIntelligenceRoutes,
      ...askSettings,
      ...workflowAdminRoutes,
      ...dashboardsSettingsRoutes,
      ...settingsPlaceholderRoutes,
      settingsSplatRoute,
    ]),
  ]),
]);

export function createAppRouter() {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPendingComponent: BootScreen,
    defaultPendingMs: 150,
    defaultPendingMinMs: 200,
    defaultPreload: false,
    scrollRestoration: true,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;
