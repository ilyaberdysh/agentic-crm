import type { CSSProperties, ReactNode } from 'react';
import {
  Checkbox as RACCheckbox,
  type CheckboxProps as RACCheckboxProps,
  Radio as RACRadio,
  RadioGroup as RACRadioGroup,
  type RadioGroupProps as RACRadioGroupProps,
  type RadioProps as RACRadioProps,
  Switch as RACSwitch,
  type SwitchProps as RACSwitchProps,
} from 'react-aria-components';
import { cx } from '../../utils/cx';
import { type FieldChromeProps, FieldDescription, FieldErrorMessage, FieldLabel } from '../Field/Field';
import * as fs from '../Field/Field.css';
import * as s from './Checkbox.css';

export interface CheckboxProps extends Omit<RACCheckboxProps, 'children' | 'className' | 'style'> {
  children?: ReactNode;
  /** 16 (default, table rows) or 20. */
  size?: 16 | 20;
  shape?: 'square' | 'round';
  className?: string;
  style?: CSSProperties;
}

/** Checkbox with accent fill, 1.5 px check and indeterminate dash. */
export function Checkbox({ children, size = 16, shape = 'square', className, style, ...rest }: CheckboxProps) {
  const markW = size === 16 ? 9 : 11;
  const markH = size === 16 ? 8 : 10;
  return (
    <RACCheckbox className={cx(s.root, className)} style={style} {...rest}>
      {({ isIndeterminate }) => (
        <>
          <span className={cx(s.box, s.boxSize[size], shape === 'round' && s.round)} aria-hidden="true">
            <svg className={s.mark} width={markW} height={markH} viewBox="0 0 9 8" fill="none">
              {isIndeterminate ? (
                <path d="M1.5 4h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              ) : (
                <path
                  d="M1.25 4.25 3.5 6.5 7.75 1.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>
          </span>
          {children}
        </>
      )}
    </RACCheckbox>
  );
}

export interface SwitchProps extends Omit<RACSwitchProps, 'children' | 'className' | 'style'> {
  children?: ReactNode;
  /** 16 (default, 24 × 16 track), 20 or 24. */
  size?: 16 | 20 | 24;
  className?: string;
  style?: CSSProperties;
}

export function Switch({ children, size = 16, className, style, ...rest }: SwitchProps) {
  return (
    <RACSwitch className={cx(s.root, className)} style={style} {...rest}>
      <span className={cx(s.track, s.trackSize[size])} aria-hidden="true">
        <span className={cx(s.thumb, s.thumbSize[size])} />
      </span>
      {children}
    </RACSwitch>
  );
}

export interface RadioGroupProps
  extends Omit<RACRadioGroupProps, 'children' | 'className' | 'style'>,
    FieldChromeProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function RadioGroup({
  children,
  label,
  necessity,
  description,
  errorMessage,
  orientation = 'vertical',
  className,
  style,
  ...rest
}: RadioGroupProps) {
  return (
    <RACRadioGroup orientation={orientation} className={cx(fs.field, className)} style={style} {...rest}>
      <FieldLabel necessity={necessity}>{label}</FieldLabel>
      <div className={cx(s.radioGroup, orientation === 'horizontal' && s.radioGroupHorizontal)}>{children}</div>
      <FieldDescription>{description}</FieldDescription>
      <FieldErrorMessage>{errorMessage}</FieldErrorMessage>
    </RACRadioGroup>
  );
}

export interface RadioProps extends Omit<RACRadioProps, 'children' | 'className' | 'style'> {
  children?: ReactNode;
  size?: 16 | 20;
  className?: string;
  style?: CSSProperties;
}

export function Radio({ children, size = 16, className, style, ...rest }: RadioProps) {
  return (
    <RACRadio className={cx(s.root, className)} style={style} {...rest}>
      <span className={cx(s.radio, s.radioSize[size])} aria-hidden="true" />
      {children}
    </RACRadio>
  );
}
