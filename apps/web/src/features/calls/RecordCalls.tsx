// The Calls tab of record pages (BACKLOG 10.15; D README §2.9, I calls §11.6; evidence/I/record-company-calls-tab.png): a
// "Calls" header and a grid of cards (call tile, title, concise summary, date, participants, duration). A company's calls
// are the meetings linked to it or with its people; a person's, the meetings they attend (`record` filter of the Calls
// list). New calls appear without a reload (the server invalidates `call-recording-list` for the touched records).
import { Skeleton } from '@agentic-crm/ui';
import type { ReactNode } from 'react';
import { CallCard } from './CallCard';
import * as s from './cards.css';
import { useRecordCalls } from './data';

interface RecordRefLike {
  entityDefinitionId: string;
  entityInstanceId: string;
}

/** The number of calls of the record (the tab's count badge). */
export function useRecordCallCount(record: RecordRefLike): number | null {
  const calls = useRecordCalls(record, 1);
  return calls.data ? calls.data.total : null;
}

export function RecordCallsTab({ recordRef, empty }: { recordRef: RecordRefLike; empty: ReactNode }) {
  const calls = useRecordCalls(recordRef);
  const items = calls.data?.items ?? [];
  if (calls.isPending)
    return (
      <div data-testid="calls-tab-loading">
        <div className={s.tabHeader}>Calls</div>
        <div className={s.grid}>
          {[0, 1].map((i) => (
            <div key={i} className={s.card} style={{ cursor: 'default' }}>
              <Skeleton width={160} height={12} />
              <div style={{ height: 12 }} />
              <Skeleton width={260} height={10} />
            </div>
          ))}
        </div>
      </div>
    );
  if (items.length === 0) return <>{empty}</>;
  return (
    <div data-testid="calls-tab">
      <div className={s.tabHeader}>Calls</div>
      <div className={s.grid}>
        {items.map((c) => (
          <CallCard key={c.id} call={c} variant="record" />
        ))}
      </div>
    </div>
  );
}
