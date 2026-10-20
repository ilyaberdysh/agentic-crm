// Workflow page `/$ws/automations/workflows/$workflowId/*`: header (breadcrumb with the
// inline title input, favourite star; creator, Share, help, ⋮, Ask AI) and the tab bar (Editor | Runs n | Settings;
// right: Draft / ⏸ Paused label or ▷ Trigger workflow, and the Live switch). The routed tab renders below.
import { Button, Icon, IconButton, Switch, Tooltip } from '@agentic-crm/ui';
import { Link, Outlet, useNavigate, useParams, useRouterState } from '@tanstack/react-router';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useDocumentTitle } from '../../../lib/useDocumentTitle';
import { useMembers } from '../../attributes/data/queries';
import { MemberAvatar } from '../../attributes/ui/primitives';
import { FavoriteStar } from '../../favorites/FavoriteStar';
import { ContentSpinner } from '../../shell/AppShell';
import { PageHeader } from '../../shell/PageHeader';
import { useWorkspace } from '../../shell/workspaceContext';
import { openHelpDrawer } from '../../shortcuts/helpStore';
import { setLive, useWorkflow, useWs, type WorkflowDetail } from '../data';
import { editorPath, runsPath, settingsTabPath, workflowsPath } from '../paths';
import { SharePopover } from '../share/SharePopover';
import { WorkflowMenu } from '../ui/WorkflowMenu';
import * as s from './layout.css';
import { type EditorActions, editorActions, usePendingDetail } from './ops';
import { TriggerButton } from './TriggerButton';

export interface WorkflowPage {
  workflowId: string;
  /** The draft with pending edits applied. */
  detail: WorkflowDetail;
  actions: EditorActions;
  /** The caller may edit (Read and write or Full access). */
  canEdit: boolean;
}

const PageContext = createContext<WorkflowPage | null>(null);

export function useWorkflowPage(): WorkflowPage {
  const ctx = useContext(PageContext);
  if (!ctx) throw new Error('useWorkflowPage outside the workflow page');
  return ctx;
}

export function WorkflowLayout() {
  const { workflowId } = useParams({ strict: false }) as { workflowId: string };
  const ws = useWs();
  const query = useWorkflow(workflowId);
  const detail = usePendingDetail(ws, workflowId, query.data);
  const versionId = query.data?.workflow.draftVersionId ?? '';
  const actions = useMemo(() => editorActions(ws, workflowId, versionId), [ws.id, workflowId, versionId]);
  useDocumentTitle(detail?.workflow.displayTitle ?? 'Workflows');

  if (query.isError && !query.data) {
    return (
      <>
        <PageHeader crumbs={[{ label: 'Workflows', icon: 'workflows', href: workflowsPath() }]} />
        <div className={s.center} data-testid="workflow-not-found">
          The requested workflow could not be found
        </div>
      </>
    );
  }
  if (!detail) return <ContentSpinner />;
  const level = detail.workflow.access.level;
  const page: WorkflowPage = {
    workflowId,
    detail,
    actions,
    canEdit: level === 'full-access' || level === 'read-write',
  };
  return (
    <PageContext.Provider value={page}>
      <div className={s.root} data-testid="workflow-page" data-workflow-id={workflowId}>
        <WorkflowHeader page={page} />
        <WorkflowTabs page={page} />
        <div className={s.body}>
          <Outlet />
        </div>
      </div>
    </PageContext.Provider>
  );
}

function WorkflowHeader({ page }: { page: WorkflowPage }) {
  const { href } = useWorkspace();
  const w = page.detail.workflow;
  const members = useMembers();
  const creator = members.find((m) => m.id === w.createdBy.id);
  return (
    <PageHeader
      start={
        <div className={s.crumbs}>
          <Link to={href(workflowsPath())} className={s.crumbLink}>
            <Icon icon="workflows" size={16} />
            Workflows
          </Link>
          <span className={s.crumbSep}>/</span>
          <TitleInput page={page} />
          {!w.isTransient && <FavoriteStar favoriteType="workflow" targetId={w.id} size={20} />}
        </div>
      }
      actions={
        <>
          {creator && (
            <Tooltip content={`Created by ${[creator.firstName, creator.lastName].filter(Boolean).join(' ')}`}>
              <span style={{ display: 'inline-flex' }}>
                <MemberAvatar member={creator} size={20} />
              </span>
            </Tooltip>
          )}
          <SharePopover workflow={w} />
          <span className={s.headerDivider} />
          <IconButton icon="help" aria-label="Help" tooltip="Help" size={20} onPress={() => openHelpDrawer()} />
          <WorkflowMenu
            workflow={w}
            header
            trigger={<IconButton icon="moreVertical" size={20} aria-label="Workflow menu" tooltip="Workflow menu" />}
          />
          <Button variant="secondary" size={28} icon="chat">
            Ask AI
          </Button>
        </>
      }
    />
  );
}

