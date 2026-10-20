// Entries as table rows (C2 README §2.2; A §4.4): the record column of a list table shows each entry's parent record
// (avatar + name, a link to the record page); opening a row opens the parent record in the record overlay (J / K
// through the view's parents), "Open preview" previews the parent record. Parents come from the entry's
// `parent_record` value (normalised values cache, batched like every cell).
import type { AttributeDefinition, EntityDefinition, RecordRef } from '@agentic-crm/contracts';
import { Skeleton } from '@agentic-crm/ui';
import { createContext, useCallback, useContext } from 'react';
import { keys } from '../../data/keys';
import { queryClient } from '../../data/queryClient';
import type { WorkspaceRef } from '../../data/trpc';
import { RecordAvatar, recordPath, useRecordTitle } from '../attributes';
import { cacheLookup } from '../attributes/data/queries';
import { recordKind } from '../attributes/ui/primitives';
import { openRecordOverlay } from '../overlays';
import { openRecordPreview } from '../record/overlay/store';
import { useWorkspace } from '../shell/workspaceContext';
import * as ts from '../table/table.css';
import { cachedValues, useRecordValues } from '../table/values';
import type { List } from './data';

/** The parent record of an entry from its `parent_record` values. */
export function parentOf(values: readonly { value?: unknown }[] | undefined): RecordRef | null {
  const v = values?.[0]?.value as { entityDefinitionId?: unknown; entityInstanceId?: unknown } | undefined;
  return v && typeof v.entityDefinitionId === 'string' && typeof v.entityInstanceId === 'string'
    ? { entityDefinitionId: v.entityDefinitionId, entityInstanceId: v.entityInstanceId }
    : null;
}

/** Parents of entries already in the cache (rows the table has shown), in the given order. */
export function entryParents(
  ws: WorkspaceRef,
  listId: string,
  parentAttributeId: string | undefined,
  entryIds: readonly string[],
): RecordRef[] {
  if (!parentAttributeId) return [];
  return entryIds
    .map((id) => parentOf(cachedValues(ws, listId, parentAttributeId, id)))
    .filter((r): r is RecordRef => r !== null);
}

export function entryParentCopyText(
  ws: WorkspaceRef,
  listId: string,
  parentAttributeId: string,
  entryId: string,
): string | undefined {
  const parent = parentOf(cachedValues(ws, listId, parentAttributeId, entryId));
  if (!parent) return undefined;
  return cacheLookup(ws.id).recordTitle(parent.entityDefinitionId, parent.entityInstanceId);
}

/** Which list the entry cells belong to (the table hands the cell slot only the row id). */
export interface EntryRowsContextValue {
  listId: string;
  parentAttributeId: string | undefined;
}

export const EntryRowsContext = createContext<EntryRowsContextValue>({ listId: '', parentAttributeId: undefined });

function useEntryContext() {
  const { workspace } = useWorkspace();
  return { workspace, ...useContext(EntryRowsContext) };
}

/** Record cell of an entry row: the parent record's avatar and name. */
export function EntryParentCell({ rowId, live, onOpen }: { rowId: string; live: boolean; onOpen: () => void }) {
  const { workspace, listId, parentAttributeId } = useEntryContext();
  const cell = useRecordValues(workspace, listId, parentAttributeId, rowId, live);
  const values = live
    ? cell.values
    : parentAttributeId
      ? cachedValues(workspace, listId, parentAttributeId, rowId)
      : undefined;
  const parent = parentOf(values);
  if (!parent) {
    return values === undefined ? <Skeleton width={120} height={12} className={ts.skeleton} /> : null;
  }
  return <ParentLink parent={parent} onOpen={onOpen} />;
}

function ParentLink({ parent, onOpen }: { parent: RecordRef; onOpen: () => void }) {
  const { workspace } = useWorkspace();
  const { title, definition, isLoading } = useRecordTitle(parent.entityDefinitionId, parent.entityInstanceId);
  const href = recordPath(workspace.slug, definition, parent.entityInstanceId) ?? '#';
  return (
    <a
      href={href}
      className={ts.recordTitle}
      data-testid="entry-parent"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        onOpen();
      }}
    >
      <RecordAvatar kind={recordKind(definition)} size={16} />
      {isLoading ? (
        <Skeleton width={96} height={12} className={ts.skeleton} />
      ) : (
        <span className={ts.recordTitleText}>{title || 'Untitled record'}</span>
      )}
    </a>
  );
}

/** Opens / previews the parent record of an entry row (the record overlay walks the view's parents). */
export function useEntryRowActions(list: List, parentAttribute: AttributeDefinition | undefined, viewTitle: string) {
  const { workspace } = useWorkspace();
  const parents = useCallback(
    (ids: readonly string[]) => entryParents(workspace, list.id, parentAttribute?.id, ids),
    [workspace, list.id, parentAttribute?.id],
  );
  const open = useCallback(
    (entryId: string, rowIds: string[]) => {
      const parent = parents([entryId])[0];
      if (!parent) return;
      openRecordOverlay(parent, { list: { label: viewTitle, records: parents(rowIds) } });
    },
    [parents, viewTitle],
  );
  const preview = useCallback(
    (entryId: string, rowIds: string[]) => {
      const parent = parents([entryId])[0];
      if (!parent) return;
      const object = queryClient.getQueryData<EntityDefinition>(keys.object(workspace.id, parent.entityDefinitionId));
      if (!object) return;
      const ids = parents(rowIds)
        .filter((p) => p.entityDefinitionId === parent.entityDefinitionId)
        .map((p) => p.entityInstanceId);
      openRecordPreview({
        object,
        recordId: parent.entityInstanceId,
        sequence: {
          ids,
          total: ids.length,
          title: viewTitle,
          returnTo: `${window.location.pathname}${window.location.search}`,
        },
      });
    },
    [parents, viewTitle, workspace.id],
  );
  return { open, preview };
}
