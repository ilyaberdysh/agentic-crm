// Emoji picker popover ("Reactions";  EmojiPicker: 290 wide, radius 8, e2, 8 per row,
// 32 px rows, sticky 12 px category headers, "Search Emojis").
import { PopoverPanel } from '@agentic-crm/ui';
import { type RefObject, useState } from 'react';
import { Dialog } from 'react-aria-components';
import * as s from '../comments.css';
import { EMOJI_CATEGORIES, type EmojiEntry, searchEmoji } from './data';

function Grid({ emojis, onPick }: { emojis: EmojiEntry[]; onPick: (emoji: string) => void }) {
  return (
    <div className={s.pickerGrid}>
      {emojis.map((e) => (
        <button
          key={e.emoji}
          type="button"
          className={s.pickerEmoji}
          title={e.name}
          aria-label={e.name}
          onClick={() => onPick(e.emoji)}
        >
          {e.emoji}
        </button>
      ))}
    </div>
  );
}

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [query, setQuery] = useState('');
  const results = query.trim() ? searchEmoji(query) : null;
  return (
    <div className={s.picker} data-testid="emoji-picker">
      <div className={s.pickerSearch}>
        <input
          className={s.pickerInput}
          placeholder="Search Emojis"
          aria-label="Search Emojis"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results?.[0]) onPick(results[0].emoji);
          }}
        />
      </div>
      <div className={s.pickerScroll}>
        {results ? (
          results.length ? (
            <Grid emojis={results} onPick={onPick} />
          ) : (
            <div className={s.emptyText} style={{ padding: 8 }}>
              No emojis found
            </div>
          )
        ) : (
          EMOJI_CATEGORIES.map((c) => (
            <section key={c.name} aria-label={c.name}>
              <div className={s.pickerCategory}>{c.name}</div>
              <Grid emojis={c.emojis} onPick={onPick} />
            </section>
          ))
        )}
      </div>
    </div>
  );
}

export function EmojiPickerPopover({
  triggerRef,
  onPick,
  onClose,
  placement = 'bottom end',
}: {
  triggerRef: RefObject<Element | null>;
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** List icons open below-left aligned. */
  placement?: 'bottom end' | 'bottom start';
}) {
  return (
    <PopoverPanel
      triggerRef={triggerRef}
      isOpen
      onOpenChange={(open) => !open && onClose()}
      placement={placement}
      padding={0}
      offset={6}
    >
      <Dialog aria-label="Pick emoji" style={{ outline: 'none' }}>
        <EmojiPicker
          onPick={(emoji) => {
            onPick(emoji);
            onClose();
          }}
        />
      </Dialog>
    </PopoverPanel>
  );
}