/** Inline title (placeholder "Untitled Workflow"; width follows the text; Enter / blur commit). */
function TitleInput({ page }: { page: WorkflowPage }) {
  const w = page.detail.workflow;
  const [value, setValue] = useState(w.title ?? '');
  const [focused, setFocused] = useState(false);
  const measure = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(120);
  useEffect(() => {
    if (!focused) setValue(w.title ?? '');
  }, [w.title, focused]);
  const placeholder = w.aiTitle ?? 'Untitled Workflow';
  useEffect(() => {
    if (measure.current) setWidth(Math.ceil(measure.current.getBoundingClientRect().width) + 10);
  }, [value, placeholder]);
  const commit = () => {
    const next = value.trim() || null;
    if (next !== (w.title ?? null)) void page.actions.renameWorkflow({ title: next });
  };
  return (
    <>
      <span ref={measure} className={s.titleMeasure} aria-hidden="true">
        {value || placeholder}
      </span>
      <input
        className={s.titleInput}
        style={{ width }}
        value={value}
        placeholder={placeholder}
        aria-label="Workflow title"
        data-testid="workflow-title"
        readOnly={!page.canEdit}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setValue(w.title ?? '');
            e.currentTarget.blur();
          }
        }}
      />
    </>
  );
}

function WorkflowTabs({ page }: { page: WorkflowPage }) {
  const { href } = useWorkspace();
  const ws = useWs();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const w = page.detail.workflow;
  const active = /\/runs(\/|$)/.test(pathname) ? 'runs' : /\/settings$/.test(pathname) ? 'settings' : 'editor';
  const tabs = [
    { id: 'editor', label: 'Editor', icon: 'workflows' as const, to: editorPath(w.id) },
    { id: 'runs', label: 'Runs', icon: 'wfRetry' as const, to: runsPath(w.id), count: w.runCount || undefined },
    { id: 'settings', label: 'Settings', icon: 'settings' as const, to: settingsTabPath(w.id) },
  ];
  const publishable = w.latestPublishedVersionId !== null;
  const live = w.status === 'live';
  return (
    <nav className={s.tabBar} aria-label="Workflow tabs">
      {tabs.map((t) => (
        <Link
          key={t.id}
          to={href(t.to)}
          className={s.tab}
          data-active={active === t.id || undefined}
          data-testid={`workflow-tab-${t.id}`}
          aria-current={active === t.id ? 'page' : undefined}
        >
          <Icon icon={t.icon} size={16} />
          {t.label}
          {t.count !== undefined && <span className={s.tabCount}>{t.count}</span>}
          {active === t.id && <span className={s.tabUnderline} aria-hidden="true" />}
        </Link>
      ))}
      <span className={s.tabSpacer} />
      {w.status === 'draft' && <span className={s.stateLabel}>Draft</span>}
      {w.status === 'paused' && (
        <span className={s.stateLabel}>
          <Icon icon="wfPaused" size={14} />
          Paused
        </span>
      )}
      {live && (
        <TriggerButton
          detail={page.detail}
          onRun={(run) => void navigate({ href: href(runsPath(w.id, { versionId: run.versionId, runId: run.runId })) })}
        />
      )}
      <Tooltip
        content={publishable ? (live ? 'Pause workflow' : 'Enable workflow') : 'Publish the workflow to enable it'}
      >
        <span className={s.livePill} data-live={live || undefined} data-testid="live-toggle">
          <Switch
            isSelected={live}
            isDisabled={!publishable || !page.canEdit}
            aria-label="Live"
            className={s.liveSwitch}
            onChange={(on) => void setLive(ws, w.id, on)}
          />
          Live
        </span>
      </Tooltip>
    </nav>
  );
}
