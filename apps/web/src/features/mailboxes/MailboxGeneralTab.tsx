// Mailbox → General (F settings §2.1; evidence/F/mailbox-general-email-visibility.png): "Email visibility" with the
// three radio cards, and "Individuals with full access" (Add person, the people who have it, the info alert).
import { Avatar, Banner, Button, IconButton, toast } from '@agentic-crm/ui';
import { useState } from 'react';
import { AddPersonDialog } from './AddPersonDialog';
import {
  type Mailbox,
  useAddSharing,
  useMailboxSharing,
  useRemoveSharing,
  useUpdateMailbox,
  useWorkspaceMembers,
} from './data';
import { MailFullGlyph, MailMetadataGlyph, MailSubjectGlyph } from './glyphs';
import { grantableMembers, memberName, VISIBILITY_OPTIONS, type VisibilityLevel } from './labels';
import * as page from './page.css';
import { Section } from './parts';
import { type RadioCardOption, RadioCards } from './RadioCards';

const VISIBILITY_ICONS: Record<VisibilityLevel, RadioCardOption<VisibilityLevel>['icon']> = {
  'metadata-only': MailMetadataGlyph,
  'subject-line': MailSubjectGlyph,
  'full-access': MailFullGlyph,
};

const CARDS: RadioCardOption<VisibilityLevel>[] = VISIBILITY_OPTIONS.map((o) => ({
  ...o,
  icon: VISIBILITY_ICONS[o.id],
}));

export function MailboxGeneralTab({ mailbox, isOwner }: { mailbox: Mailbox; isOwner: boolean }) {
  return (
    <>
      <VisibilitySection mailbox={mailbox} isOwner={isOwner} />
      <SharingSection mailbox={mailbox} isOwner={isOwner} />
    </>
  );
}

function VisibilitySection({ mailbox, isOwner }: { mailbox: Mailbox; isOwner: boolean }) {
  const update = useUpdateMailbox();
  // Shown at once; the server's value replaces it when the write settles.
  const [pending, setPending] = useState<VisibilityLevel | null>(null);

  const choose = (level: VisibilityLevel) => {
    if (level === mailbox.defaultVisibility && pending === null) return;
    setPending(level);
    update.mutate(
      { mailboxId: mailbox.id, defaultVisibility: level },
      {
        onError: (error) => toast.error({ title: 'Could not change email visibility', description: error.message }),
        onSettled: () => setPending(null),
      },
    );
  };

  return (
    <Section
      id="email-visibility"
      title="Email visibility"
      description="Choose how much of your synced email and calendar your workspace can see by default. You'll always see all your own emails and calendar events in Attio."
    >
      <RadioCards
        label="Email visibility"
        testId="visibility-cards"
        options={CARDS}
        value={pending ?? mailbox.defaultVisibility}
        onChange={choose}
        isDisabled={!isOwner}
      />
    </Section>
  );
}

function SharingSection({ mailbox, isOwner }: { mailbox: Mailbox; isOwner: boolean }) {
  const sharing = useMailboxSharing(mailbox.id);
  const members = useWorkspaceMembers();
  const add = useAddSharing(mailbox.id);
  const remove = useRemoveSharing();
  const [adding, setAdding] = useState(false);

  const grants = (sharing.data ?? []).flatMap((grant) =>
    grant.target.type === 'member' ? [{ grantId: grant.id, memberId: grant.target.memberId }] : [],
  );
  const all = members.data ?? [];
  const candidates = grantableMembers(all, mailbox.memberId, new Set(grants.map((g) => g.memberId)));

  return (
    <Section
      id="individuals-with-full-access"
      compact
      title="Individuals with full access"
      description="They see all your synced email and calendar events, including attachments. This overwrites your mailbox email visibility default."
      aside={
        isOwner ? (
          <Button variant="secondary" size={28} icon="invite" onPress={() => setAdding(true)}>
            Add person
          </Button>
        ) : undefined
      }
    >
      <Banner variant="neutral" className={page.infoAlert}>
        Only applicable if "metadata only" or "subject line and metadata" is selected
      </Banner>
      {grants.length > 0 && (
        <div className={page.listCard} data-testid="granted-people">
          {grants.map((grant) => {
            const member = all.find((m) => m.id === grant.memberId);
            const name = member ? memberName(member) : 'Former member';
            return (
              <div key={grant.grantId} className={page.listRow} data-testid="granted-person">
                <Avatar name={name} kind="member" size={24} />
                <div className={page.listRowText}>
                  <span className={page.listRowPrimary}>{name}</span>
                  {member && <span className={page.listRowSecondary}>{member.emailAddress}</span>}
                </div>
                {isOwner && (
                  <IconButton
                    icon="close"
                    aria-label="Stop sharing"
                    tooltip="Stop sharing"
                    size={28}
                    onPress={() =>
                      remove.mutate(grant.grantId, {
                        onError: (error) =>
                          toast.error({ title: 'Could not stop sharing', description: error.message }),
                      })
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      <AddPersonDialog
        isOpen={adding}
        onOpenChange={setAdding}
        candidates={candidates}
        onAdd={(memberId) => add.mutateAsync(memberId)}
      />
    </Section>
  );
}
