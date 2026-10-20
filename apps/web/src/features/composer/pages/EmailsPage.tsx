// The Emails page (F composer §3, §5, §6): the header with the Drafts n · Outbox n · Templates n tabs, a toolbar per
// tab and the tab body. There is no inbox: synced mail only shows on record pages (F README §2.1).
import { Button, Icon } from '@agentic-crm/ui';
import { Link } from '@tanstack/react-router';
import { useDocumentTitle } from '../../../lib/useDocumentTitle';
import { AskButton } from '../../ask/AskButton';
import * as n from '../../notes/notesPage.css';
import { HelpButton, PageHeader } from '../../shell/PageHeader';
import { useWorkspace } from '../../shell/workspaceContext';
import { useDrafts, useOutbox, useTemplates } from '../data';
import { ComposeGlyph, TemplatesGlyph } from '../glyphs';
import { DraftsTab } from './DraftsTab';
import { OutboxTab } from './OutboxTab';
import { TemplatesTab } from './TemplatesTab';

export type EmailsTab = 'drafts' | 'outbox' | 'templates';

const LABEL: Record<EmailsTab, string> = { drafts: 'Drafts', outbox: 'Outbox', templates: 'Templates' };

function EmailsHeader({ active }: { active: EmailsTab }) {
  const { href } = useWorkspace();
  const drafts = useDrafts();
  const outbox = useOutbox();
  const templates = useTemplates();
  const counts: Record<EmailsTab, number | undefined> = {
    drafts: drafts.data?.length,
    outbox: outbox.data?.length,
    templates: templates.data?.length,
  };
  const icons = { drafts: ComposeGlyph, outbox: 'emails', templates: TemplatesGlyph } as const;
  return (
    <PageHeader
      start={
        <nav className={n.tabs} aria-label="Emails">
          {(['drafts', 'outbox', 'templates'] as const).map((tab) => (
            <Link
              key={tab}
              to={href(`emails/${tab}`)}
              className={n.tab}
              aria-current={active === tab ? 'page' : undefined}
              data-testid={`emails-tab-${tab}`}
            >
              <Icon icon={icons[tab]} size={16} className={n.tabIcon} />
              {LABEL[tab]}
              <span className={n.count} data-testid={`emails-count-${tab}`}>
                {counts[tab] ?? 0}
              </span>
            </Link>
          ))}
        </nav>
      }
      actions={
        <>
          <HelpButton />
          <AskButton />
        </>
      }
    />
  );
}

export function EmailsPage({ tab }: { tab: EmailsTab }) {
  useDocumentTitle(LABEL[tab]);
  return (
    <>
      <EmailsHeader active={tab} />
      <div className={n.page} data-testid={`emails-${tab}`}>
        {tab === 'drafts' && <DraftsTab />}
        {tab === 'outbox' && <OutboxTab />}
        {tab === 'templates' && <TemplatesTab />}
      </div>
    </>
  );
}
