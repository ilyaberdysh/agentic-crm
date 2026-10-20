// Empty editor (README §2.2; evidence G/G-new-workflow-prompt.png, G-trigger-picker.png): the prompt box (the AI
// workflow builder arrives with slice 10), four suggestion chips that preview their prompt on hover, "or" and the dashed
// "+ Start from scratch" button whose trigger picker ("Search triggers", grouped) adds the first block.
import type { BlockDefinition } from '@agentic-crm/contracts';
import { Icon, IconButton, PopoverPanel, toast } from '@agentic-crm/ui';
import { useRef, useState } from 'react';
import { Dialog } from 'react-aria-components';
import { CATALOG } from '../data';
import { paletteGroups } from '../model/blocks';
import { HueTile } from '../ui/parts';
import * as s from './empty.css';
import { PaletteItem } from './panel/Palette';

const CHIPS = [
  {
    label: 'Book discovery',
    icon: 'calendar' as const,
    hue: '#266df0',
    prompt:
      'When a new lead fills in our form, create a person record and a task for the owner to book a discovery call.',
  },
  {
    label: 'Lead triage',
    icon: 'wfSwitch' as const,
    hue: '#c43ad6',
    prompt: 'When a company is created, route it to the right owner by region and add it to the inbound pipeline list.',
  },
  {
    label: 'Deal nudge',
    icon: 'notifications' as const,
    hue: '#c98a00',
    prompt: 'Every Monday, find open deals without activity for 14 days and create a follow-up task for each owner.',
  },
  {
    label: 'Health check',
    icon: 'wfFilter' as const,
    hue: '#02ad6e',
    prompt: 'Every month, review active customers and flag accounts whose usage dropped so the team can reach out.',
  },
];

export function EmptyEditor({ onTrigger, readOnly }: { onTrigger: (def: BlockDefinition) => void; readOnly: boolean }) {
  const [prompt, setPrompt] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const scratch = useRef<HTMLButtonElement>(null);
  const groups = paletteGroups(CATALOG, 'triggers', query);
  return (
    <div className={s.root} data-testid="empty-editor">
      <div className={s.column}>
        <div className={s.prompt}>
          <textarea
            className={s.promptInput}
            placeholder={preview ?? 'Describe your workflow...'}
            value={prompt}
            aria-label="Describe your workflow"
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className={s.promptControls}>
            <span className={s.model}>Auto</span>
            <IconButton icon="template" size={20} aria-label="Insert prompt" tooltip="Insert prompt" />
            <IconButton icon="wfMic" size={20} aria-label="Dictate message" tooltip="Dictate message" />
            <button
              type="button"
              className={s.submit}
              aria-label="Submit message"
              disabled={!prompt.trim()}
              onClick={() =>
                toast({
                  title: 'Workflow builder',
                  description: 'Building workflows from a prompt arrives with the AI slice.',
                })
              }
            >
              <Icon icon="arrowUp" size={14} />
            </button>
          </div>
        </div>
        <div className={s.chips}>
          {CHIPS.map((c) => (
            <button
              key={c.label}
              type="button"
              className={s.chip}
              onMouseEnter={() => setPreview(c.prompt)}
              onMouseLeave={() => setPreview(null)}
              onClick={() => setPrompt(c.prompt)}
            >
              <HueTile icon={c.icon} hue={c.hue} size={20} />
              {c.label}
            </button>
          ))}
        </div>
        <span className={s.or}>or</span>
        <button
          ref={scratch}
          type="button"
          className={s.scratch}
          disabled={readOnly}
          data-testid="start-from-scratch"
          onClick={() => setPicking(true)}
        >
          <Icon icon="add" size={14} />
          Start from scratch
        </button>
      </div>
      {picking && (
        <PopoverPanel
          triggerRef={scratch}
          isOpen
          onOpenChange={(o) => !o && setPicking(false)}
          placement="top"
          width={240}
          padding={0}
          maxHeight={440}
        >
          <Dialog aria-label="Trigger picker" className={s.picker} data-testid="trigger-picker">
            <input
              autoFocus
              className={s.pickerSearch}
              placeholder="Search triggers"
              aria-label="Search triggers"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className={s.pickerList}>
              {groups.map((g) => (
                <div key={g.category} className={s.pickerGroup}>
                  <div className={s.pickerLabel}>{g.label}</div>
                  {g.blocks.map((b) => (
                    <PaletteItem
                      key={b.slug}
                      block={b}
                      compact
                      onPick={(def) => {
                        setPicking(false);
                        onTrigger(def);
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </Dialog>
        </PopoverPanel>
      )}
    </div>
  );
}
