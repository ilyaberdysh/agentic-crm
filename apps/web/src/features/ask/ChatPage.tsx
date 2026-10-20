// Full-page chat (`/<ws>/chats/new`, `/<ws>/chats/<id>`; ask-agentic §1, §3): header with the (renamable) title and, on
// the right, New chat (once a thread exists) · View history · More actions · Minimize to side panel.
import { IconButton, Tooltip } from '@agentic-crm/ui';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { PageHeader } from '../shell/PageHeader';
import { useWorkspace } from '../shell/workspaceContext';
import { ChatMenu, ChatTitle, HistoryButton } from './ChatHeader';
import { ChatView } from './ChatView';
import { threadTitle, useThread } from './data';
import { decodeInterests } from './interests';
import { effectiveContext, openAsk, useAskContextVersion, useAskUi } from './store';

export function ChatPage({ threadId, interests }: { threadId: string | null; interests?: string | undefined }) {
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const router = useRouter();
  const ui = useAskUi();
  const thread = useThread(threadId);
  useDocumentTitle(threadId ? threadTitle(thread.data?.thread) : 'New chat');
  useAskContextVersion();
  const context = useMemo(() => decodeInterests(interests) ?? effectiveContext(ui), [interests, ui.contextOverride]);

  const goTo = (id: string) => void navigate({ href: href(`chats/${id}`) });
  const goNew = () => void navigate({ href: href('chats/new') });
  const minimize = () => {
    openAsk({
      threadId: threadId ?? undefined,
      mode: 'panel',
      ...(context && Object.keys(context).length ? { context } : {}),
    });
    // Back to the page the chat was opened from; without one, Home.
    if (router.history.canGoBack()) router.history.back();
    else void navigate({ href: href('home') });
  };

  return (
    <>
      <PageHeader
        start={<ChatTitle threadId={threadId} />}
        actions={
          <>
            {threadId && (
              <IconButton
                icon="add"
                size={28}
                aria-label="New chat"
                tooltip="New chat"
                onPress={goNew}
                data-testid="ask-new-chat"
              />
            )}
            <HistoryButton
              currentThreadId={threadId}
              onOpen={goTo}
              onDeleted={(id) => {
                if (id === threadId) goNew();
              }}
            />
            <ChatMenu
              threadId={threadId}
              onDeleted={(id) => {
                if (id === threadId) goNew();
              }}
            />
            <Tooltip content="Minimize to sidepanel" placement="bottom">
              <IconButton
                icon="sidebarRight"
                size={28}
                aria-label="Minimize to sidepanel"
                onPress={minimize}
                data-testid="ask-minimize"
              />
            </Tooltip>
          </>
        }
      />
      <ChatView
        key={threadId ?? 'new'}
        variant="page"
        threadId={threadId}
        newChatId={ui.newChatId}
        context={context}
        onStarted={(id) => void navigate({ href: href(`chats/${id}`), replace: true })}
      />
    </>
  );
}
