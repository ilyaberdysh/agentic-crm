// Add-to-list flows outside the list page (B, C) and the dialogs that any page may open:
// AddRecordToListDialog record page "Add to list" / Lists "+" / `e`: Choose list → Add-to-list form (X-07)
// BulkAddToList table / board bulk bar "Add to list": Choose list → "Checking for duplicate entries" →
// "Duplicate entries" (skip or create duplicates) → "Adding n records to list" → "Added n
// record(s) to list · Go to list"
// RemoveEntriesDialog "Remove record from list" / "Remove n records from list"
// Opened through `openListsDialog(…)` and rendered by <ListsHost/> (mounted once in the UI shell), or rendered in
// place by the owner of the trigger.
import type { RecordRef } from '@agentic-crm/contracts';
import { AlertDialog, Checkbox, Icon, toast } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { errorEnvelopeOf, type WorkspaceRef } from '../../data/trpc';
import { useWorkspace } from '../shell/workspaceContext';
import { AddToListForm } from './AddToListForm';
import { ChooseListDialog } from './ChooseListDialog';
import { CreateListDialog } from './CreateListDialog';
import { addEntries, checkDuplicates, type List, removeEntries } from './data';
import * as s from './lists.css';

/** `/<ws>/collection/<id>` (redirects to the list's first view). */
export function listPath(list: Pick<List, 'id'>): string {
  return `collection/${list.id}`;
}

// ---- record page ----------------------------------------------------------------------------------------------------

export function AddRecordToListDialog({ record, onClose }: { record: RecordRef; onClose: () => void }) {
  const [step, setStep] = useState<{ kind: 'choose' } | { kind: 'create' } | { kind: 'form'; list: List }>({
    kind: 'choose',
  });
  if (step.kind === 'create') {
    return (
      <CreateListDialog
        parentEntityDefinitionId={record.entityDefinitionId}
        onClose={() => setStep({ kind: 'choose' })}
        onCreated={(list) => setStep({ kind: 'form', list })}
      />
    );
  }
  if (step.kind === 'form') {
    return (
      <AddToListForm list={step.list} record={record} onBack={() => setStep({ kind: 'choose' })} onClose={onClose} />
    );
  }
  return (
    <ChooseListDialog
      objectId={record.entityDefinitionId}
      record={record}
      onPick={(list) => setStep({ kind: 'form', list })}
      onCreate={() => setStep({ kind: 'create' })}
      onClose={onClose}
    />
  );
}

// ---- bulk -------------------------------------------------------------------------------------------------------------

export function duplicateEntriesSummary(duplicates: number): string {
  return duplicates === 1 ? '1 record is already in this list' : `${duplicates} records are already in this list`;
}

/** Records to add: all of them with "Create duplicate list entries", else those not in the list yet. */
export function bulkAddCount(total: number, duplicates: number, createDuplicates: boolean): number {
  return createDuplicates ? total : total - duplicates;
}

async function runBulkAdd(
  ws: WorkspaceRef,
  list: List,
  records: RecordRef[],
  createDuplicates: boolean,
  duplicates: number,
  goToList: () => void,
): Promise<void> {
  const n = bulkAddCount(records.length, duplicates, createDuplicates);
  if (n <= 0) return;
  const progress = toast({
    title: list.name,
    description: `Adding ${n.toLocaleString()} ${n === 1 ? 'record' : 'records'} to list`,
    icon: 'spinner',
    durationMs: Number.POSITIVE_INFINITY,
    dismissable: false,
  });
  try {
    const result = await addEntries(ws, {
      listId: list.id,
      parentRecords: records,
      onDuplicate: createDuplicates ? 'keep' : 'skip',
    });
    toast.dismiss(progress);
    const added = result.entryIds.length || n;
    toast.success({
      title: list.name,
      description: `Added ${added.toLocaleString()} ${added === 1 ? 'record' : 'records'} to list`,
      action: { label: 'Go to list', style: 'button', onAction: goToList },
    });
  } catch (error) {
    toast.dismiss(progress);
    toast.error({ title: 'Failed to add records to list', description: errorEnvelopeOf(error).message });
  }
}

