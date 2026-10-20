// Developers data (BACKLOG 6.07; J workspace-admin §6): access tokens (`developers.tokens.*`) and webhooks
// (`webhooks.*`). Tokens answer their secret once on creation (only a hash is stored); webhooks keep a signing secret
// admins can read again. Both are admin-only.
import type {
  ApiScope,
  ApiToken,
  CreatedApiToken,
  CreatedWebhook,
  CreateWebhookInput,
  UpdateWebhookInput,
  Webhook,
  WebhookDelivery,
  WebhookSubscription,
} from '@agentic-crm/contracts';
import { webhookEventTypes } from '@agentic-crm/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { keys } from '../../../data/keys';
import { queryClient } from '../../../data/queryClient';
import { api, inWorkspace, type WorkspaceRef } from '../../../data/trpc';
import { newId } from '../../../lib/ids';
import { written } from '../admin/parts';

// ---- access tokens -----------------------------------------------------------------------------------------------

export const tokensQuery = (ws: WorkspaceRef) =>
  queryOptions({
    queryKey: keys.apiTokens(ws.id),
    queryFn: () => api.developers.tokens.list.query(undefined, inWorkspace(ws)) as Promise<ApiToken[]>,
  });

export function useTokens(ws: WorkspaceRef) {
  return useQuery(tokensQuery(ws));
}

export async function createToken(
  ws: WorkspaceRef,
  input: { name: string; scopes: ApiScope[] },
): Promise<CreatedApiToken> {
  const { token } = await written(ws, api.developers.tokens.create.mutate({ id: newId(), ...input }, inWorkspace(ws)));
  void queryClient.invalidateQueries({ queryKey: keys.apiTokens(ws.id) });
  return token as CreatedApiToken;
}

export async function updateToken(ws: WorkspaceRef, input: { tokenId: string; name?: string; scopes?: ApiScope[] }) {
  await written(ws, api.developers.tokens.update.mutate(input, inWorkspace(ws)));
  void queryClient.invalidateQueries({ queryKey: keys.apiTokens(ws.id) });
}

export async function deleteToken(ws: WorkspaceRef, tokenId: string) {
  await written(ws, api.developers.tokens.delete.mutate({ tokenId }, inWorkspace(ws)));
  void queryClient.invalidateQueries({ queryKey: keys.apiTokens(ws.id) });
}

/** One scope row of the token dialog: a resource with Disabled / Read / Read-write (J workspace-admin §6). */
export interface ScopeRow {
  resource: string;
  title: string;
  description: string;
}

export const SCOPE_ROWS: ScopeRow[] = [
  { resource: 'user_management', title: 'User Management', description: 'View workspace members.' },
  { resource: 'record_permission', title: 'Records', description: 'View, and optionally write, records.' },
  {
    resource: 'object_configuration',
    title: 'Object Configuration',
    description: 'View, and optionally write, the configuration and attributes of objects.',
  },
  { resource: 'list_entry', title: 'List Entries', description: 'View, and optionally write, the entries in a list.' },
  {
    resource: 'list_configuration',
    title: 'List Configuration',
    description: 'View, and optionally write, the configuration and attributes of lists.',
  },
  {
    resource: 'comment',
    title: 'Comments',
    description: 'View comments (and threads), and optionally write comments.',
  },
  { resource: 'note', title: 'Notes', description: 'View, and optionally write, notes.' },
  { resource: 'task', title: 'Tasks', description: 'View, and optionally write, tasks.' },
  { resource: 'meeting', title: 'Meetings', description: 'View, and optionally write, meetings.' },
  { resource: 'call_recording', title: 'Call Recordings', description: 'View, and optionally write, call recordings.' },
  { resource: 'file', title: 'Files', description: 'View, and upload files.' },
  {
    resource: 'sequence_unsubscribe',
    title: 'Sequence unsubscribe list',
    description: 'View, and optionally write, the sequence unsubscribe list.',
  },
  { resource: 'webhook', title: 'Webhooks', description: 'View, and optionally write, webhooks.' },
  {
    resource: 'public_collection',
    title: 'Public Collections',
    description: 'View, and optionally write, public collections.',
  },
  {
    resource: 'private_collection',
    title: 'Private Collections',
    description: 'View, and optionally write, private collections.',
  },
  { resource: 'email', title: 'Emails', description: 'View email metadata. Email content is never exposed.' },
  {
    resource: 'activity_configuration',
    title: 'Activity Configuration',
    description: 'View, and optionally write, activity configuration.',
  },
  { resource: 'activity_record', title: 'Activity Records', description: 'View, and optionally write, activities.' },
];

