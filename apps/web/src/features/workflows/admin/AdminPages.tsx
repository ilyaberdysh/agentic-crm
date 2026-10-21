// Workspace settings → Workflows:
// Billing → Credits usage. The admin list shows every
// workflow (workspace admins), whatever their own access; a row opens the workflow's Permissions tab: Workspace access,
// Teams, Individual members.
import { Button, Icon, IconButton, Spinner } from '@agentic-crm/ui';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useMembers } from '../../attributes/data/queries';
import { memberName } from '../../attributes/format/formatValue';
import { MemberAvatar } from '../../attributes/ui/primitives';
import { SettingsPage, SettingsSection } from '../../settings/SettingsPage';
import type { SettingsEntry } from '../../settings/settingsNav';
import { HelpButton, PageHeader } from '../../shell/PageHeader';
import * as shell from '../../shell/shell.css';
import { useWorkspace } from '../../shell/workspaceContext';
import { useUsage, useWorkflowPermissions, useWorkflows } from '../data';
import { adminPermissionsPath, adminWorkflowsPath, editorPath } from '../paths';
import { AddMember, MemberRows, WorkspaceRow } from '../share/AccessRows';
import { StatusChip, WorkflowTile } from '../ui/parts';
import * as s from './admin.css';

const ENTRY: SettingsEntry = {
  path: 'automations/workflows',
  label: 'Workflows',
  icon: 'workflows',
  description: 'Modify workflows in your workspace.',
};

export function AdminWorkflowsPage() {
  const { isAdmin, href } = useWorkspace();
  const navigate = useNavigate();
  const list = useWorkflows({ admin: isAdmin, includeArchived: true });
  const members = useMembers();
  const [query, setQuery] = useState('');
  const rows = useMemo(
    () =>
      (list.data ?? [])
        .filter((w) => !query.trim() || w.displayTitle.toLowerCase().includes(query.trim().toLowerCase()))
        .sort((a, b) => Number(a.isArchived) - Number(b.isArchived) || (a.createdAt < b.createdAt ? 1 : -1)),
    [list.data, query],
  );
  return (
    <SettingsPage entry={ENTRY}>
      <div className={s.toolbar}>
        <label className={s.search}>
          <Icon icon="search" size={14} />
          <input
            className={s.searchInput}
            placeholder="Search"
            aria-label="Search workflows"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <Button variant="secondary" size={32} icon="filter" aria-label="Filter workflows">
          Filter
        </Button>
      </div>
      <div className={s.table} role="table" data-testid="admin-workflows">
        <div className={`${s.tr} ${s.th}`} role="row">
          <span className={s.td}>
            <Icon icon="workflows" size={14} />
            Workflow
          </span>
          <span className={s.td}>
            <Icon icon="person" size={14} />
            Created by
          </span>
          <span className={s.td}>
            <Icon icon="reports" size={14} />
            Status
          </span>
        </div>
        {list.isPending && (
          <div className={s.loading}>
            <Spinner size={16} />
          </div>
        )}
        {rows.map((w) => {
          const m = members.find((x) => x.id === w.createdBy.id);
          return (
            <div
              key={w.id}
              role="row"
              tabIndex={0}
              className={s.tr}
              data-archived={w.isArchived || undefined}
              data-testid="admin-workflow-row"
              onClick={() => void navigate({ href: href(adminPermissionsPath(w.id)) })}
              onKeyDown={(e) => e.key === 'Enter' && void navigate({ href: href(adminPermissionsPath(w.id)) })}
            >
              <span className={s.td}>
                <WorkflowTile workflowId={w.id} size={20} />
                <span className={s.truncate}>{w.displayTitle}</span>
              </span>
              <span className={s.td}>
                <MemberAvatar member={m} size={16} />
                <span className={s.truncate}>{memberName(m) || 'Workspace member'}</span>
              </span>
              <span className={s.td}>
                <StatusChip workflow={w} pill />
              </span>
            </div>
          );
        })}
      </div>
    </SettingsPage>
  );
}

