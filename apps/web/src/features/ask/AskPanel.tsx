// The side panel (ask-agentic §1; toggled with ⌘J): 359 px wide, full height, left border, over any page. Header: title,
// View history, More actions, Close chat; the composer is pinned at the bottom with the page context as a chip.
import { IconButton } from '@agentic-crm/ui';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useWorkspace } from '../shell/workspaceContext';
import { ChatMenu, ChatTitle, HistoryButton } from './ChatHeader';
import { ChatView } from './ChatView';
import * as s from './chat.css';
import { encodeInterests } from './interests';
import { askStore, closeAsk, effectiveContext, newAskChat, openAsk, useAskContextVersion, useAskUi } from './store';

export function AskPanel() {
  const ui = useAskUi();
  useAskContextVersion();
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const onChatsRoute = useRouterState({ select: (st) => /\/chats(\/|$)/.test(st.location.pathname) });
  if (!ui.panelOpen || onChatsRoute) return null;
  const context = effectiveContext(ui);
  const fullPage = () => {
    closeAsk();
    if (ui.panelThreadId) void navigate({ href: href(`chats/${ui.panelThreadId}`) });
    else {
      const i = encodeInterests(context);
      void navigate({ href: href(`chats/new${i ? `?i=${i}` : ''}`) });
    }
  };
  return (
    <aside className={s.panel} aria-label="Ask AI" data-testid="ask-panel">
      <div className={s.panelHeader}>
        <ChatTitle threadId={ui.panelThreadId} />
        {ui.panelThreadId && (
          <IconButton
            icon="add"
            size={28}
            aria-label="New chat"
            tooltip="New chat"
            onPress={newAskChat}
            data-testid="ask-new-chat"
          />
        )}
        <HistoryButton
          currentThreadId={ui.panelThreadId}
          onOpen={(id) => openAsk({ threadId: id })}
          onDeleted={(id) => {
            if (id === ui.panelThreadId) newAskChat();
          }}
        />
        <ChatMenu
          threadId={ui.panelThreadId}
          onOpenFullPage={fullPage}
          onDeleted={(id) => {
            if (id === ui.panelThreadId) newAskChat();
          }}
        />
        <IconButton
          icon="close"
          size={28}
          aria-label="Close chat"
          tooltip="Close chat"
          onPress={closeAsk}
          data-testid="ask-close"
        />
      </div>
      <ChatView
        key={ui.panelThreadId ?? ui.newChatId}
        variant="panel"
        threadId={ui.panelThreadId}
        newChatId={ui.newChatId}
        context={context}
        onStarted={(id) => askStore.set({ panelThreadId: id })}
      />
    </aside>
  );
}
