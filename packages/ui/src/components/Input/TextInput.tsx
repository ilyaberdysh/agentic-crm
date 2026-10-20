import { type CSSProperties, forwardRef, type ReactNode } from 'react';
import { Input, TextField, type TextFieldProps } from 'react-aria-components';
import { Icon } from '../../icons/Icon';
import type { IconName } from '../../icons/iconMap';
import type { IconGlyph } from '../../icons/types';
import { cx } from '../../utils/cx';
import { type FieldChromeProps, FieldDescription, FieldErrorMessage, FieldLabel } from '../Field/Field';
import * as s from '../Field/Field.css';

export type InputSize = 28 | 32 | 34;

export interface TextInputProps extends Omit<TextFieldProps, 'children' | 'className' | 'style'>, FieldChromeProps {
  /** 28 | 32 | 34 (default, as in the kit; settings and dialogs use 32). */
  size?: InputSize;
  placeholder?: string;
  /** Leading 16 px icon in content.secondary. */
  icon?: IconName | IconGlyph;
  /** 11 px text before / after the value (e.g. "https://", "USD"). */
  prefix?: ReactNode;
  suffix?: ReactNode;
  /** Arbitrary trailing element inside the box (e.g. a Kbd hint). */
  trailing?: ReactNode;
  className?: string;
  style?: CSSProperties;
  inputClassName?: string;
}

/**
 * Text input on react-aria `TextField`: hairline ring (black 6 %), hover black 2 %, focus ring
 * accent, error ring critical, read-only black 2 %, disabled 40 %.
 */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  {
    size = 34,
    label,
    necessity,
    description,
    errorMessage,
    placeholder,
    icon,
    prefix,
    suffix,
    trailing,
    className,
    style,
    inputClassName,
    ...rest
  },
  ref,
) {
  const hasLeading = Boolean(icon || prefix);
  const hasTrailing = Boolean(suffix || trailing);
  return (
    <TextField className={cx(s.field, className)} style={style} {...rest}>
      {({ isDisabled, isInvalid, isReadOnly }) => (
        <>
          <FieldLabel necessity={necessity}>{label}</FieldLabel>
          <div
            className={cx(
              s.control,
              s.controlSize[size],
              hasLeading && s.controlLeading[size],
              hasTrailing && s.controlTrailing[size],
            )}
            data-invalid={isInvalid || undefined}
            data-disabled={isDisabled || undefined}
            data-readonly={isReadOnly || undefined}
          >
            {icon && <Icon icon={icon} size={16} className={s.leadingIcon} />}
            {prefix && <span className={s.affix}>{prefix}</span>}
            <Input ref={ref} placeholder={placeholder} className={cx(s.input, inputClassName)} />
            {suffix && <span className={s.affix}>{suffix}</span>}
            {trailing}
          </div>
          <FieldDescription>{description}</FieldDescription>
          <FieldErrorMessage>{errorMessage}</FieldErrorMessage>
        </>
      )}
    </TextField>
  );
});
