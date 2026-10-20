// Card "Edit" (pencil, C2): on a list board "Edit entry" — breadcrumb "<record> / Edit list entry", one
// labelled field per list attribute, "Finished editing ⌘↵"; on an object board "Edit <singular>" with the record's
// editable attributes. Fields are the record page's form rows (features/record AttributeRow, variant "form"). The list
// page may pass its own dialog through KanbanBoard's `onEditCard`.
import { Button, DialogFooter, DialogHeader, Icon, IconTile, Modal } from '@agentic-crm/ui';
import { useMemo } from 'react';
import { useShortcut } from '../../lib/shortcuts';
import { isAttributeEditable, RecordAvatar, useRecordTitle } from '../attributes';
import { recordKind } from '../attributes/ui/primitives';
import { AttributeRow } from '../record/details/AttributeRow';
import { listedAttributes } from '../record/details/attributes';
import * as d from '../record/details/details.css';
import { objectAppearance } from '../shell/objectAppearance';
import { useAttributes } from '../views';
import { useCardRecord } from './Card';
import type { Board } from './useBoard';

export function EditCardDialog({ board, cardId, onClose }: { board: Board; cardId: string; onClose(): void }) {
  const isEntry = Boolean(board.parentAttribute);
  const attrs = useAttributes(board.definition.id);
  const fields = useMemo(
    () =>
      listedAttributes((attrs ?? []).filter((a) => !a.isArchived && a.id !== board.parentAttribute?.id)).filter(
        isAttributeEditable,
      ),
    [attrs, board.parentAttribute],
  );
  const record = useCardRecord(board, cardId);
  const title = useRecordTitle(record?.entityDefinitionId ?? '', record?.entityInstanceId ?? '');
  const look = objectAppearance(board.definition as Parameters<typeof objectAppearance>[0]);
  const heading = isEntry ? 'Edit list entry' : `Edit ${board.definition.singularNoun}`;
  const recordRef = useMemo(
    () => ({ entityDefinitionId: board.definition.id, entityInstanceId: cardId }),
    [board, cardId],
  );
  useShortcut('mod+enter', onClose);
  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()} size={808} aria-label={heading}>
      <DialogHeader
        title={
          isEntry ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {title.title}
              <Icon icon="chevronRight" size={12} />
              {heading}
            </span>
          ) : (
            heading
          )
        }
        icon={<IconTile icon={look.icon} color={look.color} size={16} />}
        onClose={onClose}
      />
      <div className={d.editHead}>
        <div className={d.editTitleRow}>
          <RecordAvatar kind={recordKind(title.definition)} size={32} />
          <h2 className={d.editTitle}>{title.title}</h2>
        </div>
        <div className={d.editSub}>
          {isEntry ? (
            <>
              {title.title} added to <span className={d.editSubStrong}>{board.definition.pluralNoun}</span>
            </>
          ) : (
            <>
              Viewing all of the record details for <span className={d.editSubStrong}>{title.title}</span>
            </>
          )}
        </div>
      </div>
      <div className={d.editRule} />
      <div className={d.editBody} data-allow-global-shortcuts="">
        {fields.length === 0 ? (
          <div className={d.noResults}>No attributes</div>
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
