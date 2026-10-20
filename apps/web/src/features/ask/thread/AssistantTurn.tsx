// An assistant turn (ask-agentic §4): while it runs a shimmering "Thinking" label with the text and tool rows of every
// step; when it ends one "N tools used ›" disclosure above the final answer, then the icon row (Copy · Helpful · Not
// helpful · Try again). Failed and interrupted turns say so.
import type { AiTurn } from '@agentic-crm/contracts';
import {
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Icon,
  Modal,
  Popover,
  Select,
  SelectItem,
  TextArea,
  toast,
} from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { api, inWorkspace } from '../../../data/trpc';
import { useWorkspaceRef } from '../../notes/data';
import { retryTurn, setFeedback } from '../actions';
import { BrandGlyph } from '../composer/ModelPicker';
import { askKeys, useModels } from '../data';
import { Markdown } from '../markdown/Markdown';
import { blocksToPlainText, parseBlocks } from '../markdown/parse';
import { answerText, displayTurn } from './display';
import { ToolRowView } from './ToolRowView';
import * as s from './thread.css';
import { toolsUsedLabel } from './toolRows';

function failureMessage(turn: AiTurn): string | null {
  if (turn.status !== 'failed') return null;
  switch (turn.failureReason) {
    case 'provider-refused-request':
      return 'Provider declined to continue with this request';
    case 'credits-exhausted':
      return "You've reached your credit limit.";
    case 'interrupted':
      return 'This answer was interrupted. Try again.';
    case 'runner-unavailable':
      return 'The local runner did not answer in time. Check that it is connected, then try again.';
    default:
      return 'Something went wrong while generating this response, try again later';
  }
}

// ---- feedback -----------------------------------------------------------------------------------------------------------------

const ISSUES = [
  ['didnt-follow-request', "Didn't follow my request"],
  ['incorrect', 'Incorrect'],
  ['incomplete', 'Incomplete'],
  ['didnt-use-context', "Didn't use the context"],
  ['missing-sources', 'Missing sources'],
  ['parsing-error', 'UI issue'],
  ['poorly-formatted', 'Poorly formatted'],
  ['other', 'Other'],
] as const;

function FeedbackDialog({ turn, onClose }: { turn: AiTurn; onClose: () => void }) {
  const ws = useWorkspaceRef();
  const [issue, setIssue] = useState<string>('other');
  const [details, setDetails] = useState('');
  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()} size="small" aria-label="Additional feedback">
      <DialogHeader title="Additional feedback" onClose={onClose} />
      <DialogBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Select
            aria-label="Issue"
            selectedKey={issue}
            onSelectionChange={(k) => setIssue(String(k))}
            items={ISSUES.map(([id, label]) => ({ id, label }))}
          >
            {(item: { id: string; label: string }) => <SelectItem id={item.id}>{item.label}</SelectItem>}
          </Select>
          <TextArea
            label="Details"
            placeholder="Please provide details"
            value={details}
            onChange={setDetails}
            rows={4}
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onPress={onClose}>
          Skip
        </Button>
        <Button
          variant="primary"
          isDisabled={details.trim() === ''}
          onPress={() => {
            void setFeedback(ws, turn, {
              type: 'negative',
              issueType: issue as (typeof ISSUES)[number][0],
              reason: details.trim(),
            });
            toast({ title: 'Thanks for your feedback' });
            onClose();
          }}
        >
          Share feedback
        </Button>
      </DialogFooter>
    </Modal>
  );
}

// ---- try again ------------------------------------------------------------------------------------------------------------------

