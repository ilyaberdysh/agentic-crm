// "Connect test account" (dev builds and e2e only): connects a mailbox of the test connector by address, so email and
// calendar demos work without Gmail (the Gmail connector is slice 7b). Nothing is delivered anywhere.
import { Banner, Button, DialogBody, DialogFooter, DialogHeader, Modal, TextInput, toast } from '@agentic-crm/ui';
import { type FormEvent, useState } from 'react';
import { useConnectMailbox } from './data';
import * as s from './dialogs.css';

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ConnectTestDialog({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size={480} overlay aria-label="Connect test account">
      <ConnectTestForm onClose={() => onOpenChange(false)} />
    </Modal>
  );
}

function ConnectTestForm({ onClose }: { onClose: () => void }) {
  const connect = useConnectMailbox();
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const value = address.trim().toLowerCase();
    if (!ADDRESS.test(value)) {
      setError('Enter a valid email address.');
      return;
    }
    setError(null);
    connect.mutate(
      { provider: 'test', emailAddress: value, syncCalendar: true },
      {
        onSuccess: () => {
          toast.success('Test account connected');
          onClose();
        },
        onError: (e) => setError(e.message),
      },
    );
  }

  return (
    <form noValidate onSubmit={submit} style={{ display: 'contents' }} data-testid="connect-test-dialog">
      <DialogHeader title="Connect test account" onClose={onClose} />
      <DialogBody className={s.body}>
        <Banner variant="info">
          Test accounts are fed by the test connector. Nothing is sent to, or read from, a real mailbox.
        </Banner>
        <TextInput
          label="Email address"
          type="email"
          size={34}
          placeholder="name@example.com"
          autoFocus
          value={address}
          onChange={(v) => {
            setAddress(v);
            setError(null);
          }}
          isInvalid={Boolean(error)}
          errorMessage={error ?? undefined}
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" size={28} shortcut={['esc']} onPress={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size={28} type="submit" isPending={connect.isPending}>
          Connect
        </Button>
      </DialogFooter>
    </form>
  );
}
