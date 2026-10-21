// The Ask composer (ask-agentic §2): text box with @-mentions and /-prompts, the page-context chip bottom left, and
// bottom right the model picker, Insert prompt and the round submit button — which becomes Stop while an answer runs
// (and "Interrupt and send" when there is text to send).
import { type AiContext, parseAiTargetModelChoice } from '@agentic-crm/contracts';
import { Icon, Tooltip } from '@agentic-crm/ui';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { AskInput } from './AskInput';
import { ContextChip, hasContext } from './ContextChip';
import * as s from './composer.css';
import { InsertPromptMenu } from './InsertPromptMenu';
import { ModelPicker } from './ModelPicker';
import { type ComposerText, insertTokenAtCaret } from './model';

/** Examples that rotate in the empty new-chat composer (ask-agentic §2). */
export const NEW_CHAT_PLACEHOLDERS = [
  'Ask anything...',
  'Create a new workflow...',
  'Find all notes from this month that mention...',
  'Draft an email to @...',
  'Find publicly available information online about...',
];

function useRotating(items: readonly string[], enabled: boolean, everyMs = 4000): string {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!enabled || items.length < 2) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % items.length), everyMs);
    return () => clearInterval(t);
  }, [enabled, items.length, everyMs]);
  return items[index % Math.max(items.length, 1)] ?? '';
}

export interface ComposerProps {
  value: ComposerText;
  onChange: (value: ComposerText) => void;
  /** "auto" or a model id. */
  model: string;
  onModel: (model: string) => void;
  context: AiContext;
  /** Placeholder: one string ("Reply…") or a list that rotates while the box is empty. */
  placeholder: string | readonly string[];
  /** An answer is running (the submit button turns into Stop). */
  running: boolean;
  onSend: () => void;
  onStop: () => void;
  /** The taller variant of the new-chat page and the Home block. */
  large?: boolean;
  disabled?: boolean;
  /** Keep model selection available when CRM credits are exhausted. */
  sendDisabled?: boolean;
  autoFocus?: boolean;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}

export function Composer({
  value,
  onChange,
  model,
  onModel,
  context,
  placeholder,
  running,
  onSend,
  onStop,
  large,
  disabled,
  sendDisabled,
  autoFocus,
  inputRef,
}: ComposerProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const ownInput = useRef<HTMLTextAreaElement>(null);
  const input = inputRef ?? ownInput;
  const list = typeof placeholder === 'string' ? [placeholder] : placeholder;
  const rotating = useRotating(list, value.text === '' && list.length > 1 && !disabled);
  const empty = value.text.trim() === '';

  const insertPrompt = (prompt: { id: string; title: string }) => {
    const caret = input.current?.selectionStart ?? value.text.length;
    const out = insertTokenAtCaret(value, caret, { kind: 'prompt', promptId: prompt.id, label: prompt.title });
    onChange(out.value);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(out.caret, out.caret);
    });
  };

  const stopMode = running && empty;
  const label = stopMode ? 'Cancel message' : running ? 'Interrupt and send' : 'Send message';

  return (
    <div
      ref={cardRef}
      className={`${s.card} ${large ? s.cardLarge : ''}`}
      data-disabled={disabled || undefined}
      data-testid="ask-composer"
    >
      <AskInput
        value={value}
        onChange={onChange}
        onSubmit={() => {
          if (!empty && !disabled && !sendDisabled) onSend();
        }}
        placeholder={rotating}
        autoFocus={autoFocus}
        disabled={disabled}
        inputRef={input}
        anchorRef={cardRef}
      />
      <div className={s.footer}>
        {hasContext(context) && <ContextChip context={context} />}
        <span className={s.spacer} />
        <ModelPicker value={model} onChange={onModel} isDisabled={disabled} />
        <InsertPromptMenu onPick={insertPrompt} isDisabled={disabled} />
        <Tooltip content={label} placement="top">
          <AriaButton
            className={`${s.submit} ${stopMode ? s.stop : ''}`}
            aria-label={label}
            isDisabled={disabled || (!stopMode && (empty || sendDisabled))}
            data-testid={stopMode ? 'ask-stop' : 'ask-send'}
            onPress={() => (stopMode ? onStop() : onSend())}
          >
            <Icon icon={stopMode ? 'stopSquare' : 'arrowUp'} size={stopMode ? 12 : 16} />
          </AriaButton>
        </Tooltip>
      </div>
      {parseAiTargetModelChoice(model) && (
        <div className={s.targetNote} role="note" data-testid="ask-target-mode">
          Text answers from attached context · No tools · Provider or local usage, no CRM credits
        </div>
      )}
    </div>
  );
}
