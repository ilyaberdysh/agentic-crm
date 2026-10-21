// Layout editor dialogs: "Edit section" (Title, "Attributes to show" with drag reorder and
// "Add attribute", the first-5 hint), "Edit tab" (title; relationship columns or email sources) and "Edit widget
// label". Each returns the next working element list to the editor; nothing is saved until "Save changes".
import type { AttributeDefinition, EntityDefinition, LayoutElement, Path } from '@agentic-crm/contracts';
import {
  Button,
  DialogFooter,
  DialogHeader,
  FilterableMenu,
  Icon,
  IconButton,
  MenuItem,
  MenuTrigger,
  Modal,
  TextInput,
} from '@agentic-crm/ui';
import { useMemo, useRef, useState } from 'react';
import { newId } from '../../../lib/ids';
import { useShortcut } from '../../../lib/shortcuts';
import { useAttributes } from '../../attributes/data/queries';
import { attributeIcon } from '../../settings/objects/attributes/typeCatalog';
import { useVerticalReorder } from '../../views/useVerticalReorder';
import { listedAttributes } from '../details/attributes';
import {
  addElement,
  childrenOf,
  groupChildren,
  groupElement,
  reorderChildren,
  setSectionAttributes,
  updateElement,
} from '../layout/model';
import { relatedObjectId } from '../relationship/RelationshipTab';
import * as s from './editor.css';

interface AttrListProps {
  label: string;
  chosen: AttributeDefinition[];
  options: AttributeDefinition[];
  onChange: (next: AttributeDefinition[]) => void;
  addLabel?: string;
}

/** Ordered attribute list with drag handles, remove buttons and an "Add attribute" picker. */
function AttributeList({ label, chosen, options, onChange, addLabel = 'Add attribute' }: AttrListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const reorder = useVerticalReorder(listRef, (from, to) => {
    const next = [...chosen];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved as AttributeDefinition);
    onChange(next);
  });
  const line = reorder.dropLineTop();
  const available = options.filter((o) => !chosen.some((c) => c.id === o.id));
  return (
    <div>
      <div className={s.fieldLabel}>{label}</div>
      <div className={s.attrList} ref={listRef} data-testid="section-attributes">
        {chosen.map((a, i) => (
          <div
            key={a.id}
            className={s.attrRow}
            data-reorder-index={i}
            data-dragging={reorder.dragging === i || undefined}
          >
            <span className={s.grip} onPointerDown={(e) => reorder.onPointerDown(i, e)} aria-label="Drag to reorder">
              <Icon icon="drag" size={16} />
            </span>
            <Icon icon={attributeIcon(a)} size={16} />
            <span className={s.spacer}>{a.title}</span>
            <IconButton
              icon="close"
              variant="ghost"
              size={20}
              aria-label={`Remove ${a.title}`}
              onPress={() => onChange(chosen.filter((c) => c.id !== a.id))}
            />
          </div>
        ))}
        <MenuTrigger>
          <button type="button" className={s.attrAdd}>
            {addLabel}
            <Icon icon="add" size={16} />
          </button>
          <FilterableMenu
            aria-label={addLabel}
            placeholder="Search attributes..."
            placement="bottom start"
            width={320}
            maxHeight={320}
            onAction={(k) => {
              const a = available.find((o) => o.id === k);
              if (a) onChange([...chosen, a]);
            }}
          >
            {available.map((a) => (
              <MenuItem key={a.id} id={a.id} icon={attributeIcon(a)} textValue={a.title}>
                {a.title}
              </MenuItem>
            ))}
          </FilterableMenu>
        </MenuTrigger>
        {line !== null && <span className={s.dropLine} style={{ top: line }} />}
      </div>
    </div>
  );
}

function DialogFrame({
  title,
  onClose,
  onSave,
  saveLabel = 'Save changes',
  children,
}: {
  title: string;
  onClose: () => void;
  onSave: () => void;
  saveLabel?: string;
  children: React.ReactNode;
}) {
  useShortcut('mod+enter', onSave);
  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()} size={808} aria-label={title}>
      <DialogHeader title={title} onClose={onClose} />
      <div className={s.dialogBody} data-allow-global-shortcuts="">
        {children}
      </div>
      <DialogFooter>
        <Button variant="secondary" size={28} onPress={onClose} shortcut={['esc']}>
          Cancel
        </Button>
        <Button variant="primary" size={28} onPress={onSave} shortcut={['mod', 'enter']}>
          {saveLabel}
        </Button>
      </DialogFooter>
    </Modal>
  );
}

