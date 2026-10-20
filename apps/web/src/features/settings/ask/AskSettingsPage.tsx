// Personal → Ask AI (`/settings/ask-agentic/{general|prompts}`; ask-agentic §11.1): General — Privacy (web search, share
// downvoted messages), Model (default model), Credits (this period's use) — and Prompts — My prompts and Saved prompts
// as cards with an Actions menu, Browse prompts and Create prompt.
import { type WebSearchPermission } from '@agentic-crm/contracts';
import {
  Button,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Select,
  SelectItem,
  toast,
} from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { errorEnvelopeOf } from '../../../data/trpc';
import {
  deletePrompt,
  formatCredits,
  type PromptItem,
  promptTitle,
  savePrompt,
  updateAiSettings,
  useAiSettings,
  useCreditsUsage,
  useModels,
  usePrompts,
} from '../../ask/data';
import { PromptCard } from '../../ask/prompts/PromptCard';
import { openCreatePrompt, openEditPrompt, openPromptsGallery } from '../../ask/prompts/store';
import { useWorkspaceRef } from '../../notes/data';
import { useWorkspace } from '../../shell/workspaceContext';
import { LearnMore, TabsPage } from '../admin/parts';
import * as os from '../objects/objects.css';
import * as s from './ask.css';

export type AskSettingsTab = 'general' | 'prompts';

const PERMISSION_OPTIONS = (allow: string, deny: string) => [
  { id: 'auto-approve' as const, label: allow },
  { id: 'disabled' as const, label: deny },
  { id: 'always-ask' as const, label: 'Always ask' },
];

function PermissionSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: WebSearchPermission;
  options: { id: WebSearchPermission; label: string }[];
  onChange: (value: WebSearchPermission) => void;
}) {
  return (
    <Select
      aria-label={label}
      size={28}
      selectedKey={value}
      onSelectionChange={(k) => onChange(String(k) as WebSearchPermission)}
      items={options}
      menuWidth={180}
    >
      {(item: { id: WebSearchPermission; label: string }) => <SelectItem id={item.id}>{item.label}</SelectItem>}
    </Select>
  );
}

function SettingRow({ label, help, children }: { label: string; help: string; children: React.ReactNode }) {
  return (
    <div className={s.settingRow} data-testid="ask-setting-row">
      <div className={s.settingText}>
        <span className={s.settingLabel}>{label}</span>
        <span className={s.settingHelp}>{help}</span>
      </div>
      {children}
    </div>
  );
}

