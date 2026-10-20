// Workspace → Record creation (F settings §4.2; evidence/F/workspace-email-record-creation.png): "Default record
// creation" radio cards (All contacts / Selective contact creation, recommended / None), the "Automatically create
// company records" switch, and "Record suppression" (domains and addresses that never create records).
import {
  Banner,
  Button,
  ErrorState,
  Icon,
  IconButton,
  LoadingState,
  Menu,
  MenuItem,
  MenuTrigger,
  Switch,
  toast,
} from '@agentic-crm/ui';
import { useState } from 'react';
import {
  type SuppressionEntry,
  useAddSuppression,
  useRemoveSuppression,
  useSuppression,
  useUpdateWorkspaceEmailSettings,
  useWorkspaceEmailSettings,
} from './data';
import { NoneGlyph, UserCogGlyph } from './glyphs';
import { RECORD_CREATION_OPTIONS, type RecordCreationMode } from './labels';
import * as page from './page.css';
import { Block, LearnMore, Section } from './parts';
import { type RadioCardOption, RadioCards } from './RadioCards';
import { TokenDialog } from './TokenDialog';

const MODE_ICONS: Record<RecordCreationMode, RadioCardOption<RecordCreationMode>['icon']> = {
  all: 'people',
  selective: UserCogGlyph,
  none: NoneGlyph,
};

const CARDS: RadioCardOption<RecordCreationMode>[] = RECORD_CREATION_OPTIONS.map((o) => ({
  ...o,
  icon: MODE_ICONS[o.id],
}));

export function RecordCreationTab({ isAdmin }: { isAdmin: boolean }) {
  const settings = useWorkspaceEmailSettings();
  const suppression = useSuppression();
  const update = useUpdateWorkspaceEmailSettings();
  const add = useAddSuppression();
  const remove = useRemoveSuppression();
  const [adding, setAdding] = useState(false);
  // Shown at once; the server's value replaces it when the write settles.
  const [pendingMode, setPendingMode] = useState<RecordCreationMode | null>(null);
  const [pendingCompanies, setPendingCompanies] = useState<boolean | null>(null);

  if (settings.isPending || suppression.isPending) return <LoadingState />;
  if (settings.isError || suppression.isError || !settings.data || !suppression.data) {
    return (
      <ErrorState
        message="Failed to load the record creation settings"
        actions={
          <Button
            variant="secondary"
            size={28}
            onPress={() => {
              void settings.refetch();
              void suppression.refetch();
            }}
          >
            Retry
          </Button>
        }
      />
    );
  }

  const current = settings.data;
  const entries = [...suppression.data.domains, ...suppression.data.emailAddresses].sort((a, b) =>
    a.value.localeCompare(b.value),
  );
  const fail = (title: string) => (error: Error) => toast.error({ title, description: error.message });

  return (
    <>
      {!isAdmin && (
        <div data-testid="read-only-note">
          <Banner variant="info">Only workspace admins can change these settings.</Banner>
        </div>
      )}
      <Section
        id="record-creation"
        tall
        title="Record creation"
        description={
          <>
            Manage whether new people records will be created. (Existing emails and meetings are not impacted.){' '}
            <LearnMore />
          </>
        }
      />
      <div className={page.stack}>
        <Block title="Default record creation" description="Automatically create people records.">
          <RadioCards
            label="Default record creation"
            testId="record-creation-cards"
            options={CARDS}
            value={pendingMode ?? current.recordCreation}
            isDisabled={!isAdmin}
            onChange={(mode) => {
              setPendingMode(mode);
              update.mutate(
                { recordCreation: mode },
                { onError: fail('Could not save'), onSettled: () => setPendingMode(null) },
              );
            }}
          />
        </Block>
        <div className={page.settingCard}>
          <div>
            <h3 className={page.settingCardTitle}>Automatically create company records</h3>
            <p className={page.settingCardDescription}>
              Company records will be automatically created based on the domain in a person's email address.
            </p>
          </div>
          <Switch
            aria-label="Automatically create company records"
            isSelected={pendingCompanies ?? current.autoCreateCompanies}
            isDisabled={!isAdmin}
            onChange={(on) => {
              setPendingCompanies(on);
              update.mutate(
                { autoCreateCompanies: on },
                { onError: fail('Could not save'), onSettled: () => setPendingCompanies(null) },
              );
            }}
          />
        </div>
      </div>
      <Block
        title="Record suppression"
        description="Emails or domains listed here will not create people and company records in Agentic CRM."
        aside={
          isAdmin ? (
            <Button variant="secondary" size={28} icon="add" onPress={() => setAdding(true)}>
              Add contacts
            </Button>
          ) : undefined
        }
      >
        <Banner variant="neutral" className={page.infoAlert}>
          This does not affect related information, such as emails, visible within your workspace. Typical use cases
          include email addresses from newsletters or from products you use that would never become customers.
        </Banner>
        {entries.length > 0 && (
          <div className={page.listCard} data-testid="suppression-list">
            {entries.map((entry) => (
              <SuppressionRow
                key={entry.id}
                entry={entry}
                isAdmin={isAdmin}
                onRemove={() => remove.mutate(entry.id, { onError: fail('Could not remove the suppression') })}
              />
            ))}
          </div>
        )}
      </Block>
      <TokenDialog
        isOpen={adding}
        onOpenChange={setAdding}
        title="Record suppression"
        placeholder="Type an email address or domain to suppress record creation"
        submit={(values) => add.mutateAsync(values)}
        testId="suppression-dialog"
      />
    </>
  );
}

function SuppressionRow({
  entry,
  isAdmin,
  onRemove,
}: {
  entry: SuppressionEntry;
  isAdmin: boolean;
  onRemove: () => void;
}) {
  return (
    <div className={page.listRow} data-testid="suppression-row" data-value={entry.value}>
      <Icon icon={entry.kind === 'domain' ? 'attrDomain' : 'attrEmail'} size={16} className={page.listIcon} />
      <div className={page.listRowText}>
        <span className={page.listRowPrimary}>{entry.value}</span>
        <span className={page.listRowSecondary}>{entry.kind === 'domain' ? 'Domain' : 'Email address'}</span>
      </div>
      {isAdmin && (
        <MenuTrigger>
          <IconButton icon="moreVertical" aria-label={`Options for ${entry.value}`} size={28} />
          <Menu
            aria-label="Options"
            placement="bottom end"
            width={200}
            onAction={(key) => key === 'remove' && onRemove()}
          >
            <MenuItem id="remove" icon="delete" variant="danger">
              Remove suppression
            </MenuItem>
          </Menu>
        </MenuTrigger>
      )}
    </div>
  );
}
