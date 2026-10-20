import type { ReactNode } from 'react';
import { FieldError, Label, Text } from 'react-aria-components';
import { cx } from '../../utils/cx';
import * as s from './Field.css';

export type FieldNecessity = 'optional' | 'required';

export interface FieldChromeProps {
  /** Label above the control (text12 tertiary, indented 4 px). */
  label?: ReactNode;
  /** Renders "(optional)" / "(required)" after the label. */
  necessity?: FieldNecessity;
  /** Helper text under the control (11 px secondary). */
  description?: ReactNode;
  /** Error text under the control (11 px critical); shown when the field is invalid. */
  errorMessage?: ReactNode;
}

export function FieldLabel({ children, necessity }: { children?: ReactNode; necessity?: FieldNecessity }) {
  if (!children) return null;
  return (
    <Label className={s.label}>
      {children}
      {necessity && <span className={s.necessity}>({necessity})</span>}
    </Label>
  );
}

export function FieldDescription({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <Text slot="description" className={s.message}>
      {children}
    </Text>
  );
}

export function FieldErrorMessage({ children }: { children?: ReactNode }) {
  return <FieldError className={cx(s.message, s.messageTone.error)}>{children}</FieldError>;
}

export { field as fieldClassName } from './Field.css';
