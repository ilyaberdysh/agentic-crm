// "Recalculate values" (ai-attributes.md §5, `EI:ai-attribute-recalc-confirm.png`): every run path — one value, a
// cell selection, a whole column — asks first: "By confirming the recalculation, {n} record(s) will be updated." and a
// bordered row "{n} credit(s) will be used" (from `aiAttributes.estimate`); Cancel / Confirm. Confirm calls
// `aiAttributes.run`, writes the returned annotations into the cache ("AI is thinking...") and toasts the outcome.
import type {
  AiRunEstimate,
  AiRunResult,
  AiRunTarget,
  AttributeDefinition,
  EntityAnnotation,
} from '@agentic-crm/contracts';
import { Button, Icon, Modal, Skeleton, toast } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { api, errorEnvelopeOf, httpStatusOf, inWorkspace, noteAcceptAfter, type WorkspaceRef } from '../../data/trpc';
import { seedAnnotations, useAiConfigured } from '../formulas/data';
import * as s from './ai.css';
import { creditsText, exceedsBudget, recordsText } from './model';

export interface AiRunRequest {
  attribute: Pick<AttributeDefinition, 'id' | 'entityDefinitionId' | 'title'>;
  target: AiRunTarget;
}

export function RecalculateDialog({
  workspace,
  request,
  onClose,
}: {
  workspace: WorkspaceRef;
  request: AiRunRequest;
  onClose: () => void;
}) {
  const { attribute, target } = request;
  const configured = useAiConfigured(workspace);
  const [pending, setPending] = useState(false);
  const input = { entityDefinitionId: attribute.entityDefinitionId, attributeDefinitionId: attribute.id, target };
  const estimate = useQuery({
    queryKey: ['ws', workspace.id, 'ai-attribute-run', 'estimate', attribute.id, JSON.stringify(target)],
    queryFn: () => api.aiAttributes.estimate.query(input, inWorkspace(workspace)) as Promise<AiRunEstimate>,
    staleTime: 0,
    retry: false,
  });
  const data = estimate.data;
  const overBudget = data ? exceedsBudget(data.credits, data.creditsRemaining) : false;

  const confirm = async () => {
    setPending(true);
    try {
      const res = (await api.aiAttributes.run.mutate(input, inWorkspace(workspace))) as AiRunResult & { seq?: string };
      noteAcceptAfter(workspace.id, res.seq);
      seedAnnotations(workspace.id, attribute.id, res.annotations as Record<string, EntityAnnotation>);
      toast({ title: 'AI Recalculation has been requested', icon: 'aiRun' });
      onClose();
    } catch (error) {
      const env = errorEnvelopeOf(error);
      if (env.code === 'CREDITS_EXHAUSTED' || httpStatusOf(error) === 402) {
        toast.error('Not enough credits left', {
          description: 'Your workspace has used its AI credits for this period. Ask an admin to raise the budget.',
        });
      } else if (env.code === 'AI_NOT_CONFIGURED') {
        toast.error('AI is not configured for this workspace');
      } else {
        toast.error('There was a problem requesting AI Recalculation');
      }
      setPending(false);
      onClose();
    }
  };

  return (
    <Modal
      isOpen
      onOpenChange={(open) => !open && onClose()}
      size={340}
      alignment="center"
      overlay
      aria-label="Recalculate values"
    >
      <div data-testid="ai-recalculate-dialog">
        <div className={s.dialogBody}>
          <h2 className={s.dialogTitle}>Recalculate values</h2>
          {configured === false ? (
            <p className={s.dialogText}>AI is not configured for this workspace, so values can't be generated.</p>
          ) : estimate.isError ? (
            <p className={s.dialogText}>{errorEnvelopeOf(estimate.error).message ?? "Couldn't estimate the run."}</p>
          ) : data ? (
            <>
              <p className={s.dialogText}>{recordsText(data.recordCount)}</p>
              <div className={s.creditsRow} data-testid="ai-credits">
                <Icon icon="credits" size={16} />
                {creditsText(data.credits)}
              </div>
              {overBudget && <div className={s.creditsWarning}>Not enough credits left</div>}
            </>
          ) : (
            <>
              <Skeleton width={220} height={12} />
              <div className={s.creditsRow} style={{ marginTop: 12 }}>
                <Skeleton width={140} height={12} />
              </div>
            </>
          )}
        </div>
        <div className={s.dialogFooter}>
          <Button variant="secondary" size={28} onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size={28}
            autoFocus
            isPending={pending}
            isDisabled={!data || overBudget || configured === false || data.recordCount === 0}
            onPress={() => void confirm()}
          >
            Confirm
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** One "Recalculate values" dialog for a screen: `open(attribute, target)` and the element to render. */
export function useAiRunDialog(workspace: WorkspaceRef) {
  const [request, setRequest] = useState<AiRunRequest | null>(null);
  const open = useCallback(
    (attribute: AiRunRequest['attribute'], target: AiRunTarget) => setRequest({ attribute, target }),
    [],
  );
  const dialog = request ? (
    <RecalculateDialog workspace={workspace} request={request} onClose={() => setRequest(null)} />
  ) : null;
  return { open, dialog };
}
