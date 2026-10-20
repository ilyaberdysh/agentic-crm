// Share: a ≈440 px popover — "Workspace access" + level; search + level
// + Add; "Individual members" with their levels; footer "Learn more about permissions".

import { Button, Icon, Popover, Spinner } from '@agentic-crm/ui';
import { useState } from 'react';
import { useWorkflowPermissions } from '../data';
import type { Workflow } from '../types';
import { AddMember, MemberRows, WorkspaceRow } from './AccessRows';
import * as s from './share.css';

export function SharePopover({ workflow }: { workflow: Workflow }) {
  const [open, setOpen] = useState(false);
  const query = useWorkflowPermissions(workflow.id, open);
  const data = query.data;
  const workspace = data?.grants.find((g) => g.target.type === 'workspace');
  const people = (data?.grants ?? []).filter((g) => g.target.type === 'member' || g.target.type === 'team');
  return (
    <Popover
      isOpen={open}
      onOpenChange={setOpen}
      placement="bottom end"
      width={440}
      padding={0}
      aria-label="Share"
      trigger={
        <Button variant="ghost" size={28} isActive={open} data-testid="share-button">
          Share
        </Button>
      }
    >
      <div className={s.popover} data-testid="share-popover">
        {!data ? (
          <div className={s.loading}>
            <Spinner size={14} />
          </div>
        ) : (
          <>
            <WorkspaceRow workflowId={workflow.id} grant={workspace} canManage={data.canManage} />
            <div className={s.divider} />
            <AddMember workflowId={workflow.id} granted={people.map((g) => g.target.id)} canManage={data.canManage} />
            {people.length > 0 && <div className={s.sectionLabel}>Individual members</div>}
            <MemberRows workflowId={workflow.id} grants={people} canManage={data.canManage} />
            <div className={s.divider} />
            <a
              className={s.footer}
              href="https://github.com/ilyaberdysh/agentic-crm#what-works-today"
              target="_blank"
              rel="noreferrer"
            >
              <Icon icon="help" size={14} />
              Learn more about permissions
            </a>
          </>
        )}
      </div>
    </Popover>
  );
}
