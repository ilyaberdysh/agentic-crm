// "Create prompt" (ask-agentic §11.2): the default path describes the prompt and lets the AI write it (Generate ⌘↵ →
// "Enhancing prompt..." → the editor with the draft); "Advanced" opens the manual editor (← Back, Cancel ESC, Create
// prompt ⌘↵).
import { Button, DialogFooter, DialogHeader, Icon, Modal, Spinner, toast } from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { errorEnvelopeOf } from '../../../data/trpc';
import { newId } from '../../../lib/ids';
import { useWorkspaceRef } from '../../notes/data';
import { useAction } from '../../shortcuts/catalog';
import { createPrompt, updatePrompt } from '../data';
import { type PromptDraft, PromptEditor } from './PromptEditor';
import * as s from './prompts.css';
import { closePromptsModal } from './store';

const EMPTY: PromptDraft = { title: '', prompt: '', iconId: null, iconColor: null };

export function CreatePromptModal() {
  const ws = useWorkspaceRef();
  const client = useQueryClient();
  const [step, setStep] = useState<'generate' | 'advanced'>('generate');
  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState<PromptDraft>(EMPTY);
  /** The transient prompt the AI wrote; saving it updates this row instead of creating another. */
  const [generatedId, setGeneratedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clientId = useRef(newId());

  const generate = async () => {
    if (busy || description.trim() === '') return;
    setBusy(true);
    try {
      const prompt = await createPrompt(client, ws, {
        mode: 'generate',
        id: clientId.current,
        description: description.trim(),
      });
      setGeneratedId(prompt.id);
      setDraft({
        title: prompt.title ?? prompt.aiTitle ?? '',
        prompt: prompt.prompt,
        iconId: prompt.iconId,
        iconColor: prompt.iconColor,
      });
      setStep('advanced');
    } catch (e) {
      toast.error({ title: 'Failed to generate prompt', description: errorEnvelopeOf(e).message });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (busy || draft.prompt.trim() === '') return;
    setBusy(true);
    try {
      const title = draft.title.trim() || null;
      if (generatedId) {
        await updatePrompt(client, ws, {
          promptId: generatedId,
          title,
          prompt: draft.prompt,
          iconId: draft.iconId,
          iconColor: draft.iconColor,
        });
      } else {
        await createPrompt(client, ws, {
          mode: 'manual',
          id: clientId.current,
          title,
          prompt: draft.prompt,
          iconId: draft.iconId,
          iconColor: draft.iconColor,
        });
      }
      toast({ title: 'Prompt created' });
      closePromptsModal();
    } catch (e) {
      toast.error({ title: 'Failed to create prompt', description: errorEnvelopeOf(e).message });
    } finally {
      setBusy(false);
    }
  };

  useAction('dialog-save', () => void (step === 'generate' ? generate() : save()));

  const advanced = step === 'advanced';
  return (
    <Modal
      isOpen
      onOpenChange={(open) => !open && closePromptsModal()}
      size={advanced ? 746 : 445}
      aria-label="Create prompt"
      alignment="top"
    >
      <div data-testid="create-prompt-modal">
        <DialogHeader title="Create prompt" icon={<Icon icon="slashSquare" size={16} />} onClose={closePromptsModal} />
        {advanced ? (
          <PromptEditor draft={draft} onChange={setDraft} disabled={busy} />
        ) : (
          <div className={s.editor}>
            {busy ? (
              <div className={s.enhancing} data-testid="prompt-enhancing">
                <Spinner size={16} /> Enhancing prompt...
              </div>
            ) : (
              <textarea
                className={s.generateInput}
                placeholder="Describe what you would like this prompt to do..."
                aria-label="Describe the prompt"
                value={description}
                data-testid="prompt-description"
                autoFocus
                onChange={(e) => setDescription(e.target.value)}
              />
            )}
          </div>
        )}
        {advanced ? (
          <DialogFooter
            start={
              generatedId ? undefined : (
                <Button variant="secondary" size={28} icon="arrowLeft" onPress={() => setStep('generate')}>
                  Back
                </Button>
              )
            }
          >
            <Button variant="secondary" size={28} onPress={closePromptsModal} data-testid="prompt-cancel">
              Cancel
            </Button>
            <Button
              variant="primary"
              size={28}
              shortcut={['mod', 'enter']}
              isDisabled={draft.prompt.trim() === ''}
              isPending={busy}
              onPress={() => void save()}
              data-testid="prompt-create"
            >
              Create prompt
            </Button>
          </DialogFooter>
        ) : (
          <DialogFooter
            start={
              <Button
                variant="secondary"
                size={28}
                isDisabled={busy}
                onPress={() => setStep('advanced')}
                data-testid="prompt-advanced"
              >
                Advanced
              </Button>
            }
          >
            <Button
              variant="primary"
              size={28}
              shortcut={['mod', 'enter']}
              isDisabled={description.trim() === '' || busy}
              onPress={() => void generate()}
              data-testid="prompt-generate"
            >
              Generate
            </Button>
          </DialogFooter>
        )}
      </div>
    </Modal>
  );
}
