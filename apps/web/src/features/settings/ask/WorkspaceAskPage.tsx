// Workspace → Ask AI (`/settings/workspace-ask-agentic/{usage|custom-context}`, admins; ask-agentic §11.3): Usage — credits
// per member, members using Ask AI, the workspace pool with its limit switch and a per-member table — and Custom
// context (workspace-wide guidance for every answer, up to 20,000 characters).
import { Avatar, Icon, Switch, toast } from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { errorEnvelopeOf } from '../../../data/trpc';
import { formatCredits, updateAiWorkspaceSettings, useAiWorkspaceSettings, useCreditsUsage } from '../../ask/data';
import { useMembers } from '../../attributes/data/queries';
import { memberName } from '../../attributes/format/formatValue';
import { useWorkspaceRef } from '../../notes/data';
import { useWorkspace } from '../../shell/workspaceContext';
import { TabsPage } from '../admin/parts';
import * as os from '../objects/objects.css';
import * as s from './ask.css';

export type WorkspaceAskTab = 'usage' | 'custom-context';

const CONTEXT_LIMIT = 20_000;

function Stat({
  label,
  value,
  secondary,
  total,
}: {
  label: string;
  value: string;
  secondary?: string;
  total?: string;
}) {
  return (
    <div className={s.stat}>
      <span className={s.statLabel}>{label}</span>
      <span className={s.statValueRow}>
        <span className={s.statValue}>{value}</span>
        {secondary && <span className={s.statSecondary}>{secondary}</span>}
        {total && <span className={s.statTotal}>{total}</span>}
      </span>
    </div>
  );
}

