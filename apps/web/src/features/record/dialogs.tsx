// Record dialogs (a): "Edit {Singular}" (every editable attribute as a labelled field,
// "Finished editing ⌘↵"), "Delete {singular}" confirmation (permanent for users, soft-deleted per X-22; the page
// then goes back to the object's views) and "Choose list" → Add to list (features/lists).
import {
  AlertDialog,
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Icon,
  IconTile,
  Modal,
  toast,
} from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { objectPath } from '../../data/objects';
import { api, errorEnvelopeOf, inWorkspace } from '../../data/trpc';
import { useShortcut } from '../../lib/shortcuts';
import { isAttributeEditable, RecordAvatar } from '../attributes';
import { recordKind } from '../attributes/ui/primitives';
import { objectAppearance } from '../shell/objectAppearance';
import { useWorkspace } from '../shell/workspaceContext';
import { AddRecordToListDialog } from './adapters';
import { useRecordPage } from './context';
import { AttributeRow } from './details/AttributeRow';
import { listedAttributes } from './details/attributes';
import * as d from './details/details.css';
import { useRecordTitleText } from './title';
import * as u from './ui/ui.css';

export function EditRecordModal({ onClose }: { onClose: () => void }) {
  const { object, attributes, recordRef } = useRecordPage();
  const title = useRecordTitleText();
  const look = objectAppearance(object);
  const fields = useMemo(() => listedAttributes(attributes).filter(isAttributeEditable), [attributes]);
  useShortcut('mod+enter', onClose);
  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()} size={808} aria-label={`Edit ${object.singularNoun}`}>
      <DialogHeader
        title={`Edit ${object.singularNoun}`}
        icon={<IconTile icon={look.icon} color={look.color} size={16} />}
        onClose={onClose}
      />
      <div className={d.editHead}>
        <div className={d.editTitleRow}>
          <RecordAvatar kind={recordKind(object)} size={32} />
          <h2 className={d.editTitle}>{title.text}</h2>
        </div>
        <div className={d.editSub}>
          Viewing all of the record details for <span className={d.editSubStrong}>{title.text}</span>
        </div>
      </div>
      <div className={d.editRule} />
      <div className={d.editBody} data-allow-global-shortcuts="">
        {fields.length === 0 ? (
          <div className={d.noResults}>
            No attributes
            <br />
            This object has no attributes.
          </div>
        ) : (
          fields.map((a) => <AttributeRow key={a.id} attribute={a} recordRef={recordRef} variant="form" />)
        )}
      </div>
      <DialogFooter>
        <Button variant="primary" size={28} onPress={onClose} shortcut={['mod', 'enter']}>
          Finished editing
        </Button>
      </DialogFooter>
    </Modal>
  );
}

export function DeleteRecordDialog({ onClose }: { onClose: () => void }) {
  const { object, recordRef } = useRecordPage();
  const { workspace, href } = useWorkspace();
  const navigate = useNavigate();
  const noun = object.singularNoun.toLowerCase();
  const remove = async () => {
    onClose();
    try {
      await api.records.delete.mutate(recordRef, inWorkspace(workspace));
      toast.success(`Successfully deleted ${noun}`);
      void navigate({ href: href(objectPath(object)), replace: true });
    } catch (error) {
      toast.error({ title: `Failed to delete ${noun}`, description: errorEnvelopeOf(error).message });
    }
  };
  return (
    <AlertDialog
      isOpen
      onOpenChange={(open) => !open && onClose()}
      title={`Delete ${noun}`}
      description={`Are you sure? This will remove all references to this ${noun} from your workspace, including in lists and relationships, and will delete associated notes and tasks.`}
      confirmLabel="Delete"
      variant="danger"
      onConfirm={() => void remove()}
      onCancel={onClose}
    />
  );
}

/** "Choose list" (D, X-07; `e`): choose a list of this object, then the Add-to-list form (features/lists). */
export function ChooseListDialog({ onClose }: { onClose: () => void }) {
  const { recordRef } = useRecordPage();
  return <AddRecordToListDialog record={recordRef} onClose={onClose} />;
}
