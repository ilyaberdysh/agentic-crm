// "Start from scratch" (C2 README §2.1.2; J objects-lists §4.1; evidence/C2/create-list-from-scratch.png): 728 px
// dialog, breadcrumb "Templates / Start from scratch" + ×; **Object** select (searchable; every active object,
// alphabetical; default Companies), the list icon button (📋 → emoji picker) and **List name** ("New list"); footer
// Cancel ESC · "Create list ⌘↵". Validation "Please provide a name for this list."; failure toast "Failed to create
// list". The templates gallery is deferred (BACKLOG §4 Defer), so the dialog opens on this step.
import { Button, DialogFooter, IconButton, Modal, Select, SelectItem, TextInput, toast } from '@agentic-crm/ui';
import { type KeyboardEvent, useMemo, useRef, useState } from 'react';
import { Button as AriaButton, Heading } from 'react-aria-components';
import { useObjects } from '../../data/objects';
import { errorEnvelopeOf } from '../../data/trpc';
import { EmojiPickerPopover } from '../comments/emoji/EmojiPicker';
import { useWorkspace } from '../shell/workspaceContext';
import { createList, DEFAULT_LIST_ICON, DEFAULT_LIST_NAME, type List } from './data';
import { iconOfEmoji, ListIcon } from './icon';
import * as s from './lists.css';
import { Crumbs } from './PickerDialog';
import { ObjectIconTile } from './parts';

export interface CreateListDialogProps {
  /** Preselected parent object (record page "Create new list"). */
  parentEntityDefinitionId?: string;
  onClose: () => void;
  onCreated: (list: List) => void;
}

export function CreateListDialog({ parentEntityDefinitionId, onClose, onCreated }: CreateListDialogProps) {
  const { workspace } = useWorkspace();
  const objects = useObjects(workspace).data ?? [];
  const sorted = useMemo(() => [...objects].sort((a, b) => a.pluralNoun.localeCompare(b.pluralNoun)), [objects]);
  const fallback = objects.find((o) => o.entityType === 'company-record') ?? sorted[0];
  const [objectId, setObjectId] = useState<string | null>(parentEntityDefinitionId ?? null);
  const selected = objectId ?? fallback?.id ?? null;
  const [name, setName] = useState(DEFAULT_LIST_NAME);
  const [icon, setIcon] = useState<string>(DEFAULT_LIST_ICON);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const iconRef = useRef<HTMLButtonElement>(null);

  const submit = async () => {
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please provide a name for this list.');
      return;
    }
    if (!selected) return;
    setBusy(true);
    try {
      const list = await createList(workspace, { name: trimmed, icon, parentEntityDefinitionIds: [selected] });
      onClose();
      onCreated(list);
    } catch (e) {
      toast.error({ title: 'Failed to create list', description: errorEnvelopeOf(e).message });
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <Modal
      isOpen
      onOpenChange={(open) => !open && !picking && onClose()}
      size={728}
      aria-label="Start from scratch"
      isKeyboardDismissDisabled={picking}
    >
      <div style={{ display: 'contents' }} onKeyDown={onKeyDown} data-testid="create-list-dialog">
        <div className={s.pickerHeader}>
          <IconButton icon="chevronLeft" aria-label="Back" size={20} variant="ghost" onPress={onClose} />
          <Heading slot="title" className={s.crumbs}>
            <Crumbs
              parts={[
                <span key="t" className={s.crumbMuted}>
                  Templates
                </span>,
                <span key="s">Start from scratch</span>,
              ]}
            />
          </Heading>
          <IconButton icon="close" aria-label="Close" size={28} onPress={onClose} />
        </div>
        <div className={s.formBody} style={{ gap: 23, paddingTop: 15, paddingBottom: 24 }}>
          <div className={s.field} style={{ gap: 4 }}>
            <span className={s.fieldLabel}>Object</span>
            <Select
              aria-label="Object"
              size={32}
              searchable
              selectedKey={selected}
              onSelectionChange={(key) => setObjectId(String(key))}
              items={sorted}
              menuWidth="trigger"
            >
              {(o) => (
                <SelectItem id={o.id} textValue={o.pluralNoun} icon={<ObjectIconTile object={o} />}>
                  {o.pluralNoun}
                </SelectItem>
              )}
            </Select>
          </div>
          <div className={s.nameRow}>
            <AriaButton
              ref={iconRef}
              className={s.iconButton}
              aria-label="Change list icon"
              onPress={() => setPicking(true)}
            >
              <ListIcon icon={icon} size={22} />
            </AriaButton>
            <div className={s.field} style={{ flex: 1, gap: 4 }}>
              <span className={s.fieldLabel}>List name</span>
              <TextInput
                size={34}
                aria-label="List name"
                value={name}
                onChange={(v) => {
                  setName(v);
                  setError(null);
                }}
                isInvalid={Boolean(error)}
              />
            </div>
          </div>
          {error && <span className={s.errorText}>{error}</span>}
        </div>
        <DialogFooter>
          <Button variant="secondary" size={28} shortcut={['esc']} onPress={onClose}>
            Cancel
          </Button>
          <Button size={28} shortcut={['mod', 'enter']} isPending={busy} onPress={() => void submit()}>
            Create list
          </Button>
        </DialogFooter>
      </div>
      {picking && (
        <EmojiPickerPopover
          placement="bottom start"
          triggerRef={iconRef}
          onPick={(emoji) => setIcon(iconOfEmoji(emoji))}
          onClose={() => setPicking(false)}
        />
      )}
    </Modal>
  );
}
