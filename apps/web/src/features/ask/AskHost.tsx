// Mounted once in the workspace layout: binds ⌘J, turns `openAsk({mode:'page'})` into navigation, renders the side
// panel (a flex sibling of the page, so it docks next to it) and the prompts modals.
import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useWorkspace } from '../shell/workspaceContext';
import { useAction } from '../shortcuts/catalog';
import { AskPanel } from './AskPanel';
import { encodeInterests } from './interests';
import { PromptsHost } from './prompts/PromptsHost';
import { askStore, toggleAsk, useAskUi } from './store';

export function AskHost() {
  const ui = useAskUi();
  const navigate = useNavigate();
  const { href } = useWorkspace();
  useAction('ask-ai', () => toggleAsk());

  useEffect(() => {
    const request = ui.pageRequest;
    if (!request) return;
    askStore.set({ pageRequest: null });
    if (request.threadId) {
      void navigate({ href: href(`chats/${request.threadId}`) });
      return;
    }
    const i = encodeInterests(request.context);
    void navigate({ href: href(`chats/new${i ? `?i=${i}` : ''}`) });
  }, [ui.pageRequest, navigate, href]);

  return (
    <>
      <AskPanel />
      <PromptsHost />
    </>
  );
}
