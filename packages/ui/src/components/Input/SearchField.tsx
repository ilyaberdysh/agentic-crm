import { type CSSProperties, forwardRef, type ReactNode } from 'react';
import {
  Button,
  Input,
  SearchField as RACSearchField,
  type SearchFieldProps as RACSearchFieldProps,
} from 'react-aria-components';
import { Icon } from '../../icons/Icon';
import { cx } from '../../utils/cx';
import { type FieldChromeProps, FieldDescription, FieldLabel } from '../Field/Field';
import * as s from '../Field/Field.css';
import type { InputSize } from './TextInput';

export interface SearchFieldProps
  extends Omit<RACSearchFieldProps, 'children' | 'className' | 'style'>,
    FieldChromeProps {
  /** Default 28 (sidebar "Search settings…" field). */
  size?: InputSize;
  placeholder?: string;
  /** Trailing element (e.g. a Kbd hint) shown while the field is empty. */
  trailing?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** Search input: leading Search icon, clear button once there is a value, Escape clears. */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { size = 28, label, necessity, description, placeholder = 'Search...', trailing, className, style, ...rest },
  ref,
) {
  return (
    <RACSearchField className={cx(s.field, className)} style={style} {...rest}>
      {({ isEmpty, isDisabled }) => (
        <>
          <FieldLabel necessity={necessity}>{label}</FieldLabel>
          <div
            className={cx(s.control, s.controlSize[size], s.controlLeading[size], s.controlTrailing[size])}
            data-disabled={isDisabled || undefined}
            data-empty={isEmpty || undefined}
          >
            <Icon icon="search" size={16} className={s.leadingIcon} />
            <Input ref={ref} placeholder={placeholder} className={s.input} />
            {isEmpty ? (
              trailing
            ) : (
              <Button className={s.clearButton} aria-label="Clear search">
                <Icon icon="close" size={16} />
              </Button>
            )}
          </div>
          <FieldDescription>{description}</FieldDescription>
        </>
      )}
    </RACSearchField>
  );
});
