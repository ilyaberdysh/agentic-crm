// Rules tab of an object (J objects-lists §3.2; evidence/J/object-rules-empty.png, object-rules-list.png): the empty
// state ("Requirement rules — Set requirements for updating records", "+ Add rule") and the list (header, table
// Rule · Applies to · ⋮ Edit / Delete). Rows open the editor; deleting asks "Delete rule?".
import type { EntityDefinition, Rule } from '@agentic-crm/contracts';
import {
  AlertDialog,
  Button,
  ErrorState,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Skeleton,
  toast,
} from '@agentic-crm/ui';
import { useState } from 'react';
import { errorEnvelopeOf } from '../../../data/trpc';
import { brand } from '../../../lib/brand';
import { useWorkspace } from '../../shell/workspaceContext';
import * as os from '../objects/objects.css';
import { deleteRule, useRules } from './data';
import { RuleDialog } from './RuleDialog';
import * as r from './rules.css';

const HELP = `${brand.supportUrl}/objects/create-and-manage-rules`;

function LearnMoreLink() {
  return (
    <>
      <a
        href={HELP}
        target="_blank"
        rel="noreferrer"
        style={{
          color: 'inherit',
          textDecoration: 'underline',
          textDecorationColor: 'var(--ar-color-stroke-secondary-transparent)',
          textUnderlineOffset: '0.14em',
        }}
      >
        Learn more
      </a>{' '}
      <Icon icon="arrowUpRight" size={12} style={{ display: 'inline', verticalAlign: '-1px' }} />
    </>
  );
}

export function RulesTab({ object, canEdit }: { object: EntityDefinition; canEdit: boolean }) {
  const { workspace } = useWorkspace();
  const rules = useRules(workspace, object.id);
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Rule | null>(null);

  if (rules.isError)
    return (
      <ErrorState
        message="Failed to load rules"
        style={{ padding: 48 }}
        actions={
          <Button variant="secondary" size={28} onPress={() => void rules.refetch()}>
            Retry
          </Button>
        }
      />
    );

  const list = rules.data ?? [];
  const dialog = editing && (
    <RuleDialog
      key={editing === 'new' ? 'new' : editing.id}
      object={object}
      rule={editing === 'new' ? null : editing}
      onClose={() => setEditing(null)}
    />
  );

  if (rules.data && list.length === 0)
    return (
      <>
        <div className={r.emptyWrap}>
          <div className={r.illustration} aria-hidden="true">
            <Icon icon="workflows" size={56} strokeWidth={0.8} />
          </div>
          <h2 className={r.emptyTitle}>Requirement rules</h2>
          <p className={r.emptyDescription}>
            Set requirements for updating records. <LearnMoreLink />
          </p>
          {canEdit && (
            <Button variant="primary" size={32} icon="add" onPress={() => setEditing('new')}>
              Add rule
            </Button>
          )}
        </div>
        {dialog}
      </>
    );

  return (
    <>
      <section className={os.section} aria-label="Requirement rules">
        <div className={os.sectionHeader}>
          <div>
            <h2 className={os.sectionTitle}>Requirement rules</h2>
            <p className={os.sectionDescription}>
              Set requirements for updating records. <LearnMoreLink />
            </p>
          </div>
          {canEdit && (
            <Button variant="primary" size={32} icon="add" onPress={() => setEditing('new')}>
              Add rule
            </Button>
          )}
        </div>
        <div className={os.table} role="table" aria-label="Rules">
          <div className={`${os.tableHeader} ${r.rulesGrid}`} role="row">
            <div className={os.headerCell} role="columnheader">
              <Icon icon="workflows" size={14} className={os.headerIcon} />
              Rule
            </div>
            <div className={os.headerCell} role="columnheader">
              <Icon icon="todo" size={14} className={os.headerIcon} />
              Applies to
            </div>
            <div role="columnheader" aria-label="Actions" />
          </div>
          {rules.isPending && (
            <div className={`${os.row} ${r.rulesGrid}`} data-static role="row">
              <Skeleton shape="text" width={160} />
            </div>
          )}
          {list.map((rule) => (
            <div
              key={rule.id}
              className={`${os.row} ${r.rulesGrid}`}
              role="row"
              tabIndex={0}
              data-testid="rule-row"
              onClick={() => canEdit && setEditing(rule)}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ') && canEdit) {
                  e.preventDefault();
                  setEditing(rule);
                }
              }}
            >
              <div className={os.cell} role="cell">
                <span className={os.cellText}>{rule.name}</span>
              </div>
              <div className={os.cell} role="cell">
                <span className={r.appliesCell}>
                  <Icon icon="user" size={16} />
                  All members
                </span>
              </div>
              <div
                className={os.rowActions}
                role="cell"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                {canEdit && (
                  <MenuTrigger>
                    <IconButton icon="moreVertical" aria-label="Options" variant="ghost" size={20} />
                    <Menu aria-label="Rule options" placement="bottom end" width={140}>
                      <MenuItem icon="edit" onAction={() => setEditing(rule)}>
                        Edit
                      </MenuItem>
                      <MenuItem icon="delete" variant="danger" onAction={() => setDeleting(rule)}>
                        Delete
                      </MenuItem>
                    </Menu>
                  </MenuTrigger>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
      {dialog}
      <AlertDialog
        isOpen={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete rule?"
        description="This removes the rule from this object."
        confirmLabel="Delete"
        onConfirm={() => {
          const rule = deleting;
          setDeleting(null);
          if (rule)
            void deleteRule(workspace, object.id, rule.id).catch((e) =>
              toast.error({ title: 'Failed to delete rule', description: errorEnvelopeOf(e).message }),
            );
        }}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
