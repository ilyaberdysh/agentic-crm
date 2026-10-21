// Bulk action bar: floating pill centred at the
// bottom of the table — "[n] Selected ×" · Add to list · Send email · Run workflow · More ⌄ (Export as CSV, Delete
// records). Delete confirms ("Delete {n} {plural}"), resolves the selection to the exact snapshot ids and deletes them
// with a progress toast. While rows are selected the snapshot is frozen; a view change shows the banner.

import { DELETE_SELECTION_MAX_ROWS, zebraSize } from '@agentic-crm/contracts';
import { AlertDialog, Button, Icon, Menu, MenuItem, MenuSeparator, MenuTrigger, toast } from '@agentic-crm/ui';
import { useState } from 'react';
import { api, errorEnvelopeOf, inWorkspace, type WorkspaceRef } from '../../data/trpc';
import { sliceZebra } from './selection';
import * as s from './table.css';

export interface BulkBarProps {
  count: number;
  singularNoun: string;
  pluralNoun: string;
  viewChanged: boolean;
  /** Rows fill the viewport: the footer is pinned at the bottom, so the bar floats above it. */
  raised: boolean;
  onClear(): void;
  onDelete(): Promise<void>;
  /** The member may delete (records) / remove (entries); false hides the item (Read only access). */
  canDelete?: boolean;
  onExport(): void;
  /** "Add to list" (features/lists); without it the action is a placeholder. */
  onAddToList?: () => void;
  /** "Send email" (features/composer: a mass-send draft to the selected people); without it a placeholder. */
  onSendEmail?: () => void;
  /** "Run workflow" (features/workflows: the Select workflow dialog). */
  onRunWorkflow?: () => void;
  /** Replaces "Delete records" (list tables: "Remove from list", confirmed by the caller). */
  remove?: { label: string; run: () => void };
}

const later = (what: string) => () => toast({ title: what, description: 'Arrives in a later slice.' });

export function BulkBar({
  count,
  singularNoun,
  pluralNoun,
  viewChanged,
  raised,
  onClear,
  onDelete,
  canDelete = true,
  onExport,
  onAddToList,
  onSendEmail,
  onRunWorkflow,
  remove,
}: BulkBarProps) {
  const lift = raised ? 37 : 0;
  const [confirming, setConfirming] = useState(false);
  const plural = pluralNoun.toLowerCase();
  const singular = singularNoun.toLowerCase();
  return (
    <>
      {viewChanged && (
        <div className={s.frozenBanner} role="status" data-testid="frozen-banner" style={{ bottom: 86 + lift }}>
          <Icon icon="info" size={16} />
          View has changed. Clear selection to update.
          <Button variant="secondary" size={20} onPress={onClear}>
            Clear selection
          </Button>
        </div>
      )}
      <div
        className={s.bulkBar}
        role="toolbar"
        aria-label="Bulk actions"
        data-testid="bulk-bar"
        style={{ bottom: 30 + lift }}
      >
        <span className={s.bulkCount}>
          <span className={s.bulkBadge}>{count.toLocaleString()}</span>
          Selected
          <button
            type="button"
            className={s.bulkClear}
            aria-label={`Clear selection, ${count} selected`}
            onClick={onClear}
          >
            <Icon icon="close" size={14} />
          </button>
        </span>
        <span className={s.bulkDivider} />
        <span className={s.bulkActions}>
          <Button variant="secondary" size={32} icon="list" onPress={onAddToList ?? later('Add to list')}>
            Add to list
          </Button>
          <Button variant="secondary" size={32} icon="emails" onPress={onSendEmail ?? later('Send email')}>
            Send email
          </Button>
          <Button variant="secondary" size={32} icon="workflows" onPress={onRunWorkflow ?? later('Run workflow')}>
            Run workflow
          </Button>
          <MenuTrigger>
            <Button variant="secondary" size={32} chevron>
              More
            </Button>
            <Menu
              aria-label="More bulk actions"
              placement="top end"
              width={220}
              onAction={(key) => {
                if (key === 'export') onExport();
                if (key === 'delete') setConfirming(true);
                if (key === 'remove') remove?.run();
              }}
            >
              <MenuItem id="export" icon="export">
                Export as CSV
              </MenuItem>
              {canDelete && <MenuSeparator />}
              {!canDelete ? null : remove ? (
                <MenuItem id="remove" icon="delete" variant="danger">
                  {remove.label}
                </MenuItem>
              ) : (
                <MenuItem id="delete" icon="delete" variant="danger">
                  {count === 1 ? 'Delete record' : 'Delete records'}
                </MenuItem>
              )}
            </Menu>
          </MenuTrigger>
        </span>
      </div>
      <AlertDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title={count === 1 ? `Delete ${singular}` : `Delete ${count.toLocaleString()} ${plural}`}
        description={`Are you sure? This will remove all references to ${
          count === 1 ? `this ${singular}` : `these ${plural}`
        } from your workspace, including in lists and relationships, and will delete associated notes and tasks`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          setConfirming(false);
          void onDelete();
        }}
      />
    </>
  );
}

/**
 * Deletes the selected rows of the frozen snapshot through `records.deleteSelection` (server-side, one transaction
 * per slice of ≤ 500 rows) with a progress toast; returns the deleted ids in snapshot order.
 */
export async function deleteSelection(input: {
  workspace: WorkspaceRef;
  entityDefinitionId: string;
  snapshotId: string;
  zebraEdges: number[];
  singularNoun: string;
  pluralNoun: string;
}): Promise<string[]> {
  const total = zebraSize(input.zebraEdges);
  const noun = total === 1 ? input.singularNoun.toLowerCase() : input.pluralNoun.toLowerCase();
  const label = total === 1 ? noun : `${total.toLocaleString()} ${noun}`;
  const toastId = toast({
    title: `Deleting ${label}`,
    progress: 0,
    durationMs: Number.POSITIVE_INFINITY,
    dismissable: false,
    icon: 'spinner',
  });
  const deleted: string[] = [];
  let done = 0;
  try {
    for (const slice of sliceZebra(input.zebraEdges, DELETE_SELECTION_MAX_ROWS)) {
      const result = await api.records.deleteSelection.mutate(
        { entityDefinitionId: input.entityDefinitionId, snapshotId: input.snapshotId, zebraEdges: slice },
        inWorkspace(input.workspace),
      );
      deleted.push(...result.deletedIds);
      done += zebraSize(slice);
      toast.update(toastId, { progress: done / Math.max(1, total) });
    }
    toast.dismiss(toastId);
    toast.success(`Successfully deleted ${label}`);
  } catch (error) {
    toast.dismiss(toastId);
    toast.error({
      title: `Failed to delete ${(total - deleted.length).toLocaleString()} of ${total.toLocaleString()}`,
      description: errorEnvelopeOf(error).message,
    });
  }
  return deleted;
}
