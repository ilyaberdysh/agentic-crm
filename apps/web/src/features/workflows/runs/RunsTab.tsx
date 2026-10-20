// Runs tab and run viewer (BACKLOG 8.07; runs.md §3–4; evidence G/G-runs-empty.png, G-run-viewer-false-path.png,
// G-run-block-detail.png, G-run-failed-retry-menu.png). `/runs` opens the latest run; `/runs/$versionId/$runId` shows
// the version that ran, read-only, with status tags and green taken paths; the toolbar chip has Run #N, Rerun (completed)
// or Retry ⌄ (failed: from start / from failed / with the live workflow), Attempt #N ⌄ and "Retried from #N". The side
// panel lists the run history with the last-7-days overview, or the selected block's execution.

import {
  Button,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Spinner,
  Tooltip,
} from '@agentic-crm/ui';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ReactFlowProvider } from '@xyflow/react';
import { useEffect, useMemo, useState } from 'react';
import { timeAgo } from '../../comments/timeAgo';
import { useWorkspace } from '../../shell/workspaceContext';
import { cancelRun, rerun, retryRun, useRun, useRuns, useWorkflow, useWs } from '../data';
import { Canvas } from '../editor/canvas/Canvas';
import { CanvasToolbar } from '../editor/canvas/CanvasToolbar';
import * as cs from '../editor/canvas/canvas.css';
import { type EditorUi, EditorUiProvider } from '../editor/EditorContext';
import * as ps from '../editor/panel/panel.css';
import { useWorkflowPage } from '../editor/WorkflowLayout';
import { creditUsagePath, runsPath } from '../paths';
import type { RunDetail, WorkflowRun } from '../types';
import { CreditPill, RunStatusIcon } from '../ui/parts';
import { attemptsOf, failedExecution, overlayFor, triggerExecution } from './model';
import { RunBlockPanel } from './RunBlockPanel';
import * as s from './runs.css';

const PANEL_WIDTH = 400;

export function RunsTab() {
  return (
    <ReactFlowProvider>
      <Runs />
    </ReactFlowProvider>
  );
}

function Runs() {
  const page = useWorkflowPage();
  const params = useParams({ strict: false }) as { versionId?: string; runId?: string };
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const runs = useRuns(page.workflowId);
  const list = runs.data?.runs ?? [];
  const runId = params.runId ?? null;

  // `/runs` → the latest run (README §2.4).
  useEffect(() => {
    if (!runId && list[0]) {
      void navigate({
        href: href(runsPath(page.workflowId, { versionId: list[0].versionId, runId: list[0].id })),
        replace: true,
      });
    }
  }, [runId, list[0]?.id]);

  if (!runId) {
    return <RunCanvas detail={null} runs={list} overview={runs.data?.overview ?? null} loading={runs.isPending} />;
  }
  return <RunView runId={runId} runs={list} overview={runs.data?.overview ?? null} />;
}

function RunView({ runId, runs, overview }: { runId: string; runs: WorkflowRun[]; overview: Overview | null }) {
  const run = useRun(runId);
  return <RunCanvas detail={run.data ?? null} runs={runs} overview={overview} loading={run.isPending} />;
}

type Overview = NonNullable<ReturnType<typeof useRuns>['data']>['overview'];

