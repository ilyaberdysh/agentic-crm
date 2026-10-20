// TanStack Query client (D-03). Freshness comes from realtime invalidations, so server data stays fresh until told
// otherwise; failures are retried for network/5xx only. A 401 from any call starts the session re-check
// (K sessions.md §1.5).
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { isRetryable, isUnauthorized } from './trpc';

let onUnauthorized: (() => void) | null = null;

/** Registered by the session module: called when any request answers 401. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (isUnauthorized(error)) onUnauthorized?.();
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        if (isUnauthorized(error)) onUnauthorized?.();
      },
    }),
    defaultOptions: {
      queries: {
        // Invalidation-driven: realtime marks data stale; a reconnect after continuity loss refetches everything.
        staleTime: 5 * 60_000,
        gcTime: 30 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => isRetryable(error) && failureCount < 3,
      },
      mutations: { retry: false },
    },
  });
}

export const queryClient = createQueryClient();
