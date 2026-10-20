// "Edit prompt" (ask-agentic §11.2): the advanced editor on an existing prompt; the header carries Share (full access
// only), the footer Cancel · Save changes ⌘↵. A prompt the member can only read opens read-only.
import { Button, DialogFooter, DialogHeader, Icon, Modal, Skeleton, toast } from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { errorEnvelopeOf } from '../../../data/trpc';
import { useWorkspaceRef } from '../../notes/data';
import { useAction } from '../../shortcuts/catalog';
import { updatePrompt, usePrompt } from '../data';
import { type PromptDraft, PromptEditor } from './PromptEditor';
import * as s from './prompts.css';
import { SharePopover } from './SharePopover';
import { closePromptsModal } from './store';

export function EditPromptModal({ promptId }: { promptId: string }) {
  const ws = useWorkspaceRef();
  const client = useQueryClient();
  const prompt = usePrompt(promptId);
  const [draft, setDraft] = useState<PromptDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const data = prompt.data;
  useEffect(() => {
    if (data && draft === null) {
      setDraft({
        title: data.title ?? data.aiTitle ?? '',
        prompt: data.prompt,
        iconId: data.iconId,
        iconColor: data.iconColor,
      });
    }
  }, [data, draft]);
  const canEdit = data?.access === 'full-access' || data?.access === 'read-write';

  const save = async () => {
    if (!draft || busy || !canEdit || draft.prompt.trim() === '') return;
    setBusy(true);
    try {
      await updatePrompt(client, ws, {
        promptId,
        title: draft.title.trim() || null,
        prompt: draft.prompt,
        iconId: draft.iconId,
        iconColor: draft.iconColor,
      });
      toast({ title: 'Prompt saved' });
      closePromptsModal();
    } catch (e) {
      toast.error({ title: 'Failed to save prompt', description: errorEnvelopeOf(e).message });
    } finally {
      setBusy(false);
    }
  };
  useAction('dialog-save', () => void save());

  return (
    <Modal isOpen onOpenChange={(open) => !open && closePromptsModal()} size={746} aria-label="Edit prompt">
      <div data-testid="edit-prompt-modal">
        <DialogHeader
          title="Edit prompt"
          icon={<Icon icon="slashSquare" size={16} />}
          actions={data?.access === 'full-access' ? <SharePopover promptId={promptId} /> : undefined}
          onClose={closePromptsModal}
        />
        {draft ? (
          <PromptEditor draft={draft} onChange={setDraft} disabled={!canEdit} />
        ) : (
          <div className={s.editor}>
            <Skeleton width={300} height={32} />
            <Skeleton width="100%" height={280} />
          </div>
        )}
        <DialogFooter>
          <Button variant="secondary" size={28} onPress={closePromptsModal} data-testid="prompt-cancel">
            Cancel
          </Button>
          <Button
            variant="primary"
            size={28}
            shortcut={['mod', 'enter']}
            isDisabled={!canEdit || !draft || draft.prompt.trim() === ''}
            isPending={busy}
            onPress={() => void save()}
            data-testid="prompt-save"
          >
            Save changes
          </Button>
        </DialogFooter>
      </div>
    </Modal>
  );
}
