// Record states without a page (BACKLOG 3.11; D README §2.6): not found / deleted ("Go back"), merged away ("Go to
// record" → the record it was merged into, "Learn more about merging"), merge in progress, and no access. A centred
// 270 px column, no top bar. The illustration is drawn for this project (a dashed box and a question mark).
import { Button, Spinner, toast } from '@agentic-crm/ui';
import { useRouter } from '@tanstack/react-router';
import * as s from './states.css';

export type RecordStateKind = 'not-found' | 'merged' | 'merging' | 'no-access';

export function RecordStatePage({
  kind,
  onGoToRecord,
  onGoBack,
}: {
  kind: RecordStateKind;
  onGoToRecord?: () => void;
  onGoBack?: () => void;
}) {
  const router = useRouter();
  const back = onGoBack ?? (() => router.history.back());
  return (
    <div className={s.page} data-testid="record-state" data-state={kind}>
      <div className={s.column}>
        <Illustration />
        {kind === 'merging' ? (
          <>
            <h1 className={s.title}>Record merge in progress</h1>
            <p className={s.text}>The record you're trying to view is currently being merged with another record.</p>
            <Spinner size={16} />
          </>
        ) : kind === 'merged' ? (
          <>
            <h1 className={s.title}>This record cannot be found</h1>
            <p className={s.text}>
              It seems like the record you're trying to view is no longer available because it has been merged with
              another record.
            </p>
            {onGoToRecord && (
              <Button variant="primary" size={32} onPress={onGoToRecord}>
                Go to record
              </Button>
            )}
            <Button
              variant="ghost"
              size={32}
              onPress={() =>
                toast({
                  title: 'Merging records',
                  description:
                    'Merging combines two records into a new one; links to the old records lead to the merged record.',
                })
              }
            >
              Learn more about merging
            </Button>
          </>
        ) : kind === 'no-access' ? (
          <>
            <h1 className={s.title}>You don't have access to this record</h1>
            <p className={s.text}>Ask a workspace admin to give you access to this object.</p>
            <Button variant="primary" size={32} onPress={back}>
              Go back
            </Button>
          </>
        ) : (
          <>
            <h1 className={s.title}>This record cannot be found</h1>
            <p className={s.text}>It seems like the record you're trying to view does not exist or has been deleted.</p>
            <Button variant="primary" size={32} onPress={back}>
              Go back
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export function Illustration() {
  return (
    <svg className={s.illustration} width="140" height="140" viewBox="0 0 140 140" fill="none" aria-hidden="true">
      <g className={s.dashed} strokeDasharray="3 3" strokeWidth="1">
        <path d="M24 74 L56 56 L88 74 L56 92 Z" />
        <path d="M24 74 V112 L56 130 V92" />
        <path d="M88 74 V112 L56 130" />
      </g>
      <g className={s.accent} strokeWidth="1.25" strokeLinejoin="round">
        <path d="M70 32c0-13 11-22 24-22s24 9 24 22c0 10-6 15-12 19-5 3-7 6-7 10v4H88v-5c0-8 4-12 9-15 4-3 8-6 8-12 0-6-5-10-11-10s-11 4-11 11H70z" />
        <path d="M88 72h11v13l-5.5 3L88 85z" />
      </g>
    </svg>
  );
}

export function RecordLoading() {
  return (
    <div className={s.page}>
      <Spinner size={16} />
    </div>
  );
}
