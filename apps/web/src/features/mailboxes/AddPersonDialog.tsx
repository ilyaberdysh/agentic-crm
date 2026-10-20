// "Add person" (F settings §2.1): picks a workspace member who then sees all of the mailbox's synced email and
// calendar events (a mailbox grant at full access). Footer "Cancel Esc" / "Confirm ⌘↵".
import {
  Avatar,
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
  Select,
  SelectItem,
  toast,
} from '@agentic-crm/ui';
import { type KeyboardEvent, useState } from 'react';
import type { WorkspaceMemberRow } from './data';
import * as s from './dialogs.css';
import { memberName } from './labels';

export function AddPersonDialog({
  isOpen,
  onOpenChange,
  candidates,
  onAdd,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Members who can still be given access (not the owner, not yet granted). */
  candidates: readonly WorkspaceMemberRow[];
  onAdd: (memberId: string) => Promise<unknown>;
}) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size={480} overlay aria-label="Add person">
      <AddPersonForm candidates={candidates} onAdd={onAdd} onClose={() => onOpenChange(false)} />
    </Modal>
  );
}

function AddPersonForm({
  candidates,
  onAdd,
  onClose,
}: {
  candidates: readonly WorkspaceMemberRow[];
  onAdd: (memberId: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [memberId, setMemberId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function confirm() {
    if (!memberId || pending) return;
    setPending(true);
    try {
      await onAdd(memberId);
      onClose();
    } catch (error) {
      toast.error({
        title: 'Could not give access',
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setPending(false);
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void confirm();
    }
  };

  return (
    <div onKeyDownCapture={onKeyDown} style={{ display: 'contents' }} data-testid="add-person-dialog">
      <DialogHeader title="Add person" onClose={onClose} />
      <DialogBody className={s.body}>
        <Select<WorkspaceMemberRow>
          aria-label="Person"
          label="Person"
          placeholder="Select a person..."
          searchable
          searchPlaceholder="Search people..."
          items={candidates}
          selectedKey={memberId}
          onSelectionChange={(key) => setMemberId(key as string | null)}
          menuWidth="trigger"
        >
          {(member) => (
            <SelectItem id={member.id} textValue={`${memberName(member)} ${member.emailAddress}`}>
              <span className={s.memberOption}>
                <Avatar name={memberName(member)} kind="member" size={20} />
                <span className={s.memberOptionText}>
                  <span>{memberName(member)}</span>
                  <span className={s.memberEmail}>{member.emailAddress}</span>
                </span>
              </span>
            </SelectItem>
          )}
        </Select>
        <p className={s.hint}>They will see all your synced email and calendar events, including attachments.</p>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" size={28} shortcut={['esc']} onPress={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size={28}
          shortcut={['mod', 'enter']}
          isPending={pending}
          isDisabled={!memberId}
          onPress={() => void confirm()}
        >
          Confirm
        </Button>
      </DialogFooter>
    </div>
  );
}
