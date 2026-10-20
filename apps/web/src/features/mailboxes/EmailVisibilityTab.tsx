// Workspace → Email visibility (F settings §4.1): "Default email visibility of new mailboxes" and "Workspace protected
// and blocked contacts": a searchable table with the built-in rows (workspace members' addresses; each internal
// domain with a protection switch) and the custom entries (enforcement select, last update, added by, ⋮ Remove).
// Writes are admin-only; other members see the same page read-only.
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
  SearchField,
  Select,
  SelectItem,
  Switch,
  toast,
} from '@agentic-crm/ui';
import { useState } from 'react';
import {
  type ProtectedContact,
  useAddProtectedContacts,
  useProtectedContacts,
  useRemoveProtectedContact,
  useUpdateProtectedContact,
  useUpdateWorkspaceEmailSettings,
  useWorkspaceEmailSettings,
  useWorkspaceMembers,
} from './data';
import {
  actorName,
  ENFORCEMENT_OPTIONS,
  type Enforcement,
  formatShortDate,
  VISIBILITY_OPTIONS,
  type VisibilityLevel,
} from './labels';
import * as page from './page.css';
import { Block, LearnMore, Section } from './parts';
import { TokenDialog } from './TokenDialog';
import * as s from './workspace.css';

const MEMBERS_ROW = "Workspace members' email addresses";

export function EmailVisibilityTab({ isAdmin }: { isAdmin: boolean }) {
  const settings = useWorkspaceEmailSettings();
  const contacts = useProtectedContacts();
  const members = useWorkspaceMembers();
  const update = useUpdateWorkspaceEmailSettings();
  const add = useAddProtectedContacts();
  const updateContact = useUpdateProtectedContact();
  const removeContact = useRemoveProtectedContact();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);

  if (settings.isPending || contacts.isPending) return <LoadingState />;
  if (settings.isError || contacts.isError || !settings.data || !contacts.data) {
    return (
      <ErrorState
        message="Failed to load the email visibility settings"
        actions={
          <Button
            variant="secondary"
            size={28}
            onPress={() => {
              void settings.refetch();
              void contacts.refetch();
            }}
          >
            Retry
          </Button>
        }
      />
    );
  }

  const current = settings.data;
  const people = members.data ?? [];
  const needle = query.trim().toLowerCase();
  const matches = (label: string) => needle === '' || label.toLowerCase().includes(needle);
  const showMembers = matches(MEMBERS_ROW) || matches('protected') || matches('system default');
  const domains = current.internalDomains.filter((d) => matches(d));
  const entries = contacts.data.filter((c) => matches(c.value));
  const fail = (title: string) => (error: Error) => toast.error({ title, description: error.message });

  return (
    <>
      {!isAdmin && (
        <div data-testid="read-only-note">
          <Banner variant="info">Only workspace admins can change these settings.</Banner>
        </div>
      )}
      <Section
        id="email-visibility"
        tall
        title="Email visibility"
        description={
          <>
            Manage which information is visible within your workspace. <LearnMore />
          </>
        }
      >
        <div className={page.stack}>
          <div className={page.settingCard}>
            <div>
              <h3 className={page.settingCardTitle}>Default email visibility of new mailboxes</h3>
              <p className={page.settingCardDescription}>
                Newly connected mailboxes start with this level; each member can change their own.
              </p>
            </div>
            <Select<(typeof VISIBILITY_OPTIONS)[number]>
              aria-label="Default email visibility of new mailboxes"
              size={28}
              items={VISIBILITY_OPTIONS}
              selectedKey={current.defaultVisibility}
              isDisabled={!isAdmin}
              onSelectionChange={(key) =>
                update.mutate({ defaultVisibility: key as VisibilityLevel }, { onError: fail('Could not save') })
              }
              style={{ width: 220 }}
              menuWidth={260}
            >
              {(item) => <SelectItem id={item.id}>{item.title}</SelectItem>}
            </Select>
          </div>
          <Block
            title="Workspace protected and blocked contacts"
            description="Hide emails and calendar event entries involving certain contacts, everywhere in Attio."
            aside={
              isAdmin ? (
                <Button variant="secondary" size={28} icon="add" onPress={() => setAdding(true)}>
                  Add contacts
                </Button>
              ) : undefined
            }
          >
            <SearchField
              aria-label="Search addresses or domains"
              placeholder="Search addresses or domains"
              size={32}
              value={query}
              onChange={setQuery}
            />
            <div
              className={s.table}
              role="table"
              aria-label="Protected and blocked contacts"
              data-testid="protected-table"
            >
              <div className={s.head} role="row">
                <div className={s.headCell} role="columnheader">
                  <Icon icon="attrEmail" size={16} className={s.headIcon} />
                  Email / Domain
                </div>
                <div className={s.headCell} role="columnheader">
                  <Icon icon="security" size={16} className={s.headIcon} />
                  Enforcement level
                </div>
                <div className={s.headCell} role="columnheader">
                  <Icon icon="clock" size={16} className={s.headIcon} />
                  Last update
                </div>
                <div className={s.headCell} role="columnheader">
                  <Icon icon="user" size={16} className={s.headIcon} />
                  Added by
                </div>
                <div role="columnheader" />
              </div>
              {showMembers && (
                <div className={s.row} role="row" data-testid="protected-row-members">
                  <div className={s.cell} role="cell">
                    <Icon icon="people" size={16} className={s.headIcon} />
                    <span className={s.cellText}>{MEMBERS_ROW}</span>
                  </div>
                  <div className={s.cell} role="cell">
                    <span className={s.enforcementStatic}>Protected</span>
                  </div>
                  <div className={`${s.cell} ${s.mutedLight}`} role="cell">
                    —
                  </div>
                  <div className={`${s.cell} ${s.muted}`} role="cell">
                    System default
                  </div>
                  <div role="cell" />
                </div>
              )}
              {domains.map((domain) => {
                const protectedNow = !current.unprotectedDomains.includes(domain);
                return (
                  <div key={domain} className={s.row} role="row" data-testid={`protected-row-domain-${domain}`}>
                    <div className={s.cell} role="cell">
                      <Icon icon="attrDomain" size={16} className={s.headIcon} />
                      <span className={s.cellText}>{domain}</span>
                    </div>
                    <div className={s.cell} role="cell">
                      <Switch
                        aria-label={`Protect ${domain}`}
                        isSelected={protectedNow}
                        isDisabled={!isAdmin}
                        onChange={(on) =>
                          update.mutate(
                            {
                              unprotectedDomains: on
                                ? current.unprotectedDomains.filter((d) => d !== domain)
                                : [...current.unprotectedDomains, domain],
                            },
                            { onError: fail('Could not save') },
                          )
                        }
                      >
                        {protectedNow ? 'Protected' : 'Not protected'}
                      </Switch>
                    </div>
                    <div className={`${s.cell} ${s.mutedLight}`} role="cell">
                      —
                    </div>
                    <div className={`${s.cell} ${s.muted}`} role="cell">
                      System default
                    </div>
                    <div role="cell" />
                  </div>
                );
              })}
              {entries.map((entry) => (
                <ContactRow
                  key={entry.id}
                  entry={entry}
                  addedBy={actorName(entry.createdBy, people)}
                  isAdmin={isAdmin}
                  onEnforcement={(enforcement) =>
                    updateContact.mutate({ id: entry.id, enforcement }, { onError: fail('Could not save') })
                  }
                  onRemove={() => removeContact.mutate(entry.id, { onError: fail('Could not remove the contact') })}
                />
              ))}
              {!showMembers && domains.length === 0 && entries.length === 0 && (
                <div className={s.noRows}>No matching addresses or domains</div>
              )}
            </div>
          </Block>
        </div>
      </Section>
      <TokenDialog
        isOpen={adding}
        onOpenChange={setAdding}
        title="Add to protected and blocked contacts"
        placeholder="Enter domains or email addresses, separated by commas or spaces"
        hint="Protected contacts hide their emails and meetings from everyone but their owners; blocked contacts are never synced."
        submit={(values) => add.mutateAsync({ values, enforcement: 'protected' })}
        testId="protected-dialog"
      />
    </>
  );
}

