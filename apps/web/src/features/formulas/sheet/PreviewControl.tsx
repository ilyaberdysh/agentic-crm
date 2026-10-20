// Record preview of the helper header (formulas.md §4.6): `[record picker] = <result>`. The first record of the
// object is pre-selected; the picker ("Find record to preview") is a record search. Results: the value (text as is,
// otherwise JSON, truncated to 500 characters with a tooltip), "No value", "Can't preview: syntax error",
// "Can't preview: {code}", "Preview failed"; an 80 px skeleton while loading.
import type { EntityDefinition } from '@agentic-crm/contracts';
import type { FormulaSource, OutputOverride } from '@agentic-crm/formula';
import { Button, Icon, Popover, Skeleton, Tooltip } from '@agentic-crm/ui';
import { useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import type { WorkspaceRef } from '../../../data/trpc';
import { RecordAvatar, RecordPicker, useRecordTitle } from '../../attributes';
import { recordKind } from '../../attributes/ui/primitives';
import { useFirstRecord, usePreview } from '../data';
import { previewDisplay } from '../model/preview';
import * as s from './sheet.css';

export function PreviewControl({
  workspace,
  object,
  source,
  outputTypeOverride,
  enabled,
}: {
  workspace: WorkspaceRef;
  object: Pick<EntityDefinition, 'id' | 'entityType' | 'standardObjectType' | 'singularNoun'>;
  source: FormulaSource;
  outputTypeOverride: OutputOverride | null;
  enabled: boolean;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const first = useFirstRecord(workspace, object.id, picked === null);
  const recordId = picked ?? first.data?.entityInstanceId ?? null;
  const preview = usePreview(
    workspace,
    { entityDefinitionId: object.id, entityInstanceId: recordId, source, outputTypeOverride },
    enabled,
  );
  const { title } = useRecordTitle(object.id, recordId ?? '');
  const noRecords = first.isSuccess && first.data === null && picked === null;
  // Nothing is shown while the formula is empty, unchecked or invalid.
  const display = enabled ? previewDisplay(preview.data, preview.isError) : null;
  const label = title || (recordId ? 'Unnamed record' : 'Select a record');

  const trigger = (
    <AriaButton
      aria-label={noRecords ? 'No records to preview' : `${label} · Select record to preview`}
      isDisabled={noRecords}
      style={{
        border: 'none',
        background: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        height: 28,
        padding: '0 6px',
        borderRadius: 8,
        cursor: noRecords ? 'default' : 'pointer',
        color: 'var(--ar-color-content-secondary)',
      }}
      data-testid="formula-preview-record"
    >
      <RecordAvatar kind={recordKind(object)} size={16} />
      <Icon icon="chevronDown" size={14} />
    </AriaButton>
  );

  return (
    <div className={s.preview}>
      {noRecords ? (
        <Tooltip content="There are no records to preview against">{trigger}</Tooltip>
      ) : (
        <Popover
          trigger={trigger}
          isOpen={open}
          onOpenChange={setOpen}
          aria-label="Find record to preview"
          width={300}
          padding={0}
        >
          <RecordPicker
            entityDefinitionIds={[object.id]}
            selected={recordId ? [{ entityDefinitionId: object.id, entityInstanceId: recordId }] : []}
            placeholder="Find record to preview"
            label={object.singularNoun}
            onSelect={(record) => {
              setPicked(record.entityInstanceId);
              setOpen(false);
            }}
          />
        </Popover>
      )}
      <span className={s.previewEquals}>=</span>
      {enabled && preview.isFetching && !preview.data ? (
        <Skeleton width={80} height={12} />
      ) : display ? (
        display.text.length > 60 ? (
          <Tooltip content={<span style={{ maxWidth: 320, display: 'block' }}>{display.text}</span>}>
            <Button variant="ghost" size={28} aria-label="Preview value">
              <span className={display.muted ? s.previewMuted : s.previewValue} data-testid="formula-preview-value">
                {display.text}
              </span>
            </Button>
          </Tooltip>
        ) : (
          <span className={display.muted ? s.previewMuted : s.previewValue} data-testid="formula-preview-value">
            {display.text}
          </span>
        )
      ) : null}
    </div>
  );
}
