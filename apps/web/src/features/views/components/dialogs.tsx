// View dialogs: "Create view" (type cards + title (+ kanban status attribute)), "Edit {title}"
// (rename), "Save as new view", "Column label". Standalone modals at 14vh (Dialog).
import type { AttributeDefinition, Path, View } from '@agentic-crm/contracts';
import { Button, DialogFooter, DialogHeader, Icon, Modal, PopoverPanel, TextInput } from '@agentic-crm/ui';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { Button as AriaButton, Dialog } from 'react-aria-components';
import { createView, useAttributes, useWorkspaceRef } from '../data';
import { attributeIcon } from '../operators';
import { isOfferable } from '../pickerModel';
import * as s from '../views.css';

export const TITLE_REQUIRED = 'Please provide a title for this view.';

interface FormDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  width?: number;
  children: ReactNode;
  submitLabel: ReactNode;
  submitShortcut: string[];
  onSubmit: () => void | Promise<void>;
  /** Extra footer content left of Cancel (e.g. "Clear label"). */
  footerStart?: ReactNode;
  isPending?: boolean;
}

/** Modal with a form: header + ×, body, footer Cancel Esc / primary action; Enter and ⌘↵ submit. */
export function FormDialog({
  isOpen,
  onOpenChange,
  title,
  width = 626,
  children,
  submitLabel,
  submitShortcut,
  onSubmit,
  footerStart,
  isPending,
}: FormDialogProps) {
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    void onSubmit();
  };
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size={width}
      aria-label={typeof title === 'string' ? title : undefined}
    >
      {({ close }) => (
        <form
          onSubmit={submit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
          }}
          style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}
        >
          <DialogHeader title={title} onClose={close} />
          <div className={s.dialogBody}>{children}</div>
          <DialogFooter>
            {footerStart}
            <Button variant="secondary" size={28} shortcut={['esc']} onPress={close}>
              Cancel
            </Button>
            <Button type="submit" size={28} shortcut={submitShortcut} isPending={isPending}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      )}
    </Modal>
  );
}

// ---- Create view ----------------------------------------------------------------------------------------------------

export interface CreateViewDialogProps {
  entityDefinitionId: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  initialType?: View['type'];
  onCreated?: (view: View) => void;
  /** "New Status Attribute" in the kanban column picker (attribute admin owns the dialog). */
  onCreateStatusAttribute?: () => void;
}

export function CreateViewDialog({
  entityDefinitionId,
  isOpen,
  onOpenChange,
  initialType = 'table',
  onCreated,
  onCreateStatusAttribute,
}: CreateViewDialogProps) {
  const ws = useWorkspaceRef();
  const [type, setType] = useState<View['type']>(initialType);
  const [title, setTitle] = useState('');
  const [pivot, setPivot] = useState<AttributeDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setType(initialType);
    setTitle('');
    setPivot(null);
    setError(null);
  }, [isOpen, initialType]);

  const submit = async () => {
    if (!title.trim()) {
      setError(TITLE_REQUIRED);
      return;
    }
    setPending(true);
    try {
      const kanbanPivotPath: Path | null =
        type === 'kanban' && pivot
          ? [{ entityDefinitionId: pivot.entityDefinitionId, attributeDefinitionId: pivot.id }]
          : null;
      const view = await createView(ws, { entityDefinitionId, type, title, kanbanPivotPath });
      onOpenChange(false);
      onCreated?.(view);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create view');
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Create view"
      width={608}
      submitLabel="Confirm"
      submitShortcut={['mod', 'enter']}
      onSubmit={submit}
      isPending={pending}
    >
      <div>
        <div className={s.fieldLabel}>View type</div>
        <div className={s.typeCards} role="radiogroup" aria-label="View type">
          <TypeCard
            selected={type === 'table'}
            onPress={() => setType('table')}
            icon="table"
            title="Table"
            text="Organize your records on a table"
          />
          <TypeCard
            selected={type === 'kanban'}
            onPress={() => setType('kanban')}
            icon="kanban"
            title="Kanban"
            text="Organize your records on a pipeline"
          />
        </div>
      </div>
      <TextInput
        size={32}
        label="Title"
        placeholder="Enter a title for this view"
        value={title}
        onChange={(v) => {
          setTitle(v);
          if (error) setError(null);
        }}
        isInvalid={Boolean(error)}
        errorMessage={error ?? undefined}
        autoFocus
        aria-label="Title"
      />
      {type === 'kanban' && (
        <KanbanColumnsField
          entityDefinitionId={entityDefinitionId}
          value={pivot}
          onChange={setPivot}
          onCreateStatusAttribute={onCreateStatusAttribute}
        />
      )}
    </FormDialog>
  );
}

function TypeCard(props: {
  selected: boolean;
  onPress: () => void;
  icon: 'table' | 'kanban';
  title: string;
  text: string;
}) {
  return (
    <AriaButton
      className={s.typeCard}
      data-selected={props.selected || undefined}
      onPress={props.onPress}
      aria-pressed={props.selected}
    >
      <span className={s.typeCardTile}>
        <Icon icon={props.icon} size={20} />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span className={s.typeCardTitle}>{props.title}</span>
        <span className={s.typeCardText}>{props.text}</span>
      </span>
    </AriaButton>
  );
}