function ContactRow({
  entry,
  addedBy,
  isAdmin,
  onEnforcement,
  onRemove,
}: {
  entry: ProtectedContact;
  addedBy: string;
  isAdmin: boolean;
  onEnforcement: (level: Enforcement) => void;
  onRemove: () => void;
}) {
  return (
    <div className={s.row} role="row" data-testid="protected-row" data-value={entry.value}>
      <div className={s.cell} role="cell">
        <Icon icon={entry.kind === 'domain' ? 'attrDomain' : 'attrEmail'} size={16} className={s.headIcon} />
        <span className={s.cellText}>{entry.value}</span>
      </div>
      <div className={s.cell} role="cell">
        <Select<(typeof ENFORCEMENT_OPTIONS)[number]>
          aria-label={`Enforcement level for ${entry.value}`}
          size={28}
          items={ENFORCEMENT_OPTIONS}
          selectedKey={entry.enforcement}
          isDisabled={!isAdmin}
          onSelectionChange={(key) => onEnforcement(key as Enforcement)}
          style={{ width: 130 }}
        >
          {(item) => <SelectItem id={item.id}>{item.label}</SelectItem>}
        </Select>
      </div>
      <div className={`${s.cell} ${s.muted}`} role="cell">
        {formatShortDate(entry.updatedAt)}
      </div>
      <div className={`${s.cell} ${s.muted}`} role="cell">
        <span className={s.cellText}>{addedBy}</span>
      </div>
      <div className={s.rowActions} role="cell">
        {isAdmin && (
          <MenuTrigger>
            <IconButton icon="moreVertical" aria-label={`Options for ${entry.value}`} size={28} />
            <Menu
              aria-label="Options"
              placement="bottom end"
              width={180}
              onAction={(key) => key === 'remove' && onRemove()}
            >
              <MenuItem id="remove" icon="delete" variant="danger">
                Remove
              </MenuItem>
            </Menu>
          </MenuTrigger>
        )}
      </div>
    </div>
  );
}
