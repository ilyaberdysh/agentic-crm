// Developers → Access tokens (J workspace-admin §6; raw s73-tokens, s73-new-token): "New access token", one card per
// token (name, ⋮ Edit / Delete, masked secret), the New / Edit dialog (name and one Disabled / Read / Read-write row per
// scope) and the one-time reveal of the secret after creation (only a hash is stored, so existing tokens stay masked).
import type { ApiToken } from '@agentic-crm/contracts';
import {
  AlertDialog,
  Button,
  DialogFooter,
  DialogHeader,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  Select,
  SelectItem,
  Skeleton,
  TextInput,
  toast,
} from '@agentic-crm/ui';
import { useState } from 'react';
import { errorEnvelopeOf } from '../../../data/trpc';
import { useWorkspace } from '../../shell/workspaceContext';
import * as os from '../objects/objects.css';
import { copyToClipboard, submitOnModEnter } from '../objects/parts';
import {
  createToken,
  deleteToken,
  levelsOf,
  SCOPE_ROWS,
  type ScopeLevel,
  scopesOf,
  updateToken,
  useTokens,
} from './data';
import * as d from './developers.css';

const LEVELS: { id: ScopeLevel; label: string }[] = [
  { id: 'disabled', label: 'Disabled' },
  { id: 'read', label: 'Read' },
  { id: 'read-write', label: 'Read-write' },
];

