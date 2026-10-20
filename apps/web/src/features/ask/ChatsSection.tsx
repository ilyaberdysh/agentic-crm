// Sidebar "Chats" section (ask-agentic §1): the member's threads (speech bubble + title, the open one highlighted), a
// dashed "+ New chat" button while there are none, and hover buttons to start a new chat.
import { Icon, NavItem, Skeleton, Tooltip } from '@agentic-crm/ui';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Button } from 'react-aria-components';
import { SidebarSection } from '../shell/SidebarSection';
import * as shell from '../shell/shell.css';
import { useWorkspace } from '../shell/workspaceContext';
import * as s from './chat.css';
import { threadTitle, useThreads } from './data';

/** Threads listed before the rest are reachable through View history. */
const LIMIT = 8;

export function ChatsSection() {
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const threads = useThreads({ sort: 'updated' });
  const list = (threads.data?.threads ?? []).slice(0, LIMIT);
  const newChat = () => void navigate({ href: href('chats/new') });
  return (
    <SidebarSection
      id="chats"
      title="Chats"
      actions={
        <Tooltip content="New chat" placement="bottom">
          <Button
            className={shell.sectionAction}
            aria-label="New chat"
            onPress={newChat}
            data-testid="sidebar-new-chat"
          >
            <Icon icon="add" size={16} />
          </Button>
        </Tooltip>
      }
    >
      {threads.isPending && (
        <div className={shell.rowSkeleton}>
          <Skeleton shape="circle" width={16} />
          <Skeleton width={96} height={10} />
        </div>
      )}
      {threads.isSuccess && list.length === 0 && (
        <button type="button" className={s.newChatButton} onClick={newChat} data-testid="sidebar-empty-new-chat">
          <Icon icon="add" size={16} /> New chat
        </button>
      )}
      {list.map((t) => {
        const to = href(`chats/${t.id}`);
        return (
          <NavItem key={t.id} href={to} icon="chat" isCurrent={pathname === to} className={shell.navItemCompact}>
            {threadTitle(t)}
          </NavItem>
        );
      })}
    </SidebarSection>
  );
}
