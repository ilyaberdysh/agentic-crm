// Model picker (ask-agentic §2.1): a text button with the current choice ("Auto" by default) opening a radio menu, "Auto"
// first, a divider, then one item per model with its brand glyph. Unavailable models are listed disabled.
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from '@agentic-crm/ui';
import { Button } from 'react-aria-components';
import { useModels } from '../data';
import * as s from './composer.css';

/** Our own asterisk glyph standing in for the provider mark of Anthropic models. */
export function BrandGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" style={{ color: '#d9633a' }}>
      <path
        d="M8 1.5v13M2.4 4.75l11.2 6.5M2.4 11.25l11.2-6.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function ModelPicker({
  value,
  onChange,
  isDisabled,
}: {
  /** "auto" or a model id. */
  value: string;
  onChange: (value: string) => void;
  isDisabled?: boolean;
}) {
  const models = useModels();
  const list = models.data?.models ?? [];
  const current = value === 'auto' ? null : list.find((m) => m.id === value);
  const label = current?.label ?? 'Auto';
  return (
    <MenuTrigger>
      <Button
        className={s.modelButton}
        aria-label={`Chosen model: ${label}`}
        isDisabled={isDisabled}
        data-testid="ask-model-picker"
      >
        {label}
      </Button>
      <Menu
        width={210}
        placement="top end"
        aria-label="Model"
        selectionMode="single"
        selectedKeys={[value]}
        onSelectionChange={(keys) => {
          const next = [...(keys as Set<string>)][0];
          if (next) onChange(String(next));
        }}
      >
        <MenuItem id="auto">Auto</MenuItem>
        <MenuSeparator />
        {list.map((m) => (
          <MenuItem key={m.id} id={m.id} icon={<BrandGlyph />} isDisabled={m.isUnavailable}>
            {m.label}
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  );
}
