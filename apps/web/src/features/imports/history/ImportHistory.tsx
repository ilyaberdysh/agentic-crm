// Import history (C2; J objects-lists): the workspace page `/settings/data/import-history` and
// the per-object / per-list Imports tabs. Search "Filter import jobs", toggle "Only imports by me", status pills, row ⋮
// (Delete draft / Cancel import / Delete import — disabled once run), row click resumes a draft or opens its overview.
import type { EntityDefinition } from '@agentic-crm/contracts';
import {
  AlertDialog,
  Button,
  EmptyState,
  Icon,
  IconButton,
  IconTile,
  Menu,
  MenuItem,
  MenuTrigger,
  SearchField,
  Spinner,
  Status,
  type StatusProps,
  Switch,
  toast,
} from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { objectPath, useObjects } from '../../../data/objects';
import { useDocumentTitle } from '../../../lib/useDocumentTitle';
import * as os from '../../settings/objects/objects.css';
import { objectAppearance } from '../../shell/objectAppearance';
import { HelpButton, PageHeader } from '../../shell/PageHeader';
import * as shell from '../../shell/shell.css';
import { useWorkspace } from '../../shell/workspaceContext';
import { useDefinitions, useMembers } from '../../views/data';
import { cancelImport, removeImport, useImportHistory, useImportsWorkspace } from '../data/backend';
import type { ImportJob, ImportJobStatus } from '../data/contract';
import { beginOverlaySession, wizardPath } from '../wizard/destination';

const STATUS: Record<ImportJobStatus, { label: string; color: StatusProps['color'] }> = {
  ingesting: { label: 'Uploading', color: 'blue' },
  'upload-failed': { label: 'Upload failed', color: 'red' },
  waiting: { label: 'Draft', color: 'grey' },
  confirmed: { label: 'Preparing import', color: 'yellow' },
  executing: { label: 'In progress', color: 'blue' },
  completed: { label: 'Completed', color: 'green' },
  canceled: { label: 'Canceled', color: 'grey' },
  failed: { label: 'Failed', color: 'red' },
};

const DRAFT = new Set<ImportJobStatus>(['ingesting', 'waiting', 'upload-failed']);

/** Route prefix of a job's destination (object page, list page). */
export function destinationBase(definition: Pick<EntityDefinition, 'id' | 'apiSlug' | 'entityType'> | undefined) {
  if (!definition) return null;
  return definition.entityType === 'collection-entry' ? `collection/${definition.id}` : objectPath(definition);
}

const gridStyle = { gridTemplateColumns: '1fr 160px 150px 120px 36px', paddingInline: '15px 12px' };

