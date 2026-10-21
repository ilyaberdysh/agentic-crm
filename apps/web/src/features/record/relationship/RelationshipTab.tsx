// Relationship tab (BACKLOG 3.05): the records referenced by one relationship attribute of this record,
// with the configured attributes of the related object right-aligned. "Add {Singular}" searches records and adds a
// reference (the inverse side follows, A); selecting rows shows the floating bar "[n] Selected ×" · Add to
// list · Send email · Run workflow · (Enroll in sequence) · More ⌄ → "Unassociate {Singular}", "Delete {Singular}".
// Single-value relationships (person → Company) get a ⋮ menu per row instead of checkboxes.
import type { AttributeDefinition, AttributeValue } from '@agentic-crm/contracts';
import {
  AlertDialog,
  Button,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Popover,
  toast,
} from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useContext, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, errorEnvelopeOf, inWorkspace } from '../../../data/trpc';
import { getAttributeUi, RecordChip, RecordPicker, useAttributeValues, useAttributeWrite } from '../../attributes';
import { useAttributes, useObjectDefinition } from '../../attributes/data/queries';
import { read } from '../../attributes/values/shapes';
import { useWorkspace } from '../../shell/workspaceContext';
import * as tbl from '../../table/table.css';
import { openListsDialog } from '../adapters';
import { type RecordRef, useRecordPage } from '../context';
import { pathHead, type ResolvedTab } from '../layout/model';
import * as r from '../record.css';
import { TabAreaContext } from '../tabs/tabArea';
import * as s from './relationship.css';

export function relatedObjectId(attribute: AttributeDefinition): string | undefined {
  return (
    attribute.relationship?.relatedEntityDefinitionId ??
    attribute.config.entityReferenceConfiguration?.allowedEntityDefinitionIds?.[0] ??
    undefined
  );
}

export function RelationshipTab({ tab }: { tab: ResolvedTab }) {
  const { attributes } = useRecordPage();
  const attribute = attributes.find((a) => a.id === pathHead(tab.element.path));
  if (!attribute) {
    return (
      <div className={s.empty}>
        <div className={s.emptyTitle}>This relationship is not available</div>
      </div>
    );
  }
  return <RelationshipList tab={tab} attribute={attribute} />;
}

