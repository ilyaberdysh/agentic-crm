import { CreatePromptModal } from './CreatePromptModal';
import { EditPromptModal } from './EditPromptModal';
import { PromptsGallery } from './PromptsGallery';
import { usePromptsModal } from './store';

/** Mounts whichever prompts modal is open (opened from the composer, the gallery and Settings → Prompts). */
export function PromptsHost() {
  const modal = usePromptsModal();
  if (!modal) return null;
  switch (modal.kind) {
    case 'gallery':
      return <PromptsGallery promptId={modal.promptId} />;
    case 'create':
      return <CreatePromptModal key="create" />;
    case 'edit':
      return <EditPromptModal key={modal.promptId} promptId={modal.promptId} />;
  }
}
