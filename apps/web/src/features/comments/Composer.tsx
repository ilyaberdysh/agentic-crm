// Comment composer ("Composer", "Post"): avatar, "Add comment..." / "Reply...", emoji and "@"
// buttons, primary Comment / Reply disabled while empty; Enter posts, Shift+Enter breaks the line; the editor clears.
import { Avatar, Button, IconButton } from '@agentic-crm/ui';
import { useRef, useState } from 'react';
import { useWorkspace } from '../shell/workspaceContext';
import * as s from './comments.css';
import { EmojiPickerPopover } from './emoji/EmojiPicker';
import { MentionInput } from './mentions/MentionInput';
import { EMPTY_MENTION_TEXT, type MentionText } from './mentions/model';

export function Composer({
  placeholder,
  submitLabel,
  onSubmit,
  flat = false,
  autoFocus = false,
}: {
  placeholder: string;
  submitLabel: string;
  /** Resolves true when posted (the composer then clears). */
  onSubmit: (value: MentionText) => Promise<boolean>;
  flat?: boolean;
  autoFocus?: boolean;
}) {
  const { me } = useWorkspace();
  const [value, setValue] = useState<MentionText>(EMPTY_MENTION_TEXT);
  const [busy, setBusy] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const emojiRef = useRef<HTMLButtonElement>(null);
  const empty = value.text.trim() === '';

  const submit = async () => {
    if (empty || busy) return;
    setBusy(true);
    const ok = await onSubmit(value);
    setBusy(false);
    if (ok) {
      setValue(EMPTY_MENTION_TEXT);
      setResetKey((k) => k + 1);
      requestAnimationFrame(() => input.current?.focus());
    }
  };

  const insertAtCaret = (text: string) => {
    const el = input.current;
    const at = el?.selectionStart ?? value.text.length;
    const next = `${value.text.slice(0, at)}${text}${value.text.slice(at)}`;
    setValue({
      text: next,
      mentions: value.mentions.map((m) => (m.start >= at ? { ...m, start: m.start + text.length } : m)),
    });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + text.length, at + text.length);
    });
  };

  return (
    <div className={`${s.composer} ${flat ? s.composerFlat : ''}`} data-testid="comment-composer">
      <div className={s.composerRow}>
        <Avatar
          name={me.user.name || me.user.email}
          seed={me.user.id}
          size={16}
          kind="member"
          className={s.composerAvatar}
        />
        <MentionInput
          key={resetKey}
          inputRef={input}
          value={value}
          onChange={setValue}
          placeholder={placeholder}
          aria-label={placeholder.replace('...', '')}
          multiline
          autoFocus={autoFocus}
          onSubmit={() => void submit()}
          data-testid="comment-input"
        />
      </div>
      <div className={s.composerFooter}>
        <IconButton
          ref={emojiRef}
          icon="addReaction"
          aria-label="Pick emoji"
          size={20}
          onPress={() => setEmojiOpen(true)}
        />
        <IconButton icon="mention" aria-label="Mention" size={20} onPress={() => insertAtCaret('@')} />
        <span className={s.composerSpacer} />
        <Button variant="primary" size={32} isDisabled={empty} isPending={busy} onPress={() => void submit()}>
          {submitLabel}
        </Button>
      </div>
      {emojiOpen && (
        <EmojiPickerPopover
          triggerRef={emojiRef}
          onClose={() => setEmojiOpen(false)}
          onPick={(e) => insertAtCaret(e)}
        />
      )}
    </div>
  );
}