export type ScopeLevel = 'disabled' | 'read' | 'read-write';

/** The level of every resource of a token's scopes (read-write covers read). */
export function levelsOf(scopes: readonly string[]): Record<string, ScopeLevel> {
  const out: Record<string, ScopeLevel> = {};
  for (const row of SCOPE_ROWS) {
    out[row.resource] = scopes.includes(`${row.resource}:read-write`)
      ? 'read-write'
      : scopes.includes(`${row.resource}:read`)
        ? 'read'
        : 'disabled';
  }
  return out;
}

export function scopesOf(levels: Record<string, ScopeLevel>): ApiScope[] {
  const out: ApiScope[] = [];
  for (const [resource, level] of Object.entries(levels)) {
    if (level === 'read') out.push(`${resource}:read` as ApiScope);
    if (level === 'read-write') out.push(`${resource}:read-write` as ApiScope);
  }
  return out;
}

// ---- webhooks ----------------------------------------------------------------------------------------------------

export const webhooksQuery = (ws: WorkspaceRef) =>
  queryOptions({
    queryKey: keys.webhooks(ws.id),
    queryFn: () => api.webhooks.list.query(undefined, inWorkspace(ws)) as Promise<Webhook[]>,
  });

export function useWebhooks(ws: WorkspaceRef) {
  return useQuery(webhooksQuery(ws));
}

export const deliveriesQuery = (ws: WorkspaceRef, webhookId: string) =>
  queryOptions({
    queryKey: [...keys.webhook(ws.id, webhookId), 'deliveries'] as const,
    queryFn: () =>
      api.webhooks.deliveries.query({ webhookId, limit: 50 }, inWorkspace(ws)) as Promise<WebhookDelivery[]>,
  });

export function useDeliveries(ws: WorkspaceRef, webhookId: string | null) {
  return useQuery({ ...deliveriesQuery(ws, webhookId ?? ''), enabled: Boolean(webhookId), refetchInterval: 4000 });
}

export function useWebhookSecret(ws: WorkspaceRef, webhookId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...keys.webhook(ws.id, webhookId), 'secret'] as const,
    queryFn: () => api.webhooks.secret.query({ webhookId }, inWorkspace(ws)),
    enabled,
    staleTime: Infinity,
  });
}

function refreshWebhooks(ws: WorkspaceRef, webhookId?: string) {
  void queryClient.invalidateQueries({ queryKey: keys.webhooks(ws.id) });
  if (webhookId) void queryClient.invalidateQueries({ queryKey: keys.webhook(ws.id, webhookId) });
}

export async function createWebhook(ws: WorkspaceRef, input: Omit<CreateWebhookInput, 'id'>): Promise<CreatedWebhook> {
  const { webhook } = await written(ws, api.webhooks.create.mutate({ id: newId(), ...input }, inWorkspace(ws)));
  refreshWebhooks(ws, webhook.id);
  return webhook as CreatedWebhook;
}

export async function updateWebhook(ws: WorkspaceRef, input: UpdateWebhookInput) {
  await written(ws, api.webhooks.update.mutate(input, inWorkspace(ws)));
  refreshWebhooks(ws, input.webhookId);
}

export async function deleteWebhook(ws: WorkspaceRef, webhookId: string) {
  await written(ws, api.webhooks.delete.mutate({ webhookId }, inWorkspace(ws)));
  refreshWebhooks(ws, webhookId);
}

export type AnyWebhookEvent = WebhookSubscription['eventType'];

export async function testWebhook(ws: WorkspaceRef, webhookId: string, eventType?: AnyWebhookEvent) {
  const { delivery } = await written(
    ws,
    api.webhooks.test.mutate({ webhookId, ...(eventType ? { eventType } : {}) }, inWorkspace(ws)),
  );
  void queryClient.invalidateQueries({ queryKey: [...keys.webhook(ws.id, webhookId), 'deliveries'] });
  refreshWebhooks(ws, webhookId);
  return delivery as WebhookDelivery;
}

/** Event types by resource group, in the order the picker lists them (J workspace-admin §6, raw s74-events). */
export function eventGroups(): { group: string; events: AnyWebhookEvent[] }[] {
  const groups = new Map<string, AnyWebhookEvent[]>();
  for (const e of [...webhookEventTypes].sort()) {
    const group = e.split('.')[0] as string;
    groups.set(group, [...(groups.get(group) ?? []), e]);
  }
  return [...groups.entries()].map(([group, events]) => ({ group, events }));
}
