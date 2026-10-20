// Drafts, outbox and templates on the client (BACKLOG 7.06–7.07; F composer §2–6). Reads are TanStack queries under the
// realtime resources of `emailKeys`; the composer window itself works on a `ComposerSession` (./session.ts), these
// hooks serve the Emails page, the dock and the template views.
import type { CreateTemplateInput, UpdateTemplateInput } from '@agentic-crm/contracts';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { emailKeys } from '../../data/emailKeys';
import { keys } from '../../data/keys';
import { api, inWorkspace, noteAcceptAfter, type RouterOutputs, type WorkspaceRef } from '../../data/trpc';
import { newId } from '../../lib/ids';
import { useWs } from '../mailboxes/data';

export type Draft = RouterOutputs['email']['drafts']['get'];
export type OutboxItem = RouterOutputs['email']['outbox']['list'][number];
export type EmailTemplate = RouterOutputs['email']['templates']['get'];
export type ReviewResult = RouterOutputs['email']['drafts']['review'];

const seqOf = (out: unknown): string | null => (out as { seq?: string | null } | null)?.seq ?? null;

async function settle(
  client: QueryClient,
  ws: WorkspaceRef,
  out: unknown,
  resources: Parameters<typeof keys.resource>[1][],
): Promise<void> {
  noteAcceptAfter(ws.id, seqOf(out));
  await Promise.all(resources.map((r) => client.invalidateQueries({ queryKey: keys.resource(ws.id, r) })));
}

// ---- drafts -------------------------------------------------------------------------------------------------------

/** The member's open drafts, newest first (Drafts tab). */
export function useDrafts() {
  const ws = useWs();
  return useQuery({
    queryKey: emailKeys.drafts(ws.id),
    queryFn: () => api.email.drafts.list.query(undefined, inWorkspace(ws)),
  });
}

/** One draft (dock bubble title); the window works on its session instead. */
export function useDraft(draftId: string | null) {
  const ws = useWs();
  return useQuery({
    queryKey: emailKeys.draft(ws.id, draftId ?? ''),
    queryFn: () => api.email.drafts.get.query({ draftId: draftId as string }, inWorkspace(ws)),
    enabled: Boolean(draftId),
    retry: false,
  });
}

export async function deleteDraft(client: QueryClient, ws: WorkspaceRef, draftId: string): Promise<void> {
  const out = await api.email.drafts.delete.mutate({ draftId }, inWorkspace(ws));
  noteAcceptAfter(ws.id, out.seq);
  client.removeQueries({ queryKey: emailKeys.draft(ws.id, draftId) });
  // The list drops the row at once (the Drafts tab counter and the toast follow).
  client.setQueriesData<Draft[]>({ queryKey: emailKeys.drafts(ws.id) }, (prev) =>
    prev ? prev.filter((d) => d.id !== draftId) : prev,
  );
  void client.invalidateQueries({ queryKey: emailKeys.drafts(ws.id) });
}

// ---- outbox -------------------------------------------------------------------------------------------------------

/** Scheduled and erroring emails plus failures of the last three months (oldest delivery first). */
export function useOutbox() {
  const ws = useWs();
  return useQuery({
    queryKey: emailKeys.outbox(ws.id),
    queryFn: () => api.email.outbox.list.query(undefined, inWorkspace(ws)),
    // Delivery state moves on its own (the worker sends when due): keep the list fresh while it is open.
    refetchInterval: 15_000,
  });
}

export function useCancelOutbox() {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ids: string[] } | { all: true }) => {
      const out = await api.email.outbox.cancel.mutate(input, inWorkspace(ws));
      await settle(client, ws, out, ['outbox']);
      return out.canceled;
    },
  });
}

// ---- templates ----------------------------------------------------------------------------------------------------

export function useTemplates() {
  const ws = useWs();
  return useQuery({
    queryKey: emailKeys.templates(ws.id),
    queryFn: () => api.email.templates.list.query(undefined, inWorkspace(ws)),
  });
}

export function useTemplate(templateId: string | null) {
  const ws = useWs();
  return useQuery({
    queryKey: emailKeys.template(ws.id, templateId ?? ''),
    queryFn: () => api.email.templates.get.query({ templateId: templateId as string }, inWorkspace(ws)),
    enabled: Boolean(templateId),
    retry: false,
  });
}

/** Creates an empty template ("Create email template", "New template"): the title stays empty ("Untitled Template"). */
export async function createTemplateNow(client: QueryClient, ws: WorkspaceRef): Promise<EmailTemplate> {
  const out = await api.email.templates.create.mutate({ id: newId(), title: '' }, inWorkspace(ws));
  client.setQueryData(emailKeys.template(ws.id, out.template.id), out.template);
  noteAcceptAfter(ws.id, out.seq);
  await client.invalidateQueries({ queryKey: emailKeys.templates(ws.id) });
  return out.template;
}

export function useCreateTemplate() {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<Omit<CreateTemplateInput, 'id'>> = {}) => {
      const out = await api.email.templates.create.mutate({ id: newId(), title: '', ...input }, inWorkspace(ws));
      client.setQueryData(emailKeys.template(ws.id, out.template.id), out.template);
      await settle(client, ws, out, ['email-template-list']);
      return out.template;
    },
  });
}

/** Writes template fields (autosave from the editor); the answer is the canonical template. */
export async function updateTemplate(
  client: QueryClient,
  ws: WorkspaceRef,
  input: UpdateTemplateInput,
): Promise<EmailTemplate> {
  const out = await api.email.templates.update.mutate(input, inWorkspace(ws));
  noteAcceptAfter(ws.id, out.seq);
  client.setQueryData(emailKeys.template(ws.id, out.template.id), out.template);
  client.setQueriesData<EmailTemplate[]>({ queryKey: emailKeys.templates(ws.id) }, (prev) =>
    prev?.map((t) => (t.id === out.template.id ? out.template : t)),
  );
  return out.template;
}

export function useDeleteTemplate() {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (templateId: string) => {
      const out = await api.email.templates.delete.mutate({ templateId }, inWorkspace(ws));
      client.removeQueries({ queryKey: emailKeys.template(ws.id, templateId) });
      client.setQueriesData<EmailTemplate[]>({ queryKey: emailKeys.templates(ws.id) }, (prev) =>
        prev?.filter((t) => t.id !== templateId),
      );
      await settle(client, ws, out, ['email-template-list']);
      return out;
    },
  });
}

export function useFavoriteTemplate() {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { templateId: string; favorite: boolean }) => {
      const out = await api.email.templates.favorite.mutate(input, inWorkspace(ws));
      client.setQueryData(emailKeys.template(ws.id, out.template.id), out.template);
      client.setQueriesData<EmailTemplate[]>({ queryKey: emailKeys.templates(ws.id) }, (prev) =>
        prev?.map((t) => (t.id === out.template.id ? out.template : t)),
      );
      await settle(client, ws, out, ['email-template-list']);
      return out.template;
    },
  });
}
