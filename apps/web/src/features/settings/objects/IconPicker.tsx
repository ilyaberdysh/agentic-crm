// Object icon picker (J objects-lists §2; raw J s03-icon-picker / s04-color-swatch): a popover with "Search..." and a
// colour swatch button (9 colours), above a 9-per-row grid of icon tiles in the chosen colour.
import { Icon, IconTile, Popover, SearchField } from '@agentic-crm/ui';
import { useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { OBJECT_COLORS, type ObjectIconValue, searchObjectIcons } from './objectIcon';
import * as s from './objects.css';

export function IconPicker({
  value,
  onChange,
  isDisabled,
  'aria-label': ariaLabel = 'Change icon',
}: {
  value: ObjectIconValue;
  onChange: (next: ObjectIconValue) => void;
  isDisabled?: boolean;
  'aria-label'?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const icons = searchObjectIcons(query);
  return (
    <Popover
      isOpen={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
      aria-label="Choose an icon"
      placement="bottom start"
      offset={6}
      padding={0}
      trigger={
        <AriaButton className={s.iconButton} aria-label={ariaLabel} isDisabled={isDisabled}>
          <IconTile icon={value.icon} color={value.color} size={20} />
        </AriaButton>
      }
    >
      <div className={s.iconPicker}>
        <div className={s.iconPickerTop}>
          <SearchField
            aria-label="Search icons"
            placeholder="Search..."
            size={32}
            value={query}
            onChange={setQuery}
            autoFocus
            className={s.toolbarSearch}
          />
          <ColorSwatchMenu value={value.color} onChange={(color) => onChange({ ...value, color })} />
        </div>
        <div className={s.iconGrid} role="listbox" aria-label="Icons">
          {icons.map((icon) => (
            <AriaButton
              key={icon}
              aria-label={icon}
              className={s.iconCell}
              data-selected={icon === value.icon || undefined}
              onPress={() => {
                onChange({ ...value, icon });
                setOpen(false);
              }}
            >
              <IconTile icon={icon} color={value.color} size={20} />
            </AriaButton>
          ))}
          {icons.length === 0 && <div className={s.tableEmpty}>No results found</div>}
        </div>
      </div>
    </Popover>
  );
}

function ColorSwatchMenu({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: (typeof OBJECT_COLORS)[number]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      isOpen={open}
      onOpenChange={setOpen}
      aria-label="Choose a colour"
      placement="bottom end"
      offset={6}
      padding={0}
      trigger={
        <AriaButton
          aria-label="Change colour"
          className={`${s.swatchButton} ${s.hueFill[value as keyof typeof s.hueFill] ?? ''}`}
        />
      }
    >
      <div className={s.swatchGrid}>
        {OBJECT_COLORS.map((color) => (
          <AriaButton
            key={color}
            aria-label={color}
            className={s.swatch}
            onPress={() => {
              onChange(color);
              setOpen(false);
            }}
          >
            <span className={`${s.swatchDot} ${s.hueFill[color]} ${color === value ? s.swatchSelected : ''}`}>
              {color === value && <Icon icon="check" size={12} style={{ color: 'white', margin: 3 }} />}
            </span>
          </AriaButton>
        ))}
      </div>
    </Popover>
  );
}
