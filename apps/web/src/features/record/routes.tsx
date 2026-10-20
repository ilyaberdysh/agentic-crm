// Record page routes (D README §1): `/$ws/company/$id[/$activeTab]`, `/$ws/person/…`, `/$ws/<deals|users|
// workspaces>/record/…`, `/$ws/custom/$slug/record/…`; bare `record/` → the object's views; the page-layout entry
// `/{object}/page-layout/$configurationId` → `/settings/data/objects/{apiSlug}/record-page/$configurationId`.
import { type AnyRoute, createRoute, redirect, useParams } from '@tanstack/react-router';
import { LayoutEditorPage } from './layoutEditor/LayoutEditorPage';
// Registers the record overlay body with features/overlays (E4) when the routes load.
import './overlay/RecordOverlayPage';
import { RecordPage } from './RecordPage';

const STANDARD = ['deals', 'users', 'workspaces'] as const;

interface RecordParams {
  entityInstanceId: string;
  activeTab?: string;
  entityApiSlug?: string;
  workspaceSlug?: string;
}

/** Routes under the main app shell (`_main`). */
export function recordRoutes(getParentRoute: () => AnyRoute): AnyRoute[] {
  const routes: AnyRoute[] = [];
  const add = (path: string, apiSlug: (p: RecordParams) => string) => {
    for (const suffix of ['', '/$activeTab']) {
      const route: AnyRoute = createRoute({
        getParentRoute,
        path: `${path}${suffix}`,
        component: function RecordRoute() {
          const params = useParams({ strict: false }) as RecordParams;
          return (
            <RecordPage
              apiSlug={apiSlug(params)}
              entityInstanceId={params.entityInstanceId}
              activeTab={params.activeTab}
            />
          );
        },
      });
      routes.push(route);
    }
  };
  add('company/$entityInstanceId', () => 'companies');
  add('person/$entityInstanceId', () => 'people');
  for (const slug of STANDARD) add(`${slug}/record/$entityInstanceId`, () => slug);
  add('custom/$entityApiSlug/record/$entityInstanceId', (p) => p.entityApiSlug ?? '');

  // Bare `record/` → the object's default view.
  for (const slug of STANDARD) {
    routes.push(
      createRoute({
        getParentRoute,
        path: `${slug}/record`,
        beforeLoad: ({ params }) => {
          throw redirect({ href: `/${(params as RecordParams).workspaceSlug}/${slug}`, replace: true });
        },
      }),
    );
  }
  routes.push(
    createRoute({
      getParentRoute,
      path: 'custom/$entityApiSlug/record',
      beforeLoad: ({ params }) => {
        const p = params as RecordParams;
        throw redirect({ href: `/${p.workspaceSlug}/custom/${p.entityApiSlug}`, replace: true });
      },
    }),
  );

  // Page layout editor entry points → Settings.
  const toEditor = (apiSlug: (p: RecordParams & { configurationId: string }) => string) => ({
    beforeLoad: ({ params }: { params: unknown }) => {
      const p = params as RecordParams & { configurationId: string };
      throw redirect({
        href: `/${p.workspaceSlug}/settings/data/objects/${apiSlug(p)}/record-page/${p.configurationId}`,
        replace: true,
      });
    },
  });
  for (const slug of ['companies', 'people', ...STANDARD]) {
    routes.push(createRoute({ getParentRoute, path: `${slug}/page-layout/$configurationId`, ...toEditor(() => slug) }));
  }
  routes.push(
    createRoute({
      getParentRoute,
      path: 'custom/$entityApiSlug/page-layout/$configurationId',
      ...toEditor((p) => p.entityApiSlug ?? ''),
    }),
  );
  return routes;
}

/** Routes under the settings shell. */
export function recordSettingsRoutes(getParentRoute: () => AnyRoute): AnyRoute[] {
  const editor: AnyRoute = createRoute({
    getParentRoute,
    path: 'data/objects/$apiSlug/record-page/$configurationId',
    component: function LayoutEditorRoute() {
      const { apiSlug, configurationId } = useParams({ strict: false }) as { apiSlug: string; configurationId: string };
      return <LayoutEditorPage apiSlug={apiSlug} configurationId={configurationId} />;
    },
  });
  return [editor];
}
