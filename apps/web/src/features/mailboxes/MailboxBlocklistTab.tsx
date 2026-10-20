// Mailbox → Mailbox-only blocklist (F settings §2.2; evidence/F/mailbox-blocklist-empty.png): emails from listed
// domains and addresses never reach Attio (the server keeps them out at ingestion). Empty state, or the entries with
// a remove button; "Add to blocklist" opens the token dialog.
import { Button, ErrorState, Icon, IconButton, LoadingState, toast } from '@agentic-crm/ui';
import { useState } from 'react';
import { type BlocklistEntry, type Mailbox, useAddBlocklist, useBlocklist, useRemoveBlocklist } from './data';
import { EmptyBlock } from './EmptyBlock';
import { UserBlockGlyph } from './glyphs';
import * as page from './page.css';
import { LearnMore } from './parts';
import { TokenDialog } from './TokenDialog';

export function MailboxBlocklistTab({ mailbox }: { mailbox: Mailbox }) {
  const list = useBlocklist(mailbox.id);
  const add = useAddBlocklist(mailbox.id);
  const remove = useRemoveBlocklist();
  const [open, setOpen] = useState(false);

  const dialog = (
    <TokenDialog
      isOpen={open}
      onOpenChange={setOpen}
      title="Mailbox-only blocklist"
      placeholder="Enter a domain/email to block from your mailbox"
      submit={(values) => add.mutateAsync(values)}
      testId="blocklist-dialog"
    />
  );

  if (list.isPending) return <LoadingState />;
  if (list.isError) {
    return (
      <ErrorState
        message="Failed to load the blocklist"
        actions={
          <Button variant="secondary" size={28} onPress={() => void list.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  const entries = list.data;
  if (entries.length === 0) {
    return (
      <>
        <EmptyBlock
          testId="blocklist-empty"
          icon={UserBlockGlyph}
          title="No emails or domains yet"
          description={
            <>
              Emails from blocklisted domains and addresses won't appear in Attio. <LearnMore />
            </>
          }
          action={
            <Button variant="primary" size={32} icon="add" onPress={() => setOpen(true)}>
              Add to blocklist
            </Button>
          }
        />
        {dialog}
      </>
    );
  }

  return (
    <>
      <div className={page.toolbar}>
        <Button variant="secondary" size={28} icon="add" onPress={() => setOpen(true)}>
          Add to blocklist
        </Button>
      </div>
      <div className={page.listCard} data-testid="blocklist-entries" style={{ marginTop: 16 }}>
        {entries.map((entry) => (
          <BlocklistRow
            key={entry.id}
            entry={entry}
            onRemove={() =>
              remove.mutate(entry.id, {
                onError: (error) => toast.error({ title: 'Could not remove the entry', description: error.message }),
              })
            }
          />
        ))}
      </div>
      {dialog}
    </>
  );
}

function BlocklistRow({ entry, onRemove }: { entry: BlocklistEntry; onRemove: () => void }) {
  return (
    <div className={page.listRow} data-testid="blocklist-row">
      <Icon icon={entry.kind === 'domain' ? 'attrDomain' : 'attrEmail'} size={16} className={page.listIcon} />
      <div className={page.listRowText}>
        <span className={page.listRowPrimary}>{entry.value}</span>
        <span className={page.listRowSecondary}>{entry.kind === 'domain' ? 'Domain' : 'Email address'}</span>
      </div>
      <IconButton icon="close" aria-label={`Remove ${entry.value}`} tooltip="Remove" size={28} onPress={onRemove} />
    </div>
  );
}
