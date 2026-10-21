// "Edit entry" (U-C2-12, A.2 "Edit entry ↵"; raw C2 s89-edit-entry): breadcrumb "<record> / Edit
// list entry", the record's avatar and name, "Added to <list> <time ago>", then every writable list attribute as a
// labelled field edited in place (each change saves at once through the normal value write path), footer "Finished
// editing ⌘↵".
import type { RecordRef } from '@agentic-crm/contracts';
import { Button, DialogFooter, IconButton, Modal } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Heading } from 'react-aria-components';
import { recordQuery } from '../../data/records';
import { useShortcut } from '../../lib/shortcuts';
import { RecordAvatar, useRecordTitle } from '../attributes';
import { recordKind } from '../attributes/ui/primitives';
import { timeAgo } from '../comments/timeAgo';
import { AttributeRow } from '../record/details/AttributeRow';
import * as d from '../record/details/details.css';
import { useWorkspace } from '../shell/workspaceContext';
import { type List, useListAttributes, writableListAttributes } from './data';
import * as s from './lists.css';
import { Crumbs } from './PickerDialog';
import { RecordName } from './parts';

export function EditEntryDialog({
  list,
  entryId,
  parent,
  onClose,
}: {
  list: Pick<List, 'id' | 'name'>;
  entryId: string;
  parent: RecordRef;
  onClose: () => void;
}) {
  const { workspace } = useWorkspace();
  const attributes = useListAttributes(workspace, list.id);
  const fields = useMemo(() => writableListAttributes(attributes.data ?? []), [attributes.data]);
  const entryRef = useMemo(() => ({ entityDefinitionId: list.id, entityInstanceId: entryId }), [list.id, entryId]);
  const header = useQuery(recordQuery({ workspace, ...entryRef }));
  const { title, definition } = useRecordTitle(parent.entityDefinitionId, parent.entityInstanceId);
  useShortcut('mod+enter', onClose);
  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()} size="large" aria-label="Edit list entry">
      <div className={s.pickerHeader} data-testid="edit-entry-dialog">
        <Heading slot="title" className={s.crumbs}>
          <Crumbs
            parts={[
              <span key="r" className={`${s.crumbMuted} ${s.crumbSmall}`}>
                <RecordName record={parent} muted />
              </span>,
              <span key="e" className={s.crumbSmall}>
                Edit list entry
              </span>,
            ]}
          />
        </Heading>
        <IconButton icon="close" aria-label="Close" size={28} onPress={onClose} />
      </div>
      <div className={d.editHead}>
        <div className={d.editTitleRow}>
          <RecordAvatar kind={recordKind(definition)} size={32} />
          <h2 className={d.editTitle}>{title || 'Untitled record'}</h2>
        </div>
        <div className={d.editSub}>
          Added to <span className={d.editSubStrong}>{list.name}</span>
          {header.data?.createdAt ? ` ${timeAgo(header.data.createdAt)}` : ''}
        </div>
      </div>
      <div className={d.editBody} data-allow-global-shortcuts="">
        {fields.length === 0 && !attributes.isPending ? (
          <div className={d.noResults}>This list has no attributes yet.</div>
        ) : (
          fields.map((a) => <AttributeRow key={a.id} attribute={a} recordRef={entryRef} variant="form" />)
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
