// Step 4 — Preview import (C2; evidence import-4-preview.png): the duplicates info alert, the rows that
// will not be imported (listed before the run,  acc. 4), tabs per object, "+ Up to N will be created ·
// ↻ N will be updated · ⊘ N will be skipped", the planned rows, and "Start import" behind a confirmation.
import { AlertDialog, Button, Icon, Popover, Spinner, toast } from '@agentic-crm/ui';
import { useState } from 'react';
import { runImport, useImportsWorkspace, usePlan } from '../data/backend';
import type { ImportJob, ImportPlan } from '../data/contract';
import type { WizardContext } from './ImportWizard';
import { OutcomeIcon, ResultsTable, StrategyTabs } from './ResultsTable';
import { useImportSchema } from './schema';
import * as s from './wizard.css';

export function PreviewStep({ ctx, job }: { ctx: WizardContext; job: ImportJob }) {
  const ws = useImportsWorkspace();
  const index = useImportSchema(job.entityDefinitionId);
  const plan = usePlan(job.jobId, { enabled: job.status !== 'ingesting' });
  const [confirm, setConfirm] = useState(false);
  const [starting, setStarting] = useState(false);
  const lastProperty = [...job.mapping].sort((a, b) => b.columnIndex - a.columnIndex)[0];

  const start = async () => {
    setStarting(true);
    try {
      await runImport(ws, job.jobId);
      ctx.go({ step: 'overview', param: job.entityDefinitionId });
    } catch {
      toast.error('Failed to start import');
      setStarting(false);
    }
  };

  const ready = plan.data?.status === 'ready';
  return (
    <>
      {job.status === 'ingesting' || !ready ? (
        <div className={s.centered} data-testid="preview-loading">
          <Spinner size={16} />
          <div className={s.stateTitle}>
            {job.status === 'ingesting' ? 'Waiting for upload to complete' : 'Generating import preview'}
          </div>
          <div className={s.stateText}>
            {job.status === 'ingesting'
              ? "We're still uploading your CSV file. You'll be able to progress in a few moments."
              : "Your preview will be ready shortly. If you're ready, you can start the import immediately."}
          </div>
        </div>
      ) : (
        <PlanView plan={plan.data as ImportPlan} index={index} />
      )}
      <footer className={s.footer}>
        <span className={s.footerNote} />
        <Button
          variant="secondary"
          size={28}
          onPress={() => ctx.go({ step: 'review-values', param: lastProperty?.id ?? null })}
        >
          Back
        </Button>
        <Button size={28} isDisabled={job.status === 'ingesting'} isPending={starting} onPress={() => setConfirm(true)}>
          Start import
        </Button>
      </footer>
      <AlertDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        variant="primary"
        title="Start import"
        description="Are you sure that you want to start running this import?"
        confirmLabel="Start import"
        onConfirm={() => void start()}
      />
    </>
  );
}

function PlanView({ plan, index }: { plan: ImportPlan; index: ReturnType<typeof useImportSchema> }) {
  const [tab, setTab] = useState(plan.strategies[0]?.id ?? 'root');
  const strategy = plan.strategies.find((x) => x.id === tab) ?? plan.strategies[0];
  if (!strategy) return null;
  const n = plan.invalidRows.length;
  return (
    <div className={s.previewBody}>
      <div className={s.alertBand}>
        <div className={s.infoAlert}>
          <Icon icon="info" size={16} />
          This preview may show duplicate instances of the same record. These will be merged together on import.
        </div>
      </div>
      <StrategyTabs strategies={plan.strategies} selected={strategy.id} index={index} onSelect={setTab} />
      <div className={s.summaryRow} data-testid="plan-summary">
        <span className={s.summaryItem}>
          <OutcomeIcon icon="add" tone="create" />
          <span className={s.summaryNumber}>Up to {strategy.counts.create}</span> will be created
        </span>
        <span className={s.summaryItem}>
          <OutcomeIcon icon="refresh" tone="update" />
          <span className={s.summaryNumber}>{strategy.counts.update}</span> will be updated
        </span>
        <span className={s.summaryItem}>
          <OutcomeIcon icon="skip" tone="skip" />
          <span className={s.summaryNumber}>{strategy.counts.skip}</span> will be skipped
        </span>
        {n > 0 && (
          <span className={s.invalidButton}>
            <Popover
              placement="bottom end"
              width={420}
              aria-label="Rows that will not be imported"
              trigger={
                <Button variant="secondary" size={28} icon="warning" data-testid="invalid-rows-button">
                  {n === 1
                    ? '1 row has values that will not be imported'
                    : `${n} rows have values that will not be imported`}
                </Button>
              }
            >
              <div className={s.invalidPopover} data-testid="invalid-rows">
                <div className={s.invalidAlertHead}>
                  <Icon icon="warning" size={16} />
                  {n === 1
                    ? '1 row has values that will not be imported'
                    : `${n} rows have values that will not be imported`}
                </div>
                <ul className={s.invalidList}>
                  {plan.invalidRows.map((r) => (
                    <li key={r.row}>
                      Row {r.row + 1}: {r.reason}
                    </li>
                  ))}
                </ul>
              </div>
            </Popover>
          </span>
        )}
      </div>
      <ResultsTable strategy={strategy} index={index} rows={strategy.rows} mode="preview" />
      {strategy.total > strategy.rows.length && (
        <div className={s.tableNote}>
          Showing the first {strategy.rows.length.toLocaleString('en-US')} of {strategy.total.toLocaleString('en-US')}{' '}
          rows
        </div>
      )}
    </div>
  );
}