export function EditSectionDialog({
  object,
  attributes,
  working,
  sectionId,
  onClose,
  onSave,
}: {
  object: EntityDefinition;
  attributes: AttributeDefinition[];
  working: LayoutElement[];
  sectionId: string | null;
  onClose: () => void;
  onSave: (next: LayoutElement[]) => void;
}) {
  const section = sectionId ? working.find((e) => e.elementId === sectionId) : undefined;
  const byId = useMemo(() => new Map(attributes.map((a) => [a.id, a])), [attributes]);
  const [title, setTitle] = useState(section?.title ?? '');
  const [chosen, setChosen] = useState<AttributeDefinition[]>(() =>
    section
      ? childrenOf(working, section.elementId)
          .map((c) => byId.get(c.path?.[0]?.attributeDefinitionId ?? ''))
          .filter((a): a is AttributeDefinition => a !== undefined)
      : [],
  );
  const save = () => {
    const paths: Path[] = chosen.map((a) => [{ entityDefinitionId: object.id, attributeDefinitionId: a.id }]);
    let next = working;
    let id = sectionId;
    if (!id) {
      const sidebar = groupElement(working, 'details-sidebar');
      if (!sidebar) return onClose();
      id = newId();
      next = addElement(next, sidebar.elementId, { elementId: id, type: 'details', title: title.trim() || null });
      // Keep the locked Lists section last.
      const order = groupChildren(next, 'details-sidebar');
      const ids = [
        ...order.filter((e) => e.type !== 'detail-list-entries'),
        ...order.filter((e) => e.type === 'detail-list-entries'),
      ].map((e) => e.elementId);
      next = reorderChildren(next, sidebar.elementId, ids);
    } else {
      next = updateElement(next, id, { title: title.trim() || null });
    }
    onSave(setSectionAttributes(next, id, paths, newId));
  };
  return (
    <DialogFrame title="Edit section" onClose={onClose} onSave={save}>
      <TextInput label="Title" size={32} placeholder="Section title" value={title} onChange={setTitle} autoFocus />
      <AttributeList
        label="Attributes to show"
        chosen={chosen}
        options={listedAttributes(attributes)}
        onChange={setChosen}
      />
      <div className={s.chip} style={{ height: 'auto', padding: '10px 12px', gap: 8, borderRadius: 12 }}>
        <Icon icon="info" size={16} />
        If you don't select any attributes, the first 5 will be shown by default.
      </div>
    </DialogFrame>
  );
}

export function EditTabDialog({
  object,
  working,
  elementId,
  onClose,
  onSave,
}: {
  object: EntityDefinition;
  working: LayoutElement[];
  elementId: string;
  onClose: () => void;
  onSave: (next: LayoutElement[]) => void;
}) {
  const tab = working.find((e) => e.elementId === elementId) as LayoutElement;
  const { attributes: own } = useAttributes(object.id);
  const relAttr = own.find((a) => a.id === tab.path?.[0]?.attributeDefinitionId);
  const relatedId = tab.type === 'relationship-tab' && relAttr ? relatedObjectId(relAttr) : undefined;
  const { attributes: related } = useAttributes(relatedId);
  const options = useMemo(
    () =>
      tab.type === 'relationship-tab'
        ? listedAttributes(related)
        : own.filter((a) => !a.isArchived && (a.type === 'email-address' || a.type === 'domain')),
    [tab.type, related, own],
  );
  const pool = tab.type === 'relationship-tab' ? related : own;
  const [title, setTitle] = useState(tab.title ?? '');
  const [chosen, setChosen] = useState<AttributeDefinition[] | null>(null);
  const initial = useMemo(
    () =>
      childrenOf(working, elementId)
        .map((c) => pool.find((a) => a.id === c.path?.[c.path.length - 1]?.attributeDefinitionId))
        .filter((a): a is AttributeDefinition => a !== undefined),
    [working, elementId, pool],
  );
  const current = chosen ?? initial;
  const save = () => {
    let next = updateElement(working, elementId, { title: title.trim() || null });
    if (chosen) {
      next = next.filter((e) => e.parentElementId !== elementId);
      const childType = tab.type === 'relationship-tab' ? 'relationship-tab-value' : 'email-tab-value';
      for (const a of chosen) {
        next = addElement(next, elementId, {
          elementId: newId(),
          type: childType,
          path: [{ entityDefinitionId: a.entityDefinitionId, attributeDefinitionId: a.id }],
        });
      }
    }
    onSave(next);
  };
  return (
    <DialogFrame title="Edit section" onClose={onClose} onSave={save}>
      <TextInput label="Title" size={32} placeholder="Tab title" value={title} onChange={setTitle} autoFocus />
      {(tab.type === 'relationship-tab' || tab.type === 'email-tab') && (
        <AttributeList
          label={
            tab.type === 'email-tab'
              ? 'Sources — Add one or more sources to show emails with any of the associated people or companies'
              : 'Attributes to show'
          }
          chosen={current}
          options={options}
          onChange={setChosen}
        />
      )}
    </DialogFrame>
  );
}

export function WidgetLabelDialog({
  working,
  elementId,
  onClose,
  onSave,
}: {
  working: LayoutElement[];
  elementId: string;
  onClose: () => void;
  onSave: (next: LayoutElement[]) => void;
}) {
  const widget = working.find((e) => e.elementId === elementId);
  const [label, setLabel] = useState(widget?.title ?? '');
  const save = () => onSave(updateElement(working, elementId, { title: label.trim() || null }));
  return (
    <DialogFrame title="Edit widget label" onClose={onClose} onSave={save} saveLabel="Save label">
      <TextInput
        label="Widget label"
        size={32}
        placeholder="Set custom label"
        description="The underlying attribute names will still be visible on hover"
        value={label}
        onChange={setLabel}
        autoFocus
      />
    </DialogFrame>
  );
}
