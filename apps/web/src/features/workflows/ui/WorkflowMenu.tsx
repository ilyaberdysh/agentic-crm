// Workflow menu (README §3.4): header ⋮ and index row ⋮. Duplicate workflow (confirm → "Copy of …" draft, the editor
// opens on the copy), Archive / Restore workflow, Add to / Remove from favorites (header only), Delete workflow (red;
// disabled once the workflow has run or while it is live) or Discard workflow for an untouched transient draft.

import { AlertDialog, Menu, MenuItem, MenuSeparator, MenuTrigger, toast } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { type ReactElement, useState } from 'react';
import { useFavoriteToggle } from '../../favorites/data';
import { useWorkspace } from '../../shell/workspaceContext';
import { deleteWorkflow, duplicateWorkflow, updateWorkflow, useWs } from '../data';
import { editorPath, workflowsPath } from '../paths';
import type { Workflow } from '../types';

type Confirm = 'duplicate' | 'delete' | 'archive' | null;

export function deleteBlockedReason(w: Pick<Workflow, 'status' | 'runCount'>): string | null {
  if (w.status === 'live') return 'You must disable this workflow before deleting it';
  if (w.runCount > 0) return 'Workflows that have been run cannot be deleted';
  return null;
}

/** The ⋮ menu and its confirmations. `trigger` is the pressable that opens the menu. */
export function WorkflowMenu({
  workflow,
  trigger,
  header = false,
  onOpenChange,
}: {
  workflow: Workflow;
  trigger: ReactElement;
  header?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const ws = useWs();
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const favorite = useFavoriteToggle({ favoriteType: 'workflow', targetId: workflow.id });
  const blocked = deleteBlockedReason(workflow);
  const transient = workflow.isTransient;

  const onAction = (key: string) => {
    switch (key) {
      case 'duplicate':
        setConfirm('duplicate');
        return;
      case 'archive':
        if (header) setConfirm('archive');
        else void updateWorkflow(ws, workflow.id, { isArchived: true }, 'Failed to archive workflow');
        return;
      case 'restore':
        void updateWorkflow(ws, workflow.id, { isArchived: false }, 'Failed to restore workflow');
        return;
      case 'favorite':
        favorite.toggle();
        return;
      case 'delete':
        setConfirm('delete');
        return;
      case 'discard':
        void deleteWorkflow(ws, workflow.id, 'Failed to discard workflow').then((ok) => {
          if (ok) void navigate({ href: href(workflowsPath()) });
        });
        return;
    }
  };

  return (
    <>
      <MenuTriggerWrap trigger={trigger} onOpenChange={onOpenChange}>
        <Menu aria-label="Workflow menu" placement="bottom end" width={240} onAction={(k) => onAction(String(k))}>
          {transient ? (
            <MenuItem id="discard" icon="delete" variant="danger">
              Discard workflow
            </MenuItem>
          ) : (
            <>
              <MenuItem id="duplicate" icon="copy">
                Duplicate workflow
              </MenuItem>
              {workflow.isArchived ? (
                <MenuItem id="restore" icon="undo">
                  Restore workflow
                </MenuItem>
              ) : (
                <MenuItem id="archive" icon="folder">
                  Archive workflow
                </MenuItem>
              )}
              {header && <MenuSeparator />}
              {header && (
                <MenuItem id="favorite" icon={favorite.isFavorite ? 'favoriteRemove' : 'favorite'}>
                  {favorite.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem
                id="delete"
                icon="delete"
                variant="danger"
                isDisabled={blocked !== null}
                description={blocked ?? undefined}
              >
                Delete workflow
              </MenuItem>
            </>
          )}
        </Menu>
      </MenuTriggerWrap>
      <AlertDialog
        isOpen={confirm === 'duplicate'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Are you sure you want to duplicate this workflow?"
        confirmLabel="Duplicate"
        variant="primary"
        onConfirm={() => {
          setConfirm(null);
          void duplicateWorkflow(ws, workflow.id).then((copy) => {
            if (copy) void navigate({ href: href(editorPath(copy.id)) });
          });
        }}
      />
      <AlertDialog
        isOpen={confirm === 'archive'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Are you sure you want to archive this workflow?"
        description="This will pause the workflow, it can be restored at any time. Ongoing runs are not affected by this change."
        confirmLabel="Archive"
        variant="primary"
        onConfirm={() => {
          setConfirm(null);
          void updateWorkflow(ws, workflow.id, { isArchived: true }, 'Failed to archive workflow').then((w) => {
            if (w) toast.success('Workflow archived');
          });
        }}
      />
      <AlertDialog
        isOpen={confirm === 'delete'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Are you sure you want to delete this workflow?"
        description="This cannot be undone"
        confirmLabel="Delete"
        onConfirm={() => {
          setConfirm(null);
          void deleteWorkflow(ws, workflow.id).then((ok) => {
            if (ok && header) void navigate({ href: href(workflowsPath()) });
          });
        }}
      />
    </>
  );
}

function MenuTriggerWrap({
  trigger,
  children,
  onOpenChange,
}: {
  trigger: ReactElement;
  children: ReactElement;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <MenuTrigger onOpenChange={onOpenChange}>
      {trigger}
      {children}
    </MenuTrigger>
  );
}
