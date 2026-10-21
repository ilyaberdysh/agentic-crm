// States that replace the composer: out of credits (ask-agentic-internals §7.6) and "Ask AI is not set up" (the server
// has no ANTHROPIC_API_KEY: `ai.models.list` reports `configured: false`).
import { Icon } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { brand } from '../../lib/brand';
import { useWorkspace } from '../shell/workspaceContext';
import * as s from './chat.css';

export function CreditLimitNotice() {
  const { isAdmin, href } = useWorkspace();
  const navigate = useNavigate();
  return (
    <div className={s.notice} role="status" data-testid="ask-credit-limit">
      <Icon icon="warning" size={16} />
      <span>
        You've reached your credit limit.{' '}
        {isAdmin ? (
          <button
            type="button"
            className={s.noticeLink}
            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit' }}
            onClick={() => void navigate({ href: href('settings/workspace-ask-agentic/usage') })}
          >
            Manage credits
          </button>
        ) : (
          'Request more credits from a workspace admin.'
        )}
      </span>
    </div>
  );
}

export function NotConfigured() {
  return (
    <div className={s.notConfigured} data-testid="ask-not-configured">
      <Icon icon="askAi" size={20} />
      <span className={s.notConfiguredTitle}>Ask AI isn't set up yet</span>
      <span>
        Add a saved API or local model target for {brand.name}, or ask a workspace admin to set{' '}
        <code>ANTHROPIC_API_KEY</code> on the server.
      </span>
    </div>
  );
}
