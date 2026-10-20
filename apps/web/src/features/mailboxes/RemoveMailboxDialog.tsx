// "Remove mailbox" confirmation (F settings §1): lists what removal does, then `mailboxes.disconnect`.
import { AlertDialog, toast } from '@agentic-crm/ui';
import * as s from './accounts.css';
import { type Mailbox, useDisconnectMailbox } from './data';

export function RemoveMailboxDialog({
  mailbox,
  isOpen,
  onOpenChange,
  onRemoved,
}: {
  mailbox: Pick<Mailbox, 'id' | 'emailAddress'>;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved?: () => void;
}) {
  const disconnect = useDisconnectMailbox();
  return (
    <AlertDialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={`Remove ${mailbox.emailAddress}?`}
      description="Removing this mailbox disconnects the account from the workspace:"
      confirmLabel="Remove mailbox"
      onConfirm={() => {
        disconnect.mutate(mailbox.id, {
          onSuccess: () => {
            toast.success('Mailbox removed');
            onRemoved?.();
          },
          onError: (error) => toast.error({ title: 'Could not remove the mailbox', description: error.message }),
        });
      }}
    >
      <ul className={s.removeList}>
        <li>All emails and calendar events synced from this mailbox are deleted.</li>
        <li>Email access grants given to other members for this mailbox are removed.</li>
        <li>Records stay, but they no longer show this mailbox's emails and meetings.</li>
      </ul>
    </AlertDialog>
  );
}