function UsageTab() {
  const ws = useWorkspaceRef();
  const client = useQueryClient();
  const { workspace } = useWorkspace();
  const usage = useCreditsUsage();
  const members = useMembers();
  const data = usage.data;
  const [limitDraft, setLimitDraft] = useState<string | null>(null);
  if (!data) return <div className={s.empty}>Loading usage...</div>;
  const perMember = new Map((data.members ?? []).map((m) => [m.memberId, m]));
  const active = (data.members ?? []).filter((m) => m.seatUsed + m.workspaceUsed > 0).length;
  const reached = (data.members ?? []).filter((m) => m.limitReached).length;
  const pool = data.workspace;
  const total = pool.askLimit ?? pool.limit;
  const fill = total && total > 0 ? Math.min(100, Math.round((pool.askUsed / total) * 100)) : 0;
  const hasLimit = pool.askLimit !== null;
  const save = (askWorkspaceCreditsLimit: number | null) =>
    void updateAiWorkspaceSettings(client, ws, { askWorkspaceCreditsLimit }).catch((e) =>
      toast.error({ title: 'Failed to save the limit', description: errorEnvelopeOf(e).message }),
    );
  const resets = new Date(data.period.end).toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return (
    <div className={os.sections} data-testid="ask-settings-usage">
      <div className={s.stats} data-testid="ask-usage-stats">
        <Stat
          label="Credits available per member"
          value={data.member.limit === null ? '∞' : formatCredits(data.member.limit)}
          secondary={`Resets on ${resets}`}
        />
        <Stat label="Members using Ask AI" value={String(active)} total={`/ ${members.length}`} />
        <Stat label="Members reached personal limit" value={String(reached)} total={`/ ${members.length}`} />
      </div>

      <div className={s.card} data-testid="ask-usage-pool">
        <div className={s.poolHead}>
          <span className={s.settingLabel}>Workspace credits used for Ask AI</span>
          <span className={s.settingHelp}>
            If a member runs out of seat credits, they'll continue on workspace credits. Up to a limit you set.
          </span>
        </div>
        <div
          className={s.poolBar}
          role="progressbar"
          aria-valuenow={fill}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Workspace credits used"
        >
          <div className={s.poolFill} style={{ width: `${fill}%` }} />
        </div>
        <div className={s.poolFoot}>
          <span>
            {formatCredits(pool.askUsed)} / {total === null ? '∞' : formatCredits(total)} workspace credits
          </span>
          <span>{formatCredits(pool.otherSourcesUsed)} used by other sources</span>
        </div>
        <div className={s.poolLimit}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            Set a limit
            <span title="Members who run out of seat credits can use up to this many workspace credits for Ask AI each month. Set it to 0 to disable workspace credit usage for Ask AI.">
              <Icon icon="info" size={14} color="tertiary" />
            </span>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
            {hasLimit && (
              <input
                className={s.limitInput}
                type="number"
                min={0}
                aria-label="Workspace credit limit"
                data-testid="ask-limit-input"
                value={limitDraft ?? String(pool.askLimit)}
                onChange={(e) => setLimitDraft(e.target.value)}
                onBlur={() => {
                  if (limitDraft === null) return;
                  const n = Math.max(0, Math.floor(Number(limitDraft)));
                  setLimitDraft(null);
                  if (Number.isFinite(n) && n !== pool.askLimit) save(n);
                }}
              />
            )}
            <Switch
              aria-label="Set a limit"
              isSelected={hasLimit}
              onChange={(on) => save(on ? (pool.limit ?? 1000) : null)}
              data-testid="ask-limit-switch"
            />
          </span>
        </div>
      </div>

      <div className={s.members} data-testid="ask-usage-members">
        <div className={s.membersHead}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon icon="person" size={12} /> Member
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon icon="attrCurrency" size={12} /> Usage
          </span>
        </div>
        {members.map((m) => {
          const row = perMember.get(m.id);
          const used = row ? row.seatUsed + row.workspaceUsed : 0;
          const name = memberName(m);
          return (
            <div key={m.id} className={s.memberRow} data-testid="ask-usage-member">
              <span className={s.memberName}>
                <Avatar name={name} seed={m.id} size={16} kind="member" />
                <span>
                  {name}
                  {m.id === workspace.membership.id ? ' (You)' : ''}
                </span>
                <span className={s.memberEmail}>{m.emailAddress}</span>
              </span>
              <span style={{ color: used > 0 ? undefined : 'var(--ar-color-content-tertiary)' }}>
                {formatCredits(used)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- custom context -----------------------------------------------------------------------------------------------------------

/** A ring that fills with the share of the limit used. */
function Ring({ fraction }: { fraction: number }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r={r} fill="none" stroke="var(--ar-color-stroke-secondary)" strokeWidth="2" />
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        stroke="var(--ar-color-interactive-primary)"
        strokeWidth="2"
        strokeDasharray={`${c * fraction} ${c}`}
        strokeLinecap="round"
        transform="rotate(-90 9 9)"
      />
    </svg>
  );
}

function ContextTab() {
  const ws = useWorkspaceRef();
  const client = useQueryClient();
  const settings = useAiWorkspaceSettings();
  const stored = settings.data?.customContext ?? '';
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const text = draft ?? stored;

  const save = (value: string) => {
    if (value === stored) return;
    void updateAiWorkspaceSettings(client, ws, { customContext: value.trim() === '' ? null : value })
      .then(() => {
        setDraft(null);
        setSaved(true);
      })
      .catch((e) => toast.error({ title: 'Failed to save context', description: errorEnvelopeOf(e).message }));
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return (
    <div className={os.sections} data-testid="ask-settings-context">
      <section className={os.section} aria-label="Workspace context">
        <div>
          <h2 className={os.sectionTitle}>Workspace context</h2>
          <p className={os.sectionDescription}>
            Help Ask AI generate more relevant responses for your entire workspace
          </p>
        </div>
        <textarea
          className={s.contextArea}
          placeholder="Provide context, guidance or other information"
          aria-label="Workspace context"
          maxLength={CONTEXT_LIMIT}
          value={text}
          data-testid="ask-context-input"
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
            if (timer.current) clearTimeout(timer.current);
            const value = e.target.value;
            timer.current = setTimeout(() => save(value), 800);
          }}
          onBlur={() => {
            if (timer.current) clearTimeout(timer.current);
            if (draft !== null) save(draft);
          }}
        />
        <div className={s.counter}>
          <Ring fraction={Math.min(1, text.length / CONTEXT_LIMIT)} />
          <span data-testid="ask-context-counter">
            {text.length.toLocaleString('en-US')} / {CONTEXT_LIMIT.toLocaleString('en-US')}
          </span>
          {saved && <span className={s.savedNote}>Saved</span>}
        </div>
      </section>
    </div>
  );
}

export function WorkspaceAskPage({ tab }: { tab: WorkspaceAskTab }) {
  const { href } = useWorkspace();
  const navigate = useNavigate();
  return (
    <TabsPage<WorkspaceAskTab>
      crumbs={[{ label: 'Ask AI', icon: 'chat' }]}
      title="Ask AI"
      description="Manage Ask AI settings for your workspace."
      tabs={[
        { id: 'usage', label: 'Usage', icon: 'calculation' },
        { id: 'custom-context', label: 'Custom context', icon: 'document' },
      ]}
      tab={tab}
      onTab={(next) => void navigate({ href: href(`settings/workspace-ask-agentic/${next}`) })}
    >
      {tab === 'usage' ? <UsageTab /> : <ContextTab />}
    </TabsPage>
  );
}
