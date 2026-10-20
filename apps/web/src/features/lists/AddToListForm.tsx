// The Add-to-list form (C2 README §2.5 A.3, X-07; evidence/C2/add-to-list-form.png): breadcrumb "‹ <record> / Add to
// list <list chip>", tabs All · Create templates, one field per writable list attribute ("<Title> (optional)",
// "Set <title>"), prefilled values (kanban column stage), footer Cancel ESC · "Add to list ⌘↵". Submit creates the
// entry with every value in one `entries.add`. Closing with edits asks "Discard entry".
import type { RecordRef } from '@agentic-crm/contracts';
import {
  AlertDialog,
  Button,
  DialogBody,
  DialogFooter,
  IconButton,
  Modal,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  toast,
} from '@agentic-crm/ui';
import { type KeyboardEvent, useMemo, useState } from 'react';
import { Heading } from 'react-aria-components';
import { errorEnvelopeOf } from '../../data/trpc';
import { getAttributeUi } from '../attributes';
import * as d from '../attributes/dialogs.css';
import { FieldControl } from '../attributes/NewRecordDialog';
import type { ValueInput } from '../attributes/types';
import { useWorkspace } from '../shell/workspaceContext';
import { addEntries, type List, useListAttributes, writableListAttributes } from './data';
import { useEntryForm } from './entryForm';
import * as s from './lists.css';
import { Crumbs } from './PickerDialog';
import { ListChip, RecordName } from './parts';

export interface AddToListFormProps {
  list: List;
  record: RecordRef;
  /** Prefilled values by attribute id or api slug. */
  initialValues?: Record<string, ValueInput[]>;
  onBack?: () => void;
  onClose: () => void;
  onAdded?: (entryId: string | null) => void;
}

export function AddToListForm({ list, record, initialValues, onBack, onClose, onAdded }: AddToListFormProps) {
  const { workspace } = useWorkspace();
  const attributes = useListAttributes(workspace, list.id);
  const fields = useMemo(() => writableListAttributes(attributes.data ?? []), [attributes.data]);
  const form = useEntryForm(list.id, fields, initialValues);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ attributeId: string; anchor: HTMLElement } | null>(null);
  const [discarding, setDiscarding] = useState(false);

  const requestClose = () => {
    if (form.dirty) setDiscarding(true);
    else onClose();
  };

  const submit = async () => {
    if (busy) return;
    const values = form.collect();
    if (!values) return;
    setBusy(true);
    try {
      const result = await addEntries(workspace, {
        listId: list.id,
        parentRecords: [record],
        values,
        onDuplicate: 'keep',
      });
      onClose();
      onAdded?.(result.entryIds[0] ?? null);
    } catch (error) {
      toast.error({ title: 'Failed to add record to list', description: errorEnvelopeOf(error).message });
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

  const editingAttr = editing ? fields.find((a) => a.id === editing.attributeId) : undefined;
  const EditingEditor = editingAttr ? getAttributeUi(editingAttr.type).Editor : null;

  return (
    <>
      <Modal
        isOpen
        onOpenChange={(open) => !open && !editing && requestClose()}
        size="large"
        style={{ height: 522 }}
        aria-label="Add to list"
        isKeyboardDismissDisabled={Boolean(editing) || discarding}
      >
        <div style={{ display: 'contents' }} onKeyDown={onKeyDown} data-testid="add-to-list-form">
          <div className={s.pickerHeader}>
            {onBack && <IconButton icon="chevronLeft" aria-label="Back" size={20} variant="ghost" onPress={onBack} />}
            <Heading slot="title" className={s.crumbs}>
              <Crumbs
                parts={[
                  <span key="r" className={`${s.crumbMuted} ${s.crumbSmall}`}>
                    <RecordName record={record} muted />
                  </span>,
                  <span key="a" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span className={s.crumbSmall}>Add to list</span>
                    <ListChip list={list} />
                  </span>,
                ]}
              />
            </Heading>
            <IconButton icon="close" aria-label="Close" size={28} onPress={requestClose} />
          </div>
          <Tabs defaultSelectedKey="all" style={{ display: 'contents' }}>
            <div className={d.tabs}>
              <TabList aria-label="Add to list">
                <Tab id="all">All</Tab>
                <Tab id="templates" icon="template" divider>
                  Create templates
                </Tab>
              </TabList>
            </div>
            <TabPanel id="all" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <DialogBody className={d.body}>
                <h3 className={d.sectionTitle}>All</h3>
                {attributes.isPending && <span className={d.label}>Loading…</span>}
                {!attributes.isPending && fields.length === 0 && (
                  <span className={d.label}>This list has no attributes yet.</span>
                )}
                {fields.map((a) => (
                  <FieldControl
                    key={a.id}
                    attribute={a}
                    rows={form.state.rows[a.id] ?? []}
                    text={form.state.texts[a.id] ?? ''}
                    error={form.errors[a.id]}
                    isOpen={editing?.attributeId === a.id}
                    onText={(t) => form.setText(a, t)}
                    onCommit={(next, meta) => {
                      form.commitTo(a)(next, meta);
                      if (!meta?.keepOpen) setEditing(null);
                    }}
                    onOpen={(anchor) => setEditing({ attributeId: a.id, anchor })}
                  />
                ))}
              </DialogBody>
            </TabPanel>
            <TabPanel id="templates" style={{ flex: 1 }}>
              <div className={d.templates}>List entry templates are not available yet.</div>
            </TabPanel>
          </Tabs>
          <DialogFooter>
            <Button variant="secondary" size={28} shortcut={['esc']} onPress={requestClose}>
              Cancel
            </Button>
            <Button size={28} shortcut={['mod', 'enter']} isPending={busy} onPress={() => void submit()}>
              Add to list
            </Button>
          </DialogFooter>
        </div>
        {editingAttr && EditingEditor && editing && (
          <EditingEditor
            attribute={editingAttr}
            values={form.state.rows[editingAttr.id] ?? []}
            anchor={editing.anchor}
            density="field"
            onCommit={(next, meta) => {
              form.commitTo(editingAttr)(next, meta);
              if (!meta?.keepOpen) setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>
      <AlertDialog
        isOpen={discarding}
        onOpenChange={setDiscarding}
        title="Discard entry"
        description="This will discard your current entry."
        confirmLabel="Discard"
        variant="danger"
        onConfirm={() => {
          setDiscarding(false);
          onClose();
        }}
        onCancel={() => setDiscarding(false)}
      />
    </>
  );
}
