import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { askKeys } from '../../ask/data';

/**
 * A summary is "out of date" when a value changed after it was written, which the server reports on `get`. Value
 * edits do not invalidate the summary query themselves, so when a value list of this record is refetched (a value
 * changed here or in another tab) the summary is read again.
 */
export function useSummaryFreshness(workspaceId: string, entityDefinitionId: string, entityInstanceId: string): void {
  const client = useQueryClient();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = client.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'success') return;
      const key = event.query.queryKey;
      if (key[0] !== 'ws' || key[1] !== workspaceId || key[2] !== 'attribute-value-list') return;
      if (!key.includes(entityInstanceId)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(
        () =>
          void client.invalidateQueries({
            queryKey: askKeys.summary(workspaceId, entityDefinitionId, entityInstanceId),
          }),
        300,
      );
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [client, workspaceId, entityDefinitionId, entityInstanceId]);
}
