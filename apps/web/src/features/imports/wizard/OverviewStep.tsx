// Run / overview page (C2; evidence import-5-overview-object / -list): the status card ("Import queued…",
// "Importing records…", "Import completed", "Import canceled"; "x / y"; progress bar, green when complete; "<member>
// confirmed <time>"), tabs per object, "{n} created · {n} updated · {n} skipped · {n} failed", the Filter menu and the
// rows with their result. The page polls while the job runs; it can be closed, the job continues.
import { Avatar, Button, EmptyState, Menu, MenuItem, MenuTrigger } from '@agentic-crm/ui';
import { useEffect, useMemo, useState } from 'react';
import { timeAgo } from '../../comments/timeAgo';
import { useMembers } from '../../views/data';
import { usePlan } from '../data/backend';
import type { ImportJob, RowStatus, StrategyStatistics } from '../data/contract';
import type { WizardContext } from './ImportWizard';
import { OutcomeIcon, ResultsTable, StrategyTabs } from './ResultsTable';
import { useImportSchema } from './schema';
import * as s from './wizard.css';

const FILTERS: Array<{ id: RowStatus; label: string }> = [
  { id: 'failed', label: 'Failed' },
  { id: 'planned', label: 'Planned' },
  { id: 'created', label: 'Created' },
  { id: 'updated', label: 'Updated' },
  { id: 'skipped', label: 'Skipped' },
];

function statusTitle(job: ImportJob): string {
  switch (job.status) {
    case 'confirmed':
      return 'Import queued…';
    case 'executing':
      return 'Importing records…';
    case 'completed':
      return 'Import completed';
    case 'canceled':
      return 'Import canceled';
    case 'failed':
      return 'Import failed';
    default:
      return 'Preparing import…';
  }
}

const EMPTY_STATS: StrategyStatistics = { created: 0, updated: 0, skipped: 0, failed: 0, canceled: 0 };

export function OverviewStep({ ctx, job }: { ctx: WizardContext; job: ImportJob }) {
  const index = useImportSchema(job.entityDefinitionId);
  const running = job.status === 'confirmed' || job.status === 'executing';
  const plan = usePlan(job.jobId, { live: running });
  const members = useMembers();
  const [tab, setTab] = useState<string | null>(null);
  const [filter, setFilter] = useState<Set<RowStatus>>(new Set());
  // One last refresh of the rows when the run finishes.
  useEffect(() => {
    if (!running) void plan.refetch();
  }, [running, plan.refetch]);

  const strategies = plan.data?.strategies ?? [];
  const strategy =
    strategies.find((x) => x.id === tab) ??
    strategies.find((x) => x.entityDefinitionId === ctx.location.param) ??
    strategies[0];
  const stats = (strategy && job.statistics[strategy.entityDefinitionId]) || EMPTY_STATS;
  const rows = useMemo(
    () => (strategy ? strategy.rows.filter((r) => filter.size === 0 || filter.has(r.status)) : []),
    [strategy, filter],
  );
  const member = members?.find((m) => m.id === (job.status === 'canceled' ? job.canceledBy : job.confirmedBy));
  const memberName = member
    ? [member.firstName, member.lastName].filter(Boolean).join(' ') || member.emailAddress
    : 'Workspace Member';
  const complete = job.status === 'completed';
  const pct = job.progress.total > 0 ? (job.progress.done / job.progress.total) * 100 : complete ? 100 : 0;

  return (
    <div className={s.previewBody}>
      <div className={s.statusCard} data-testid="import-status">
        <div className={s.statusHead}>
          <span data-testid="import-status-title">{statusTitle(job)}</span>
          <span className={s.statusCount} data-testid="import-progress">
            {job.progress.done} / {job.progress.total}
          </span>
        </div>
        <div className={s.progressTrack}>
          <div className={s.progressFill} data-complete={complete || undefined} style={{ width: `${pct}%` }} />
        </div>
        <div className={s.statusMeta}>
          <Avatar name={memberName} size={16} kind="member" seed={member?.id} />
          <span className={s.statusMember}>{memberName}</span>
          {job.status === 'canceled' && job.canceledAt
            ? `canceled at ${new Date(job.canceledAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`
            : job.confirmedAt
              ? `confirmed ${timeAgo(job.confirmedAt)}`
              : null}
        </div>
      </div>
      {strategy && (
        <>
          <StrategyTabs strategies={strategies} selected={strategy.id} index={index} onSelect={setTab} />
          <div className={s.summaryRow} data-testid="overview-summary">
            <span className={s.summaryItem}>
              <OutcomeIcon icon="add" tone="create" />
              <span className={s.summaryNumber}>{stats.created}</span> created
            </span>
            <span className={s.summaryItem}>
              <OutcomeIcon icon="refresh" tone="update" />
              <span className={s.summaryNumber}>{stats.updated}</span> updated
            </span>
            <span className={s.summaryItem}>
              <OutcomeIcon icon="skip" tone="skip" />
              <span className={s.summaryNumber}>{stats.skipped}</span> skipped
            </span>
            <span className={s.summaryItem}>
              <OutcomeIcon icon="warning" tone="failed" />
              <span className={s.summaryNumber}>{stats.failed}</span> failed
            </span>
            {stats.canceled > 0 && (
              <span className={s.summaryItem}>
                <span className={s.summaryNumber}>{stats.canceled}</span> canceled
              </span>
            )}
            <span className={s.filterButton}>
              <MenuTrigger>
                <Button variant="secondary" size={20} icon="filter" badge={filter.size > 0 ? filter.size : undefined}>
                  Filter
                </Button>
                <Menu
                  aria-label="Filter import job assertions"
                  selectionMode="multiple"
                  selectedKeys={filter}
                  placement="bottom end"
                  width={200}
                  onSelectionChange={(keys) =>
                    setFilter(new Set(keys === 'all' ? FILTERS.map((f) => f.id) : (keys as Set<RowStatus>)))
                  }
                >
                  {FILTERS.map((f) => (
                    <MenuItem key={f.id} id={f.id}>
                      {f.label}
                    </MenuItem>
                  ))}
                </Menu>
              </MenuTrigger>
            </span>
          </div>
          {rows.length === 0 && filter.size > 0 ? (
            <EmptyState
              icon="filter"
              title="No results match that filter"
              description="It looks like no result matches your set filters"
              style={{ margin: '48px auto' }}
              actions={
                <Button variant="secondary" size={28} onPress={() => setFilter(new Set())}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <ResultsTable strategy={strategy} index={index} rows={rows} mode="overview" />
          )}
        </>
      )}
    </div>
  );
}
