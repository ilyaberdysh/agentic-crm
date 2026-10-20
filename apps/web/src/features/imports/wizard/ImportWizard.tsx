// The import wizard frame: header (overlay: × + "Import" + destination chip / file name, Help or ⋮;
// page: breadcrumbs "<Object> / Import / <file>" + ⋮), the stepper "1 Upload file › 2 Map columns › 3 Review values ›
// 4 Preview import" (previous steps clickable), then the step. A job that has been confirmed only shows its overview.
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
  Spinner,
  Tooltip,
  toast,
} from '@agentic-crm/ui';
import { Navigate, useRouter } from '@tanstack/react-router';
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../../lib/useDocumentTitle';
import { objectAppearance } from '../../shell/objectAppearance';
import { HelpButton, PageHeader } from '../../shell/PageHeader';
import { useWorkspace } from '../../shell/workspaceContext';
import { cancelImport, removeImport, useImportJob, useImportsWorkspace } from '../data/backend';
import { type ImportJob, ImportNotFoundError } from '../data/contract';
import { cancelUpload } from '../data/upload';
import {
  type DestinationRef,
  endOverlaySession,
  overlaySession,
  parseWizardPath,
  type ResolvedDestination,
  useDestination,
  type WizardLocation,
  type WizardStep,
  wizardPath,
} from './destination';
import { MapColumnsStep } from './MapColumnsStep';
import { OverviewStep } from './OverviewStep';
import { PreviewStep } from './PreviewStep';
import { ReviewValuesStep } from './ReviewValuesStep';
import { UploadStep } from './UploadStep';
import * as s from './wizard.css';

export interface WizardContext {
  destination: ResolvedDestination;
  job: ImportJob | null;
  location: WizardLocation;
  /** Navigates to another step of this import. */
  go: (loc: Partial<WizardLocation> & { step: WizardStep }, replace?: boolean) => void;
  close: () => void;
  base: string;
}

const STEPS: Array<{ step: WizardStep; label: string }> = [
  { step: 'upload', label: 'Upload file' },
  { step: 'map-properties', label: 'Map columns' },
  { step: 'review-values', label: 'Review values' },
  { step: 'preview', label: 'Preview import' },
];

const DRAFT = new Set(['ingesting', 'waiting', 'upload-failed']);

export function ImportWizard({
  destination: ref,
  base,
  splat,
}: {
  destination: DestinationRef;
  base: string;
  splat: string;
}) {
  const { href, workspace } = useWorkspace();
  const router = useRouter();
  const location = useMemo(() => parseWizardPath(splat), [splat]);
  const { destination, isPending } = useDestination(ref);
  const jobQ = useImportJob(location?.jobId ?? null);
  const job = jobQ.data ?? null;
  useDocumentTitle(job ? `Import · ${job.fileName}` : 'Import');

  const close = useCallback(() => {
    const { returnTo } = overlaySession();
    endOverlaySession();
    const fallback = base.startsWith('settings/') ? base : (destination?.pagePath ?? 'home');
    void router.navigate({ href: returnTo ?? href(fallback) });
  }, [router, href, base, destination?.pagePath]);

  const go = useCallback(
    (loc: Partial<WizardLocation> & { step: WizardStep }, replace = false) => {
      const target = { importId: location?.importId ?? null, jobId: location?.jobId ?? null, ...loc };
      void router.navigate({ href: href(wizardPath(base, target)), replace });
    },
    [router, href, base, location?.importId, location?.jobId],
  );

  // Esc closes the overlay (the draft is kept and resumable).
  const overlay = overlaySession().overlay;
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],input,textarea')) return;
      if (document.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"]')) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlay, close]);

  if (!location) return <Navigate to={href(`${base}/import/new`)} replace />;
  if (isPending || (location.jobId && jobQ.isPending)) {
    return (
      <div className={s.root}>
        <div className={s.centered}>
          <Spinner size={16} />
        </div>
      </div>
    );
  }
  if (!destination) {
    return (
      <div className={s.root}>
        <EmptyState
          icon="object"
          title="Import not allowed"
          description="You do not have permission to import to this entity. Please contact a workspace admin."
          style={{ margin: 'auto' }}
        />
      </div>
    );
  }
  if (location.jobId && (jobQ.error instanceof ImportNotFoundError || (!job && jobQ.isError))) {
    return (
      <div className={s.root}>
        <WizardHeader destination={destination} job={null} onClose={close} base={base} />
        <EmptyState
          icon="import"
          title="Import not found"
          description="This import doesn't exist anymore or its source file is no longer available."
          style={{ margin: 'auto' }}
          actions={
            <Button size={28} onPress={() => go({ step: 'upload', importId: null, jobId: null })}>
              Start a new import
            </Button>
          }
        />
      </div>
    );
  }
  // A confirmed (or canceled) import only has its overview.
  if (job && !DRAFT.has(job.status) && location.step !== 'overview') {
    return <Navigate to={href(wizardPath(base, { ...location, step: 'overview', param: null }))} replace />;
  }

  const ctx: WizardContext = { destination, job, location, go, close, base };
  let content: ReactNode;
  switch (location.step) {
    case 'upload':
      content = <UploadStep ctx={ctx} />;
      break;
    case 'map-properties':
      content = job ? <MapColumnsStep ctx={ctx} job={job} /> : null;
      break;
    case 'review-values':
      content = job ? <ReviewValuesStep ctx={ctx} job={job} /> : null;
      break;
    case 'preview':
      content = job ? <PreviewStep ctx={ctx} job={job} /> : null;
      break;
    case 'overview':
      content = job ? <OverviewStep ctx={ctx} job={job} /> : null;
      break;
  }

  return (
    <div className={s.root} data-testid="import-wizard" data-step={location.step}>
      <WizardHeader destination={destination} job={job} onClose={close} base={base} />
      {location.step !== 'overview' && <Stepper current={location.step} job={job} go={go} />}
      <div className={s.body}>{content}</div>
    </div>
  );
}

