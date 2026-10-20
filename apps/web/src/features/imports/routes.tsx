// Import wizard routes (C2 README §1, import.md §I1), one family per destination prefix:
//   /$ws/{companies|people|deals|users|workspaces}/import[/…]   /$ws/custom/$entityApiSlug/import[/…]
//   /$ws/collection/$collectionId/import[/…]
//   /$ws/settings/data/objects/$apiSlug/imports/import[/…]       /$ws/settings/data/lists/$listId/imports/import[/…]
// `…/import` redirects to `…/import/new`; the rest (`new`, `{mapping}/job/{job}/{step}[/{param}]`) is parsed by the wizard.
import { type AnyRoute, createRoute, redirect } from '@tanstack/react-router';
import { standardObjectSlugs } from '../shell/navigation';
import type { DestinationRef } from './wizard/destination';
import { ImportWizard } from './wizard/ImportWizard';

type Params = Record<string, string>;

function family(
  getParentRoute: () => AnyRoute,
  prefix: string,
  destination: (params: Params) => DestinationRef,
  base: (params: Params) => string,
): AnyRoute[] {
  const bare = createRoute({
    getParentRoute,
    path: `${prefix}/import`,
    beforeLoad: ({ location }) => {
      throw redirect({ href: `${location.pathname.replace(/\/$/, '')}/new`, replace: true });
    },
  });
  const splat = createRoute({
    getParentRoute,
    path: `${prefix}/import/$`,
    component: function ImportRoute() {
      const params = splat.useParams() as Params;
      return <ImportWizard destination={destination(params)} base={base(params)} splat={params._splat ?? ''} />;
    },
  });
  return [bare, splat];
}

/** Routes under the main app shell (pass `mainRoute`). */
export function importRoutes(getParentRoute: () => AnyRoute): AnyRoute[] {
  return [
    ...standardObjectSlugs.flatMap((slug) =>
      family(
        getParentRoute,
        slug,
        () => ({ kind: 'object', apiSlug: slug }),
        () => slug,
      ),
    ),
    ...family(
      getParentRoute,
      'custom/$entityApiSlug',
      (p) => ({ kind: 'object', apiSlug: p.entityApiSlug as string }),
      (p) => `custom/${p.entityApiSlug}`,
    ),
    ...family(
      getParentRoute,
      'collection/$collectionId',
      (p) => ({ kind: 'list', listId: p.collectionId as string }),
      (p) => `collection/${p.collectionId}`,
    ),
  ];
}

/** Routes under settings (pass the settings route). */
export function importSettingsRoutes(getParentRoute: () => AnyRoute): AnyRoute[] {
  return [
    ...family(
      getParentRoute,
      'data/objects/$apiSlug/imports',
      (p) => ({ kind: 'object', apiSlug: p.apiSlug as string }),
      (p) => `settings/data/objects/${p.apiSlug}/imports`,
    ),
    ...family(
      getParentRoute,
      'data/lists/$listId/imports',
      (p) => ({ kind: 'list', listId: p.listId as string }),
      (p) => `settings/data/lists/${p.listId}/imports`,
    ),
  ];
}
