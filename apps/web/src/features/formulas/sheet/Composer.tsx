// AI composer under the editor: rounded input "Describe the formula you want … to create..."
// (empty editor) / "Refine your formula"; undo / redo once history exists; 28 px submit (ArrowUp); Enter submits,
// Shift+Enter is a newline. While a request is open: shimmering "Thinking" and a stop button ("Cancel generation"
// only forgets the request locally). Failures show a warning banner above the input. Without an LLM the composer
// says AI is not configured.
import { Icon, IconButton, Tooltip } from '@agentic-crm/ui';
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import * as s from './sheet.css';

export interface ComposerFailure {
  message: string;
  category: string | null;
}

export interface ComposerProps {
  editorEmpty: boolean;
  generating: boolean;
  failure: ComposerFailure | null;
  configured: boolean | undefined;
  canUndo: boolean;
  canRedo: boolean;
  onSubmit: (prompt: string) => void;
  onCancel: () => void;
  onDismissFailure: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function Composer(props: ComposerProps) {
  const [prompt, setPrompt] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const notConfigured = props.configured === false;

  // Auto-grow up to 80 px, then scroll.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(80, el.scrollHeight)}px`;
  }, [prompt]);

  const submit = () => {
    const text = prompt.trim();
    if (!text || props.generating || notConfigured) return;
    props.onSubmit(text);
    setPrompt('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      submit();
    }
  };

  const placeholder = notConfigured
    ? 'AI is not configured for this workspace'
    : props.editorEmpty
      ? 'Describe the formula you want to create...'
      : 'Refine your formula';

  return (
    <div className={s.composerWrap}>
      {props.failure && (
        <div className={s.banner} role="alert" data-testid="formula-ai-failure">
          <Icon icon="warning" size={14} />
          <span className={s.bannerText}>
            {props.failure.category === 'unsupported_function' ? (
              <>{props.failure.message.replace(/\.$/, '')}. Try a different function</>
            ) : (
              "Couldn't generate your formula"
            )}
          </span>
          {props.failure.category !== 'unsupported_function' && props.failure.message && (
            <Tooltip content={props.failure.message}>
              <AriaButton aria-label="View refusal reason" style={{ border: 'none', background: 'none', padding: 2 }}>
                <Icon icon="info" size={14} />
              </AriaButton>
            </Tooltip>
          )}
          <IconButton icon="close" size={20} aria-label="Dismiss" onPress={props.onDismissFailure} />
        </div>
      )}
      <div className={s.composer} data-testid="formula-ai-composer">
        {props.generating ? (
          <span className={s.thinking} data-testid="formula-ai-thinking">
            Thinking
          </span>
        ) : (
          <textarea
            ref={input}
            className={s.composerInput}
            rows={1}
            value={prompt}
            placeholder={placeholder}
            aria-label="Generate with AI"
            disabled={notConfigured}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
          />
        )}
        <span className={s.composerActions}>
          {!props.generating && (props.canUndo || props.canRedo) && (
            <>
              <IconButton
                icon="undo"
                size={28}
                aria-label="Undo"
                tooltip="Undo"
                tooltipShortcut={['mod', 'z']}
                isDisabled={!props.canUndo}
                onPress={props.onUndo}
              />
              <IconButton
                icon="redo"
                size={28}
                aria-label="Redo"
                tooltip="Redo"
                tooltipShortcut={['mod', 'shift', 'z']}
                isDisabled={!props.canRedo}
                onPress={props.onRedo}
              />
            </>
          )}
          {props.generating ? (
            <Tooltip content="Cancel generation">
              <AriaButton className={s.stop} aria-label="Cancel generation" onPress={props.onCancel}>
                <Icon icon="stop" size={12} fill="currentColor" />
              </AriaButton>
            </Tooltip>
          ) : (
            <AriaButton
              className={s.submit}
              aria-label="Submit prompt"
              isDisabled={!prompt.trim() || notConfigured}
              onPress={submit}
            >
              <Icon icon="arrowUp" size={16} />
            </AriaButton>
          )}
        </span>
      </div>
    </div>
  );
}