function RelationshipList({ tab, attribute }: { tab: ResolvedTab; attribute: AttributeDefinition }) {
  const { recordRef } = useRecordPage();
  const { workspace } = useWorkspace();
  const client = useQueryClient();
  const relatedId = relatedObjectId(attribute);
  const related = useObjectDefinition(relatedId);
  const { attributes: relatedAttributes } = useAttributes(relatedId);
  const { values, isLoading } = useAttributeValues(recordRef, attribute);
  const write = useAttributeWrite(recordRef, attribute);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const host = useContext(TabAreaContext);
  const multiple = attribute.isMultiselect;
  const singular = related?.singularNoun ?? 'Record';
  const plural = related?.pluralNoun ?? 'records';

  const rows = useMemo(
    () =>
      values
        .map((v) => ({ value: v, ref: read.reference(v.value) }))
        .filter((x): x is { value: AttributeValue; ref: NonNullable<typeof x.ref> } => x.ref !== null),
    [values],
  );
  const columns = useMemo(() => {
    const byId = new Map(relatedAttributes.map((a) => [a.id, a]));
    return tab.children
      .map((c) => byId.get(c.path?.[c.path.length - 1]?.attributeDefinitionId ?? ''))
      .filter((a): a is AttributeDefinition => a !== undefined && !a.isArchived);
  }, [relatedAttributes, tab.children]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const add = (ref: RecordRef) => {
    if (rows.some((x) => x.ref.entityInstanceId === ref.entityInstanceId)) return;
    if (multiple) write([{ op: 'put', value: ref }]);
    else write([{ value: ref }]);
    setAdding(false);
  };

  const unassociate = (ids: Set<string>) => {
    const doomed = rows.filter((x) => ids.has(x.ref.entityInstanceId));
    if (doomed.length === 0) return;
    write(doomed.map((x) => ({ op: 'retire' as const, id: x.value.id })));
    setSelected(new Set());
    toast(`Unassociated ${doomed.length === 1 ? singular.toLowerCase() : `${doomed.length} ${plural.toLowerCase()}`}`);
  };

  const deleteSelected = async () => {
    const ids = [...selected];
    setSelected(new Set());
    if (!relatedId) return;
    try {
      for (const id of ids) {
        await api.records.delete.mutate(
          { entityDefinitionId: relatedId, entityInstanceId: id },
          inWorkspace(workspace),
        );
      }
      toast.success(
        `Successfully deleted ${ids.length === 1 ? singular.toLowerCase() : `${ids.length} ${plural.toLowerCase()}`}`,
      );
      void client.invalidateQueries({ queryKey: ['ws', workspace.id, 'attribute-value-list'] });
    } catch (error) {
      toast.error({ title: 'Failed to delete', description: errorEnvelopeOf(error).message });
    }
  };

  const addButton = (
    <Popover
      isOpen={adding}
      onOpenChange={setAdding}
      aria-label={`Add ${singular}`}
      placement="bottom end"
      width={300}
      trigger={
        <Button variant="secondary" size={28} icon="add">
          Add {singular}
        </Button>
      }
    >
      <RecordPicker
        entityDefinitionIds={relatedId ? [relatedId] : null}
        selected={rows.map((x) => x.ref)}
        placeholder={`Find a ${singular.toLowerCase()}...`}
        label={plural}
        onSelect={(ref) => add({ entityDefinitionId: ref.entityDefinitionId, entityInstanceId: ref.entityInstanceId })}
      />
    </Popover>
  );

  return (
    <div data-testid="relationship-tab" data-relationship={attribute.apiSlug}>
      <div className={r.tabHeader}>
        <h2 className={r.tabTitle}>{tab.title}</h2>
        {addButton}
      </div>
      {!isLoading && rows.length === 0 ? (
        <div className={s.empty}>
          <div className={s.emptyTitle}>No {plural.toLowerCase()} found</div>
          <div className={s.emptyText}>There are no related records for this relationship.</div>
          <Button variant="secondary" size={28} icon="add" onPress={() => setAdding(true)}>
            New {singular}
          </Button>
        </div>
      ) : columns.length === 0 && tab.children.length > 0 && relatedAttributes.length > 0 ? (
        <div className={s.empty}>
          <div className={s.emptyText}>No attributes have been configured for this relationship tab</div>
        </div>
      ) : (
        <div className={s.list} role="list">
          {rows.map(({ ref }) => {
            const isSelected = selected.has(ref.entityInstanceId);
            return (
              <div
                key={ref.entityInstanceId}
                role="listitem"
                className={s.row}
                data-selected={isSelected || undefined}
                data-testid="related-row"
              >
                {multiple && (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isSelected}
                    aria-label={isSelected ? 'Deselect row' : 'Select row'}
                    className={s.checkbox}
                    onClick={() => toggle(ref.entityInstanceId)}
                  >
                    {isSelected && <Icon icon="check" size={12} strokeWidth={3} />}
                  </button>
                )}
                <span className={s.title}>
                  <RecordChip entityDefinitionId={ref.entityDefinitionId} entityInstanceId={ref.entityInstanceId} />
                </span>
                <span className={s.columns}>
                  {columns.map((col) => (
                    <RelatedValue key={col.id} attribute={col} recordRef={ref} />
                  ))}
                </span>
                {!multiple && (
                  <MenuTrigger>
                    <IconButton icon="moreVertical" variant="ghost" size={20} aria-label="Row options" />
                    <Menu
                      aria-label="Row options"
                      placement="bottom end"
                      width={220}
                      onAction={(k) => {
                        if (k === 'unassociate') unassociate(new Set([ref.entityInstanceId]));
                      }}
                    >
                      <MenuItem id="unassociate" icon="unlink">
                        Unassociate {singular}
                      </MenuItem>
                    </Menu>
                  </MenuTrigger>
                )}
              </div>
            );
          })}
        </div>
      )}
      {selected.size > 0 &&
        host &&
        createPortal(
          <div className={s.bar} role="toolbar" aria-label="Bulk actions" data-testid="relationship-bulk-bar">
            <span className={tbl.bulkCount}>
              <span className={tbl.bulkBadge}>{selected.size}</span>
              Selected
              <button
                type="button"
                className={tbl.bulkClear}
                aria-label="Clear selection"
                onClick={() => setSelected(new Set())}
              >
                <Icon icon="close" size={14} />
              </button>
            </span>
            <span className={tbl.bulkDivider} />
            <span className={tbl.bulkActions}>
              <Button
                variant="secondary"
                size={32}
                icon="listAdd"
                onPress={() =>
                  relatedId
                    ? openListsDialog({
                        kind: 'bulk-add',
                        objectId: relatedId,
                        records: [...selected].map((id) => ({ entityDefinitionId: relatedId, entityInstanceId: id })),
                        onDone: () => setSelected(new Set()),
                      })
                    : undefined
                }
              >
                Add to list
              </Button>
              <Button variant="secondary" size={32} icon="emails" onPress={later('Send email')}>
                Send email
              </Button>
              <Button variant="secondary" size={32} icon="workflows" onPress={later('Run workflow')}>
                Run workflow
              </Button>
              {related?.entityType === 'person-record' && (
                <Button variant="secondary" size={32} icon="sequences" onPress={later('Enroll in sequence')}>
                  Enroll in sequence
                </Button>
              )}
              <MenuTrigger>
                <Button variant="secondary" size={32} chevron>
                  More
                </Button>
                <Menu
                  aria-label="More bulk actions"
                  placement="top end"
                  width={220}
                  onAction={(k) => {
                    if (k === 'unassociate') unassociate(selected);
                    if (k === 'delete') setConfirmDelete(true);
                  }}
                >
                  <MenuItem id="unassociate" icon="unlink">
                    Unassociate {singular}
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem id="delete" icon="delete" variant="danger">
                    Delete {singular}
                  </MenuItem>
                </Menu>
              </MenuTrigger>
            </span>
          </div>,
          host,
        )}
      <AlertDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={
          selected.size === 1 ? `Delete ${singular.toLowerCase()}` : `Delete ${selected.size} ${plural.toLowerCase()}`
        }
        description={`Are you sure? This will remove all references to ${
          selected.size === 1 ? `this ${singular.toLowerCase()}` : `these ${plural.toLowerCase()}`
        } from your workspace, including in lists and relationships, and will delete associated notes and tasks.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          setConfirmDelete(false);
          void deleteSelected();
        }}
      />
    </div>
  );
}

const later = (what: string) => () => toast({ title: what, description: 'Arrives in a later slice.' });

function RelatedValue({ attribute, recordRef }: { attribute: AttributeDefinition; recordRef: RecordRef }) {
  const { values } = useAttributeValues(recordRef, attribute);
  const { View } = getAttributeUi(attribute.type);
  if (values.length === 0) return null;
  return (
    <span className={s.column}>
      <View attribute={attribute} values={values} density="chip" recordRef={recordRef} />
    </span>
  );
}
