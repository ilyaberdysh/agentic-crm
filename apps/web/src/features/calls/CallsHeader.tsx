// The Calls pages' header (I calls §2.1): ghost tabs "Calls n" / "Insight Templates n" on the left, Help and Ask AI on
// the right. Shared by `/calls` and `/calls/templates`.
import { Button, Icon } from '@agentic-crm/ui';
import { Link } from '@tanstack/react-router';
import { AskButton } from '../ask';
import { HelpButton, PageHeader } from '../shell/PageHeader';
import { useWorkspace } from '../shell/workspaceContext';
import { useCallsTotal, useInsightTemplates } from './data';
import * as s from './list.css';

export function CallsHeader({ active }: { active: 'calls' | 'templates' }) {
  const { href } = useWorkspace();
  const total = useCallsTotal();
  const templates = useInsightTemplates();
  const tab = (
    key: 'calls' | 'templates',
    label: string,
    icon: 'meeting' | 'insightTemplate',
    count: number | undefined,
  ) => (
    <Link
      to={href(key === 'calls' ? 'calls' : 'calls/templates')}
      search={{}}
      className={s.tab}
      aria-current={active === key ? 'page' : undefined}
      data-testid={`calls-tab-${key}`}
    >
      <Icon icon={icon} size={16} className={s.tabIcon} />
      {label}
      <span className={s.count} data-testid={`calls-tab-count-${key}`}>
        {count ?? 0}
      </span>
    </Link>
  );
  return (
    <PageHeader
      start={
        <nav className={s.tabs} aria-label="Calls">
          {tab('calls', 'Calls', 'meeting', total.data)}
          {tab('templates', 'Insight Templates', 'insightTemplate', templates.data?.length)}
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
