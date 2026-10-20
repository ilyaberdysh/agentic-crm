import { type CSSProperties, forwardRef } from 'react';
import { TextArea as RACTextArea, TextField, type TextFieldProps } from 'react-aria-components';
import { cx } from '../../utils/cx';
import { type FieldChromeProps, FieldDescription, FieldErrorMessage, FieldLabel } from '../Field/Field';
import * as s from '../Field/Field.css';

export interface TextAreaProps extends Omit<TextFieldProps, 'children' | 'className' | 'style'>, FieldChromeProps {
  placeholder?: string;
  rows?: number;
  /** Show the vertical resize handle. Disabled by default. */
  resizable?: boolean;
  className?: string;
  style?: CSSProperties;
  textAreaClassName?: string;
}

/** Multi-line text field: TextInput tokens with padding 6 10. */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  {
    label,
    necessity,
    description,
    errorMessage,
    placeholder,
    rows = 3,
    resizable,
    className,
    style,
    textAreaClassName,
    ...rest
  },
  ref,
) {
  return (
    <TextField className={cx(s.field, className)} style={style} {...rest}>
      <FieldLabel necessity={necessity}>{label}</FieldLabel>
      <RACTextArea
        ref={ref}
        rows={rows}
        placeholder={placeholder}
        className={cx(s.textarea, resizable && s.resizable, textAreaClassName)}
      />
      <FieldDescription>{description}</FieldDescription>
      <FieldErrorMessage>{errorMessage}</FieldErrorMessage>
    </TextField>
  );
});
