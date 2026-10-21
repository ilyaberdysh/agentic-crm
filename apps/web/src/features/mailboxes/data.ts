// Mailboxes, signatures and workspace email settings on the client (BACKLOG 7.08; F settings). Reads are TanStack
// queries under the realtime resources of `emailKeys`; writes answer the canonical item plus a change seq (the next
// reads are not served older than it) and refresh the affected prefixes.
import type {
  AddBlocklistInput,
  AddContactsInput,
  AddProtectedContactsInput,
  ConnectMailboxInput,
  CreateSignatureInput,
  UpdateMailboxInput,
  UpdateSignatureInput,
  UpdateWorkspaceEmailSettingsInput,
} from '@agentic-crm/contracts';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { emailKeys } from '../../data/emailKeys';
import { keys } from '../../data/keys';
import { api, inWorkspace, noteAcceptAfter, type RouterOutputs, type WorkspaceRef } from '../../data/trpc';
import { newId } from '../../lib/ids';
import { useWorkspace } from '../shell/workspaceContext';

export type Mailbox = RouterOutputs['mailboxes']['list'][number];
export type BlocklistEntry = RouterOutputs['mailboxes']['blocklist']['list'][number];
export type MailboxSignature = RouterOutputs['email']['signatures']['list'][number];
export type WorkspaceEmailSettings = RouterOutputs['workspaceEmail']['settings']['get'];
export type ProtectedContact = RouterOutputs['workspaceEmail']['protectedContacts']['list'][number];
export type Suppression = RouterOutputs['suppression']['list'];
export type SuppressionEntry = Suppression['domains'][number];
export type SharingGrant = RouterOutputs['mailboxes']['sharing']['list'][number];
export type WorkspaceMemberRow = RouterOutputs['members']['list'][number];

export function useWs(): WorkspaceRef {
  const { workspace } = useWorkspace();
  return { id: workspace.id, slug: workspace.slug };
}

const seqOf = (out: unknown): string | null => (out as { seq?: string | null } | null)?.seq ?? null;

/** Notes the write's seq and refreshes the given resource prefixes. */
async function settle(
  client: QueryClient,
  ws: WorkspaceRef,
  out: unknown,
  resources: Parameters<typeof keys.resource>[1][],
): Promise<void> {
  noteAcceptAfter(ws.id, seqOf(out));
  await Promise.all(resources.map((r) => client.invalidateQueries({ queryKey: keys.resource(ws.id, r) })));
}

// ---- reads ----------------------------------------------------------------------------------------------------

/** The member's mailboxes (settings → accounts; the composer's sender). `memberId` = admins viewing another member. */
export function useMailboxes(params: { memberId?: string; includeArchived?: boolean } = {}, enabled = true) {
  const ws = useWs();
  return useQuery({
    queryKey: emailKeys.mailboxes(ws.id, params),
    queryFn: () => api.mailboxes.list.query(params, inWorkspace(ws)),
    enabled,
  });
}

export function useMailbox(mailboxId: string | undefined) {
  const ws = useWs();
  return useQuery({
    queryKey: emailKeys.mailbox(ws.id, mailboxId ?? ''),
    queryFn: () => api.mailboxes.get.query({ mailboxId: mailboxId as string }, inWorkspace(ws)),
    enabled: Boolean(mailboxId),
  });
}

export function useBlocklist(mailboxId: string) {
  const ws = useWs();
  return useQuery({
    queryKey: emailKeys.blocklist(ws.id, mailboxId),
    queryFn: () => api.mailboxes.blocklist.list.query({ mailboxId }, inWorkspace(ws)),
  });
}

export function useMailboxSharing(mailboxId: string) {
  const ws = useWs();
  return useQuery({
    queryKey: emailKeys.mailboxSharing(ws.id, mailboxId),
    queryFn: () => api.mailboxes.sharing.list.query({ mailboxId }, inWorkspace(ws)),
  });
}