function RunCanvas({
  detail,
  runs,
  overview,
  loading,
}: {
  detail: RunDetail | null;
  runs: WorkflowRun[];
  overview: Overview | null;
  loading: boolean;
}) {
  const page = useWorkflowPage();
  const versionId = detail?.run.versionId ?? null;
  const versionQuery = useWorkflow(page.workflowId, versionId);
  const version = versionId ? versionQuery.data?.version : page.detail.version;
  const attempts = detail ? attemptsOf(detail) : [];
  const latestAttempt = attempts[attempts.length - 1] ?? 1;
  const [attempt, setAttempt] = useState<number | null>(null);
  const shownAttempt = attempt ?? latestAttempt;
  useEffect(() => setAttempt(null), [detail?.run.id, latestAttempt]);
  const overlay = useMemo(() => (detail ? overlayFor(detail, shownAttempt) : null), [detail, shownAttempt]);
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  useEffect(() => setSelectedBlock(null), [detail?.run.id]);
  const [tool, setTool] = useState<'pointer' | 'hand'>('pointer');
  const inset = { top: 80, right: PANEL_WIDTH + 52, bottom: 90, left: 40 };

  const ui: EditorUi | null = version
    ? {
        page,
        version,
        readOnly: true,
        viewingVersionId: versionId,
        panel: selectedBlock ? { kind: 'block', blockId: selectedBlock } : { kind: 'overview' },
        setPanel: () => {},
        selectBlock: setSelectedBlock,
        setHighlight: () => {},
        blockTitle: (id) => version.blocks.find((b) => b.id === id)?.title ?? null,
        viewVersion: () => {},
      }
    : null;

  const block = selectedBlock ? version?.blocks.find((b) => b.id === selectedBlock) : undefined;
  const executions = detail && block ? detail.executions.filter((e) => e.blockId === block.id) : [];
  const execution = block && overlay ? (overlay.latestByBlock.get(block.id) ?? null) : null;

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }} data-testid="workflow-runs">
      {version && ui ? (
        <EditorUiProvider value={ui}>
          <Canvas
            key={versionId ?? 'draft'}
            blocks={version.blocks}
            paths={version.paths}
            mode="run"
            tool={tool}
            selectedIds={new Set(selectedBlock ? [selectedBlock] : [])}
            onSelect={(ids) => setSelectedBlock(ids[ids.length - 1] ?? null)}
            {...(overlay ? { run: { ...overlay, selectedBlockId: selectedBlock } } : {})}
            inset={inset}
            onPaneClick={() => setSelectedBlock(null)}
          />
          {detail && (
            <RunChip detail={detail} attempts={attempts} attempt={shownAttempt} onAttempt={setAttempt} runs={runs} />
          )}
          <CanvasToolbar
            tool={tool}
            onTool={setTool}
            center={`calc((100% - ${PANEL_WIDTH + 12}px) / 2)`}
            inset={inset}
          />
          <aside className={ps.panel} data-testid="side-panel" aria-label="Run side panel">
            {block && detail ? (
              <RunBlockPanel
                block={block}
                execution={execution}
                executionCount={executions.length}
                detail={detail}
                version={version}
                onBack={() => setSelectedBlock(null)}
                onSelect={setSelectedBlock}
              />
            ) : (
              <RunHistory
                runs={runs}
                overview={overview}
                selectedRunId={detail?.run.id ?? null}
                loading={loading && runs.length === 0}
              />
            )}
          </aside>
        </EditorUiProvider>
      ) : (
        <div className={ps.panel} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spinner size={16} />
        </div>
      )}
    </div>
  );
}