// ---- header ------------------------------------------------------------------------------------------------------------

function DestinationTile({ destination, size = 16 }: { destination: ResolvedDestination; size?: 16 | 20 | 24 }) {
  if (destination.isList) {
    const icon = destination.definition.icon ?? '';
    if (icon && !/^[a-z]/i.test(icon)) return <span style={{ fontSize: size - 2, lineHeight: 1 }}>{icon}</span>;
    return <IconTile icon="list" color="grey" size={size} />;
  }
  const look = objectAppearance(destination.definition as Parameters<typeof objectAppearance>[0]);
  return <IconTile icon={look.icon} color={look.color} size={size} />;
}

function WizardHeader({
  destination,
  job,
  onClose,
  base,
}: {
  destination: ResolvedDestination;
  job: ImportJob | null;
  onClose: () => void;
  base: string;
}) {
  const { href } = useWorkspace();
  const overlay = overlaySession().overlay;
  const actions = job ? <JobMenu job={job} base={base} /> : <HelpButton />;
  if (!overlay) {
    return (
      <PageHeader
        crumbs={[
          {
            label: destination.title,
            icon: <DestinationTile destination={destination} />,
            href: href(destination.pagePath),
          },
          { label: 'Import' },
          ...(job ? [{ label: job.fileName }] : []),
        ]}
        actions={actions}
      />
    );
  }
  return (
    <header className={s.header} data-testid="import-header">
      <IconButton icon="close" aria-label="Close import" tooltip="Close" onPress={onClose} />
      {job ? (
        <span className={s.headerFile}>{job.fileName}</span>
      ) : (
        <>
          <span className={s.headerTitle}>Import</span>
          <span className={s.destinationChip}>
            <DestinationTile destination={destination} />
            {destination.title}
          </span>
        </>
      )}
      <span className={s.headerSpacer} />
      {actions}
    </header>
  );
}

function JobMenu({ job, base }: { job: ImportJob; base: string }) {
  const ws = useImportsWorkspace();
  const { href } = useWorkspace();
  const router = useRouter();
  const [confirm, setConfirm] = useState<'delete' | 'cancel' | null>(null);
  const draft = DRAFT.has(job.status);
  const running = job.status === 'confirmed' || job.status === 'executing';
  return (
    <>
      <MenuTrigger>
        <IconButton icon="moreVertical" aria-label="Import options" />
        <Menu
          aria-label="Import options"
          placement="bottom end"
          width={220}
          onAction={(k) => setConfirm(k as 'delete' | 'cancel')}
        >
          {draft ? (
            <MenuItem id="delete" icon="delete" variant="danger">
              Delete draft
            </MenuItem>
          ) : running ? (
            <MenuItem id="cancel" icon="close" variant="danger">
              Cancel import
            </MenuItem>
          ) : (
            <MenuItem
              id="disabled"
              icon="delete"
              isDisabled
              description="Imports that have been run cannot be deleted."
            >
              Delete import
            </MenuItem>
          )}
        </Menu>
      </MenuTrigger>
      <AlertDialog
        isOpen={confirm === 'delete'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Are you sure?"
        description="This import will be permanently deleted, this cannot be undone."
        confirmLabel="Delete draft"
        onConfirm={() => {
          cancelUpload(job.jobId);
          void removeImport(ws, job.jobId)
            .then(() => router.navigate({ href: href(`${base}/import/new`), replace: true }))
            .catch(() => toast.error('Failed to delete draft'));
        }}
      />
      <AlertDialog
        isOpen={confirm === 'cancel'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Cancel import"
        description="This import will be cancelled and any remaining records will not be imported or updated - this may take a few seconds to take effect."
        confirmLabel="Cancel import"
        cancelLabel="Back"
        onConfirm={() => void cancelImport(ws, job.jobId).catch(() => toast.error('Failed to cancel import'))}
      />
    </>
  );
}

// ---- stepper -----------------------------------------------------------------------------------------------------------

function Stepper({ current, job, go }: { current: WizardStep; job: ImportJob | null; go: WizardContext['go'] }) {
  const index = STEPS.findIndex((st) => st.step === current);
  return (
    <nav className={s.stepper} aria-label="Import steps" data-testid="import-stepper">
      {STEPS.map((st, i) => {
        const clickable = Boolean(job) && i < index;
        return (
          <Fragment key={st.step}>
            {i > 0 && <Icon icon="chevronRight" size={12} className={s.stepChevron} />}
            <button
              type="button"
              className={s.step}
              data-current={i === index || undefined}
              data-clickable={clickable || undefined}
              aria-current={i === index ? 'step' : undefined}
              disabled={!clickable}
              onClick={() => clickable && go({ step: st.step, param: null })}
            >
              <span className={s.stepNumber}>{i + 1}</span>
              {st.label}
            </button>
          </Fragment>
        );
      })}
    </nav>
  );
}
