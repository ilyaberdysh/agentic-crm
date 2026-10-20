// Routes under `/$workspaceSlug/settings` for objects administration (J README §1, objects-lists §3):
//   data/objects                     objects list
//   data/objects/$apiSlug            → …/general
//   data/objects/$apiSlug/$tab       object settings (appearance → general, integrations → app)
//   record/$apiSlug                  legacy alias → data/objects/$apiSlug/general
import { type AnyRoute, createRoute, redirect } from '@tanstack/react-router';
import { OBJECT_TAB_IDS, ObjectSettingsPage, type ObjectTabId } from './ObjectSettingsPage';
import { ObjectsListPage } from './ObjectsListPage';

const TAB_ALIASES: Record<string, ObjectTabId> = {
  appearance: 'general',
  integrations: 'app',
  configuration: 'general',
};

/** Pass the settings route (`getParentRoute`). */
export function objectSettingsRoutes(getParentRoute: () => AnyRoute): AnyRoute[] {
  const list = createRoute({ getParentRoute, path: 'data/objects', component: ObjectsListPage });

  const objectIndex = createRoute({
    getParentRoute,
    path: 'data/objects/$apiSlug',
    beforeLoad: ({ location }) => {
      throw redirect({ href: `${location.pathname.replace(/\/$/, '')}/general`, replace: true });
    },
  });

  const objectTab = createRoute({
    getParentRoute,
    path: 'data/objects/$apiSlug/$tab',
    beforeLoad: ({ params, location }) => {
      const { tab } = params as { tab: string };
      const alias = TAB_ALIASES[tab];
      if (alias || !(OBJECT_TAB_IDS as string[]).includes(tab)) {
        const base = location.pathname.slice(0, location.pathname.lastIndexOf('/'));
        throw redirect({ href: `${base}/${alias ?? 'general'}`, replace: true });
      }
    },
    component: function ObjectTabRoute() {
      const { apiSlug, tab } = objectTab.useParams() as { apiSlug: string; tab: ObjectTabId };
      return <ObjectSettingsPage apiSlug={apiSlug} tab={tab} />;
    },
  });

  const legacyRecord = createRoute({
    getParentRoute,
    path: 'record/$apiSlug',
    beforeLoad: ({ params, location }) => {
      const { apiSlug } = params as { apiSlug: string };
      const settingsBase = location.pathname.slice(0, location.pathname.indexOf('/record/'));
      throw redirect({ href: `${settingsBase}/data/objects/${apiSlug}/general`, replace: true });
    },
  });

  return [list, objectIndex, objectTab, legacyRecord];
}