function RetryMenu({ turn }: { turn: AiTurn }) {
  const ws = useWorkspaceRef();
  const models = useModels();
  const [instruction, setInstruction] = useState('');
  const [switching, setSwitching] = useState(false);
  return (
    <Popover
      placement="bottom start"
      padding={4}
      aria-label="Try again"
      onOpenChange={(open) => {
        if (!open) {
          setInstruction('');
          setSwitching(false);
        }
      }}
      trigger={
        <AriaButton className={s.actionButton} aria-label="Try again" data-testid="ask-retry">
          <Icon icon="refresh" size={16} />
        </AriaButton>
      }
    >
      {({ close }) => (
        <div className={s.retryMenu} data-testid="ask-retry-menu">
          {switching ? (
            <>
              <button type="button" className={s.menuItem} onClick={() => setSwitching(false)}>
                <Icon icon="chevronLeft" size={16} /> Switch model
              </button>
              {[
                {
                  id: 'auto',
                  label: 'Auto',
                  isUnavailable: !models.data?.models.some((model) => model.isAuto && !model.isUnavailable),
                },
                ...(models.data?.models ?? []),
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={s.menuItem}
                  disabled={m.isUnavailable}
                  title={m.isUnavailable ? 'This model is currently unavailable' : undefined}
                  onClick={() => {
                    close();
                    void retryTurn(ws, turn, { model: m.id });
                  }}
                >
                  {m.id !== 'auto' &&
                    ('brand' in m && m.brand === 'anthropic' ? (
                      <BrandGlyph />
                    ) : (
                      <Icon icon="askAi" size={14} />
                    ))}
                  {m.label}
                  {(turn.modelMode === 'auto' ? 'auto' : turn.model) === m.id && (
                    <span className={s.menuTrailing}>Last used</span>
                  )}
                </button>
              ))}
            </>
          ) : (
            <>
              <input
                className={s.retryInput}
                placeholder="Ask to change response"
                aria-label="Ask to change response"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && instruction.trim()) {
                    close();
                    void retryTurn(ws, turn, { refinement: { type: 'custom', instruction: instruction.trim() } });
                  }
                }}
              />
              <button
                type="button"
                className={s.menuItem}
                onClick={() => {
                  close();
                  void retryTurn(ws, turn);
                }}
              >
                <Icon icon="refresh" size={16} /> Try again
              </button>
              <button
                type="button"
                className={s.menuItem}
                onClick={() => {
                  close();
                  void retryTurn(ws, turn, { refinement: { type: 'add-detail' } });
                }}
              >
                <Icon icon="add" size={16} /> Add more detail
              </button>
              <button
                type="button"
                className={s.menuItem}
                onClick={() => {
                  close();
                  void retryTurn(ws, turn, { refinement: { type: 'make-concise' } });
                }}
              >
                <Icon icon="remove" size={16} /> Make more concise
              </button>
              <button type="button" className={s.menuItem} onClick={() => setSwitching(true)}>
                <Icon icon="chevronUpDown" size={16} /> Switch model
                <Icon icon="chevronRight" size={12} style={{ marginLeft: 'auto' }} />
              </button>
            </>
          )}
        </div>
      )}
    </Popover>
  );
}

// ---- icon row ---------------------------------------------------------------------------------------------------------------------

function TurnActions({ turn, text }: { turn: AiTurn; text: string }) {
  const ws = useWorkspaceRef();
  const [reporting, setReporting] = useState(false);
  const positive = turn.feedback?.type === 'positive';
  const negative = turn.feedback?.type === 'negative';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(blocksToPlainText(parseBlocks(text)));
      toast({ title: 'Copied to clipboard!', icon: 'copy' });
    } catch {
      toast.error({ title: 'Failed to copy' });
    }
  };
  return (
    <div className={s.actions} data-testid="ask-turn-actions">
      {text && (
        <AriaButton className={s.actionButton} aria-label="Copy" onPress={() => void copy()}>
          <Icon icon="copy" size={16} />
        </AriaButton>
      )}
      {!negative && (
        <AriaButton
          className={s.actionButton}
          aria-label={positive ? 'Remove helpful rating' : 'Helpful'}
          data-active={positive || undefined}
          data-testid="ask-feedback-up"
          onPress={() => void setFeedback(ws, turn, positive ? null : { type: 'positive' })}
        >
          <Icon icon="thumbsUp" size={16} />
        </AriaButton>
      )}
      {!positive && (
        <AriaButton
          className={s.actionButton}
          aria-label={negative ? 'Remove not helpful rating' : 'Not helpful'}
          data-active={negative || undefined}
          data-testid="ask-feedback-down"
          onPress={() => {
            if (negative) void setFeedback(ws, turn, null);
            else {
              void setFeedback(ws, turn, { type: 'negative' });
              setReporting(true);
            }
          }}
        >
          <Icon icon="thumbsDown" size={16} />
        </AriaButton>
      )}
      <RetryMenu turn={turn} />
      {reporting && <FeedbackDialog turn={turn} onClose={() => setReporting(false)} />}
    </div>
  );
}