function KanbanColumnsField({
  entityDefinitionId,
  value,
  onChange,
  onCreateStatusAttribute,
}: {
  entityDefinitionId: string;
  value: AttributeDefinition | null;
  onChange: (a: AttributeDefinition) => void;
  onCreateStatusAttribute?: () => void;
}) {
  const attrs = useAttributes(entityDefinitionId);
  const statuses = (attrs ?? []).filter((a) => a.type === 'pipeline' && isOfferable(a));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const visible = statuses.filter((a) => a.title.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div>
      <div className={s.fieldLabel}>Kanban Columns</div>
      <Button
        ref={triggerRef}
        variant="secondary"
        size={32}
        fullWidth
        onPress={() => setOpen(true)}
        icon={value ? attributeIcon(value) : undefined}
        iconRight="chevronDown"
        style={{ justifyContent: 'space-between' }}
      >
        <span style={{ flex: 1, textAlign: 'left', color: value ? undefined : 'var(--ar-color-content-tertiary)' }}>
          {value ? value.title : 'Select a status attribute'}
        </span>
      </Button>
      <PopoverPanel triggerRef={triggerRef} isOpen={open} onOpenChange={setOpen} width="trigger">
        <Dialog aria-label="Status attributes" className={s.panelColumn}>
          <div className={s.searchRow}>
            <Icon icon="search" size={16} className={s.searchIcon} />
            <input
              className={s.searchInput}
              placeholder="Search attributes"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>
          <div className={s.list} role="listbox" aria-label="Status attributes">
            {visible.map((a) => (
              <div
                key={a.id}
                role="option"
                aria-selected={value?.id === a.id}
                tabIndex={-1}
                className={s.row}
                onClick={() => {
                  onChange(a);
                  setOpen(false);
                }}
                onKeyDown={() => {}}
              >
                <Icon icon={attributeIcon(a)} size={16} className={s.rowIcon} />
                <span className={s.rowLabel}>{a.title}</span>
              </div>
            ))}
            {visible.length === 0 && <div className={s.empty}>No status attributes</div>}
          </div>
          {onCreateStatusAttribute && (
            <>
              <hr className={s.separator} />
              <div
                role="button"
                tabIndex={0}
                className={s.row}
                onClick={() => {
                  setOpen(false);
                  onCreateStatusAttribute();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onCreateStatusAttribute();
                }}
              >
                <Icon icon="add" size={16} className={s.rowIcon} />
                <span className={s.rowLabel}>New Status Attribute</span>
              </div>
            </>
          )}
        </Dialog>
      </PopoverPanel>
    </div>
  );
}

// ---- Rename / Save as new view -------------------------------------------------------------------------------

export interface TitleDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dialog heading, e.g. "Edit {title}" or "Save as new view". */
  heading: string;
  initialTitle: string;
  label: string;
  /** Shows "(required)" after the label (rename). */
  required?: boolean;
  submitLabel: string;
  onSubmit: (title: string) => Promise<void> | void;
}

/** One title field: rename ("Edit {title}", "Title (required)", Save ↵) and "Save as new view" (Create view ↵). */
export function TitleDialog({
  isOpen,
  onOpenChange,
  heading,
  initialTitle,
  label,
  required,
  submitLabel,
  onSubmit,
}: TitleDialogProps) {
  const [title, setTitle] = useState(initialTitle);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (isOpen) {
      setTitle(initialTitle);
      setError(null);
    }
  }, [isOpen, initialTitle]);
  const submit = async () => {
    if (!title.trim()) {
      setError(TITLE_REQUIRED);
      return;
    }
    setPending(true);
    try {
      await onSubmit(title.trim());
      onOpenChange(false);
    } catch {
      // the caller reported it (toast); keep the dialog open
    } finally {
      setPending(false);
    }
  };
  return (
    <FormDialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={heading}
      submitLabel={submitLabel}
      submitShortcut={['enter']}
      onSubmit={submit}
      isPending={pending}
    >
      <TextInput
        size={32}
        label={label}
        necessity={required ? 'required' : undefined}
        value={title}
        onChange={(v) => {
          setTitle(v);
          if (error) setError(null);
        }}
        isInvalid={Boolean(error)}
        errorMessage={error ?? undefined}
        autoFocus
        aria-label={label}
      />
    </FormDialog>
  );
}

// ---- Column label ---------------------------------------------------------------------------------------------

export interface ColumnLabelDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  viewTitle: string;
  attributeTitle: string;
  currentLabel: string | null;
  onSave: (label: string | null) => void;
}

/** "Edit column label" (C1): heading = view title, placeholder = attribute title, Clear label when set. */
export function ColumnLabelDialog({
  isOpen,
  onOpenChange,
  viewTitle,
  attributeTitle,
  currentLabel,
  onSave,
}: ColumnLabelDialogProps) {
  const [value, setValue] = useState(currentLabel ?? '');
  useEffect(() => {
    if (isOpen) setValue(currentLabel ?? '');
  }, [isOpen, currentLabel]);
  return (
    <FormDialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={viewTitle}
      submitLabel="Save label"
      submitShortcut={['enter']}
      onSubmit={() => {
        onSave(value.trim() ? value.trim() : null);
        onOpenChange(false);
      }}
      footerStart={
        currentLabel ? (
          <Button
            variant="ghost"
            size={28}
            onPress={() => {
              onSave(null);
              onOpenChange(false);
            }}
          >
            Clear label
          </Button>
        ) : undefined
      }
    >
      <TextInput
        size={32}
        label="Column label"
        placeholder={attributeTitle}
        value={value}
        onChange={setValue}
        description="The underlying attribute names will still be visible on hover."
        autoFocus
        aria-label="Column label"
      />
    </FormDialog>
  );
}