export function AdminWorkflowPermissionsPage() {
  const { workflowId } = useParams({ strict: false }) as { workflowId: string };
  const { href } = useWorkspace();
  const perms = useWorkflowPermissions(workflowId);
  const list = useWorkflows({ admin: true, includeArchived: true });
  const workflow = list.data?.find((w) => w.id === workflowId);
  const data = perms.data;
  const workspace = data?.grants.find((g) => g.target.type === 'workspace');
  const teams = (data?.grants ?? []).filter((g) => g.target.type === 'team');
  const people = (data?.grants ?? []).filter((g) => g.target.type === 'member');
  const [adding, setAdding] = useState(false);
  const title = workflow?.displayTitle ?? data?.resourceName ?? 'Workflow';
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Workflows', icon: 'workflows', href: href(adminWorkflowsPath()) }, { label: title }]}
        actions={<HelpButton />}
      />
      <div className={shell.content}>
        <div className={s.page} data-testid="admin-workflow-permissions">
          <Link to={href(adminWorkflowsPath())} className={s.back}>
            <Icon icon="chevronLeft" size={14} />
            Back
          </Link>
          <div className={s.titleRow}>
            <h1 className={s.title}>{title}</h1>
            {workflow && <StatusChip workflow={workflow} pill />}
            {workflow && (
              <IconButton
                icon="externalLink"
                size={28}
                aria-label="Open workflow"
                tooltip="Open workflow"
                onPress={() => window.open(href(editorPath(workflow.id)), '_self')}
              />
            )}
          </div>
          <p className={s.subtitle}>Manage workflow permissions and other relevant settings.</p>
          <div className={s.tabs}>
            <span className={s.tab}>
              <Icon icon="lock" size={14} />
              Permissions
            </span>
          </div>
          {!data ? (
            <div className={s.loading}>
              <Spinner size={16} />
            </div>
          ) : (
            <div className={s.sections}>
              <SettingsSection
                id="members"
                title="Members"
                description="Set access rules for people in your workspace."
              >
                <div className={s.card}>
                  <WorkspaceRow
                    workflowId={workflowId}
                    grant={workspace}
                    canManage={data.canManage}
                    subtitle="Set default access for all workspace members"
                  />
                </div>
              </SettingsSection>
              <div className={s.sectionRow}>
                <div>
                  <h2 className={s.sectionTitle}>Teams</h2>
                  <p className={s.sectionText}>
                    Set access for teams. Team members will still inherit workspace access.
                  </p>
                </div>
                <Button variant="secondary" size={28} icon="add" isDisabled>
                  Add
                </Button>
              </div>
              {teams.length > 0 && (
                <div className={s.card}>
                  <MemberRows workflowId={workflowId} grants={teams} canManage={data.canManage} />
                </div>
              )}
              <div className={s.sectionRow}>
                <div>
                  <h2 className={s.sectionTitle}>Individual members</h2>
                  <p className={s.sectionText}>
                    Set access for members. Members will still inherit team and workspace access.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size={28}
                  icon="add"
                  isDisabled={!data.canManage}
                  onPress={() => setAdding((a) => !a)}
                  data-testid="add-member-access"
                >
                  Add
                </Button>
              </div>
              {adding && (
                <div className={s.card}>
                  <AddMember
                    workflowId={workflowId}
                    granted={people.map((g) => g.target.id)}
                    canManage={data.canManage}
                  />
                </div>
              )}
              {people.length > 0 && (
                <div className={s.card}>
                  <MemberRows workflowId={workflowId} grants={people} canManage={data.canManage} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const USAGE_ENTRY: SettingsEntry = {
  path: 'billing/automation-credit-usage',
  label: 'Credits usage',
  icon: 'billing',
  description: 'View your workspace credit usage over time',
};

/** Billing → Credits usage: credits consumed this period, a daily bar chart and the per-type table. */
export function CreditUsagePage() {
  const usage = useUsage();
  const data = usage.data;
  const days = useMemo(() => {
    if (!data) return [];
    const out: { date: string; credits: number }[] = [];
    const start = new Date(`${data.period.from}T00:00:00Z`);
    const end = new Date(`${data.period.to}T00:00:00Z`);
    for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) {
      const iso = d.toISOString().slice(0, 10);
      out.push({ date: iso, credits: data.byDay.find((x) => x.date === iso)?.credits ?? 0 });
    }
    return out;
  }, [data]);
  const max = Math.max(1, ...days.map((d) => d.credits));
  return (
    <SettingsPage entry={USAGE_ENTRY}>
      {!data ? (
        <Spinner size={16} />
      ) : (
        <>
          <div className={s.usageHead} data-testid="credits-usage">
            <span className={s.sectionText}>Current billing period</span>
            <span className={s.usageTotal}>
              Credits consumed <strong>{data.totalCredits.toLocaleString('en-US')}</strong> /{' '}
              {data.allowance.toLocaleString('en-US')}
            </span>
          </div>
          <div className={s.chart} role="img" aria-label="Credits per day">
            {days.map((d) => (
              <span
                key={d.date}
                className={s.bar}
                title={`${d.date}: ${d.credits}`}
                style={{ height: `${(d.credits / max) * 100}%` }}
              />
            ))}
          </div>
          <div className={s.table} role="table">
            <div className={`${s.tr2} ${s.th}`} role="row">
              <span className={s.td}>Type</span>
              <span className={s.td}>Credits</span>
            </div>
            {data.byType.map((t) => (
              <div key={t.type} className={s.tr2} role="row">
                <span className={s.td}>{t.label}</span>
                <span className={s.td}>{t.credits}</span>
              </div>
            ))}
            {data.byWorkflow.map((w) => (
              <div key={w.workflowId} className={s.tr2} role="row">
                <span className={s.td} style={{ paddingLeft: 32 }}>
                  {w.title ?? 'Private workflow'}
                </span>
                <span className={s.td}>{w.credits}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </SettingsPage>
  );
}