// ---- reply suggestions ------------------------------------------------------------------------------------------------------------

export function ReplySuggestions({ turn, onPick }: { turn: AiTurn; onPick: (text: string) => void }) {
  const ws = useWorkspaceRef();
  const q = useQuery({
    queryKey: askKeys.suggestions(ws.id, turn.id),
    queryFn: () => api.ai.turns.suggestions.query({ turnId: turn.id }, inWorkspace(ws)),
    enabled: turn.status === 'completed',
    // Generated once per answer: never refetched by invalidations of the thread.
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const list = q.data?.suggestions ?? [];
  if (list.length === 0) return null;
  return (
    <div className={s.suggestions} data-testid="ask-reply-suggestions">
      {list.slice(0, 3).map((text) => (
        <button
          key={text}
          type="button"
          className={s.suggestion}
          data-testid="ask-reply-suggestion"
          onClick={() => onPick(text)}
        >
          <Icon icon="returnArrow" size={14} />
          <span>{text}</span>
        </button>
      ))}
    </div>
  );
}

// ---- the turn ---------------------------------------------------------------------------------------------------------------------

export function AssistantTurn({ turn, isLast }: { turn: AiTurn; isLast: boolean }) {
  const display = useMemo(() => displayTurn(turn), [turn]);
  const [expanded, setExpanded] = useState(false);
  const failure = failureMessage(turn);
  const text = answerText(display);
  const finished = !display.running;

  const activity = display.activity.map((item) =>
    item.kind === 'text' ? (
      <Markdown
        key={item.part.id}
        source={item.part.content}
        streaming={item.part.status === 'streaming'}
        muted={finished}
      />
    ) : (
      <ToolRowView key={item.part.id} part={item.part} />
    ),
  );

  return (
    <div className={s.assistant} data-testid="ask-assistant-turn" data-status={turn.status}>
      {display.thinking && (
        <span className={s.thinking} data-testid="ask-thinking">
          Thinking
        </span>
      )}
      {display.running ? (
        <div className={s.activity}>{activity}</div>
      ) : (
        <>
          {display.toolCount > 0 && (
            <>
              <button
                type="button"
                className={s.disclosure}
                aria-expanded={expanded}
                data-testid="ask-tools-disclosure"
                onClick={() => setExpanded((v) => !v)}
              >
                {toolsUsedLabel(display.toolCount)}
                <span className={s.disclosureChevron}>
                  <Icon icon="chevronRight" size={12} />
                </span>
              </button>
              {expanded && <div className={s.activity}>{activity}</div>}
            </>
          )}
          {display.toolCount === 0 && display.activity.length > 0 && <div className={s.activity}>{activity}</div>}
          {display.answer.map((p) => (
            <Markdown key={p.id} source={p.content} streaming={p.status === 'streaming'} />
          ))}
        </>
      )}
      {failure && (
        <div className={`${s.banner} ${s.bannerCritical}`} data-testid="ask-turn-failed">
          {failure}
        </div>
      )}
      {turn.status === 'canceled' && isLast && (
        <div className={s.banner} data-testid="ask-turn-interrupted">
          Interrupted - what should Ask AI do instead?
        </div>
      )}
      {finished && turn.status !== 'canceled' && <TurnActions turn={turn} text={text} />}
    </div>
  );
}
