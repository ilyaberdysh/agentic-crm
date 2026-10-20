// The Insight Templates tab `/$ws/calls/templates` (BACKLOG 10.13; I calls): a
// table of templates (title, sections, status, creator, last published) with a row menu (Archive / Restore, Delete) and
// "New template" (a transient template is created and its editor opens).
import {
  AlertDialog,
  Button,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Skeleton,
  Tooltip,
  toast,
} from '@agentic-crm/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { errorEnvelopeOf } from '../../data/trpc';
import { newId } from '../../lib/ids';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { formatRelativeTime, formatTimestampAbsolute } from '../attributes/format/formatValue';
import { ActorLabel } from '../notes/actors';
import { EmptyArt } from '../shell/EmptyArt';
import { useWorkspace } from '../shell/workspaceContext';
import { CallsHeader } from './CallsHeader';
import {
  type InsightTemplate,
  useCreateTemplate,
  useDeleteTemplate,
  useInsightTemplates,
  useUpdateTemplate,
} from './data';
import { templateTitle } from './model';
import * as s from './templates.css';

const STATUS_LABEL = { enabled: 'Published', disabled: 'Archived', draft: 'Draft' } as const;

export function StatusBadge({ status }: { status: InsightTemplate['status'] }) {
  return (
    <span className={`${s.statusBadge} ${s.statusTone[status]}`} data-testid="template-status" data-status={status}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** The Archive / Restore / Delete menu of a template (list row and editor header). */
export function TemplateMenu({
  template,
  onDeleted,
  size = 20,
  className,
}: {
  template: InsightTemplate;
  onDeleted?: () => void;
  size?: 20 | 28;
  className?: string;
}) {
  const update = useUpdateTemplate();
  const remove = useDeleteTemplate();
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);
  const fail = (what: string) => (e: unknown) => toast.error({ title: what, description: errorEnvelopeOf(e).message });
  return (
    <>
      <MenuTrigger>
        <IconButton
          icon="moreVertical"
          size={size}
          aria-label="Show menu"
          tooltip="Show menu"
          className={className}
          data-testid="template-menu"
        />
        <Menu
          aria-label="Template menu"
          placement="bottom end"
          width={192}
          onAction={(key) => {
            if (key === 'archive') setConfirm('archive');
            else if (key === 'restore')
              update.mutate(
                { templateId: template.id, archived: false },
                { onError: fail('Failed to restore template') },
              );
            else if (key === 'delete') setConfirm('delete');
          }}
          disabledKeys={template.canDelete ? [] : ['delete']}
        >
          {template.isArchived ? (
            <MenuItem id="restore" icon="unarchive">
              Restore template
            </MenuItem>
          ) : (
            <>
              <MenuItem id="archive" icon="archive">
                Archive template
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                id="delete"
                icon="delete"
                variant="danger"
                description={template.canDelete ? undefined : 'Templates that have been used cannot be deleted'}
              >
                Delete template
              </MenuItem>
            </>
          )}
        </Menu>
      </MenuTrigger>
      <AlertDialog
        isOpen={confirm === 'archive'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Are you sure you want to archive this template?"
        description="You will no longer be able to use it in call recording insights. You can restore the template at any time."
        confirmLabel="Archive template"
        variant="primary"
        onConfirm={() =>
          update.mutate({ templateId: template.id, archived: true }, { onError: fail('Failed to archive template') })
        }
      />
      <AlertDialog
        isOpen={confirm === 'delete'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Are you sure you want to delete this template?"
        description="This cannot be undone"
        confirmLabel="Delete template"
        onConfirm={() =>
          remove.mutate(template.id, {
            onSuccess: () => onDeleted?.(),
            onError: fail('Failed to delete template'),
          })
        }
      />
    </>
  );
}

/** "New template": a transient template is created on the server and its editor opens. */
export function useNewTemplate() {
  const create = useCreateTemplate();
  const navigate = useNavigate();
  const { href } = useWorkspace();
  return {
    isPending: create.isPending,
    start: () => {
      const id = newId();
      create.mutate(
        { id },
        {
          onSuccess: () => void navigate({ to: href(`calls/templates/${id}`) }),
          onError: (e) => toast.error({ title: 'Failed to create template', description: errorEnvelopeOf(e).message }),
        },
      );
    },
  };
}

function TemplateRow({ template }: { template: InsightTemplate }) {
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const to = href(`calls/templates/${template.id}`);
  return (
    <div
      className={`${s.row} ${s.dataRow}`}
      role="row"
      data-testid="template-row"
      data-template-id={template.id}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a, button, [role="menuitem"], [role="alertdialog"]')) return;
        void navigate({ to });
      }}
    >
      <div className={s.cell} role="cell">
        <span className={s.tile} aria-hidden="true">
          <Icon icon="insightTemplate" size={14} />
        </span>
        <Link to={to} className={s.link} data-testid="template-link">
          {templateTitle(template)}
        </Link>
      </div>
      <div className={`${s.cell} ${s.muted}`} role="cell" data-testid="template-sections">
        {template.sectionCount}
      </div>
      <div className={s.cell} role="cell">
        <StatusBadge status={template.status} />
      </div>
      <div className={s.cell} role="cell">
        <ActorLabel actor={template.createdBy} />
      </div>
      <div className={`${s.cell} ${s.muted}`} role="cell">
        {template.lastPublishedAt ? (
          <Tooltip content={formatTimestampAbsolute(template.lastPublishedAt)}>
            <span>{formatRelativeTime(template.lastPublishedAt)}</span>
          </Tooltip>
        ) : null}
      </div>
      <div className={s.cell} role="cell" style={{ justifyContent: 'flex-end', padding: '0 12px 0 0' }}>
        <TemplateMenu template={template} className={s.rowMenu} />
      </div>
    </div>
  );
}

export function TemplatesPage() {
  useDocumentTitle('Insight templates');
  const templates = useInsightTemplates();
  const create = useNewTemplate();
  const list = templates.data ?? [];

  return (
    <>
      <CallsHeader active="templates" />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }} data-testid="templates-page">
        {templates.isError ? (
          <div className={s.state}>
            <span className={s.stateError} data-testid="templates-error">
              Something went wrong trying to load templates. Refresh the page to try again.
            </span>
          </div>
        ) : templates.isPending ? (
          <div
            style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 24 }}
            data-testid="templates-loading"
          >
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} width={360} height={12} />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className={s.state} data-testid="templates-empty">
            <EmptyArt icon="insightTemplate" />
            <span className={s.stateTitle}>No insight templates yet</span>
            <span className={s.stateText}>Create a template to capture the key details that matter from any call.</span>
            <span className={s.stateAction}>
              <Button
                variant="primary"
                size={28}
                icon="add"
                isPending={create.isPending}
                onPress={create.start}
                data-testid="new-template"
              >
                New template
              </Button>
            </span>
          </div>
        ) : (
          <>
            <div className={s.toolbar}>
              <Button
                variant="primary"
                size={28}
                icon="add"
                isPending={create.isPending}
                onPress={create.start}
                data-testid="new-template"
              >
                New template
              </Button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <div role="table" aria-label="Insight templates" style={{ minWidth: 800 }}>
                <div className={`${s.row} ${s.head}`} role="row">
                  {[
                    ['insightTemplate', 'Template'],
                    ['list', 'Sections'],
                    ['attrStatus', 'Status'],
                    ['user', 'Created by'],
                    ['calendar', 'Last published'],
                  ].map(([icon, label]) => (
                    <div key={label} className={s.headCell} role="columnheader">
                      <Icon icon={icon as 'list'} size={14} />
                      {label}
                    </div>
                  ))}
                  <div className={s.headCell} role="columnheader" aria-hidden="true" />
                </div>
                {list.map((t) => (
                  <TemplateRow key={t.id} template={t} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