function RunChip({
  detail,
  attempts,
  attempt,
  onAttempt,
  runs,
}: {
  detail: RunDetail;
  attempts: number[];
  attempt: number;
  onAttempt: (n: number) => void;
  runs: WorkflowRun[];
}) {
  const page = useWorkflowPage();
  const ws = useWs();
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const run = detail.run;
  const failed = failedExecution(detail);
  const trigger = triggerExecution(detail);
  const live = page.detail.workflow.status === 'live';
  const liveDiffers = live && page.detail.workflow.activeVersionId !== run.versionId;
  const open = (r: { id: string; versionId: string }) =>
    void navigate({ href: href(runsPath(page.workflowId, { versionId: r.versionId, runId: r.id })) });
  const retriedFrom = run.retriedFrom ? runs.find((r) => r.id === run.retriedFrom?.runId) : undefined;
  return (
    <div className={cs.runChip} data-testid="run-chip" data-status={run.status}>
      <RunStatusIcon status={run.status} />
      <span data-testid="run-number">{`Run #${run.sequenceNumber}`}</span>
      {attempts.length > 1 && (
        <>
          <span className={cs.runChipDivider} />
          <MenuTrigger>
            <Button variant="ghost" size={28} chevron data-testid="attempt-menu">
              {`Attempt #${attempt}`}
            </Button>
            <Menu aria-label="Attempts" placement="bottom start" width={220} onAction={(k) => onAttempt(Number(k))}>
              {[...attempts].reverse().map((n, i) => {
                const frame = detail.frames.find((f) => f.attempt === n && f.type !== 'loop-iteration');
                const when = frame
                  ? new Date(frame.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                  : '';
                return (
                  <MenuItem key={n} id={String(n)}>
                    {`${i === 0 ? 'Latest attempt' : 'Attempt'} #${n} · ${when}`}
                  </MenuItem>
                );
              })}
            </Menu>
          </MenuTrigger>
        </>
      )}
      {run.status === 'completed' && (
        <IconButton
          icon="wfRetry"
          size={28}
          aria-label="Rerun"
          tooltip="Rerun"
          data-testid="rerun"
          onPress={() => void rerun(ws, page.workflowId, run.id)}
        />
      )}
      {(run.status === 'failed' || run.status === 'canceled') && page.canEdit && (
        <>
          <span className={cs.runChipDivider} />
          <MenuTrigger>
            <Button variant="ghost" size={28} icon="wfRetry" chevron data-testid="retry-menu">
              Retry
            </Button>
            <Menu
              aria-label="Retry"
              placement="bottom start"
              width={240}
              onAction={async (k) => {
                if (k === 'start' && trigger) await retryRun(ws, page.workflowId, run.id, trigger.id);
                if (k === 'failed' && failed) await retryRun(ws, page.workflowId, run.id, failed.id);
                if (k === 'live') {
                  const next = await rerun(ws, page.workflowId, run.id, true);
                  if (next) open(next);
                }
              }}
            >
              <MenuItem id="start" icon="wfRetry" isDisabled={!trigger}>
                Retry from start
              </MenuItem>
              <MenuItem id="failed" icon="wfRetry" isDisabled={!failed}>
                {run.status === 'canceled' ? 'Retry from canceled' : 'Retry from failed'}
              </MenuItem>
              {liveDiffers && <MenuSeparator />}
              {liveDiffers && (
                <MenuItem
                  id="live"
                  icon="wfPlay"
                  description="Create a new run with the live version of the workflow and the same trigger output as this run"
                >
                  Retry with live workflow
                </MenuItem>
              )}
            </Menu>
          </MenuTrigger>
        </>
      )}
      {(run.status === 'executing' || run.status === 'queued') && page.canEdit && (
        <Tooltip content="Cancel run">
          <Button variant="ghost" size={28} icon="wfCancel" onPress={() => void cancelRun(ws, page.workflowId, run.id)}>
            Cancel
          </Button>
        </Tooltip>
      )}
      {run.retriedFrom && (
        <Link
          to={href(
            runsPath(page.workflowId, {
              versionId: retriedFrom?.versionId ?? run.versionId,
              runId: run.retriedFrom.runId,
            }),
          )}
          className={cs.retriedFrom}
        >
          {`Retried from #${run.retriedFrom.sequenceNumber}`}
        </Link>
      )}
    </div>
  );
}

function RunHistory({
  runs,
  overview,
  selectedRunId,
  loading,
}: {
  runs: WorkflowRun[];
  overview: Overview | null;
  selectedRunId: string | null;
  loading: boolean;
}) {
  const page = useWorkflowPage();
  const { href } = useWorkspace();
  return (
    <>
      <div className={ps.topBar} style={{ height: 58, padding: '0 12px 0 20px' }}>
        <span className={s.historyTitle}>Run history</span>
      </div>
      {loading ? (
        <div className={s.empty}>
          <Spinner size={16} />
        </div>
      ) : runs.length === 0 ? (
        <div className={s.empty} data-testid="runs-empty">
          <div className={s.emptyArt} aria-hidden="true">
            <span className={s.emptyTick} style={{ top: 28 }} />
            <span className={s.emptyPill} />
            <span className={s.emptyTick} style={{ top: 98 }} />
          </div>
          <span className={s.emptyTitle}>No runs yet</span>
          <span className={s.emptyText}>Trigger the workflow to see run history here.</span>
        </div>
      ) : (
        <>
          <div className={ps.scroll}>
            <div className={s.list} data-testid="run-history">
              {runs.map((r) => (
                <Link
                  key={r.id}
                  to={href(runsPath(page.workflowId, { versionId: r.versionId, runId: r.id }))}
                  className={s.runRow}
                  data-selected={r.id === selectedRunId || undefined}
                  data-testid="run-row"
                  data-status={r.status}
                >
                  <RunStatusIcon status={r.status} />
                  {`Run #${r.sequenceNumber}`}
                  {r.status === 'failed' ? (
                    <span className={s.failedText}>Failed</span>
                  ) : r.creditsUsed > 0 ? (
                    <CreditPill amount={r.creditsUsed} />
                  ) : null}
                  <span className={s.runTime}>{timeAgo(r.createdAt)}</span>
                </Link>
              ))}
            </div>
          </div>
          {overview && (
            <div className={s.overview} data-testid="runs-overview">
              <div className={s.overviewHead}>
                Overview (last 7 days)
                <Link to={href(creditUsagePath())} className={s.usageLink}>
                  View all credit usage
                  <Icon icon="arrowUpRight" size={12} />
                </Link>
              </div>
              <div className={s.tiles}>
                <div className={`${s.tile} ${s.tileGreen}`}>
                  <span className={`${s.tileValue} ${s.tileValueGreen}`}>{overview.last7DaysCompleted}</span>
                  <span className={s.tileLabel}>Runs completed</span>
                  <Icon icon="checkCircle" size={14} className={s.tileIcon} />
                </div>
                <div className={`${s.tile} ${s.tileRed}`}>
                  <span className={`${s.tileValue} ${s.tileValueRed}`}>{overview.last7DaysFailed}</span>
                  <span className={s.tileLabel}>Runs failed</span>
                  <Icon icon="wfFailed" size={14} className={s.tileIcon} />
                </div>
                <div className={s.tile}>
                  <span className={s.tileValue}>{overview.last7DaysExecuting}</span>
                  <span className={s.tileLabel}>Runs in progress</span>
                  <Icon icon="spinner" size={14} className={s.tileIcon} />
                </div>
                <div className={s.tile}>
                  <span className={s.tileValue}>{overview.last7DaysCredits}</span>
                  <span className={s.tileLabel}>Credits consumed</span>
                  <Icon icon="wfCredits" size={14} className={s.tileIcon} />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
