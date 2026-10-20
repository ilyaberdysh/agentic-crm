// Object index and record routes (`/companies`, `/people`, `/<standard>`, `/custom/<slug>`, `/company/<id>`, …).
// The index page (slice 2, BACKLOG 2.01) opens a view: the bare object URL redirects to the object's first
// non-archived view (lowest sort order, C1 README §1); an object without views shows "Start with a view"; an unknown
// or archived view id falls back to the first view. Record pages live in features/record. Unknown object slugs
// redirect to the workspace root like any unknown path.
import { IconTile } from '@agentic-crm/ui';
import { Navigate, useParams, useRouterState } from '@tanstack/react-router';
import { objectPath, useObjects } from '../../data/objects';
import { ObjectUnavailable } from '../access/ObjectUnavailable';
import { ContentSpinner } from '../shell/AppShell';
import { objectAppearance } from '../shell/objectAppearance';
import { PageHeader } from '../shell/PageHeader';
import { useWorkspace } from '../shell/workspaceContext';
import { StartWithAView } from '../table/contracts';
import { useViews } from '../views';
import { ObjectPage, type PageObject, useViewNavigation } from './ObjectPage';
import * as s from './objectPage.css';

function useObjectBySlug(apiSlug: string) {
  const { workspace } = useWorkspace();
  const objects = useObjects(workspace);
  // The list holds full definitions (data/objects.ts fetches EntityDefinition rows), epithet path included.
  const object = objects.data?.find((o) => o.apiSlug === apiSlug) as PageObject | undefined;
  return { object, isPending: objects.isPending };
}

export function ObjectIndexPage({ apiSlug }: { apiSlug: string }) {
  const { href } = useWorkspace();
  const params = useParams({ strict: false }) as { entityViewId?: string };
  // Deep links (comment threads, overlays) land on the bare object URL: keep their search params on the redirect.
  const searchStr = useRouterState({ select: (st) => st.location.searchStr });
  const { object, isPending } = useObjectBySlug(apiSlug);
  const views = useViews(object?.id);
  const navigate = useViewNavigation(object ?? { apiSlug, entityType: 'custom-record' });
  if (isPending) return <ContentSpinner />;
  if (!object) return <ObjectUnavailable apiSlug={apiSlug} />;
  if (!views.data) return <ContentSpinner />;
  const look = objectAppearance(object);
  const live = views.data.filter((v) => !v.isArchived);
  if (live.length === 0) {
    return (
      <>
        <PageHeader
          crumbs={[{ label: object.pluralNoun, icon: <IconTile icon={look.icon} color={look.color} size={16} /> }]}
        />
        <div className={s.page}>
          <StartWithAView object={object} onCreated={(view) => navigate(view.id)} />
        </div>
      </>
    );
  }
  const current = live.find((v) => v.id === params.entityViewId);
  if (!current) {
    const first = live[0] as (typeof live)[number];
    return (
      <Navigate to={href(`${objectPath(object)}/view/${first.id}`)} search={searchStr ? true : undefined} replace />
    );
  }
  return <ObjectPage key={current.id} object={object} viewId={current.id} />;
}
