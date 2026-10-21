// Block configuration panel:
// G-panel-create-record.png, G-update-record-config.png): header (tile, title, category, ⋮ Replace / Delete), the
// description, the block's own alert (red: "This trigger is not connected to any steps"; grey: "This block has nothing
// to configure"), Configuration fields, Cost (credit pill or "Dynamic"), and Next step with one row per outcome
// ("+ Select next block", or the connected block).
import { BLOCK_CATEGORY_LABELS, type BlockCategory, type BlockConfig, blockDefinition } from '@agentic-crm/contracts';
import { AlertDialog, Icon, IconButton, Menu, MenuItem, MenuTrigger, Tooltip } from '@agentic-crm/ui';
import { useEffect, useState } from 'react';
import { isVisible } from '../../model/config';
import type { WorkflowBlock } from '../../types';
import { BlockTile, CreditPill } from '../../ui/parts';
import { nextPosition } from '../canvas/geometry';
import { useEditorUi } from '../EditorContext';
import { Field } from './Field';
import * as s from './panel.css';

export function BlockPanel({ block }: { block: WorkflowBlock }) {
  const ui = useEditorUi();
  const def = blockDefinition(block.slug);
  const readOnly = ui.readOnly;
  const actions = ui.page.actions;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [description, setDescription] = useState(block.description ?? '');
  const [nextOpen, setNextOpen] = useState(true);
  useEffect(() => setDescription(block.description ?? ''), [block.id, block.description]);
  const kind = block.blockType === 'trigger' ? 'trigger' : 'step';
  const specs = (def?.inputs ?? []).filter(
    (spec) => spec.control !== 'custom-fields' && isVisible(spec, block.config, def?.inputs ?? []),
  );
  const blockIssue = block.issues.find((i) => i.path.length === 0);
  const onConfig = (config: BlockConfig) => void actions.setConfig(block, config);
  const cost = def?.cost;

  return (
    <div data-testid="block-panel" data-block-id={block.id} data-slug={block.slug}>
      <div className={s.head}>
        <BlockTile slug={block.slug} size={32} />
        <div className={s.headTexts}>
          <span className={s.headTitle}>{block.title}</span>
          <span className={s.headCategory}>{def ? categoryLabel(def.category) : ''}</span>
        </div>
        {!readOnly && (
          <MenuTrigger>
            <IconButton icon="moreVertical" size={20} aria-label="Block options" tooltip="Block options" />
            <Menu
              aria-label="Block options"
              placement="bottom end"
              width={200}
              onAction={(key) => {
                if (key === 'replace')
                  ui.setPanel({ kind: 'palette', purpose: 'replace', blockId: block.id, blockType: block.blockType });
                if (key === 'delete') setConfirmDelete(true);
              }}
            >
              <MenuItem id="replace" icon="wfRetry">
                {kind === 'trigger' ? 'Replace trigger' : 'Replace step'}
              </MenuItem>
              <MenuItem id="delete" icon="delete" variant="danger">
                {kind === 'trigger' ? 'Delete trigger' : 'Delete step'}
              </MenuItem>
            </Menu>
          </MenuTrigger>
        )}
      </div>
      <textarea
        className={s.description}
        rows={1}
        placeholder={readOnly ? 'No description' : 'Add a description...'}
        value={description}
        readOnly={readOnly}
        aria-label="Block description"
        data-testid="block-description"
        onChange={(e) => {
          setDescription(e.target.value);
          e.currentTarget.style.height = 'auto';
          e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
        }}
        onBlur={() => {
          const next = description.trim() || null;
          if (next !== (block.description ?? null)) void actions.setDescription(block, next);
        }}
      />
      <hr className={s.divider} />
      {blockIssue && !readOnly && (
        <div className={s.alertWrap}>
          <div className={`${s.alert} ${s.alertCritical}`} role="alert" data-testid="block-alert">
            <Icon icon="warning" size={16} />
            {blockIssue.message}
          </div>
        </div>
      )}
      {specs.length === 0 ? (
        <div className={s.section}>
          <div className={`${s.alert} ${s.alertInfo}`}>
            <Icon icon="info" size={16} />
            This block has nothing to configure
          </div>
        </div>
      ) : (
        <div className={s.section} data-testid="block-config">
          <h3 className={s.sectionTitle}>Configuration</h3>
          {specs.map((spec) => (
            <Field key={spec.key} block={block} spec={spec} readOnly={readOnly} onConfig={onConfig} />
          ))}
        </div>
      )}
      {block.slug === 'on-inbound-webhook' && (
        <WebhookUrl workspaceId={ui.page.detail.workflow.workspaceId} workflowId={ui.page.workflowId} />
      )}
      <hr className={s.divider} />
      {cost && cost.type !== 'free' && (
        <div className={s.costRow} data-testid="block-cost">
          Cost
          {cost.type === 'fixed' ? (
            <CreditPill amount={cost.amount} />
          ) : (
            <Tooltip content="The cost of this block varies based on usage.">
              <span>
                <CreditPill amount="Dynamic" label="Dynamic cost" />
              </span>
            </Tooltip>
          )}
        </div>
      )}
      <NextStep block={block} open={nextOpen} onToggle={() => setNextOpen((o) => !o)} />
      <AlertDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Are you sure you want to delete this ${kind}?`}
        description="This cannot be undone"
        confirmLabel="Delete"
        onConfirm={() => {
          setConfirmDelete(false);
          ui.selectBlock(null);
          void actions.deleteBlocks([block.id]);
        }}
      />
    </div>
  );
}

const categoryLabel = (c: BlockCategory) => BLOCK_CATEGORY_LABELS[c];

function NextStep({ block, open, onToggle }: { block: WorkflowBlock; open: boolean; onToggle: () => void }) {
  const ui = useEditorUi();
  const version = ui.version;
  const multi = block.outcomes.length > 1;
  return (
    <div data-testid="next-step">
      <button type="button" className={s.nextHead} onClick={onToggle} aria-expanded={open}>
        <span style={{ flex: 1 }}>
          <span className={s.nextTitle}>Next step</span>
          <span className={s.nextText}>Define what happens after this block</span>
        </span>
        <Icon icon={open ? 'chevronDown' : 'chevronRight'} size={16} />
      </button>
      {open && (
        <div className={s.nextRows}>
          {block.outcomes.map((o) => {
            const targets = version.paths
              .filter((p) => p.sourceBlockId === block.id && p.outcome === o.slug)
              .map((p) => ({ path: p, target: version.blocks.find((b) => b.id === p.targetBlockId) }))
              .filter((x) => x.target);
            return (
              <div key={o.slug} style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-outcome={o.slug}>
                {multi && <span className={s.outcomeLabel}>{o.label}</span>}
                {targets.map(({ path, target }) => (
                  <div key={path.id} className={s.nextRow} style={{ cursor: 'default' }}>
                    <BlockTile slug={(target as WorkflowBlock).slug} size={20} />
                    <button
                      type="button"
                      className={s.connectedTitle}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        textAlign: 'left',
                        cursor: 'pointer',
                        padding: 0,
                        font: 'inherit',
                      }}
                      onClick={() => ui.selectBlock((target as WorkflowBlock).id)}
                    >
                      {(target as WorkflowBlock).title}
                    </button>
                    {!ui.readOnly && (
                      <IconButton
                        icon="wfDisconnect"
                        size={20}
                        aria-label="Disconnect"
                        tooltip="Disconnect"
                        onPress={() => void ui.page.actions.disconnect(path.id)}
                      />
                    )}
                  </div>
                ))}
                {targets.length === 0 && !ui.readOnly && (
                  <button
                    type="button"
                    className={s.nextRow}
                    data-testid="select-next-block"
                    onClick={() =>
                      ui.setPanel({
                        kind: 'palette',
                        purpose: 'next',
                        from: { blockId: block.id, outcome: o.slug },
                        position: nextPosition(block, o.slug, version.blocks),
                      })
                    }
                  >
                    <span className={s.plusBox}>
                      <Icon icon="add" size={12} />
                    </span>
                    Select next block
                  </button>
                )}
                {targets.length === 0 && ui.readOnly && (
                  <span className={s.subtle} style={{ paddingLeft: 18 }}>
                    No next block
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WebhookUrl({ workspaceId, workflowId }: { workspaceId: string; workflowId: string }) {
  const url = `${window.location.origin}/hooks/w/${workspaceId}/${workflowId}`;
  return (
    <div className={s.section}>
      <h3 className={s.sectionTitle}>Webhook details</h3>
      <div className={s.field}>
        <div className={s.labelRow}>
          <span className={s.label}>Webhook URL</span>
        </div>
        <div className={s.row}>
          <input className={s.input} readOnly value={url} aria-label="Webhook URL" />
          <IconButton
            icon="copy"
            size={28}
            variant="secondary"
            aria-label="Copy"
            tooltip="Copy"
            onPress={() => void navigator.clipboard?.writeText(url)}
          />
        </div>
      </div>
    </div>
  );
}
