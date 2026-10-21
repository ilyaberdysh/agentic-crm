// Developers → Webhooks (J workspace-admin §6; raw s74-webhooks, s74-new-webhook, s74-events): "Create webhook", one card
// per webhook (target URL, status, subscribed events, ⋮ Test subscription / Deliveries / Show secret / Activate or
// Deactivate / Edit / Delete), the New / Edit dialog (Target URL, Events picker, per-subscription menu) and the
// deliveries log with payloads and attempts.
import {
  type Webhook,
  type WebhookDelivery,
  type WebhookSubscription,
  webhookTargetUrlSchema,
} from '@agentic-crm/contracts';
import {
  AlertDialog,
  Button,
  DialogFooter,
  DialogHeader,
  EmptyState,
  ErrorState,
  FilterableMenu,
  Icon,
  IconButton,
  type IconName,
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
  Modal,
  Skeleton,
  Submenu,
  TextInput,
  toast,
} from '@agentic-crm/ui';
import { Fragment, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { errorEnvelopeOf } from '../../../data/trpc';
import { useWorkspace } from '../../shell/workspaceContext';
import * as os from '../objects/objects.css';
import { copyToClipboard, submitOnModEnter } from '../objects/parts';
import {
  type AnyWebhookEvent,
  createWebhook,
  deleteWebhook,
  eventGroups,
  testWebhook,
  updateWebhook,
  useDeliveries,
  useWebhookSecret,
  useWebhooks,
} from './data';
import * as d from './developers.css';

const GROUP_ICON: Record<string, IconName> = {
  'call-recording': 'recording',
  comment: 'comment',
  list: 'list',
  'list-attribute': 'apps',
  'list-entry': 'list',
  note: 'notes',
  'note-content': 'notes',
  'object-attribute': 'apps',
  record: 'record',
  task: 'tasks',
  'workspace-member': 'user',
};

const eventIcon = (event: string): IconName => GROUP_ICON[event.split('.')[0] as string] ?? 'workflows';

const STATUS_LABEL = { active: 'Active', degraded: 'Degraded', inactive: 'Inactive' } as const;

export function WebhooksTab() {
  const { workspace } = useWorkspace();
  const webhooks = useWebhooks(workspace);
  const [editing, setEditing] = useState<Webhook | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Webhook | null>(null);
  const [deliveries, setDeliveries] = useState<Webhook | null>(null);
  const [secretOf, setSecretOf] = useState<{ webhook: Webhook; secret?: string } | null>(null);

  const header = (
    <div className={os.sectionHeader}>
      <div>
        <h2 className={os.sectionTitle}>Webhooks</h2>
        <p className={os.sectionDescription}>Configure webhooks and webhook events</p>
      </div>
      <Button variant="primary" size={28} icon="add" onPress={() => setEditing('new')}>
        Create webhook
      </Button>
    </div>
  );

  let body: React.ReactNode;
  if (webhooks.isError)
    body = (
      <ErrorState
        message="Failed to load webhooks"
        style={{ padding: 48 }}
        actions={
          <Button variant="secondary" size={28} onPress={() => void webhooks.refetch()}>
            Retry
          </Button>
        }
      />
    );
  else if (webhooks.isPending)
    body = (
      <div className={d.cards}>
        <div className={d.tokenCard}>
          <Skeleton shape="text" width={220} />
          <Skeleton shape="text" width={120} />
        </div>
      </div>
    );
  else if ((webhooks.data ?? []).length === 0)
    return (
      <>
        <EmptyState
          icon="workflows"
          iconSize={40}
          title="No webhooks"
          description="Configure webhooks and webhook events"
          style={{ padding: '56px 24px' }}
          actions={
            <Button variant="primary" size={28} icon="add" onPress={() => setEditing('new')}>
              Create webhook
            </Button>
          }
        />
        {editing && (
          <WebhookDialog
            webhook={null}
            onClose={() => setEditing(null)}
            onCreated={(webhook, secret) => {
              setEditing(null);
              setSecretOf({ webhook, secret });
            }}
          />
        )}
        <SecretDialog target={secretOf} onClose={() => setSecretOf(null)} />
      </>
    );
  else
    body = (
      <div className={d.cards}>
        {(webhooks.data ?? []).map((webhook) => (
          <WebhookCard
            key={webhook.id}
            webhook={webhook}
            onEdit={() => setEditing(webhook)}
            onDelete={() => setDeleting(webhook)}
            onDeliveries={() => setDeliveries(webhook)}
            onSecret={() => setSecretOf({ webhook })}
          />
        ))}
      </div>
    );

  return (
    <>
      <section className={os.section} aria-label="Webhooks">
        {header}
        {body}
      </section>
      {editing && (
        <WebhookDialog
          key={editing === 'new' ? 'new' : editing.id}
          webhook={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onCreated={(webhook, secret) => {
            setEditing(null);
            setSecretOf({ webhook, secret });
          }}
        />
      )}
      <DeliveriesDialog webhook={deliveries} onClose={() => setDeliveries(null)} />
      <SecretDialog target={secretOf} onClose={() => setSecretOf(null)} />
      <AlertDialog
        isOpen={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete webhook"
        description="Are you sure you want to delete this webhook? Any connected services will stop functioning."
        confirmLabel="Delete webhook"
        onConfirm={() => {
          const hook = deleting;
          setDeleting(null);
          if (hook)
            void deleteWebhook(workspace, hook.id)
              .then(() => toast.success('Webhook deleted'))
              .catch((e) =>
                toast.error({ title: 'Failed to delete webhook', description: errorEnvelopeOf(e).message }),
              );
        }}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

function WebhookCard({
  webhook,
  onEdit,
  onDelete,
  onDeliveries,
  onSecret,
}: {
  webhook: Webhook;
  onEdit: () => void;
  onDelete: () => void;
  onDeliveries: () => void;
  onSecret: () => void;
}) {
  const { workspace } = useWorkspace();
  const types = [...new Set(webhook.subscriptions.map((s) => s.eventType))];
  const statusClass =
    webhook.status === 'active' ? d.statusActive : webhook.status === 'degraded' ? d.statusDegraded : d.statusInactive;

  async function test(eventType?: AnyWebhookEvent) {
    try {
      const delivery = await testWebhook(workspace, webhook.id, eventType);
      if (delivery.status === 'succeeded') {
        toast.success({ title: `Test delivery sent (${delivery.lastStatusCode ?? 200})` });
      } else {
        toast.warning({
          title: 'Test delivery failed',
          description:
            delivery.lastError ?? (delivery.lastStatusCode ? `Target answered ${delivery.lastStatusCode}` : undefined),
          action: { label: 'Deliveries', onAction: onDeliveries },
        });
      }
    } catch (e) {
      toast.error({ title: 'Failed to send test delivery', description: errorEnvelopeOf(e).message });
    }
  }

  async function setStatus(status: 'active' | 'inactive') {
    try {
      await updateWebhook(workspace, { webhookId: webhook.id, status });
    } catch (e) {
      toast.error({ title: 'Failed to update webhook', description: errorEnvelopeOf(e).message });
    }
  }

  return (
    <div className={d.tokenCard} data-testid="webhook-card">
      <div className={d.hookHeader}>
        <span className={d.hookUrl}>{webhook.targetUrl}</span>
        <span className={`${d.statusPill} ${statusClass}`}>{STATUS_LABEL[webhook.status]}</span>
        <span style={{ flex: 1 }} />
        <MenuTrigger>
          <IconButton icon="moreVertical" aria-label="More" variant="ghost" size={28} />
          <Menu aria-label="Webhook options" placement="bottom end" width={220}>
            {types.length > 1 ? (
              <Submenu label="Test subscription" icon="send" menuWidth={240}>
                {types.map((t) => (
                  <MenuItem key={t} id={`test:${t}`} icon={eventIcon(t)} onAction={() => void test(t)}>
                    {t}
                  </MenuItem>
                ))}
              </Submenu>
            ) : (
              <MenuItem icon="send" onAction={() => void test(types[0])}>
                Test subscription
              </MenuItem>
            )}
            <MenuItem icon="history" onAction={onDeliveries}>
              Deliveries
            </MenuItem>
            <MenuItem icon="key" onAction={onSecret}>
              Show secret
            </MenuItem>
            <MenuSeparator />
            {webhook.status === 'inactive' ? (
              <MenuItem icon="refresh" onAction={() => void setStatus('active')}>
                Activate
              </MenuItem>
            ) : (
              <MenuItem icon="hide" onAction={() => void setStatus('inactive')}>
                Deactivate
              </MenuItem>
            )}
            <MenuItem icon="edit" onAction={onEdit}>
              Edit
            </MenuItem>
            <MenuItem icon="delete" variant="danger" onAction={onDelete}>
              Delete
            </MenuItem>
          </Menu>
        </MenuTrigger>
      </div>
      <div className={d.eventChips}>
        {types.slice(0, 6).map((t) => (
          <span
            key={t}
            className={d.statusPill}
            style={{ backgroundColor: 'var(--ar-color-surface-tint)', color: 'var(--ar-color-content-secondary)' }}
          >
            {t}
          </span>
        ))}
        {types.length > 6 && (
          <span
            className={d.statusPill}
            style={{ backgroundColor: 'var(--ar-color-surface-tint)', color: 'var(--ar-color-content-secondary)' }}
          >
            +{types.length - 6}
          </span>
        )}
      </div>
      <p className={d.cardMeta}>
        {webhook.lastDeliveryAt
          ? `Last delivery ${new Date(webhook.lastDeliveryAt).toLocaleString()}`
          : 'No deliveries yet'}
      </p>
    </div>
  );
}

// ---- New / Edit dialog -----------------------------------------------------------------------------------------------

function EventPicker({ selected, onToggle }: { selected: Set<string>; onToggle: (event: AnyWebhookEvent) => void }) {
  const groups = eventGroups();
  // Picking an event adds its subscription (listed below) and closes the list.
  const [open, setOpen] = useState(false);
  return (
    <MenuTrigger isOpen={open} onOpenChange={setOpen}>
      <AriaButton className={d.pickerTrigger} aria-label="Events">
        <span className={d.pickerPlaceholder}>Search events</span>
        <Icon icon="chevronDown" size={16} />
      </AriaButton>
      <FilterableMenu
        aria-label="Events"
        placeholder="Search events"
        width={716}
        placement="bottom start"
        selectionMode="multiple"
        selectedKeys={selected}
        onAction={(key) => {
          onToggle(String(key) as AnyWebhookEvent);
          setOpen(false);
        }}
      >
        {groups.map(({ group, events }, i) => (
          <Fragment key={group}>
            {i > 0 && <MenuSeparator />}
            <MenuSection aria-label={group}>
              {events.map((event) => (
                <MenuItem key={event} id={event} icon={eventIcon(event)}>
                  {event}
                </MenuItem>
              ))}
            </MenuSection>
          </Fragment>
        ))}
      </FilterableMenu>
    </MenuTrigger>
  );
}

function WebhookDialog({
  webhook,
  onClose,
  onCreated,
}: {
  webhook: Webhook | null;
  onClose: () => void;
  onCreated: (webhook: Webhook, secret: string) => void;
}) {
  const { workspace } = useWorkspace();
  const [url, setUrl] = useState(webhook?.targetUrl ?? '');
  const [subs, setSubs] = useState<WebhookSubscription[]>(webhook?.subscriptions ?? []);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const selected = new Set(subs.map((s) => s.eventType));
  const toggle = (event: AnyWebhookEvent) => {
    setError(null);
    setSubs((prev) =>
      prev.some((s) => s.eventType === event)
        ? prev.filter((s) => s.eventType !== event)
        : [...prev, { eventType: event, filter: null }],
    );
  };

  async function save() {
    setUrlError(null);
    setError(null);
    const parsed = webhookTargetUrlSchema.safeParse(url.trim());
    if (!parsed.success) {
      setUrlError('Must provide secure URL');
      return;
    }
    if (subs.length === 0) {
      setError('Must have at least one event');
      return;
    }
    setPending(true);
    try {
      if (webhook) {
        await updateWebhook(workspace, { webhookId: webhook.id, targetUrl: parsed.data, subscriptions: subs });
        onClose();
      } else {
        const created = await createWebhook(workspace, { targetUrl: parsed.data, subscriptions: subs });
        onCreated(created, created.secret);
      }
    } catch (e) {
      const { code, message } = errorEnvelopeOf(e);
      setError(
        code === 'SUBSCRIPTION_CONFLICT'
          ? 'A webhook with this target URL and these events already exists'
          : (message ?? 'Failed to save webhook'),
      );
    } finally {
      setPending(false);
    }
  }

  async function test(event: AnyWebhookEvent) {
    if (!webhook) return;
    try {
      const delivery = await testWebhook(workspace, webhook.id, event);
      if (delivery.status === 'succeeded')
        toast.success({ title: `Test delivery sent (${delivery.lastStatusCode ?? 200})` });
      else toast.warning({ title: 'Test delivery failed', description: delivery.lastError ?? undefined });
    } catch (e) {
      toast.error({ title: 'Failed to send test delivery', description: errorEnvelopeOf(e).message });
    }
  }

  return (
    <Modal
      isOpen
      onOpenChange={(o) => !o && onClose()}
      size={748}
      aria-label={webhook ? 'Edit webhook' : 'New webhook'}
      overlay
    >
      <DialogHeader title={webhook ? 'Edit webhook' : 'New webhook'} onClose={onClose} />
      <div className={d.webhookBody} onKeyDown={submitOnModEnter(() => void save())}>
        <TextInput
          label="Target URL"
          size={32}
          autoFocus
          value={url}
          onChange={(v) => {
            setUrl(v);
            setUrlError(null);
          }}
          isInvalid={Boolean(urlError)}
          errorMessage={urlError ?? undefined}
        />
        <div>
          <span className={d.eventPickerLabel}>Events</span>
          <EventPicker selected={selected} onToggle={toggle} />
        </div>
        {subs.length > 0 && (
          <div className={d.eventList} role="list" aria-label="Subscriptions">
            {subs.map((sub) => (
              <div key={sub.eventType} role="listitem">
                <div className={d.eventRow}>
                  <Icon icon={eventIcon(sub.eventType)} size={16} />
                  <span className={d.eventName}>{sub.eventType}</span>
                  <MenuTrigger>
                    <IconButton
                      icon="moreVertical"
                      aria-label={`Options of ${sub.eventType}`}
                      variant="ghost"
                      size={20}
                    />
                    <Menu aria-label="Subscription options" placement="bottom end" width={200}>
                      {webhook && webhook.subscriptions.some((s) => s.eventType === sub.eventType) && (
                        <MenuItem icon="send" onAction={() => void test(sub.eventType as AnyWebhookEvent)}>
                          Test subscription
                        </MenuItem>
                      )}
                      <MenuItem
                        icon="delete"
                        variant="danger"
                        onAction={() => toggle(sub.eventType as AnyWebhookEvent)}
                      >
                        Remove subscription
                      </MenuItem>
                    </Menu>
                  </MenuTrigger>
                </div>
                {sub.filter && (
                  <p className={d.eventNote}>
                    This event is filtered to a subset of values. Please use the public API to view and edit event
                    filters.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
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

// ---- signing secret ----------------------------------------------------------------------------------------------------

function SecretDialog({
  target,
  onClose,
}: {
  target: { webhook: Webhook; secret?: string } | null;
  onClose: () => void;
}) {
  const { workspace } = useWorkspace();
  const known = target?.secret;
  const fetched = useWebhookSecret(workspace, target?.webhook.id ?? '', Boolean(target && !known));
  const secret = known ?? fetched.data?.secret ?? null;
  return (
    <Modal
      isOpen={target !== null}
      onOpenChange={(o) => !o && onClose()}
      size="medium"
      aria-label="Webhook secret"
      overlay
    >
      <DialogHeader title="Webhook signing secret" icon={<Icon icon="key" size={16} />} onClose={onClose} />
      <div className={d.dialogBody}>
        <p className={os.sectionDescription} style={{ margin: 0 }}>
          Deliveries to <b>{target?.webhook.targetUrl}</b> are signed with this secret: the{' '}
          <code>Agentic-CRM-Signature</code> header holds the HMAC-SHA256 of the request body.
        </p>
        <div className={d.secretRow}>
          <div className={d.secretBox}>
            <span className={d.secretText} data-testid="webhook-secret">
              {secret ?? 'Loading...'}
            </span>
            <IconButton
              icon="copy"
              aria-label="Copy secret"
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

// ---- deliveries log ------------------------------------------------------------------------------------------------------

const DELIVERY_STATUS: Record<WebhookDelivery['status'], string> = {
  pending: 'Pending',
  succeeded: 'Succeeded',
  failed: 'Failed',
};

function DeliveriesDialog({ webhook, onClose }: { webhook: Webhook | null; onClose: () => void }) {
  const { workspace } = useWorkspace();
  const deliveries = useDeliveries(workspace, webhook?.id ?? null);
  const [open, setOpen] = useState<string | null>(null);
  const rows = deliveries.data ?? [];
  return (
    <Modal isOpen={webhook !== null} onOpenChange={(o) => !o && onClose()} size="large" aria-label="Deliveries" overlay>
      <DialogHeader title="Deliveries" icon={<Icon icon="history" size={16} />} onClose={onClose} />
      <div className={d.dialogBody}>
        <p className={os.sectionDescription} style={{ margin: 0 }}>
          {webhook?.targetUrl}
        </p>
        {deliveries.isPending ? (
          <Skeleton shape="text" width={200} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="history"
            title="No deliveries yet"
            description="Deliveries appear here as events happen or when you test a subscription"
            style={{ padding: '24px 16px' }}
          />
        ) : (
          <div className={os.table} role="table" aria-label="Deliveries" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <div className={`${os.tableHeader} ${d.deliveriesGrid}`} role="row">
              <div className={os.headerCell} role="columnheader">
                Time
              </div>
              <div className={os.headerCell} role="columnheader">
                Event
              </div>
              <div className={os.headerCell} role="columnheader">
                Status
              </div>
              <div className={os.headerCell} role="columnheader">
                Code
              </div>
              <div className={os.headerCell} role="columnheader">
                Attempts
              </div>
            </div>
            {rows.map((row) => (
              <Fragment key={row.id}>
                <div
                  className={`${os.row} ${d.deliveriesGrid}`}
                  role="row"
                  tabIndex={0}
                  data-testid="delivery-row"
                  onClick={() => setOpen(open === row.id ? null : row.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setOpen(open === row.id ? null : row.id);
                  }}
                >
                  <div className={os.cell} role="cell">
                    {new Date(row.createdAt).toLocaleString()}
                  </div>
                  <div className={os.cell} role="cell">
                    <span className={os.cellText}>{row.eventType}</span>
                    {row.isTest && <span className={d.testBadge}>Test</span>}
                  </div>
                  <div className={os.cell} role="cell">
                    {DELIVERY_STATUS[row.status]}
                  </div>
                  <div className={os.cell} role="cell">
                    {row.lastStatusCode ?? '—'}
                  </div>
                  <div className={os.cell} role="cell">
                    {row.attempts}
                  </div>
                </div>
                {open === row.id && (
                  <div className={d.deliveryDetail}>
                    {row.lastError && <p className={d.dialogError}>{row.lastError}</p>}
                    {row.nextAttemptAt && row.status === 'pending' && (
                      <p className={d.cardMeta}>Next attempt {new Date(row.nextAttemptAt).toLocaleString()}</p>
                    )}
                    <pre className={d.payload}>{JSON.stringify(row.payload, null, 2)}</pre>
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="primary" size={28} onPress={onClose}>
          Done
        </Button>
      </DialogFooter>
    </Modal>
  );
}
