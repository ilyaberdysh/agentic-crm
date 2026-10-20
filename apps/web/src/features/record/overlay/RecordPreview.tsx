// Record preview drawer (BACKLOG 3.09; D README §2.7, C1 README §2.9; evidence D-view-preview-panel): a floating
// ~496 px panel 8 px from the viewport edges, opened from a table row's "Open preview" without changing the URL.
// Header: × · ↑ / ↓ · "{n} of {total} in {view}" · expand ("Open record"); body: avatar + title, Highlights (two
// columns), Activity (3 events, "View all"), Tasks.
import type { CustomLayout, EntityDefinition } from '@agentic-crm/contracts';
import { IconButton } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { RecordAvatar } from '../../attributes';
import { useAttributes, useObjectDefinition } from '../../attributes/data/queries';
import { recordKind } from '../../attributes/ui/primitives';
import { useWorkspace } from '../../shell/workspaceContext';
import { RecordPageContext, type RecordPageContextValue } from '../context';
import { useLayout } from '../data';
import { titleAttributeOf } from '../details/attributes';
import { resolveLayout } from '../layout/model';
import { Highlights } from '../overview/Highlights';
import { ActivityPreview, TasksSection } from '../overview/OverviewTab';
import { recordUrl } from '../paths';
import { useRecordTitleText } from '../title';
import * as s from './preview.css';
import { closeRecordPreview, openRecordPreview, type PreviewState, useRecordPreview } from './store';

/** Mounted by pages that open previews (the object page). */
export function RecordPreviewHost() {
  const state = useRecordPreview();
  useEffect(() => () => closeRecordPreview(), []);
  if (!state) return null;
  return createPortal(<PreviewLoader state={state} />, document.body);
}

function PreviewLoader({ state }: { state: PreviewState }) {
  const object = useObjectDefinition(state.object.id);
  const layout = useLayout(state.object.id);
  const { attributes } = useAttributes(state.object.id);
  if (!object || !layout.data) return <aside className={s.panel} aria-label="Record preview" />;
  return <PreviewPanel state={state} object={object} layout={layout.data} attributes={attributes} />;
}

function PreviewPanel({
  state,
  object,
  layout,
  attributes: all,
}: {
  state: PreviewState;
  object: EntityDefinition;
  layout: CustomLayout;
  attributes: ReturnType<typeof useAttributes>['attributes'];
}) {
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const attributes = useMemo(() => all.filter((a) => !a.isArchived), [all]);
  const recordRef = useMemo(
    () => ({ entityDefinitionId: object.id, entityInstanceId: state.recordId }),
    [object.id, state.recordId],
  );
  const basePath = recordUrl(href, object, state.recordId);
  const ctx = useMemo<RecordPageContextValue>(
    () => ({
      object,
      recordRef,
      layout: resolveLayout(layout),
      rawLayout: layout,
      attributes,
      titleAttribute: titleAttributeOf(object, attributes),
      basePath,
      activeTab: 'overview',
      goToTab: (slug) => {
        closeRecordPreview();
        void navigate({ href: `${basePath}/${slug}` });
      },
      inOverlay: false,
      openDialog: () => {},
    }),
    [object, recordRef, layout, attributes, basePath, navigate],
  );
  const ids = state.sequence.ids;
  const index = ids.indexOf(state.recordId);
  const go = (delta: 1 | -1) => {
    const id = ids[index + delta];
    if (id) openRecordPreview({ ...state, recordId: id });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest?.('[role="dialog"]')) closeRecordPreview();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <RecordPageContext.Provider value={ctx}>
      <aside className={s.panel} aria-label="Record preview" data-testid="record-preview">
        <div className={s.bar}>
          <IconButton icon="close" variant="ghost" size={28} aria-label="Close" onPress={closeRecordPreview} />
          <IconButton
            icon="chevronUp"
            variant="secondary"
            size={28}
            aria-label="Previous record"
            tooltip="Previous record"
            isDisabled={index <= 0}
            onPress={() => go(-1)}
          />
          <IconButton
            icon="chevronDown"
            variant="secondary"
            size={28}
            aria-label="Next record"
            tooltip="Next record"
            isDisabled={index < 0 || index >= ids.length - 1}
            onPress={() => go(1)}
          />
          <span className={s.position}>
            {index >= 0
              ? `${index + 1} of ${Math.max(state.sequence.total, ids.length)} in ${state.sequence.title}`
              : ''}
          </span>
          <IconButton
            icon="expand"
            variant="secondary"
            size={28}
            aria-label="Open record"
            tooltip="Open record"
            onPress={() => ctx.goToTab('overview')}
          />
        </div>
        <div className={s.body} key={state.recordId}>
          <PreviewTitle object={object} />
          <div className={s.sections}>
            <Highlights widgets={ctx.layout.widgets} />
            {ctx.layout.tabs.some((t) => t.kind === 'activity') && <ActivityPreview />}
            {ctx.layout.tabs.some((t) => t.kind === 'tasks') && (
              <TasksSection slug={ctx.layout.tabs.find((t) => t.kind === 'tasks')?.slug ?? 'tasks'} />
            )}
          </div>
        </div>
      </aside>
    </RecordPageContext.Provider>
  );
}

function PreviewTitle({ object }: { object: EntityDefinition }) {
  const title = useRecordTitleText();
  return (
    <div className={s.titleRow}>
      <RecordAvatar kind={recordKind(object)} size={32} />
      <h2 className={s.title}>{title.text}</h2>
    </div>
  );
}