export function TokensTab() {
  const { workspace } = useWorkspace();
  const tokens = useTokens(workspace);
  const [editing, setEditing] = useState<ApiToken | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ApiToken | null>(null);
  /** Secrets of tokens created in this session (the only time they are known). */
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<string | null>(null);

  const header = (
    <div className={os.sectionHeader}>
      <div>
        <h2 className={os.sectionTitle}>Access tokens</h2>
        <p className={os.sectionDescription}>View and create access tokens for your workspace</p>
      </div>
      <Button variant="primary" size={28} icon="add" onPress={() => setEditing('new')}>
        New access token
      </Button>
    </div>
  );

  let body: React.ReactNode;
  if (tokens.isError)
    body = (
      <ErrorState
        message="Failed to load access tokens"
        style={{ padding: 48 }}
        actions={
          <Button variant="secondary" size={28} onPress={() => void tokens.refetch()}>
            Retry
          </Button>
        }
      />
    );
  else if (tokens.isPending)
    body = (
      <div className={d.cards}>
        <div className={d.tokenCard}>
          <Skeleton shape="text" width={120} />
          <Skeleton shape="block" height={32} width="100%" />
        </div>
      </div>
    );
  else if ((tokens.data ?? []).length === 0)
    body = (
      <EmptyState
        icon="key"
        iconSize={40}
        title="No access token"
        description="You don't have any access token"
        style={{ padding: '56px 24px' }}
        actions={
          <Button variant="primary" size={28} icon="add" onPress={() => setEditing('new')}>
            Create access token
          </Button>
        }
      />
    );
  else
    body = (
      <div className={d.cards}>
        {(tokens.data ?? []).map((token) => (
          <TokenCard
            key={token.id}
            token={token}
            secret={secrets[token.id] ?? null}
            onEdit={() => setEditing(token)}
            onDelete={() => setDeleting(token)}
          />
        ))}
      </div>
    );

  return (
    <>
      <section className={os.section} aria-label="Access tokens">
        {header}
        {body}
      </section>
      {editing && (
        <TokenDialog
          key={editing === 'new' ? 'new' : editing.id}
          token={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onCreated={(token, secret) => {
            setSecrets((prev) => ({ ...prev, [token.id]: secret }));
            setRevealed(token.id);
            setEditing(null);
          }}
        />
      )}
      <SecretDialog
        token={(tokens.data ?? []).find((t) => t.id === revealed) ?? null}
        secret={revealed ? (secrets[revealed] ?? null) : null}
        onClose={() => setRevealed(null)}
      />
      <AlertDialog
        isOpen={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete access token"
        description="Deleting an access token will revoke access to the API and can't be undone"
        confirmLabel="Delete access token"
        onConfirm={() => {
          const token = deleting;
          setDeleting(null);
          if (token)
            void deleteToken(workspace, token.id)
              .then(() => toast.success(`${token.name} was deleted`))
              .catch((e) =>
                toast.error({ title: 'Failed to delete access token', description: errorEnvelopeOf(e).message }),
              );
        }}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function TokenCard({
  token,
  secret,
  onEdit,
  onDelete,
}: {
  token: ApiToken;
  secret: string | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [shown, setShown] = useState(false);
  const mask = '•'.repeat(56);
  return (
    <div className={d.tokenCard} data-testid="token-card">
      <div className={d.cardHeader}>
        <h3 className={d.cardTitle}>{token.name}</h3>
        <MenuTrigger>
          <IconButton icon="moreVertical" aria-label="More" variant="ghost" size={28} />
          <Menu aria-label="Token options" placement="bottom end" width={160}>
            <MenuItem icon="edit" onAction={onEdit}>
              Edit
            </MenuItem>
            <MenuItem icon="delete" variant="danger" onAction={onDelete}>
              Delete
            </MenuItem>
          </Menu>
        </MenuTrigger>
      </div>
      <div className={d.secretRow}>
        <div className={d.secretBox}>
          <span className={d.secretText} aria-label="Access token" data-testid="token-secret">
            {shown && secret ? secret : secret ? mask : `${token.tokenPrefix}${'•'.repeat(48)}`}
          </span>
          {secret && (
            <IconButton
              icon="copy"
              aria-label="Copy access token"
              tooltip="Copy"
              variant="ghost"
              size={20}
              onPress={() => void copyToClipboard(secret, (t) => toast(t, { icon: 'copy' }))}
            />
          )}
        </div>
        {secret && (
          <IconButton
            icon={shown ? 'hide' : 'show'}
            aria-label={shown ? 'Hide access token' : 'Show access token'}
            variant="secondary"
            size={32}
            onPress={() => setShown((v) => !v)}
          />
        )}
      </div>
      <p className={d.cardMeta}>
        Created {formatDate(token.createdAt)} · Last used {formatDate(token.lastUsedAt)}
        {secret ? '' : ' · The secret is only shown when the token is created'}
      </p>
    </div>
  );
}

// ---- New / Edit dialog ----------------------------------------------------------------------------------------------

function TokenDialog({
  token,
  onClose,
  onCreated,
}: {
  token: ApiToken | null;
  onClose: () => void;
  onCreated: (token: ApiToken, secret: string) => void;
}) {
  const { workspace } = useWorkspace();
  const [name, setName] = useState(token?.name ?? '');
  const [levels, setLevels] = useState<Record<string, ScopeLevel>>(() => levelsOf(token?.scopes ?? []));
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    const trimmed = name.trim();
    const scopes = scopesOf(levels);
    setError(null);
    setNameError(null);
    if (!trimmed) {
      setNameError("Name can't be empty");
      return;
    }
    if (scopes.length === 0) {
      setError('Please select at least one scope');
      return;
    }
    setPending(true);
    try {
      if (token) {
        await updateToken(workspace, { tokenId: token.id, name: trimmed, scopes });
        onClose();
      } else {
        const created = await createToken(workspace, { name: trimmed, scopes });
        onCreated(created, created.token);
      }
    } catch (e) {
      setError(errorEnvelopeOf(e).message ?? 'Failed to save access token');
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      isOpen
      onOpenChange={(o) => !o && onClose()}
      size={748}
      aria-label={token ? 'Edit access token' : 'New access token'}
      overlay
    >
      <DialogHeader title={token ? 'Edit access token' : 'New access token'} onClose={onClose} />
      <div className={d.dialogBody} onKeyDown={submitOnModEnter(() => void save())}>
        <TextInput
          label="Name"
          size={32}
          autoFocus
          maxLength={256}
          value={name}
          onChange={(v) => {
            setName(v);
            setNameError(null);
          }}
          isInvalid={Boolean(nameError)}
          errorMessage={nameError ?? undefined}
        />
        <div className={d.scopeList} role="group" aria-label="Scopes">
          {SCOPE_ROWS.map((row) => (
            <div key={row.resource} className={d.scopeRow} data-testid={`scope-${row.resource}`}>
              <div className={d.scopeText}>
                <span className={d.scopeTitle}>{row.title}</span>
                <span className={d.scopeDescription}>{row.description}</span>
              </div>
              <Select<(typeof LEVELS)[number]>
                aria-label={row.title}
                variant="ghost"
                size={28}
                items={LEVELS}
                selectedKey={levels[row.resource] ?? 'disabled'}
                onSelectionChange={(k) => setLevels((prev) => ({ ...prev, [row.resource]: String(k) as ScopeLevel }))}
                menuWidth={160}
                style={{ width: 'auto' }}
              >
                {(item) => <SelectItem id={item.id}>{item.label}</SelectItem>}
              </Select>
            </div>
          ))}
        </div>
        {error && (
          <p className={d.dialogError} role="alert">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="secondary" size={28} onPress={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size={28} isPending={pending} onPress={() => void save()}>
          Save
        </Button>
      </DialogFooter>
    </Modal>
  );
}

// ---- one-time secret ---------------------------------------------------------------------------------------------------

function SecretDialog({
  token,
  secret,
  onClose,
}: {
  token: ApiToken | null;
  secret: string | null;
  onClose: () => void;
}) {
  return (
    <Modal
      isOpen={token !== null && secret !== null}
      onOpenChange={(o) => !o && onClose()}
      size="medium"
      aria-label="Access token created"
      overlay
    >
      <DialogHeader title="Access token created" icon={<Icon icon="key" size={16} />} onClose={onClose} />
      <div className={d.dialogBody}>
        <p className={os.sectionDescription} style={{ margin: 0 }}>
          Copy <b>{token?.name}</b> now. For security reasons it will not be shown again.
        </p>
        <div className={d.secretRow}>
          <div className={d.secretBox}>
            <span className={d.secretText} data-testid="new-token-secret">
              {secret}
            </span>
            <IconButton
              icon="copy"
              aria-label="Copy access token"
              tooltip="Copy"
              variant="ghost"
              size={20}
              onPress={() => secret && void copyToClipboard(secret, (t) => toast(t, { icon: 'copy' }))}
            />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="primary" size={28} onPress={onClose}>
          Done
        </Button>
      </DialogFooter>
    </Modal>
  );
}