export function BulkAddToList({
  objectId,
  records,
  onClose,
  onDone,
}: {
  objectId: string;
  records: RecordRef[];
  onClose: () => void;
  /** After the entries were written (clear the selection). */
  onDone?: () => void;
}) {
  const { workspace, href } = useWorkspace();
  const navigate = useNavigate();
  const [step, setStep] = useState<
    | { kind: 'choose' }
    | { kind: 'create' }
    | { kind: 'checking' }
    | { kind: 'confirm'; list: List; duplicates: number; toastId: string }
  >({ kind: 'choose' });
  const [createDuplicates, setCreateDuplicates] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    // Set on every mount: StrictMode runs the cleanup once before the real mount.
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const go = (list: List) => () => void navigate({ href: href(listPath(list)) });

  const pick = async (list: List) => {
    setStep({ kind: 'checking' });
    const checking = toast({
      title: list.name,
      description: 'Checking for duplicate entries',
      icon: 'info',
      durationMs: Number.POSITIVE_INFINITY,
    });
    let duplicates = 0;
    try {
      const found = await checkDuplicates(workspace, list.id, records);
      duplicates = records.filter((r) => (found.get(r.entityInstanceId)?.length ?? 0) > 0).length;
    } catch (error) {
      toast.dismiss(checking);
      toast.error({ title: 'Failed to add records to list', description: errorEnvelopeOf(error).message });
      onClose();
      return;
    }
    if (!alive.current) {
      toast.dismiss(checking);
      return;
    }
    if (duplicates > 0) {
      // The "Checking for duplicate entries" toast stays up beside the dialog (bulk-add-duplicate-entries.png).
      setStep({ kind: 'confirm', list, duplicates, toastId: checking });
      return;
    }
    toast.dismiss(checking);
    onClose();
    await runBulkAdd(workspace, list, records, false, 0, go(list));
    onDone?.();
  };

  if (step.kind === 'create') {
    return (
      <CreateListDialog
        parentEntityDefinitionId={objectId}
        onClose={() => setStep({ kind: 'choose' })}
        onCreated={(list) => void pick(list)}
      />
    );
  }
  if (step.kind === 'choose') {
    return (
      <ChooseListDialog
        objectId={objectId}
        onPick={(list) => void pick(list)}
        onCreate={() => setStep({ kind: 'create' })}
        onClose={onClose}
      />
    );
  }
  if (step.kind === 'checking') return null;
  const count = bulkAddCount(records.length, step.duplicates, createDuplicates);
  return (
    <AlertDialog
      isOpen
      onOpenChange={(open) => {
        if (open) return;
        toast.dismiss(step.toastId);
        onClose();
      }}
      title="Duplicate entries"
      description="Some of the selected records are already in this list. You can skip adding these records or create duplicate list entries for them."
      confirmLabel={`Add to list (${count.toLocaleString()})`}
      variant="primary"
      onCancel={() => {
        toast.dismiss(step.toastId);
        onClose();
      }}
      onConfirm={() => {
        const { list, duplicates, toastId } = step;
        toast.dismiss(toastId);
        onClose();
        void runBulkAdd(workspace, list, records, createDuplicates, duplicates, go(list)).then(() => onDone?.());
      }}
    >
      <div className={s.dupBox} data-testid="duplicate-entries-box">
        <div className={s.dupHead}>
          <Icon icon="info" size={16} />
          {duplicateEntriesSummary(step.duplicates)}
        </div>
        <div className={s.dupCheck}>
          <Checkbox isSelected={createDuplicates} onChange={setCreateDuplicates}>
            Create duplicate list entries
          </Checkbox>
        </div>
      </div>
    </AlertDialog>
  );
}

// ---- remove ------------------------------------------------------------------------------------------------------------

export function RemoveEntriesDialog({
  list,
  entryIds,
  parents = [],
  onClose,
  onRemoved,
}: {
  list: Pick<List, 'id' | 'name'>;
  entryIds: string[];
  parents?: RecordRef[];
  onClose: () => void;
  onRemoved?: () => void;
}) {
  const { workspace } = useWorkspace();
  const n = entryIds.length;
  const remove = async () => {
    onClose();
    const progress = toast({
      title: n === 1 ? 'Removing record' : `Removing ${n.toLocaleString()} records`,
      icon: 'spinner',
      durationMs: Number.POSITIVE_INFINITY,
      dismissable: false,
    });
    try {
      await removeEntries(workspace, list.id, entryIds, parents);
      toast.dismiss(progress);
      toast.success(
        n === 1 ? 'Successfully removed record from list' : `Successfully removed ${n.toLocaleString()} records`,
      );
      onRemoved?.();
    } catch (error) {
      toast.dismiss(progress);
      toast.error({
        title: n === 1 ? 'Failed to remove record from list' : 'Failed to remove records from list',
        description: errorEnvelopeOf(error).message,
      });
    }
  };
  return (
    <AlertDialog
      isOpen
      onOpenChange={(open) => !open && onClose()}
      title={n === 1 ? 'Remove record from list' : `Remove ${n.toLocaleString()} records from list`}
      description={
        n === 1
          ? "Are you sure? This will delete the record's list attribute data."
          : 'Are you sure? Removing records will also delete their list attribute data.'
      }
      confirmLabel="Remove from list"
      variant="danger"
      onCancel={onClose}
      onConfirm={() => void remove()}
    />
  );
}

// ---- dialogs any page can open (rendered by <ListsHost/>) -----------------------------------------------------------

export type ListsDialogRequest =
  | { kind: 'create-list'; parentEntityDefinitionId?: string; then?: 'open-list' | 'open-settings' | 'none' }
  | { kind: 'bulk-add'; objectId: string; records: RecordRef[]; onDone?: () => void }
  | { kind: 'add-record'; record: RecordRef };

let current: ListsDialogRequest | null = null;
const listeners = new Set<() => void>();

export function openListsDialog(request: ListsDialogRequest): void {
  current = request;
  for (const l of listeners) l();
}

function closeListsDialog(): void {
  current = null;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Mounted once in the UI shell (next to the overlay host). */
export function ListsHost() {
  const request = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  const { href } = useWorkspace();
  const navigate = useNavigate();
  if (!request) return null;
  switch (request.kind) {
    case 'create-list':
      return (
        <CreateListDialog
          parentEntityDefinitionId={request.parentEntityDefinitionId}
          onClose={closeListsDialog}
          onCreated={(list) => {
            if (request.then === 'none') return;
            const path = request.then === 'open-settings' ? `settings/data/lists/${list.id}/general` : listPath(list);
            void navigate({ href: href(path) });
          }}
        />
      );
    case 'bulk-add':
      return (
        <BulkAddToList
          objectId={request.objectId}
          records={request.records}
          onClose={closeListsDialog}
          onDone={request.onDone}
        />
      );
    case 'add-record':
      return <AddRecordToListDialog record={request.record} onClose={closeListsDialog} />;
  }
}
