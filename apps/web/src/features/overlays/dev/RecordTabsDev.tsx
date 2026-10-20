// Dev-only harness for the E3 record-page contents until features/record mounts them: `/$ws/__dev/record-tabs
// ?object=<object id or slug>&record=<record id>` renders the Notes and Tasks tabs and the 320 px comments panel the
// way the record page lays them out (tab content left, comments panel right). Used by e2e and parity runs.
import { useRouterState } from '@tanstack/react-router';
import { useObjects } from '../../../data/objects';
import { RecordCommentsPanel } from '../../comments/CommentsPanel';
import { RecordNotesTab } from '../../notes/RecordNotesTab';
import { PageHeader } from '../../shell/PageHeader';
import { useWorkspace } from '../../shell/workspaceContext';
import { RecordTasksTab } from '../../tasks/RecordTasksTab';

export function RecordTabsDev() {
  const { workspace } = useWorkspace();
  const search = useRouterState({ select: (s) => s.location.search }) as unknown as Record<string, string>;
  const objects = useObjects(workspace).data ?? [];
  const object = objects.find((o) => o.id === search.object || o.apiSlug === search.object);
  if (!object || !search.record) return <PageHeader crumbs={[{ label: 'Record tabs (dev)' }]} />;
  const recordRef = { entityDefinitionId: object.id, entityInstanceId: search.record };
  return (
    <>
      <PageHeader crumbs={[{ label: object.pluralNoun }, { label: 'Record tabs (dev)' }]} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
          <RecordNotesTab recordRef={recordRef} />
          <RecordTasksTab recordRef={recordRef} />
        </div>
        <RecordCommentsPanel recordRef={recordRef} />
      </div>
    </>
  );
}