export function useSignatures(mailboxId: string | null | undefined) {
  const ws = useWs();
  return useQuery({
    queryKey: emailKeys.signatures(ws.id, mailboxId ?? ''),
    queryFn: () => api.email.signatures.list.query({ mailboxId: mailboxId as string }, inWorkspace(ws)),
    enabled: Boolean(mailboxId),
  });
}

/** Workspace members (the "Add person" picker, names of granted people). Shares the cache of the other pickers. */
export function useWorkspaceMembers() {
  const ws = useWs();
  return useQuery({
    queryKey: keys.members(ws.id),
    queryFn: () => api.members.list.query(undefined, inWorkspace(ws)),
  });
}

export function useWorkspaceEmailSettings() {
  const ws = useWs();
  return useQuery({
    queryKey: emailKeys.workspaceSettings(ws.id),
    queryFn: () => api.workspaceEmail.settings.get.query(undefined, inWorkspace(ws)),
  });
}

export function useProtectedContacts() {
  const ws = useWs();
  return useQuery({
    queryKey: emailKeys.protectedContacts(ws.id),
    queryFn: () => api.workspaceEmail.protectedContacts.list.query(undefined, inWorkspace(ws)),
  });
}

export function useSuppression() {
  const ws = useWs();
  return useQuery({
    queryKey: emailKeys.suppression(ws.id),
    queryFn: () => api.suppression.list.query(undefined, inWorkspace(ws)),
  });
}

/** Providers this server can connect (Google needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET on the server). */
export function useMailboxProviders() {
  const ws = useWs();
  return useQuery({
    queryKey: ['ws', ws.id, 'mailbox-providers'] as const,
    queryFn: () => api.mailboxes.providers.query(undefined, inWorkspace(ws)),
    staleTime: 5 * 60_000,
  });
}

// ---- writes: mailboxes ----------------------------------------------------------------------------------------

/**
 * "Connect Google Account" / "Reconnect": asks the server for the start URL of Google's consent and leaves
 * the UI for it; Google sends the browser back to the accounts page with `?google=…` (see googleReturnMessage).
 */
export function useConnectGoogle() {
  const ws = useWs();
  return useMutation({
    mutationFn: async (mailboxId?: string) => {
      const out = await api.mailboxes.authorize.mutate(
        { provider: 'google', ...(mailboxId ? { mailboxId } : {}) },
        inWorkspace(ws),
      );
      window.location.assign(out.authorizationUrl);
      return out;
    },
  });
}

const mailboxResources = ['mailbox-list', 'mailbox'] as const;

export function useConnectMailbox() {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<ConnectMailboxInput, 'id'>) => {
      const out = await api.mailboxes.connect.mutate({ id: newId(), ...input }, inWorkspace(ws));
      await settle(client, ws, out, [...mailboxResources]);
      return out.mailbox;
    },
  });
}

export function useUpdateMailbox() {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateMailboxInput) => {
      const out = await api.mailboxes.update.mutate(input, inWorkspace(ws));
      client.setQueryData(emailKeys.mailbox(ws.id, out.mailbox.id), out.mailbox);
      await settle(client, ws, out, ['mailbox-list']);
      return out.mailbox;
    },
  });
}

export function useDisconnectMailbox() {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (mailboxId: string) => {
      const out = await api.mailboxes.disconnect.mutate({ mailboxId }, inWorkspace(ws));
      await settle(client, ws, out, [...mailboxResources, 'email-thread-list', 'meeting-list']);
      return out.mailbox;
    },
  });
}

export function useSyncMailbox() {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (mailboxId: string) => {
      const out = await api.mailboxes.sync.mutate({ mailboxId }, inWorkspace(ws));
      await settle(client, ws, out, [...mailboxResources]);
      return out;
    },
  });
}

// ---- writes: blocklist and individual sharing ---------------------------------------------------------------------

export function useAddBlocklist(mailboxId: string) {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (values: AddBlocklistInput['values']) => {
      const out = await api.mailboxes.blocklist.add.mutate({ mailboxId, values }, inWorkspace(ws));
      await settle(client, ws, out, ['mailbox-blocklist']);
      return out;
    },
  });
}