export function ImportHistoryList({
  entityDefinitionId,
  pluralNoun,
  startBase,
}: {
  /** Per-object / per-list tab; absent on the workspace page. */
  entityDefinitionId?: string;
  pluralNoun?: string;
  /** Where "Start first import" opens the wizard (below the workspace). */
  startBase?: string;
}) {
  const { href, workspace } = useWorkspace();
  const navigate = useNavigate();
  const [onlyMine, setOnlyMine] = useState(false);
  const [query, setQuery] = useState('');
  const history = useImportHistory({ entityDefinitionId, onlyMine });
  const definitions = useDefinitions();
  const members = useMembers();
  const objects = useObjects(workspace).data ?? [];

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (history.data ?? []).filter((j) => !q || j.fileName.toLowerCase().includes(q));
  }, [history.data, query]);

  const open = (job: ImportJob) => {
    const def = definitions?.find((d) => d.id === job.entityDefinitionId);
    const base = destinationBase(def);
    if (!base) return;
    beginOverlaySession(window.location.pathname);
    void navigate({
      href: href(
        wizardPath(base, {
          step: DRAFT.has(job.status) ? 'map-properties' : 'overview',
          importId: job.importId,
          jobId: job.jobId,
          param: DRAFT.has(job.status) ? null : job.entityDefinitionId,
        }),
      ),
    });
  };

  const start = (base: string) => {
    beginOverlaySession(window.location.pathname);
    void navigate({ href: href(`${base}/import/new`) });
  };

  const empty = (history.data ?? []).length === 0 && !onlyMine;
  return (
    <div data-testid="import-history">
      <div className={os.toolbar}>
        <SearchField
          aria-label="Filter import jobs"
          placeholder="Filter import jobs"
          value={query}
          onChange={setQuery}
          className={os.toolbarSearch}
        />
        <Switch isSelected={onlyMine} onChange={setOnlyMine}>
          Only imports by me
        </Switch>
      </div>
      {history.isPending ? (
        <div className={os.centered}>
          <Spinner size={16} />
        </div>
      ) : history.isError ? (
        <EmptyState icon="warning" title="Failed to fetch import history" style={{ padding: '48px 24px' }} />
      ) : empty ? (
        <EmptyState
          icon="import"
          title="No imports yet"
          description={
            pluralNoun
              ? `You haven't imported any ${pluralNoun.toLowerCase()} yet`
              : "You haven't imported anything yet"
          }
          style={{ padding: '48px 24px' }}
          actions={
            startBase ? (
              <Button size={28} onPress={() => start(startBase)}>
                Start first import
              </Button>
            ) : (
              <MenuTrigger>
                <Button size={28} chevron>
                  Start first import
                </Button>
                <Menu aria-label="Import into" width={240} onAction={(k) => start(String(k))}>
                  {objects.map((o) => {
                    const look = objectAppearance(o);
                    return (
                      <MenuItem
                        key={o.id}
                        id={objectPath(o)}
                        icon={<IconTile icon={look.icon} color={look.color} size={16} />}
                      >
                        {o.pluralNoun}
                      </MenuItem>
                    );
                  })}
                </Menu>
              </MenuTrigger>
            )
          }
        />
      ) : (
        <div className={os.table} role="table" aria-label="Imports">
          <div className={os.tableHeader} style={gridStyle} role="row">
            <div className={os.headerCell} role="columnheader">
              <Icon icon="csvFile" size={14} className={os.headerIcon} />
              File
            </div>
            <div className={os.headerCell} role="columnheader">
              <Icon icon="object" size={14} className={os.headerIcon} />
              {entityDefinitionId ? 'Rows' : 'Destination'}
            </div>
            <div className={os.headerCell} role="columnheader">
              <Icon icon="user" size={14} className={os.headerIcon} />
              Created by
            </div>
            <div className={os.headerCell} role="columnheader">
              <Icon icon="info" size={14} className={os.headerIcon} />
              Status
            </div>
            <div role="columnheader" aria-label="Actions" />
          </div>
          {list.length === 0 ? (
            <div className={os.tableEmpty}>
              No imports match that filter
              <div style={{ marginTop: 8 }}>
                <Button variant="secondary" size={28} onPress={() => (setQuery(''), setOnlyMine(false))}>
                  Clear filter
                </Button>
              </div>
            </div>
          ) : (
            list.map((job) => {
              const def = definitions?.find((d) => d.id === job.entityDefinitionId);
              const member = members?.find((m) => m.id === job.createdBy);
              const status = STATUS[job.status];
              return (
                <div
                  key={job.jobId}
                  className={os.row}
                  style={gridStyle}
                  role="row"
                  tabIndex={0}
                  data-testid="import-history-row"
                  onClick={() => open(job)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') open(job);
                  }}
                >
                  <div className={os.cell} role="cell">
                    <span className={os.cellText}>{job.fileName}</span>
                    <span className={os.muted}>
                      {new Date(job.createdAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}
                    </span>
                  </div>
                  <div className={os.cell} role="cell">
                    <span className={os.cellText}>
                      {entityDefinitionId
                        ? job.rowCount.toLocaleString('en-US')
                        : (def?.pluralNoun ?? 'Deleted object')}
                    </span>
                  </div>
                  <div className={os.cell} role="cell">
                    <span className={os.cellText}>
                      {member
                        ? [member.firstName, member.lastName].filter(Boolean).join(' ') || member.emailAddress
                        : '—'}
                    </span>
                  </div>
                  <div className={os.cell} role="cell">
                    <Status color={status.color}>{status.label}</Status>
                  </div>
                  <div className={os.rowActions} role="cell" onClick={(e) => e.stopPropagation()} onKeyDown={() => {}}>
                    <RowMenu job={job} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function RowMenu({ job }: { job: ImportJob }) {
  const ws = useImportsWorkspace();
  const [confirm, setConfirm] = useState<'delete' | 'cancel' | null>(null);
  const running = job.status === 'confirmed' || job.status === 'executing';
  return (
    <>
      <MenuTrigger>
        <IconButton icon="moreVertical" aria-label="Import actions" />
        <Menu
          aria-label="Import actions"
          placement="bottom end"
          width={240}
          onAction={(k) => setConfirm(k as 'delete' | 'cancel')}
        >
          {DRAFT.has(job.status) ? (
            <MenuItem id="delete" icon="delete" variant="danger">
              Delete draft
            </MenuItem>
          ) : running ? (
            <MenuItem id="cancel" icon="close" variant="danger">
              Cancel import
            </MenuItem>
          ) : (
            <MenuItem id="none" icon="delete" isDisabled description="Imports that have been run cannot be deleted.">
              Delete import
            </MenuItem>
          )}
        </Menu>
      </MenuTrigger>
      <AlertDialog
        isOpen={confirm === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Are you sure?"
        description="This import will be permanently deleted, this cannot be undone."
        confirmLabel="Delete draft"
        onConfirm={() => void removeImport(ws, job.jobId).catch(() => toast.error('Failed to delete draft'))}
      />
      <AlertDialog
        isOpen={confirm === 'cancel'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Cancel import"
        description="This import will be cancelled and any remaining records will not be imported or updated - this may take a few seconds to take effect."
        confirmLabel="Cancel import"
        cancelLabel="Back"
        onConfirm={() => void cancelImport(ws, job.jobId).catch(() => toast.error('Failed to cancel import'))}
      />
    </>
  );
}

/** `/settings/data/import-history`. */
export function ImportHistoryPage() {
  useDocumentTitle('Import history');
  return (
    <>
      <PageHeader crumbs={[{ label: 'Import history', icon: 'history' }]} actions={<HelpButton />} />
      <div className={shell.content}>
        <div className={os.page}>
          <h1 className={os.pageTitle}>Import history</h1>
          <p className={os.pageDescription}>View and manage the history of imported files.</p>
          <div className={os.pageRule} />
          <ImportHistoryList />
        </div>
      </div>
    </>
  );
}
