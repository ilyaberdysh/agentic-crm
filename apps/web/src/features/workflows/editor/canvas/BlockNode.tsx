// A block card on the canvas: tile + title, description line, the "Trigger" tab, outcome
// handles (labelled rows for multi-outcome blocks), the validation ⚠, the blue "+" next to a selected block's free
// handles and, in the run viewer, the status tag and green / grey handles.
import type { ExecutionStatus } from '@agentic-crm/contracts';
import { Icon, Tooltip } from '@agentic-crm/ui';
import { Handle, type Node, type NodeProps, Position, useConnection } from '@xyflow/react';
import { memo } from 'react';
import type { WorkflowBlock } from '../../types';
import { BlockTile } from '../../ui/parts';
import * as s from './canvas.css';
import { CARD_WIDTH, cardHeight, handleY, showsOutcomeRows } from './geometry';

export interface BlockNodeData extends Record<string, unknown> {
  block: WorkflowBlock;
  mode: 'edit' | 'view' | 'run';
  selected: boolean;
  connectedOutcomes: string[];
  highlighted: boolean;
  issueMessage: string | null;
  onAddNext?: (blockId: string, outcome: string) => void;
  run?: {
    status: ExecutionStatus | null;
    takenOutcome: string | null;
    selected: boolean;
  };
}

export type BlockNodeType = Node<BlockNodeData, 'block'>;

function RunTag({ status, trigger }: { status: ExecutionStatus; trigger: boolean }) {
  if (status === 'completed') {
    return (
      <span className={`${s.runTag} ${s.runTagCompleted}`} data-testid="run-tag" data-status="completed">
        <Icon icon="check" size={12} />
        {trigger ? 'Triggered' : 'Completed'}
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className={`${s.runTag} ${s.runTagFailed}`} data-testid="run-tag" data-status="failed">
        <Icon icon="warning" size={12} />
        Failed
      </span>
    );
  }
  if (status === 'canceled') {
    return (
      <span className={`${s.runTag} ${s.runTagRunning}`} data-testid="run-tag" data-status="canceled">
        Canceled
      </span>
    );
  }
  return (
    <span className={`${s.runTag} ${s.runTagRunning}`} data-testid="run-tag" data-status={status}>
      <Icon icon="spinner" size={12} />
      {status === 'delayed' ? 'Delayed' : status === 'queued' ? 'Queued' : 'Running'}
    </span>
  );
}

export const BlockNode = memo(function BlockNode({ id, data }: NodeProps<BlockNodeType>) {
  const { block, mode, selected, run } = data;
  const trigger = block.blockType === 'trigger';
  const rows = showsOutcomeRows(block);
  const height = cardHeight(block);
  const dropTarget = useConnection((c) => c.inProgress && c.fromNode?.id !== id && c.toNode?.id === id);
  const connecting = useConnection((c) => c.inProgress && c.fromNode?.id !== id);
  const editable = mode === 'edit';
  const description = block.description?.trim();
  return (
    <div className={s.node} data-testid="block-node" data-block-id={id} data-slug={block.slug}>
      {trigger && (
        <span className={s.triggerTag} data-selected={(selected && mode !== 'run') || undefined}>
          <Icon icon="target" size={12} />
          Trigger
        </span>
      )}
      {run?.status && <RunTag status={run.status} trigger={trigger} />}
      <div
        className={s.card}
        style={{ height }}
        data-selected={(selected && mode !== 'run') || undefined}
        data-run-selected={run?.selected || undefined}
        data-highlight={data.highlighted || undefined}
        data-drop-target={dropTarget || undefined}
      >
        <div className={s.cardHead}>
          <BlockTile slug={block.slug} size={24} />
          <span className={s.cardTitle}>{block.title}</span>
        </div>
        <p className={s.cardDescription} data-empty={!description || undefined}>
          {description || (mode === 'edit' ? 'Add a description...' : 'No description')}
        </p>
        {rows && (
          <div className={s.outcomes}>
            {block.outcomes.map((o) => (
              <span key={o.slug} className={s.outcomeRow}>
                {o.label}
              </span>
            ))}
          </div>
        )}
        {data.issueMessage && mode === 'edit' && (
          <Tooltip content={data.issueMessage}>
            <span
              className={s.warning}
              style={rows ? { top: 14, bottom: 'auto' } : undefined}
              data-testid="block-warning"
              aria-label={data.issueMessage}
            >
              <Icon icon="warning" size={14} />
            </span>
          </Tooltip>
        )}
      </div>
      {!trigger && (
        <Handle
          type="target"
          id="in"
          position={Position.Left}
          isConnectableStart={false}
          className={s.targetHandle}
          style={
            connecting
              ? { top: 0, left: 0, width: CARD_WIDTH, height, transform: 'none', borderRadius: 14 }
              : { top: 35, left: 0, width: 1, height: 1, pointerEvents: 'none' }
          }
        />
      )}
      {block.outcomes.map((o) => {
        const y = handleY(block, o.slug);
        const connected = data.connectedOutcomes.includes(o.slug);
        const taken = run ? run.takenOutcome === o.slug : false;
        return (
          <div key={o.slug}>
            <Handle
              type="source"
              id={o.slug}
              position={Position.Right}
              isConnectable={editable}
              className={s.sourceHandle}
              style={{ top: y, transform: 'translateY(-50%)' }}
              data-testid="outcome-handle"
              data-outcome={o.slug}
            >
              <span
                className={s.handleDot}
                data-active={(selected && editable) || undefined}
                data-connected={(!run && connected) || undefined}
                data-taken={taken || undefined}
                data-not-taken={(run && run.status && !taken && rows) || undefined}
              />
            </Handle>
            {editable && selected && !connected && data.onAddNext && (
              <button
                type="button"
                className={s.addNext}
                style={{ left: CARD_WIDTH + 30, top: y - 9 }}
                aria-label="Add connecting block"
                data-testid="add-next"
                onClick={(e) => {
                  e.stopPropagation();
                  data.onAddNext?.(block.id, o.slug);
                }}
              >
                <Icon icon="add" size={12} strokeWidth={2.5} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
});

/** The dashed card where a block chosen in "Select next step" will go. */
export function PlaceholderNode() {
  return (
    <div className={s.placeholder} data-testid="next-placeholder">
      <Icon icon="add" size={14} />
      <Handle type="target" id="in" position={Position.Left} isConnectable={false} style={{ opacity: 0, top: 35 }} />
    </div>
  );
}
