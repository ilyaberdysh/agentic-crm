// Workflow overview (no block selected; README §3.3; evidence G/G-publish-confirm.png, G-version-history.png): tile +
// editable title (placeholder: the AI title or "Untitled Workflow"), description, the publish Checklist when the last
// publish was refused, "Helpful resources"; the clock button toggles the version history timeline ("Current draft",
// then published versions newest first with Live / Paused and the publisher). Picking a version opens it read-only.
import type { WorkflowVersionSummary } from '@agentic-crm/contracts';
import { IconButton, Spinner } from '@agentic-crm/ui';
import { useEffect, useState } from 'react';
import { useMembers } from '../../../attributes/data/queries';
import { memberName } from '../../../attributes/format/formatValue';
import { MemberAvatar } from '../../../attributes/ui/primitives';
import { type PublishFailure, useVersions } from '../../data';
import { StatusChip, WorkflowTile } from '../../ui/parts';
import { useEditorUi } from '../EditorContext';
import * as s from './panel.css';

export function OverviewHeader({ onCollapse }: { onCollapse: () => void }) {
  const ui = useEditorUi();
  const w = ui.page.detail.workflow;
  const [title, setTitle] = useState(w.title ?? '');
  useEffect(() => setTitle(w.title ?? ''), [w.title]);
  const versions = ui.panel.kind === 'versions';
  return (
    <div className={s.topBar} style={{ height: 58, padding: '0 12px 0 16px', gap: 10 }}>
      <WorkflowTile workflowId={w.id} size={28} />
      <input
        className={s.overviewTitle}
        value={title}
        placeholder={w.aiTitle ?? 'Untitled Workflow'}
        aria-label="Workflow name"
        readOnly={!ui.page.canEdit}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          const next = title.trim() || null;
          if (next !== (w.title ?? null)) void ui.page.actions.renameWorkflow({ title: next });
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <IconButton
        icon={versions ? 'close' : 'history'}
        size={28}
        variant={versions ? 'secondary' : 'ghost'}
        aria-label={versions ? 'Close version history' : 'Version history'}
        tooltip={versions ? 'Close version history' : 'Version history'}
        data-testid="version-history-toggle"
        onPress={() => {
          if (versions) {
            ui.viewVersion(null);
            ui.setPanel({ kind: 'overview' });
          } else ui.setPanel({ kind: 'versions' });
        }}
      />
      <IconButton
        icon="wfCollapsePanel"
        size={28}
        aria-label="Collapse workflow side panel"
        tooltip="Collapse"
        onPress={onCollapse}
      />
    </div>
  );
}

export function OverviewPanel({ failure }: { failure: PublishFailure | null }) {
  const ui = useEditorUi();
  const w = ui.page.detail.workflow;
  const [description, setDescription] = useState(w.description ?? '');
  useEffect(() => setDescription(w.description ?? ''), [w.description]);
  const checklist = failure?.checklist;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }} data-testid="workflow-overview">
      <textarea
        className={s.description}
        rows={2}
        placeholder={w.aiDescription ?? 'Add a description...'}
        value={description}
        readOnly={!ui.page.canEdit}
        aria-label="Workflow description"
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => {
          const next = description.trim() || null;
          if (next !== (w.description ?? null)) void ui.page.actions.renameWorkflow({ description: next });
        }}
      />
      <hr className={s.divider} />
      {failure && (
        <div style={{ paddingTop: 16 }}>
          <div className={s.checklist} role="alert" data-testid="publish-checklist">
            <span className={s.checklistTitle}>Checklist</span>
            {checklist && checklist.errorCount > 0 ? (
              <>
                <span>{`${checklist.blocksWithErrors.length} blocks have errors`}</span>
                <span>Make sure all issues are resolved before publishing</span>
              </>
            ) : (
              <span>{failure.message}</span>
            )}
            {checklist?.messages
              .filter((m) => !/blocks have errors/.test(m))
              .map((m) => (
                <span key={m}>{m}</span>
              ))}
          </div>
        </div>
      )}
      <div className={s.resources}>
        <span className={s.resourcesLabel}>Helpful resources</span>
        <a
          className={s.resourceCard}
          href="https://github.com/ilyaberdysh/agentic-crm#what-works-today"
          target="_blank"
          rel="noreferrer"
        >
          Documentation
          <span className={s.resourceText}>Find out more about how to best set up workflows</span>
        </a>
      </div>
    </div>
  );
}

function versionDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return `Today, ${time}`;
  if (diff === 1) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })}, ${time}`;
}

export function VersionHistory() {
  const ui = useEditorUi();
  const query = useVersions(ui.page.workflowId);
  const members = useMembers();
  if (!query.data) {
    return (
      <div style={{ padding: 16 }}>
        <Spinner size={14} />
      </div>
    );
  }
  const draft = query.data.find((v) => v.type === 'draft');
  const published = query.data.filter((v) => v.type === 'immutable');
  const current = ui.viewingVersionId;
  const draftLabel = draft?.restoredFrom
    ? `Current draft, restored from ${draft.restoredFrom.publishedAt ? versionDate(draft.restoredFrom.publishedAt) : 'a previous version'}`
    : 'Current draft';
  return (
    <div className={s.timeline} data-testid="version-history">
      <button
        type="button"
        className={s.versionRow}
        data-selected={current === null || undefined}
        data-testid="version-row"
        data-version="draft"
        onClick={() => ui.viewVersion(null)}
      >
        <span className={s.versionDot} data-current />
        <span className={`${s.versionTitle} ${s.versionCurrent}`}>{draftLabel}</span>
      </button>
      {published.map((v: WorkflowVersionSummary) => {
        const by = v.publishedBy?.id ? members.find((m) => m.id === v.publishedBy?.id) : undefined;
        return (
          <button
            key={v.id}
            type="button"
            className={s.versionRow}
            data-selected={current === v.id || undefined}
            data-testid="version-row"
            data-version={v.id}
            data-status={v.status}
            onClick={() => ui.viewVersion(v.id)}
          >
            <span className={s.versionDot} />
            <span className={s.versionTitle}>
              {v.publishedAt ? versionDate(v.publishedAt) : 'Unpublished'}
              {(v.status === 'live' || v.status === 'paused') && (
                <StatusChip workflow={{ status: v.status, isArchived: false }} pill />
              )}
            </span>
            <span className={s.versionBy}>
              <MemberAvatar member={by} size={16} />
              {memberName(by) || 'Workspace member'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