const resetsOn = (iso: string | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : '';

function GeneralTab() {
  const ws = useWorkspaceRef();
  const client = useQueryClient();
  const settings = useAiSettings();
  const models = useModels();
  const usage = useCreditsUsage();
  const save = (patch: Parameters<typeof updateAiSettings>[2]) =>
    void updateAiSettings(client, ws, patch).catch((e) =>
      toast.error({ title: 'Failed to save settings', description: errorEnvelopeOf(e).message }),
    );
  const data = settings.data;
  const modelItems = [
    { id: 'auto', label: 'Auto' },
    ...(models.data?.models ?? [])
      .filter((m) => !m.id.startsWith('target:'))
      .map((m) => ({ id: m.id, label: m.label })),
  ];
  const member = usage.data?.member;
  return (
    <div className={os.sections} data-testid="ask-settings-general">
      <section className={os.section} aria-label="Privacy">
        <h2 className={os.sectionTitle}>Privacy</h2>
        <div className={s.group}>
          <SettingRow label="Web search" help="Search queries will be shared with external search providers.">
            <PermissionSelect
              label="Web search"
              value={data?.allowWebSearch ?? 'always-ask'}
              options={PERMISSION_OPTIONS('Allow', "Don't allow")}
              onChange={(allowWebSearch) => save({ allowWebSearch })}
            />
          </SettingRow>
          <SettingRow
            label="Share downvoted messages"
            help="Share conversations to help our team improve the assistant."
          >
            <PermissionSelect
              label="Share downvoted messages"
              value={data?.shareThreadFeedback ?? 'always-ask'}
              options={PERMISSION_OPTIONS('Always share', "Don't share")}
              onChange={(shareThreadFeedback) => save({ shareThreadFeedback })}
            />
          </SettingRow>
        </div>
      </section>

      <section className={os.section} aria-label="Model">
        <h2 className={os.sectionTitle}>Model</h2>
        <SettingRow
          label="Default model"
          help="This model will be used to generate all responses unless it's overridden."
        >
          <Select
            aria-label="Default model"
            size={28}
            selectedKey={data?.defaultModel ?? 'auto'}
            onSelectionChange={(k) => save({ defaultModel: String(k) === 'auto' ? null : String(k) })}
            items={modelItems}
            menuWidth={200}
          >
            {(item: { id: string; label: string }) => <SelectItem id={item.id}>{item.label}</SelectItem>}
          </Select>
        </SettingRow>
      </section>

      <section className={os.section} aria-label="Credits">
        <div>
          <h2 className={os.sectionTitle}>Credits</h2>
          <p className={os.sectionDescription}>View your usage for the current credit period</p>
        </div>
        <div className={s.kv} data-testid="ask-credits-table">
          <div className={s.kvRow}>
            <span className={s.kvLabel}>
              <span className={s.kvStrong}>Credits used</span>
              <span className={s.kvNote}>Resets on {resetsOn(usage.data?.period.end)}</span>
            </span>
            <span className={`${s.kvValue} ${s.kvStrong}`} data-testid="ask-credits-total">
              {member ? formatCredits(member.used + member.workspaceUsed) : '–'}
            </span>
          </div>
          <div className={s.kvRow}>
            <span>Personal credits used</span>
            <span className={s.kvValue} data-testid="ask-credits-personal">
              {member
                ? `${formatCredits(member.used)}/${member.limit === null ? '∞' : formatCredits(member.limit)}`
                : '–'}
            </span>
          </div>
          <div className={s.kvRow}>
            <span className={s.kvLabel}>
              Workspace credits used
              <span title="When you run out of personal credits, usage continues with workspace credits.">
                <Icon icon="info" size={14} color="tertiary" />
              </span>
            </span>
            <span className={s.kvValue}>{member ? formatCredits(member.workspaceUsed) : '–'}</span>
          </div>
        </div>
      </section>
    </div>
  );
}

// ---- prompts -----------------------------------------------------------------------------------------------------------------

function PromptActions({ prompt }: { prompt: PromptItem }) {
  const ws = useWorkspaceRef();
  const client = useQueryClient();
  const copy = () =>
    void navigator.clipboard
      .writeText(prompt.prompt)
      .then(() => toast({ title: 'Copied to clipboard!', icon: 'copy' }))
      .catch(() => toast.error({ title: 'Failed to copy' }));
  const remove = () => {
    const task =
      prompt.kind === 'curated' ? savePrompt(client, ws, prompt.id, false) : deletePrompt(client, ws, prompt.id);
    void task.catch((e) =>
      toast.error({ title: 'Failed to remove the prompt', description: errorEnvelopeOf(e).message }),
    );
  };
  return (
    <MenuTrigger>
      <IconButton icon="more" size={20} aria-label="Actions" data-testid="prompt-actions" />
      <Menu aria-label={`Actions of ${promptTitle(prompt)}`} width={180} placement="bottom end">
        <MenuItem id="copy" icon="copy" onAction={copy}>
          Copy prompt
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          id="remove"
          icon="delete"
          variant="danger"
          isDisabled={prompt.access === 'read-only' && prompt.kind === 'custom'}
          onAction={remove}
        >
          Remove
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}

function PromptsGrid({ prompts }: { prompts: PromptItem[] }) {
  return (
    <div className={s.promptsGrid}>
      {prompts.map((p) => (
        <PromptCard
          key={p.id}
          prompt={p}
          onOpen={() => (p.kind === 'curated' ? openPromptsGallery(p.id) : openEditPrompt(p.id))}
          menu={<PromptActions prompt={p} />}
        />
      ))}
    </div>
  );
}

function PromptsTab() {
  const mine = usePrompts({ scope: 'mine' });
  const shared = usePrompts({ scope: 'shared' });
  const list = mine.data?.prompts ?? [];
  const own = list.filter((p) => p.kind === 'custom');
  const saved = list.filter((p) => p.kind === 'curated');
  const sharedList = (shared.data?.prompts ?? []).filter((p) => !own.some((o) => o.id === p.id));
  return (
    <div data-testid="ask-settings-prompts">
      <div className={s.promptsHead}>
        <div>
          <h2 className={os.sectionTitle}>My prompts</h2>
          <p className={os.sectionDescription}>
            View and configure your prompts. <LearnMore />
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" size={28} onPress={() => openPromptsGallery()} data-testid="prompts-browse">
            Browse prompts
          </Button>
          <Button
            variant="primary"
            size={28}
            icon="add"
            onPress={() => openCreatePrompt()}
            data-testid="prompts-create"
          >
            Create prompt
          </Button>
        </div>
      </div>
      {own.length > 0 && (
        <div className={s.promptsSection} data-testid="prompts-own">
          <PromptsGrid prompts={own} />
        </div>
      )}
      <div className={s.promptsSection} data-testid="prompts-saved">
        <h3 className={s.sectionHeading}>Saved prompts</h3>
        {saved.length === 0 ? (
          <div className={s.empty}>No saved prompts yet. Browse prompts to add some.</div>
        ) : (
          <PromptsGrid prompts={saved} />
        )}
      </div>
      {sharedList.length > 0 && (
        <div className={s.promptsSection}>
          <h3 className={s.sectionHeading}>Shared with me</h3>
          <PromptsGrid prompts={sharedList} />
        </div>
      )}
    </div>
  );
}

export function AskSettingsPage({ tab }: { tab: AskSettingsTab }) {
  const { href } = useWorkspace();
  const navigate = useNavigate();
  return (
    <TabsPage<AskSettingsTab>
      crumbs={[{ label: 'Ask AI', icon: 'chat' }]}
      title="Ask AI"
      description="Manage your Ask AI settings and prompts."
      tabs={[
        { id: 'general', label: 'General', icon: 'settings' },
        { id: 'prompts', label: 'Prompts', icon: 'slashSquare' },
      ]}
      tab={tab}
      onTab={(next) => void navigate({ href: href(`settings/ask-agentic/${next}`) })}
    >
      {tab === 'general' ? <GeneralTab /> : <PromptsTab />}
    </TabsPage>
  );
}
