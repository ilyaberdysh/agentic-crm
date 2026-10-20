// Record search for ⌘K, the Search modal and the pickers. One request per keystroke (no
// debounce, by design); the response of a superseded request never overwrites a newer one (SearchGuard +
// `requestSeq` echoed by the server).
import type { SearchRecordHit, SearchRecordsOutput } from '@agentic-crm/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, inWorkspace } from '../../data/trpc';
import { useWorkspace } from '../shell/workspaceContext';
import { nextRequestSeq, SearchGuard } from './guard';

export interface RecordSearchState {
  /** Hits of the newest applied response ([] until one arrived). */
  hits: SearchRecordHit[];
  groups: SearchRecordsOutput['groups'];
  /** The query the shown hits answer (null before the first response). */
  answeredQuery: string | null;
  /** A request is in flight. */
  isFetching: boolean;
  error: Error | null;
}

const EMPTY: RecordSearchState = { hits: [], groups: [], answeredQuery: null, isFetching: false, error: null };

export function useRecordSearch(
  query: string,
  options: { enabled?: boolean; limit?: number; entityDefinitionIds?: string[] } = {},
): RecordSearchState {
  const { workspace } = useWorkspace();
  const { enabled = true, limit = 20 } = options;
  const objectKey = options.entityDefinitionIds?.join(',') ?? '';
  const guard = useRef<SearchGuard | null>(null);
  guard.current ??= new SearchGuard();
  const [state, setState] = useState<RecordSearchState>(EMPTY);
  const ws = useMemo(() => ({ id: workspace.id, slug: workspace.slug }), [workspace.id, workspace.slug]);

  useEffect(() => {
    if (!enabled) return;
    const seq = nextRequestSeq();
    let alive = true;
    setState((s) => ({ ...s, isFetching: true }));
    api.search.records
      .query(
        {
          query,
          requestSeq: seq,
          limit,
          ...(objectKey ? { entityDefinitionIds: objectKey.split(',') } : {}),
        },
        inWorkspace(ws),
      )
      .then((res) => {
        if (!alive) return;
        // `res.requestSeq` echoes ours; a response older than the newest applied one is dropped.
        if (!guard.current?.accept(res.requestSeq ?? seq)) return;
        setState({ hits: res.hits, groups: res.groups, answeredQuery: query, isFetching: false, error: null });
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setState((s) => ({
          ...s,
          isFetching: false,
          error: error instanceof Error ? error : new Error(String(error)),
        }));
      });
    return () => {
      alive = false;
    };
  }, [query, enabled, limit, objectKey, ws]);

  return state;
}
