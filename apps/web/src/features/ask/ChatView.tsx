// One chat: the transcript, then the composer — or, in its place, an approval card while a write waits, a credit-limit
// banner when the member is out of credits, a not-configured card when the server has no AI key. A new chat (no
// thread yet) shows "What can I help with?" with the composer in the middle of the page. The same component serves
// the full page and the side panel.
import { type AiContext, type AiTurn, parseAiTargetModelChoice } from '@agentic-crm/contracts';
import { Icon, Spinner } from '@agentic-crm/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { httpStatusOf } from '../../data/trpc';
import { brand } from '../../lib/brand';
import { newId } from '../../lib/ids';
import { useWorkspaceRef } from '../notes/data';
import { useWorkspace } from '../shell/workspaceContext';
import { cancelTurn, sendTurn } from './actions';
import { ApprovalTray, type PendingApproval } from './approval/ApprovalTray';
import * as s from './chat.css';
import { Composer, NEW_CHAT_PLACEHOLDERS } from './composer/Composer';
import { type ComposerText, EMPTY_COMPOSER, toSendable } from './composer/model';
import { defaultAskModel } from './composer/modelChoice';
import { useAiSettings, useCreditsUsage, useModels, useThread } from './data';
import { CreditLimitNotice, NotConfigured } from './notices';
import { askStore } from './store';
import { useThreadTurns } from './stream/useThreadLive';
import { displayTurn } from './thread/display';
import { ThreadView } from './thread/ThreadView';
import { linearize, replyTarget } from './thread/tree';

export type ChatVariant = 'page' | 'panel';

export interface ChatViewProps {
  variant: ChatVariant;
  /** The thread shown; null = a new chat that has no thread yet. */
  threadId: string | null;
  /** The id a new chat is created with (client-minted, idempotent). */
  newChatId: string;
  /** What the user is looking at (the composer's chip; sent with every message). */
  context: AiContext;
  /** The first message created the thread. */
  onStarted: (threadId: string) => void;
}

function pendingOf(path: readonly AiTurn[]): PendingApproval[] {
  const out: PendingApproval[] = [];
  for (const turn of path) {
    if (turn.role !== 'assistant' || turn.status !== 'executing') continue;
    for (const part of displayTurn(turn).pending) out.push({ turn, part });
  }
  return out;
}

