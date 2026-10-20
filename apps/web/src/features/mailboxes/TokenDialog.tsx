// "Mailbox-only blocklist", "Add to protected and blocked contacts" and "Record suppression" dialogs (F settings §2.2,
// §4): one textarea of domains and addresses separated by commas or spaces, "Cancel Esc" / "Confirm ⌘↵". The server
// answers {added, duplicates, invalid}: invalid tokens are flagged "Invalid email/domain", duplicates are counted,
// and the dialog closes once something was added or nothing is wrong.
import { Button, DialogBody, DialogFooter, DialogHeader, Modal, TextArea, toast } from '@agentic-crm/ui';
import { type KeyboardEvent, useState } from 'react';
import * as s from './dialogs.css';
import { type AddOutcome, describeOutcome, INVALID_TOKEN_MESSAGE, splitTokens } from './tokens';

export const DEFAULT_TOKEN_HINT = 'Separate your domains and email addresses by a comma or space to add multiple';

export interface TokenDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Textbox placeholder and accessible name. */
  placeholder: string;
  hint?: string;
  /** Sends the tokens; resolves with the server's classification. */
  submit: (values: string[]) => Promise<AddOutcome>;
  testId?: string;
}

export function TokenDialog(props: TokenDialogProps) {
  return (
    <Modal isOpen={props.isOpen} onOpenChange={props.onOpenChange} size={480} overlay aria-label={props.title}>
      {/* The overlay unmounts when closed: every opening starts with an empty textbox. */}
      <TokenForm {...props} onClose={() => props.onOpenChange(false)} />
    </Modal>
  );
}

function TokenForm({
  title,
  placeholder,
  hint = DEFAULT_TOKEN_HINT,
  submit,
  onClose,
  testId = 'token-dialog',
}: TokenDialogProps & { onClose: () => void }) {
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState<string[]>([]);
  const [duplicates, setDuplicates] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const tokens = splitTokens(value);

  async function confirm() {
    if (pending || tokens.length === 0) return;
    setPending(true);
    try {
      const view = describeOutcome(await submit(tokens));
      if (view.shouldClose) {
        if (view.leftoverNotice) toast(view.leftoverNotice);
        onClose();
        return;
      }
      setInvalid(view.invalid);
      setDuplicates(view.duplicateMessage);
      setValue(view.remaining);
    } catch (error) {
      toast.error({ title: 'Something went wrong', description: error instanceof Error ? error.message : undefined });
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
    <div onKeyDownCapture={onKeyDown} style={{ display: 'contents' }} data-testid={testId}>
      <DialogHeader title={title} onClose={onClose} />
      <DialogBody className={s.body}>
        <TextArea
          aria-label={placeholder}
          placeholder={placeholder}
          rows={4}
          autoFocus
          value={value}
          onChange={(v) => {
            setValue(v);
            setInvalid([]);
            setDuplicates(null);
          }}
          isInvalid={invalid.length > 0}
        />
        {(invalid.length > 0 || duplicates) && (
          <div className={s.problems} role="alert" data-testid="token-problems">
            {invalid.length > 0 && (
              <div className={s.invalidRow}>
                <span>{INVALID_TOKEN_MESSAGE}</span>
                {invalid.map((token) => (
                  <span key={token} className={s.invalidChip}>
                    {token}
                  </span>
                ))}
              </div>
            )}
            {duplicates && <p className={s.duplicateRow}>{duplicates}</p>}
          </div>
        )}
        <p className={s.hint}>{hint}</p>
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
          isDisabled={tokens.length === 0}
          onPress={() => void confirm()}
        >
          Confirm
        </Button>
      </DialogFooter>
    </div>
  );
}
