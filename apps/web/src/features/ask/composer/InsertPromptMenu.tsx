// "Insert prompt" (ask-agentic §2.2): a popover with a search field, the member's saved prompts (own prompts and saved
// curated ones), then New prompt · Browse prompts · Manage prompts. Picking a prompt inserts it as a "/Title" token.
import { Icon, IconButton, Popover } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useWorkspace } from '../../shell/workspaceContext';
import { promptTitle, usePrompts } from '../data';
import { PromptTile } from '../prompts/PromptTile';
import { openCreatePrompt, openPromptsGallery } from '../prompts/store';
import * as s from './composer.css';
import { fuzzyMatch } from './model';

export function InsertPromptMenu({
  onPick,
  isDisabled,
}: {
  onPick: (prompt: { id: string; title: string }) => void;
  isDisabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const prompts = usePrompts({ scope: 'mine' });
  const navigate = useNavigate();
  const { href } = useWorkspace();
  const list = (prompts.data?.prompts ?? []).filter((p) => fuzzyMatch(query, promptTitle(p)));
  return (
    <Popover
      placement="top end"
      width={256}
      padding={4}
      aria-label="Prompts"
      onOpenChange={(open) => {
        if (!open) setQuery('');
      }}
      trigger={
        <IconButton
          icon="slashSquare"
          size={28}
          aria-label="Open prompts"
          tooltip="Insert prompt"
          isDisabled={isDisabled}
          data-testid="ask-insert-prompt"
        />
      }
    >
      {({ close }) => (
        <div data-testid="ask-prompt-menu">
          <input
            className={s.searchInput}
            placeholder="Search prompts..."
            aria-label="Search prompts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className={s.menu} style={{ marginTop: 4 }}>
            {list.length === 0 && <div className={s.empty}>No prompts found</div>}
            {list.map((p) => (
              <button
                key={p.id}
                type="button"
                className={s.option}
                style={{ border: 'none', background: 'transparent', textAlign: 'left', width: '100%' }}
                data-testid="ask-prompt-item"
                onClick={() => {
                  onPick({ id: p.id, title: promptTitle(p) });
                  close();
                }}
              >
                <PromptTile iconId={p.iconId} color={p.iconColor} size={20} />
                <span className={s.optionLabel}>{promptTitle(p)}</span>
              </button>
            ))}
            <div className={s.divider} />
            {[
              { id: 'new', label: 'New prompt', icon: 'add' as const, run: () => openCreatePrompt() },
              { id: 'browse', label: 'Browse prompts', icon: 'apps' as const, run: () => openPromptsGallery() },
              {
                id: 'manage',
                label: 'Manage prompts',
                icon: 'settings' as const,
                run: () => void navigate({ href: href('settings/ask-agentic/prompts') }),
              },
            ].map((a) => (
              <button
                key={a.id}
                type="button"
                className={s.option}
                style={{ border: 'none', background: 'transparent', textAlign: 'left', width: '100%' }}
                data-testid={`ask-prompt-${a.id}`}
                onClick={() => {
                  close();
                  a.run();
                }}
              >
                <Icon icon={a.icon} size={16} />
                <span className={s.optionLabel}>{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Popover>
  );
}
