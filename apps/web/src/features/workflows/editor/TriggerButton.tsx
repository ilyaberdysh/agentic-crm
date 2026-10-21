// "▷ Trigger workflow": live workflows with a Manual run trigger start a run at once; a Record action
// trigger opens "Search records ({object plural})" and runs on the picked record. The UI then opens the new run.
import { Button, PopoverPanel, Tooltip } from '@agentic-crm/ui';
import { useRef, useState } from 'react';
import { Dialog, DialogTrigger } from 'react-aria-components';
import { useObjectDefinition } from '../../attributes/data/queries';
import { RecordPicker } from '../../attributes/editors/pickers';
import { triggerManual, useWs, type WorkflowDetail } from '../data';
import { definitionRef } from '../model/config';

export function TriggerButton({
  detail,
  onRun,
}: {
  detail: WorkflowDetail;
  onRun: (run: { runId: string; versionId: string }) => void;
}) {
  const ws = useWs();
  const w = detail.workflow;
  const [pending, setPending] = useState(false);
  const recordTrigger = detail.version.blocks.find((b) => b.slug === 'on-record-action');
  const manual = w.triggerSlugs.includes('on-manual-run');
  const objectId = recordTrigger ? definitionRef(recordTrigger.config.entries.object) : null;
  const object = useObjectDefinition(objectId);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  const start = async (refs: Parameters<typeof triggerManual>[2]) => {
    setPending(true);
    const runs = await triggerManual(ws, w.id, refs);
    setPending(false);
    const first = runs?.[0];
    if (first) onRun(first);
  };

  if (manual) {
    return (
      <Button
        variant="secondary"
        size={28}
        icon="wfPlay"
        isPending={pending}
        onPress={() => void start({})}
        data-testid="trigger-workflow"
      >
        Trigger workflow
      </Button>
    );
  }
  // Only manual-run and record-action triggers start from the header; list entry and note actions start
  // from their entry points.
  if (!recordTrigger || !objectId) {
    if (!w.triggerSlugs.some((slug) => slug === 'on-list-entry-action' || slug === 'on-note-action')) return null;
    return (
      <Tooltip content="Run this workflow from a list entry or a note">
        <Button variant="secondary" size={28} icon="wfPlay" isDisabled data-testid="trigger-workflow">
          Trigger workflow
        </Button>
      </Tooltip>
    );
  }
  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <Button
        ref={trigger}
        variant="secondary"
        size={28}
        icon="wfPlay"
        isPending={pending}
        data-testid="trigger-workflow"
      >
        Trigger workflow
      </Button>
      <PopoverPanel placement="bottom end" width={320} padding={0}>
        <Dialog aria-label="Trigger workflow" style={{ outline: 'none' }}>
          <RecordPicker
            entityDefinitionIds={[objectId]}
            selected={[]}
            placeholder={`Search records (${object?.pluralNoun ?? 'records'})`}
            label="Records"
            onSelect={(record) => {
              setOpen(false);
              void start({
                recordRefs: [
                  { entityDefinitionId: record.entityDefinitionId, entityInstanceId: record.entityInstanceId },
                ],
              });
            }}
          />
        </Dialog>
      </PopoverPanel>
    </DialogTrigger>
  );
}
