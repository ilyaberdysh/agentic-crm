// "Run workflow" from a record page, a table selection or a list (README §3.8; runs.md §1): the Select workflow command
// dialog — search "Search workflows...", the group "<Object> workflows" with the live Record action (or List entry
// action) workflows of that object / list, the group "Actions" → "Create new workflow", footer "↑ ↓ Navigate" and
// "Select workflow ⏎". Choosing one starts one run per record and toasts "Triggered <workflow>".
import { Icon, Kbd, Modal, Spinner, toast } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace } from '../../shell/workspaceContext';
import { createWorkflow, triggerManual, useWorkflows, useWs } from '../data';
import { editorPath } from '../paths';
import { WorkflowTile } from '../ui/parts';
import * as s from './dialog.css';

export interface RunWorkflowTarget {
  kind: 'record' | 'list-entry';
  /** The object (records) or the list (entries). */
  entityDefinitionId: string;
  /** Record or entry ids. */
  ids: string[];
  /** "Deal" → group "Deal workflows". */
  groupLabel: string;
}

export function RunWorkflowDialog({ target, onClose }: { target: RunWorkflowTarget | null; onClose: () => void }) {
  return (
    <Modal isOpen={target !== null} onOpenChange={(o) => !o && onClose()} size="palette" aria-label="Select workflow">
      {target && <DialogBody target={target} onClose={onClose} />}
    </Modal>
  );
}

function DialogBody({ target, onClose }: { target: RunWorkflowTarget; onClose: () => void }) {
  const ws = useWs();
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const list = useWorkflows({ actionFor: { kind: target.kind, entityDefinitionId: target.entityDefinitionId } });
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const workflows = useMemo(
    () =>
      (list.data ?? []).filter(
        (w) => !query.trim() || w.displayTitle.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [list.data, query],
  );
  const items = [
    ...workflows.map((w) => ({ key: w.id, kind: 'workflow' as const, workflow: w })),
    ...(!query.trim() || 'create new workflow'.includes(query.trim().toLowerCase())
      ? [{ key: 'create', kind: 'create' as const, workflow: null }]
      : []),
  ];
  useEffect(() => setActive(0), [query, list.data?.length]);

  const choose = async (index: number) => {
    const item = items[index];
    if (!item) return;
    onClose();
    if (item.kind === 'create') {
      const w = await createWorkflow(ws).catch(() => null);
      if (w) void navigate({ href: href(editorPath(w.id)) });
      return;
    }
    const w = item.workflow;
    const refs = target.ids.map((id) => ({ entityDefinitionId: target.entityDefinitionId, entityInstanceId: id }));
    const runs = await triggerManual(ws, w.id, target.kind === 'record' ? { recordRefs: refs } : { entryRefs: refs });
    if (runs) toast.success({ title: 'Run workflow', description: `Triggered ${w.displayTitle}` });
  };

  return (
    <div className={s.root} data-testid="run-workflow-dialog">
      <div className={s.search}>
        <Icon icon="search" size={16} />
        <input
          ref={input}
          className={s.input}
          placeholder="Search workflows..."
          aria-label="Search workflows"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(items.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              void choose(active);
            }
          }}
        />
      </div>
      <div className={s.list} role="listbox" aria-label="Workflows">
        <div className={s.groupLabel}>{`${target.groupLabel} workflows`}</div>
        {list.isPending ? (
          <div className={s.empty}>
            <Spinner size={14} />
          </div>
        ) : workflows.length === 0 ? (
          <div className={s.empty}>No workflows</div>
        ) : (
          workflows.map((w, i) => (
            <button
              key={w.id}
              type="button"
              role="option"
              aria-selected={active === i}
              className={s.item}
              data-active={active === i || undefined}
              data-testid="run-workflow-option"
              onMouseEnter={() => setActive(i)}
              onClick={() => void choose(i)}
            >
              <WorkflowTile workflowId={w.id} size={20} />
              {w.displayTitle}
            </button>
          ))
        )}
        {items.some((x) => x.kind === 'create') && (
          <>
            <div className={s.groupLabel}>Actions</div>
            <button
              type="button"
              role="option"
              aria-selected={active === workflows.length}
              className={s.item}
              data-active={active === workflows.length || undefined}
              onMouseEnter={() => setActive(workflows.length)}
              onClick={() => void choose(workflows.length)}
            >
              <Icon icon="add" size={16} />
              Create new workflow
            </button>
          </>
        )}
      </div>
      <div className={s.footer}>
        <span className={s.hint}>
          <Kbd keys={['↑']} size={20} />
          <Kbd keys={['↓']} size={20} />
          Navigate
        </span>
        <span className={s.hint}>
          Select workflow
          <Kbd keys={['enter']} size={20} />
        </span>
      </div>
    </div>
  );
}
