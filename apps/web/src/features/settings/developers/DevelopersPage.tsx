// Settings → Developers (J workspace-admin §6; admin only): "Learn more about the Attio API and Apps" with the
// Access tokens | Webhooks tabs (raw s73-tokens, s74-webhooks).
import { useNavigate } from '@tanstack/react-router';
import { useWorkspace } from '../../shell/workspaceContext';
import { LearnMore, TabsPage } from '../admin/parts';
import { TokensTab } from './TokensTab';
import { WebhooksTab } from './WebhooksTab';

export type DevelopersTabId = 'access-tokens' | 'webhooks';

export function DevelopersPage({ tab }: { tab: DevelopersTabId }) {
  const { href } = useWorkspace();
  const navigate = useNavigate();
  return (
    <TabsPage<DevelopersTabId>
      crumbs={[{ label: 'Developers', icon: 'developers' }]}
      title="Developers"
      description={
        <>
          Learn more about the <LearnMore label="API and webhooks" />
        </>
      }
      learnMoreHref={false}
      tabs={[
        { id: 'access-tokens', label: 'Access tokens', icon: 'key' },
        { id: 'webhooks', label: 'Webhooks', icon: 'workflows' },
      ]}
      tab={tab}
      onTab={(next) => void navigate({ href: href(`settings/developers/${next}`) })}
    >
      {tab === 'access-tokens' ? <TokensTab /> : <WebhooksTab />}
    </TabsPage>
  );
}
