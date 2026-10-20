// Home → Ask AI block: above the composer a credit-limit warning or a "Recent chat · <title>"
// row; the composer (rotating examples, model chip, Insert prompt, submit) — submitting starts a chat and opens it —
// and below it suggestion chips. Without an AI key it says so instead of failing.
import { parseAiTargetModelChoice } from '@agentic-crm/contracts';
import { Icon, Skeleton } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { newId } from '../../lib/ids';
import { useWorkspaceRef } from '../notes/data';
import { useWorkspace } from '../shell/workspaceContext';
import { sendTurn } from './actions';
import * as s from './chat.css';
import { Composer, NEW_CHAT_PLACEHOLDERS } from './composer/Composer';
import { type ComposerText, EMPTY_COMPOSER, toSendable } from './composer/model';
import { defaultAskModel } from './composer/modelChoice';
import { threadTitle, useAiSettings, useCreditsUsage, useModels, useThreads } from './data';
import { CreditLimitNotice, NotConfigured } from './notices';

const SUGGESTIONS = [
  { label: 'Prep for next meeting', text: 'Help me prepare for my next meeting' },
  { label: 'Recap last call', text: 'Recap my last call' },
];

export function HomeAsk() {
  const ws = useWorkspaceRef();
  const { workspace, href } = useWorkspace();
  const navigate = useNavigate();
  const models = useModels();
  const usage = useCreditsUsage();
  const settings = useAiSettings();
  const threads = useThreads({ sort: 'updated' });
  const [value, setValue] = useState<ComposerText>(EMPTY_COMPOSER);
  const [model, setModel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedModel = model ?? defaultAskModel(models.data, settings.data?.defaultModel);
  const recent = threads.data?.threads[0];

  const start = async (
    text: string,
    annotations: ReturnType<typeof toSendable>['annotations'],
    source: 'composer' | 'suggestion',
  ) => {
    if (busy) return;
    setBusy(true);
    const threadId = newId();
    const id = await sendTurn({
      ws,
      memberId: workspace.membership.id,
      threadId,
      content: text,
      annotations,
      model: selectedModel,
      source,
    });
    setBusy(false);
    if (id) {
      setValue(EMPTY_COMPOSER);
      void navigate({ href: href(`chats/${threadId}`) });
    }
  };

  if (models.isPending) {
    return (
      <div className={s.homeBlock} data-testid="home-ask">
        <Skeleton width="100%" height={116} />
      </div>
    );
  }
  if (models.isError) {
    return (
      <div className={s.homeBlock} data-testid="home-ask">
        <div className={s.notice}>We're having trouble loading Ask AI</div>
      </div>
    );
  }
  const configured = models.data.configured;
  const outOfCredits = usage.data?.outOfCredits === true && !parseAiTargetModelChoice(selectedModel);

  return (
    <div className={s.homeBlock} data-testid="home-ask">
      {outOfCredits ? (
        <CreditLimitNotice />
      ) : (
        recent && (
          <button
            type="button"
            className={s.recentChat}
            data-testid="home-recent-chat"
            onClick={() => void navigate({ href: href(`chats/${recent.id}`) })}
          >
            <Icon icon="history" size={12} />
            Recent chat · {threadTitle(recent)}
          </button>
        )
      )}
      {!configured ? (
        <NotConfigured />
      ) : (
        <>
          <Composer
            value={value}
            onChange={setValue}
            model={selectedModel}
            onModel={setModel}
            context={{}}
            placeholder={NEW_CHAT_PLACEHOLDERS}
            running={false}
            large
            disabled={busy}
            sendDisabled={outOfCredits}
            onSend={() => {
              const { content, annotations } = toSendable(value);
              if (content) void start(content, annotations, 'composer');
            }}
            onStop={() => undefined}
          />
          {!outOfCredits && (
            <div className={s.suggestionRow}>
              {SUGGESTIONS.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  className={s.suggestionChip}
                  data-testid="home-ask-suggestion"
                  onClick={() => void start(chip.text, [], 'suggestion')}
                >
                  <Icon icon="calendar" size={14} />
                  {chip.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