export function ChatView({ variant, threadId, newChatId, context, onStarted }: ChatViewProps) {
  const ws = useWorkspaceRef();
  const { workspace } = useWorkspace();
  const tid = threadId ?? newChatId;
  const thread = useThread(threadId);
  const turns = useThreadTurns(ws, tid, threadId ? thread.data?.turns : undefined);
  const path = useMemo(() => linearize(turns), [turns]);
  const models = useModels();
  const usage = useCreditsUsage();
  const settings = useAiSettings();

  const [value, setValue] = useState<ComposerText>(() => ({ text: askStore.get().draft, tokens: [] }));
  const [modelChoice, setModelChoice] = useState<string | null>(null);
  const lastAssistant = [...path].reverse().find((t) => t.role === 'assistant');
  const model =
    modelChoice ??
    (lastAssistant?.modelMode === 'manual' && lastAssistant.model ? lastAssistant.model : null) ??
    defaultAskModel(models.data, settings.data?.defaultModel);

  const executing = path.some((t) => t.role === 'assistant' && t.status === 'executing');
  const pending = useMemo(() => pendingOf(path), [path]);
  const configured = models.data?.configured ?? true;
  const outOfCredits = usage.data?.outOfCredits === true && !parseAiTargetModelChoice(model);
  const hasSavedTarget = models.data?.models.some((m) => !m.isUnavailable && parseAiTargetModelChoice(m.id));
  const startedRef = useRef(false);

  const send = async (
    content: string,
    annotations: ReturnType<typeof toSendable>['annotations'],
    source?: 'composer' | 'suggestion' | 'reply-suggestion',
  ) => {
    const id = await sendTurn({
      ws,
      memberId: workspace.membership.id,
      threadId: tid,
      content,
      annotations,
      context,
      model,
      parentTurnId: replyTarget(path)?.id ?? null,
      ...(source ? { source } : {}),
    });
    if (id && !threadId) {
      onStarted(tid);
      // The next new chat gets a fresh id.
      askStore.set({ newChatId: newId(), draft: '' });
    }
  };

  const submit = () => {
    const { content, annotations } = toSendable(value);
    if (!content) return;
    setValue(EMPTY_COMPOSER);
    askStore.set({ draft: '' });
    void send(content, annotations);
  };

  // `openAsk({send})` / the Home composer hand over a first message.
  useEffect(() => {
    const pendingSend = askStore.get().pendingSend;
    if (!pendingSend || startedRef.current || threadId || !configured) return;
    startedRef.current = true;
    askStore.set({ pendingSend: null });
    void send(pendingSend, [], 'suggestion');
  });

  const keepDraft = (next: ComposerText) => {
    setValue(next);
    askStore.set({ draft: next.text });
  };

  const stop = () => {
    const turn = [...path].reverse().find((t) => t.role === 'assistant' && t.status === 'executing');
    if (turn) void cancelTurn(ws, turn);
  };

  const showingThread = path.length > 0;
  const notFound = Boolean(threadId) && thread.isError && httpStatusOf(thread.error) === 404 && !showingThread;
  const loadingThread = Boolean(threadId) && thread.isPending && !showingThread;

  const composer = !configured ? (
    <NotConfigured />
  ) : pending.length > 0 ? (
    <ApprovalTray items={pending} />
  ) : outOfCredits && !hasSavedTarget ? (
    <CreditLimitNotice />
  ) : (
    <>
      {outOfCredits && <CreditLimitNotice />}
      <Composer
        value={value}
        onChange={keepDraft}
        model={model}
        onModel={setModelChoice}
        context={context}
        placeholder={showingThread ? 'Reply...' : NEW_CHAT_PLACEHOLDERS}
        running={executing}
        onSend={submit}
        onStop={stop}
        large={!showingThread && variant === 'page'}
        autoFocus
        sendDisabled={outOfCredits}
      />
    </>
  );

  if (notFound) {
    return (
      <div className={s.notFound} data-testid="ask-not-found">
        <strong>Chat not found</strong>
        <span>This chat may have been deleted or expired.</span>
      </div>
    );
  }
  if (loadingThread) {
    return (
      <div className={s.loading}>
        <Spinner size={16} />
      </div>
    );
  }

  if (!showingThread && variant === 'page') {
    return (
      <div className={s.root}>
        <div className={s.empty} data-testid="ask-empty">
          <div className={s.emptyInner}>
            <h1 className={s.emptyTitle}>What can I help with?</h1>
            {composer}
            {configured && pending.length === 0 && (
              <div className={s.suggestionRow}>
                <button
                  type="button"
                  className={s.suggestionChip}
                  data-testid="ask-suggestion-chip"
                  onClick={() => void send('Help me prepare for my next meeting', [], 'suggestion')}
                >
                  <Icon icon="calendar" size={14} />
                  Prep for next meeting
                </button>
              </div>
            )}
          </div>
          <div className={s.learnMore}>
            <span className={s.learnMoreLabel}>Learn more</span>
            <a className={s.learnMoreCard} href={brand.supportUrl} target="_blank" rel="noreferrer">
              <span className={s.learnMoreTile}>
                <Icon icon="askAi" size={24} />
              </span>
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span className={s.learnMoreTitle}>Ask AI</span>
                <span className={s.learnMoreText}>See what Ask AI can do for you</span>
              </span>
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={s.root}>
      {showingThread ? (
        <ThreadView
          path={path}
          onReply={(text) => void send(text, [], 'reply-suggestion')}
          columnClass={variant === 'page' ? s.pageColumn : s.panelColumn}
          scrollClass={s.scrollArea}
        />
      ) : (
        <div className={s.scrollArea} />
      )}
      <div className={`${s.dock} ${variant === 'page' ? s.dockPage : ''}`}>{composer}</div>
    </div>
  );
}