export function useRemoveBlocklist() {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const out = await api.mailboxes.blocklist.remove.mutate({ id }, inWorkspace(ws));
      await settle(client, ws, out, ['mailbox-blocklist']);
      return out;
    },
  });
}

export function useAddSharing(mailboxId: string) {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (memberId: string) => {
      const out = await api.mailboxes.sharing.add.mutate({ mailboxId, memberId }, inWorkspace(ws));
      await settle(client, ws, out, ['email-grant-list', 'email-thread-list']);
      return out.grant;
    },
  });
}

export function useRemoveSharing() {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (grantId: string) => {
      const out = await api.mailboxes.sharing.remove.mutate({ grantId }, inWorkspace(ws));
      await settle(client, ws, out, ['email-grant-list', 'email-thread-list']);
      return out;
    },
  });
}

// ---- writes: signatures -------------------------------------------------------------------------------------------

export function useCreateSignature(mailboxId: string) {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<Omit<CreateSignatureInput, 'mailboxId'>> = {}) => {
      const out = await api.email.signatures.create.mutate({ id: newId(), mailboxId, ...input }, inWorkspace(ws));
      await settle(client, ws, out, ['mailbox-signature-list', 'mailbox-list']);
      return out.signature;
    },
  });
}

export function useUpdateSignature() {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateSignatureInput) => {
      const out = await api.email.signatures.update.mutate(input, inWorkspace(ws));
      await settle(client, ws, out, ['mailbox-signature-list']);
      return out.signature;
    },
  });
}

export function useSetDefaultSignature() {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { signatureId: string; isDefault: boolean }) => {
      const out = await api.email.signatures.setDefault.mutate(input, inWorkspace(ws));
      await settle(client, ws, out, ['mailbox-signature-list', 'mailbox-list']);
      return out.signature;
    },
  });
}

export function useDeleteSignature() {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (signatureId: string) => {
      const out = await api.email.signatures.delete.mutate({ signatureId }, inWorkspace(ws));
      await settle(client, ws, out, ['mailbox-signature-list', 'mailbox-list']);
      return out;
    },
  });
}

// ---- writes: workspace settings (admins) --------------------------------------------------------------------------

export function useUpdateWorkspaceEmailSettings() {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateWorkspaceEmailSettingsInput) => {
      const out = await api.workspaceEmail.settings.update.mutate(input, inWorkspace(ws));
      client.setQueryData(emailKeys.workspaceSettings(ws.id), out.settings);
      await settle(client, ws, out, ['workspace-email-settings']);
      return out.settings;
    },
  });
}

export function useAddProtectedContacts() {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddProtectedContactsInput) => {
      const out = await api.workspaceEmail.protectedContacts.add.mutate(input, inWorkspace(ws));
      await settle(client, ws, out, ['workspace-email-settings']);
      return out;
    },
  });
}

export function useUpdateProtectedContact() {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; enforcement: 'protected' | 'blocked' }) => {
      const out = await api.workspaceEmail.protectedContacts.update.mutate(input, inWorkspace(ws));
      await settle(client, ws, out, ['workspace-email-settings']);
      return out.contact;
    },
  });
}

export function useRemoveProtectedContact() {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const out = await api.workspaceEmail.protectedContacts.remove.mutate({ id }, inWorkspace(ws));
      await settle(client, ws, out, ['workspace-email-settings']);
      return out;
    },
  });
}

export function useAddSuppression() {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (values: AddContactsInput['values']) => {
      const out = await api.suppression.add.mutate({ values }, inWorkspace(ws));
      await settle(client, ws, out, ['workspace-email-settings']);
      return out;
    },
  });
}

export function useRemoveSuppression() {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const out = await api.suppression.remove.mutate({ id }, inWorkspace(ws));
      await settle(client, ws, out, ['workspace-email-settings']);
      return out;
    },
  });
}
