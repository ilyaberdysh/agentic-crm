// Record route component (BACKLOG 3.01, 3.11): resolves the object from the route, the record's
// state (live / merged / deleted / unknown) and the page layout, then renders the record. A missing or unknown
// `$activeTab` is replaced by `overview` (replace-navigation). The record overlay opened from views (features/overlays,
//) renders the same body through `RecordBody` with the tab kept in component state.
import { Skeleton } from '@agentic-crm/ui';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { type ReactNode, useCallback, useEffect, useMemo } from 'react';
import { httpStatusOf } from '../../data/trpc';
import { ObjectUnavailable } from '../access/ObjectUnavailable';
import { useWorkspace } from '../shell/workspaceContext';
import type { RecordRef } from './context';
import { useLayout, useObjectBySlug, useRecordState } from './data';
import { findTab, resolveLayout } from './layout/model';
import { isUuid, recordUrl } from './paths';
import { type RecordOverlayChrome, RecordView } from './RecordView';
import * as s from './record.css';
import { RecordStatePage } from './states/RecordStatePage';

type ObjectDef = NonNullable<ReturnType<typeof useObjectBySlug>['object']>;

export interface RecordPageProps {
  apiSlug: string;
  entityInstanceId: string;
  activeTab?: string;
}

export function RecordPage({ apiSlug, entityInstanceId, activeTab }: RecordPageProps) {
  const { object, isPending } = useObjectBySlug(apiSlug);
  if (isPending) return <PageSkeleton />;
  if (!object) return <ObjectUnavailable apiSlug={apiSlug} />;
  if (!isUuid(entityInstanceId)) return <RecordStatePage kind="not-found" />;
  return <RoutedRecord object={object} entityInstanceId={entityInstanceId} activeTab={activeTab} />;
}

function RoutedRecord({
  object,
  entityInstanceId,
  activeTab,
}: {
  object: ObjectDef;
  entityInstanceId: string;
  activeTab: string | undefined;
}) {
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const recordRef = useMemo(() => ({ entityDefinitionId: object.id, entityInstanceId }), [object.id, entityInstanceId]);
  const layout = useLayout(object.id);
  const search = useRouterState({ select: (st) => st.location.search as Record<string, unknown> });
  const initialComments =
    search['show-comments'] === 'true' || search['show-comments'] === true || search['side-panel-tab'] === 'comments';
  const basePath = recordUrl(href, object, entityInstanceId);
  const onTab = useCallback((slug: string) => void navigate({ href: `${basePath}/${slug}` }), [navigate, basePath]);

  // Unknown or missing tab → overview (replace).
  const resolved = useMemo(() => (layout.data ? resolveLayout(layout.data) : null), [layout.data]);
  const tabKnown = resolved ? findTab(resolved, activeTab) !== null : true;
  useEffect(() => {
    if (resolved && !tabKnown) {
      void navigate({
        href: `${basePath}/${resolved.overview?.slug ?? resolved.allTabs[0]?.slug ?? 'overview'}`,
        replace: true,
      });
    }
  }, [resolved, tabKnown, navigate, basePath]);

  return (
    <RecordBody
      object={object}
      recordRef={recordRef}
      activeTab={tabKnown ? activeTab : undefined}
      onTab={onTab}
      initialComments={initialComments}
      onGoToRecord={(id) => void navigate({ href: recordUrl(href, object, id, 'overview') })}
    />
  );
}

/** States, loading and the record view for a resolved object (the route page and the record overlay). */
export function RecordBody({
  object,
  recordRef,
  activeTab,
  onTab,
  initialComments,
  overlay,
  onGoToRecord,
}: {
  object: ObjectDef;
  recordRef: RecordRef;
  activeTab: string | undefined;
  onTab: (slug: string) => void;
  initialComments?: boolean;
  overlay?: RecordOverlayChrome;
  onGoToRecord: (entityInstanceId: string) => void;
}) {
  const { href } = useWorkspace();
  const state = useRecordState(recordRef);
  const layout = useLayout(object.id);
  const frame = (content: ReactNode) =>
    overlay ? (
      <div className={s.page}>
        <header className={s.overlayBar}>{overlay.navigation}</header>
        <div className={s.row}>{content}</div>
      </div>
    ) : (
      content
    );
  if (state.isError) {
    const status = httpStatusOf(state.error);
    return frame(<RecordStatePage kind={status === 403 ? 'no-access' : 'not-found'} onGoBack={overlay?.close} />);
  }
  if (!state.data || !layout.data) return <PageSkeleton bar={overlay?.navigation} />;
  const st = state.data;
  if (st.state === 'merged') {
    const into = st.mergedInto;
    return frame(
      <RecordStatePage kind="merged" onGoToRecord={into ? () => onGoToRecord(into.entityInstanceId) : undefined} />,
    );
  }
  if (st.state !== 'live') return frame(<RecordStatePage kind="not-found" onGoBack={overlay?.close} />);
  return (
    <RecordView
      key={recordRef.entityInstanceId}
      object={object}
      recordRef={recordRef}
      layout={layout.data}
      activeTab={activeTab}
      basePath={recordUrl(href, object, recordRef.entityInstanceId)}
      overlay={overlay}
      initialComments={initialComments}
      onTab={onTab}
    />
  );
}

function PageSkeleton({ bar }: { bar?: ReactNode }) {
  return (
    <div className={s.page} data-testid="record-loading">
      {bar ? (
        <header className={s.overlayBar}>{bar}</header>
      ) : (
        <div style={{ height: 49, boxShadow: 'inset 0 -1px 0 var(--ar-color-stroke-primary)' }} />
      )}
      <div className={s.row}>
        <div className={s.skeletonStack} style={{ width: 360 }}>
          <Skeleton width={180} height={20} />
          <Skeleton width={240} height={12} />
          <Skeleton width={200} height={12} />
          <Skeleton width={220} height={12} />
        </div>
        <div className={s.skeletonStack} style={{ flex: 1 }}>
          <Skeleton width={320} height={16} />
          <Skeleton width="100%" height={86} />
          <Skeleton width="100%" height={86} />
        </div>
      </div>
    </div>
  );
}
