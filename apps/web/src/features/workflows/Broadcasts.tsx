// Broadcast message and Celebration steps on the receiving side (block-catalog §4 `send-workspace-toast`,
// `send-workspace-celebration`): a 'workflow-broadcast' invalidation refetches the broadcasts since this tab opened;
// each new one shows once — a toast in the chosen style, or confetti across the workspace.
import { toast } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { keys } from '../../data/keys';
import { api, inWorkspace } from '../../data/trpc';
import { fireConfetti } from '../kanban/confetti';
import { useWs } from './data';

interface ToastPayload {
  variant?: 'neutral' | 'success' | 'warning' | 'error';
  title?: string;
  description?: string | null;
  durationSeconds?: number | null;
}

export function WorkflowBroadcasts() {
  const ws = useWs();
  const since = useRef(new Date().toISOString());
  const seen = useRef(new Set<string>());
  const query = useQuery({
    queryKey: [...keys.resource(ws.id, 'workflow-broadcast'), since.current],
    queryFn: () => api.workflows.broadcasts.query({ since: since.current }, inWorkspace(ws)),
    refetchOnWindowFocus: false,
    retry: false,
  });
  useEffect(() => {
    for (const b of query.data?.broadcasts ?? []) {
      if (seen.current.has(b.id)) continue;
      seen.current.add(b.id);
      if (b.kind === 'celebration') {
        fireConfetti();
        continue;
      }
      const p = (typeof b.payload === 'string' ? JSON.parse(b.payload) : b.payload) as ToastPayload;
      const show = p.variant && p.variant !== 'neutral' ? toast[p.variant] : toast;
      show({
        title: p.title ?? 'Workflow message',
        ...(p.description ? { description: p.description } : {}),
        ...(p.durationSeconds ? { durationMs: p.durationSeconds * 1000 } : {}),
      });
    }
  }, [query.data]);
  return null;
}
