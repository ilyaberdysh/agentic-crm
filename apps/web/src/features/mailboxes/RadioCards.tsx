// Large radio cards: icon tile, title (+ optional badge), description and a round indicator. One choice; arrow keys
// move and select like any radio group (react-aria).
import { Icon, type IconGlyph, type IconName, Tag } from '@agentic-crm/ui';
import { Radio, RadioGroup } from 'react-aria-components';
import * as s from './radioCards.css';

export interface RadioCardOption<T extends string> {
  id: T;
  title: string;
  description: string;
  icon: IconName | IconGlyph;
  /** Small blue tag after the title ("Recommended"). */
  badge?: string;
}

export function RadioCards<T extends string>({
  label,
  options,
  value,
  onChange,
  isDisabled,
  testId,
}: {
  label: string;
  options: readonly RadioCardOption<T>[];
  value: T;
  onChange: (value: T) => void;
  isDisabled?: boolean;
  testId?: string;
}) {
  return (
    <RadioGroup
      aria-label={label}
      value={value}
      onChange={(v) => onChange(v as T)}
      isDisabled={isDisabled}
      className={s.group}
      data-testid={testId}
    >
      {options.map((option) => (
        <Radio
          key={option.id}
          value={option.id}
          className={s.card}
          data-testid={`${testId ?? 'radio-card'}-${option.id}`}
        >
          <span className={s.iconTile}>
            <Icon icon={option.icon} size={18} />
          </span>
          <span className={s.text_}>
            <span className={option.badge ? `${s.titleRow} ${s.titleRowBadge}` : s.titleRow}>
              <span className={s.title}>{option.title}</span>
              {option.badge && <Tag color="blue">{option.badge}</Tag>}
            </span>
            <span className={s.description}>{option.description}</span>
          </span>
          <span className={s.indicator} aria-hidden="true" />
        </Radio>
      ))}
    </RadioGroup>
  );
}
