// The prompt editor body (ask-agentic §11.2): an icon button opening the icon grid with its colour swatches, the title
// input ("Untitled prompt") and the large body field. Shared by "Create prompt › Advanced" and "Edit prompt".
import { Icon, Popover } from '@agentic-crm/ui';
import { vars } from '@agentic-crm/ui/styles';
import { Button as AriaButton } from 'react-aria-components';
import { DEFAULT_PROMPT_ICON, PROMPT_COLORS, PROMPT_ICONS, promptColor } from './icons';
import { PromptTile } from './PromptTile';
import * as s from './prompts.css';

export interface PromptDraft {
  title: string;
  prompt: string;
  iconId: string | null;
  iconColor: string | null;
}

const swatchColor = (hue: string): string => (vars.color.utilities.surface as Record<string, string>)[hue] ?? 'gray';

export function PromptEditor({
  draft,
  onChange,
  disabled,
}: {
  draft: PromptDraft;
  onChange: (draft: PromptDraft) => void;
  disabled?: boolean;
}) {
  const color = promptColor(draft.iconColor);
  return (
    <div className={s.editor} data-testid="prompt-editor">
      <div className={s.editorTitleRow}>
        <Popover
          placement="bottom start"
          aria-label="Choose an icon"
          trigger={
            <AriaButton
              className={s.iconButton}
              aria-label="Choose an icon"
              isDisabled={disabled}
              data-testid="prompt-icon-button"
            >
              <PromptTile iconId={draft.iconId ?? DEFAULT_PROMPT_ICON} color={draft.iconColor ?? 'grey'} size={20} />
            </AriaButton>
          }
        >
          {({ close }) => (
            <div className={s.picker}>
              <div className={s.swatches}>
                {PROMPT_COLORS.map((hue) => (
                  <button
                    key={hue}
                    type="button"
                    className={s.swatch}
                    style={{ backgroundColor: swatchColor(hue) }}
                    aria-label={hue}
                    data-selected={color === hue || undefined}
                    onClick={() => onChange({ ...draft, iconColor: hue })}
                  />
                ))}
              </div>
              <div className={s.pickerGrid}>
                {Object.entries(PROMPT_ICONS).map(([id, icon]) => (
                  <button
                    key={id}
                    type="button"
                    className={s.pickerCell}
                    aria-label={id}
                    data-selected={(draft.iconId ?? DEFAULT_PROMPT_ICON) === id || undefined}
                    onClick={() => {
                      onChange({ ...draft, iconId: id, iconColor: draft.iconColor ?? 'blue' });
                      close();
                    }}
                  >
                    <Icon icon={icon} size={16} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </Popover>
        <input
          className={s.titleInput}
          placeholder="Untitled prompt"
          aria-label="Prompt title"
          value={draft.title}
          disabled={disabled}
          data-testid="prompt-title"
          autoFocus
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
        />
      </div>
      <textarea
        className={s.bodyInput}
        placeholder="Describe what you would like this prompt to do..."
        aria-label="Prompt"
        value={draft.prompt}
        disabled={disabled}
        data-testid="prompt-body"
        onChange={(e) => onChange({ ...draft, prompt: e.target.value })}
      />
    </div>
  );
}
