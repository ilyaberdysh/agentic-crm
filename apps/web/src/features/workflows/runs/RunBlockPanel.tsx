// Run block detail: back to run history,
// header (tile, title, category), the description, stats Status · Credits used · Runtime · Executions, the failure text
// with "Troubleshooting workflows", the read-only Configuration, Outputs (or "This block has no outputs") and Next step.
import { BLOCK_CATEGORY_LABELS, blockDefinition, FAILURE_REASON_LABELS, type WfType } from '@agentic-crm/contracts';
import { Icon, IconButton } from '@agentic-crm/ui';
import type { ReactNode } from 'react';
import { useMembers, useRecordTitle } from '../../attributes/data/queries';
import { memberName } from '../../attributes/format/formatValue';
import { Field } from '../editor/panel/Field';
import * as ps from '../editor/panel/panel.css';
import { isVisible } from '../model/config';
import type { BlockExecution, RunDetail, WorkflowBlock, WorkflowVersion } from '../types';
import { BlockTile, CreditPill } from '../ui/parts';
import { runtimeLabel, statusLabel } from './model';
import * as s from './runs.css';

export function RunBlockPanel({
  block,
  execution,
  executionCount,
  detail,
  version,
  onBack,
  onSelect,
}: {
  block: WorkflowBlock;
  execution: BlockExecution | null;
  executionCount: number;
  detail: RunDetail;
  version: WorkflowVersion;
  onBack: () => void;
  onSelect: (blockId: string) => void;
}) {
  const def = blockDefinition(block.slug);
  const trigger = block.blockType === 'trigger';
  const specs = (def?.inputs ?? []).filter(
    (spec) => spec.control !== 'custom-fields' && isVisible(spec, block.config, def?.inputs ?? []),
  );
  const outcome = execution?.outcome ? block.outcomes.find((o) => o.slug === execution.outcome) : undefined;
  const outputs = outcome?.outputs ?? null;
  const next = execution ? detail.executions.find((e) => e.parentExecutionId === execution.id) : undefined;
  const nextBlock = next ? version.blocks.find((b) => b.id === next.blockId) : undefined;
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      data-testid="run-block-panel"
      data-block-id={block.id}
    >
      <div className={ps.topBar}>
        <IconButton
          icon="chevronLeft"
          size={20}
          aria-label="Back to run history"
          tooltip="Back to run history"
          onPress={onBack}
        />
      </div>
      <div className={ps.scroll}>
        <div className={ps.head}>
          <BlockTile slug={block.slug} size={32} />
          <div className={ps.headTexts}>
            <span className={ps.headTitle}>{block.title}</span>
            <span className={ps.headCategory}>{BLOCK_CATEGORY_LABELS[block.category]}</span>
          </div>
        </div>
        {block.description ? (
          <p className={ps.description} style={{ margin: '10px 12px 0' }}>
            {block.description}
          </p>
        ) : (
          <div style={{ height: 12 }} />
        )}
        {execution ? (
          <>
            <div className={s.stats} data-testid="run-block-stats">
              <div className={s.stat}>
                Status
                <span className={s.statValue}>
                  <span
                    className={`${s.statusPill} ${
                      execution.status === 'completed'
                        ? s.statusCompleted
                        : execution.status === 'failed'
                          ? s.statusFailed
                          : s.statusRunning
                    }`}
                    data-testid="run-block-status"
                  >
                    <Icon
                      icon={
                        execution.status === 'completed'
                          ? 'check'
                          : execution.status === 'failed'
                            ? 'warning'
                            : 'spinner'
                      }
                      size={12}
                    />
                    {statusLabel(execution.status, trigger)}
                  </span>
                </span>
              </div>
              <div className={s.stat}>
                Credits used
                <span className={s.statValue}>
                  <CreditPill amount={execution.cost?.amount ?? 0} />
                </span>
              </div>
              <div className={s.stat}>
                Runtime
                <span className={s.statValue}>{runtimeLabel(execution)}</span>
              </div>
              <div className={s.stat}>
                Executions
                <span className={s.statValue}>{executionCount}</span>
              </div>
            </div>
            {execution.status === 'failed' && (
              <div className={s.error} data-testid="run-block-error">
                <span>
                  {execution.errorMessage ??
                    (execution.failureReason ? FAILURE_REASON_LABELS[execution.failureReason] : 'This block failed')}
                </span>
                <a
                  className={s.troubleshoot}
                  href="https://github.com/ilyaberdysh/agentic-crm/issues"
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon icon="arrowUpRight" size={12} />
                  Troubleshooting workflows
                </a>
              </div>
            )}
          </>
        ) : (
          <div className={s.error} style={{ color: 'var(--ar-color-content-secondary)' }}>
            Not yet run
          </div>
        )}
        <hr className={ps.divider} />
        {specs.length > 0 && (
          <div className={ps.section}>
            <h3 className={ps.sectionTitle}>Configuration</h3>
            {specs.map((spec) => (
              <Field key={spec.key} block={{ ...block, issues: [] }} spec={spec} readOnly onConfig={() => {}} />
            ))}
          </div>
        )}
        {execution?.status === 'completed' && (
          <div className={ps.section} style={{ paddingTop: specs.length > 0 ? 0 : 16 }}>
            <h3 className={ps.sectionTitle}>Outputs</h3>
            {outputs && outputs.length > 0 && execution.outputs ? (
              <div className={s.outputs} data-testid="run-block-outputs">
                {outputs.map((o) => (
                  <div key={o.key}>
                    <div className={s.outputLabel}>{o.label}</div>
                    <div className={s.outputValue} data-testid="run-output" data-key={o.key}>
                      <OutputValue value={execution.outputs?.[o.key]} type={execution.outputTypes?.[o.key] ?? o.type} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={s.noOutputs}>
                <Icon icon="info" size={16} />
                This block has no outputs
              </div>
            )}
          </div>
        )}
        {execution?.status === 'failed' && (
          <div className={ps.section} style={{ paddingTop: 0 }}>
            <h3 className={ps.sectionTitle}>Outputs</h3>
            <div className={s.noOutputs}>
              <Icon icon="info" size={16} />
              This block has no outputs
            </div>
          </div>
        )}
      </div>
      <button
        type="button"
        className={s.nextFooter}
        onClick={() => nextBlock && onSelect(nextBlock.id)}
        disabled={!nextBlock}
        style={{ borderTop: '1px solid var(--ar-color-stroke-primary)' }}
      >
        <span style={{ flex: 1 }}>
          <span className={ps.nextTitle}>Next step</span>
          <span className={ps.nextText}>{nextBlock ? nextBlock.title : 'What happens after this block'}</span>
        </span>
        <Icon icon="chevronRight" size={16} />
      </button>
    </div>
  );
}

function RecordOutput({ value }: { value: { entityDefinitionId: string; entityInstanceId: string } }) {
  const { title } = useRecordTitle(value.entityDefinitionId, value.entityInstanceId);
  return <>{title || value.entityInstanceId}</>;
}

function OutputValue({ value, type }: { value: unknown; type: WfType }): ReactNode {
  const members = useMembers();
  if (value === null || value === undefined || value === '')
    return <span style={{ color: 'var(--ar-color-content-tertiary)' }}>Empty</span>;
  if (type.kind === 'record' && typeof value === 'object' && value && 'entityInstanceId' in value) {
    return <RecordOutput value={value as { entityDefinitionId: string; entityInstanceId: string }} />;
  }
  if (type.kind === 'actor' && typeof value === 'object' && value && 'actorId' in value) {
    const id = (value as { actorId: string }).actorId;
    return <>{memberName(members.find((m) => m.id === id)) || id}</>;
  }
  if (type.kind === 'timestamp' && typeof value === 'string') return <>{new Date(value).toLocaleString('en-US')}</>;
  if (type.kind === 'array' && Array.isArray(value))
    return <>{value.length === 0 ? 'No items' : `${value.length} items`}</>;
  if (typeof value === 'object') return <>{JSON.stringify(value)}</>;
  return <>{String(value)}</>;
}
