import { Icon } from '@agentic-crm/ui';
import type { ReactNode } from 'react';
import { brand } from '../../../lib/brand';
import { type PromptItem, promptTitle } from '../data';
import { PromptTile } from './PromptTile';
import * as s from './prompts.css';

/** A prompt card: colour tile, title, two lines of summary; the gallery adds the author and the save count. */
export function PromptCard({
  prompt,
  gallery,
  onOpen,
  menu,
}: {
  prompt: PromptItem;
  gallery?: boolean;
  onOpen: () => void;
  /** Hover "Actions" menu (Settings → Prompts). */
  menu?: ReactNode;
}) {
  return (
    <div
      className={s.card}
      role="button"
      tabIndex={0}
      data-testid="prompt-card"
      data-prompt-id={prompt.id}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <PromptTile iconId={prompt.iconId} color={prompt.iconColor} size={20} />
      <h3 className={s.cardTitle}>{promptTitle(prompt)}</h3>
      <p className={s.cardSummary}>{prompt.summary ?? ''}</p>
      {gallery && (
        <div className={s.cardFooter}>
          <span className={s.cardMeta}>
            <Icon icon="askAi" size={12} /> {brand.name}
          </span>
          <span className={s.cardMeta} title="Saved by members of this workspace">
            <Icon icon="pin" size={12} /> {prompt.savedCount}
          </span>
        </div>
      )}
      {menu && (
        <div className={s.cardActions} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {menu}
        </div>
      )}
    </div>
  );
}
