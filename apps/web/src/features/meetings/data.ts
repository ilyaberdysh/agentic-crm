// Meetings on the client (BACKLOG 7.04; F README §2.4): one meeting, a calendar range of the viewer's own (Home), a
// record's meetings, the call recordings of a meeting, and writes (create, update, delete). Reads are TanStack
// queries under the `meeting` / `meeting-list` / `call-recording-list` resources of `emailKeys`; writes answer the
// canonical meeting plus a change seq and refresh the lists and the record timelines the meeting appears in.
import type { CreateMeetingInput, ListMeetingsInput, UpdateMeetingInput } from '@agentic-crm/contracts';
import { type QueryClient, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { emailKeys } from '../../data/emailKeys';
import { keys } from '../../data/keys';
import {
  api,
  httpStatusOf,
  inWorkspace,
  noteAcceptAfter,
  type RouterOutputs,
  type WorkspaceRef,
} from '../../data/trpc';
import { newId } from '../../lib/ids';
import { useWsRef } from '../email/data';

export type Meeting = RouterOutputs['meetings']['get'];
export type CallRecording = RouterOutputs['meetings']['recordings']['list'][number];

export { useWsRef };

const retry = (count: number, error: unknown) => httpStatusOf(error) !== 404 && count < 2;

/** One meeting; a 404 (no such meeting or none the viewer may see) is final. */
export function useMeeting(meetingId: string) {
  const ws = useWsRef();
  return useQuery({
    queryKey: emailKeys.meeting(ws.id, meetingId),
    queryFn: () => api.meetings.get.query({ meetingId }, inWorkspace(ws)),
    retry,
  });
}

/**
 * Several meetings by id (timeline events): one query per id under the meeting's own key, so they share the cache with
 * the modal; the tRPC link sends them in one HTTP batch. Ids that cannot be read are simply absent.
 */
export function useMeetingsById(meetingIds: readonly string[]): Map<string, Meeting> {
  const ws = useWsRef();
  const results = useQueries({
    queries: meetingIds.map((meetingId) => ({
      queryKey: emailKeys.meeting(ws.id, meetingId),
      queryFn: () => api.meetings.get.query({ meetingId }, inWorkspace(ws)),
      retry,
    })),
  });
  const stamp = results.map((r, i) => `${meetingIds[i]}:${r.dataUpdatedAt}`).join('|');
  return useMemo(
    () => new Map(results.flatMap((r): [string, Meeting][] => (r.data ? [[r.data.id, r.data]] : []))),
    [stamp],
  );
}

type ListParams = Omit<ListMeetingsInput, 'acceptAfter' | 'cursor'>;

/** Meetings in a calendar range, the viewer's own with `mine` (the Home widget). */
export function useMeetingsList(params: ListParams, enabled = true) {
  const ws = useWsRef();
  return useQuery({
    queryKey: emailKeys.meetings(ws.id, params),
    queryFn: () => api.meetings.list.query({ limit: 200, ...params }, inWorkspace(ws)),
    enabled,
    placeholderData: (prev) => prev,
  });
}

/** Call recordings of a meeting (transcript-only until slice 10). */
export function useRecordings(meetingId: string, enabled = true) {
  const ws = useWsRef();
  return useQuery({
    queryKey: emailKeys.recordings(ws.id, meetingId),
    queryFn: () => api.meetings.recordings.list.query({ meetingId }, inWorkspace(ws)),
    enabled,
  });
}

// ---- writes ----------------------------------------------------------------------------------------------------

const seqOf = (out: unknown): string | null => (out as { seq?: string | null } | null)?.seq ?? null;

async function settle(client: QueryClient, ws: WorkspaceRef, out: { meeting?: Meeting; seq?: string | null }) {
  noteAcceptAfter(ws.id, seqOf(out));
  if (out.meeting) client.setQueryData(emailKeys.meeting(ws.id, out.meeting.id), out.meeting);
  // A meeting shows in the Activity timeline of every record it touches and in the Home / record meeting lists.
  await Promise.all([
    client.invalidateQueries({ queryKey: keys.resource(ws.id, 'meeting-list') }),
    client.invalidateQueries({ queryKey: keys.resource(ws.id, 'record-timeline') }),
  ]);
}

export function useCreateMeeting() {
  const ws = useWsRef();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<CreateMeetingInput, 'id'> & { id?: string }) => {
      const out = await api.meetings.create.mutate({ id: input.id ?? newId(), ...input }, inWorkspace(ws));
      await settle(client, ws, out);
      return out.meeting;
    },
  });
}

export function useUpdateMeeting() {
  const ws = useWsRef();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateMeetingInput) => {
      const out = await api.meetings.update.mutate(input, inWorkspace(ws));
      await settle(client, ws, out);
      return out.meeting;
    },
  });
}

export function useDeleteMeeting() {
  const ws = useWsRef();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (meetingId: string) => {
      const out = await api.meetings.delete.mutate({ meetingId }, inWorkspace(ws));
      client.removeQueries({ queryKey: emailKeys.meeting(ws.id, meetingId) });
      await settle(client, ws, out);
      return out;
    },
  });
}
