// Add column (evidence C1/05, 06): 274 px picker "Search {object} attributes...", system attributes
// first, relationship drill-down ≤ 5 hops, location → City/State/Country, search across nested paths, query kept for
// the session, footer "+ Create new attribute ›". Picking adds the column at once (end, or next to a column).
import { Button, PopoverPanel } from '@agentic-crm/ui';
import { type ReactElement, type RefObject, useRef, useState } from 'react';
import { Dialog } from 'react-aria-components';
import { useDefinition } from '../data';
import type { PickerSelection } from '../pickerModel';
import type { ColumnPosition } from '../types';
import type { ViewDraft } from '../useViewDraft';
import * as s from '../views.css';
import { PathPicker, PICKER_MAX_HEIGHT, PickerFooterItem } from './PathPicker';

export interface AddColumnPopoverProps {
  draft: ViewDraft;
  triggerRef: RefObject<Element | null>;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  position?: ColumnPosition;
  /** "+ Create new attribute ›" (attribute admin's dialog); hidden when absent. */
  onCreateAttribute?: () => void;
  onAdded?: (selection: PickerSelection) => void;
  placement?: 'bottom start' | 'bottom end' | 'end top' | 'bottom';
}

/** The picker popover, anchored to any element (header "+ Add column", empty-state button, header menu inserts). */
export function AddColumnPopover({
  draft,
  triggerRef,
  isOpen,
  onOpenChange,
  position = 'end',
  onCreateAttribute,
  onAdded,
  placement = 'bottom start',
}: AddColumnPopoverProps) {
  const object = useDefinition(draft.view.entityDefinitionId);
  return (
    <PopoverPanel
      triggerRef={triggerRef}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      width={274}
      maxHeight={PICKER_MAX_HEIGHT}
      placement={placement}
    >
      <Dialog aria-label="Add column" className={s.panelColumn}>
        <PathPicker
          rootDefinitionId={draft.view.entityDefinitionId}
          purpose="column"
          queryMemoryKey={`add-column:${draft.view.entityDefinitionId}`}
          placeholder={object ? `Search ${object.singularNoun.toLowerCase()} attributes...` : undefined}
          onSelect={(selection) => {
            onOpenChange(false);
            void draft.addColumn({ path: selection.path, field: selection.field, position });
            onAdded?.(selection);
          }}
          footer={
            onCreateAttribute ? (
              <PickerFooterItem
                icon="add"
                chevron
                onPress={() => {
                  onOpenChange(false);
                  onCreateAttribute();
                }}
              >
                Create new attribute
              </PickerFooterItem>
            ) : undefined
          }
        />
      </Dialog>
    </PopoverPanel>
  );
}

export interface AddColumnPickerProps extends Omit<AddColumnPopoverProps, 'triggerRef' | 'isOpen' | 'onOpenChange'> {
  /** Custom trigger (a react-aria pressable, e.g. ui Button); default: the header "+ Add column" ghost button. */
  trigger?: ReactElement<{ onPress?: () => void; ref?: unknown }>;
}

/** "+ Add column" button with its picker. */
export function AddColumnPicker({ trigger, ...props }: AddColumnPickerProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      {trigger ? (
        <span ref={ref} style={{ display: 'inline-flex' }} onClickCapture={() => setOpen(true)}>
          {trigger}
        </span>
      ) : (
        <Button ref={ref} variant="ghost" size={28} icon="add" isActive={open} onPress={() => setOpen(true)}>
          Add column
        </Button>
      )}
      {/* The header "+ Add column" picker hangs right-aligned under the button (evidence C1/05). */}
      <AddColumnPopover placement="bottom end" {...props} triggerRef={ref} isOpen={open} onOpenChange={setOpen} />
    </>
  );
}
