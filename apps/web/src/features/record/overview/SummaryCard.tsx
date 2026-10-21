// AI record summary (BACKLOG 10.07;  item 4): "{Noun} summary" with "Generated at {time}" and a
// regenerate button, from `records.summary.get` (never calls the model) and `regenerate` (the bulk model over the
// record's values, recent notes and open tasks). Shows Generate when none exists, "Out of date" when a value changed
// after generation, and a note instead of a button when the server has no AI key.
import { Button, IconButton, Skeleton, toast } from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, inWorkspace, noteAcceptAfter } from '../../../data/trpc';
import { aiErrorMessage } from '../../ask/actions';
import { askKeys, useModels, useRecordSummary } from '../../ask/data';
import { useWorkspaceRef } from '../../notes/data';
import { useRecordPage } from '../context';
import * as o from './overview.css';
import * as s from './summaryCard.css';
import { useSummaryFreshness } from './useSummaryFreshness';

export function SummaryCard() {
  const { object, recordRef } = useRecordPage();
  const ws = useWorkspaceRef();
  const client = useQueryClient();
  const models = useModels();
  // Saved targets currently power Ask text answers; summaries still require the server's configured LLM.
  const configured = models.data?.models.some((m) => m.isAuto && !m.isUnavailable) ?? true;
  const summary = useRecordSummary(recordRef.entityDefinitionId, recordRef.entityInstanceId);
  useSummaryFreshness(ws.id, recordRef.entityDefinitionId, recordRef.entityInstanceId);
  const [busy, setBusy] = useState(false);
  const noun = object.singularNoun;

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { seq, ...result } = await api.records.summary.regenerate.mutate({ recordRef }, inWorkspace(ws));
      noteAcceptAfter(ws.id, seq);
      client.setQueryData(askKeys.summary(ws.id, recordRef.entityDefinitionId, recordRef.entityInstanceId), result);
    } catch (error) {
      toast.error({ title: 'Failed to generate the summary', description: aiErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const data = summary.data?.summary ?? null;
  const generatedAt = data
    ? new Date(data.generatedAt).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  return (
    <section className={o.section} aria-label={`${noun} summary`} data-testid="overview-summary">
      <div className={o.sectionHeader}>
        <h3 className={o.sectionTitle}>{noun} summary</h3>
        {data && configured && (
          <span className={o.sectionActions}>
            <IconButton
              icon="refresh"
              variant="ghost"
              size={20}
              aria-label="Regenerate summary"
              tooltip="Regenerate"
              isPending={busy}
              onPress={() => void generate()}
              data-testid="summary-regenerate"
            />
          </span>
        )}
      </div>
      <div className={s.card}>
        {summary.isPending ? (
          <Skeleton width="100%" height={48} />
        ) : !configured ? (
          <p className={s.muted} data-testid="summary-not-configured">
            Ask AI isn't set up yet, so summaries are unavailable.
          </p>
        ) : data ? (
          <>
            <p className={s.body} data-testid="summary-text">
              {data.text}
            </p>
            <div className={s.meta}>
              <span>Generated at {generatedAt}</span>
              {data.stale && (
                <span className={s.stale} data-testid="summary-stale">
                  Out of date
                </span>
              )}
            </div>
          </>
        ) : (
          <div className={s.empty}>
            <p className={s.muted}>Summarize this {noun.toLowerCase()} from its values, notes and tasks.</p>
            <Button
              variant="secondary"
              size={28}
              icon="askAi"
              isPending={busy}
              onPress={() => void generate()}
              data-testid="summary-generate"
            >
              Generate
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
