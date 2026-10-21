// Add a record from the list:
// add-to-list-form.png): header "+ Add <Parent>", the stage "+" of a board, ghost "+ Add" of empty columns and `e`.
// 1. Choose record — "Find record…", RECORDS (avatar, name, object chip), ACTIONS "+ Create new record" /
// 'Create "<query>" as record', footer "Select record ↵". Records already in the list are still listed.
// 2. Duplicates — when the record already has entries here: each entry with its status ("Stage: ● Lead") and
// "Create new entry"; the primary becomes "Edit entry ↵" (opens the existing entry).
// 3. Add to list form.
import type { AttributeDefinition, RecordRef } from '@agentic-crm/contracts';
import { Icon, StatusDot, toast } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { type ObjectSummary, useObjects } from '../../data/objects';
import { api, errorEnvelopeOf, inWorkspace } from '../../data/trpc';
import { NewRecordDialog, RecordAvatar, useRecordTitle, useStages } from '../attributes';
import type { ValueInput } from '../attributes/types';
import { recordKind } from '../attributes/ui/primitives';
import { useWorkspace } from '../shell/workspaceContext';
import { useRecordValues } from '../table/values';
import { AddToListForm } from './AddToListForm';
import { checkDuplicates, type List, useListAttributes } from './data';
import { EditEntryDialog } from './EditEntryDialog';
import * as s from './lists.css';
import { Crumbs, PickerDialog, type PickerItem } from './PickerDialog';
import { ObjectIconTile, RecordName, useParentObjects, useRecordTitleText } from './parts';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

type Step =
  | { kind: 'choose' }
  | { kind: 'object'; title: string }
  | { kind: 'create'; object: ObjectSummary; title: string }
  | { kind: 'duplicates'; record: RecordRef; entryIds: string[] }
  | { kind: 'form'; record: RecordRef; from: 'choose' | 'duplicates'; entryIds?: string[] }
  | { kind: 'edit'; record: RecordRef; entryId: string };

export interface AddRecordFlowProps {
  list: List;
  /** Prefilled list values (the stage of the kanban column). */
  initialValues?: Record<string, ValueInput[]>;
  onClose: () => void;
  onAdded?: (entryId: string | null) => void;
}

export function AddRecordFlow({ list, initialValues, onClose, onAdded }: AddRecordFlowProps) {
  const { workspace } = useWorkspace();
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const [query, setQuery] = useState('');
  const [checking, setChecking] = useState(false);
  const parents = useParentObjects(list);

  const pickRecord = async (record: RecordRef) => {
    if (checking) return;
    setChecking(true);
    try {
      const dups = await checkDuplicates(workspace, list.id, [record]);
      const entryIds = dups.get(record.entityInstanceId) ?? [];
      setStep(
        entryIds.length > 0 ? { kind: 'duplicates', record, entryIds } : { kind: 'form', record, from: 'choose' },
      );
    } catch (error) {
      toast.error({ title: 'Failed to check for duplicate entries', description: errorEnvelopeOf(error).message });
    } finally {
      setChecking(false);
    }
  };

  const startCreate = (title: string) => {
    if (parents.length === 1) setStep({ kind: 'create', object: parents[0] as ObjectSummary, title });
    else if (parents.length > 1) setStep({ kind: 'object', title });
  };

  switch (step.kind) {
    case 'choose':
      return (
        <ChooseRecordStep
          list={list}
          query={query}
          onQuery={setQuery}
          onPick={(r) => void pickRecord(r)}
          onCreate={startCreate}
          onClose={onClose}
        />
      );
    case 'object':
      return (
        <PickerDialog
          label="Choose object"
          title="Choose object"
          onBack={() => setStep({ kind: 'choose' })}
          onClose={onClose}
          primaryLabel="Select object"
          sections={[
            {
              key: 'objects',
              label: 'Objects',
              items: parents.map((o) => ({
                key: o.id,
                icon: <ObjectIconTile object={o} size={20} />,
                label: o.singularNoun,
                onSelect: () => setStep({ kind: 'create', object: o, title: step.title }),
              })),
            },
          ]}
        />
      );
    case 'create':
      return (
        <NewRecordDialog
          entityDefinitionId={step.object.id}
          initialTitle={step.title}
          allowCreateMore={false}
          navigateOnCreate={false}
          onClose={() => setStep({ kind: 'choose' })}
          onCreated={(record) => setStep({ kind: 'form', record, from: 'choose' })}
        />
      );
    case 'duplicates':
      return (
        <DuplicatesStep
          list={list}
          record={step.record}
          entryIds={step.entryIds}
          onBack={() => setStep({ kind: 'choose' })}
          onClose={onClose}
          onEdit={(entryId) => setStep({ kind: 'edit', record: step.record, entryId })}
          onCreate={() => setStep({ kind: 'form', record: step.record, from: 'duplicates', entryIds: step.entryIds })}
        />
      );
    case 'form':
      return (
        <AddToListForm
          list={list}
          record={step.record}
          initialValues={initialValues}
          onBack={() =>
            setStep(
              step.from === 'duplicates' && step.entryIds
                ? { kind: 'duplicates', record: step.record, entryIds: step.entryIds }
                : { kind: 'choose' },
            )
          }
          onClose={onClose}
          onAdded={onAdded}
        />
      );
    case 'edit':
      return <EditEntryDialog list={list} entryId={step.entryId} parent={step.record} onClose={onClose} />;
  }
}

function ChooseRecordStep({
  list,
  query,
  onQuery,
  onPick,
  onCreate,
  onClose,
}: {
  list: List;
  query: string;
  onQuery: (q: string) => void;
  onPick: (record: RecordRef) => void;
  onCreate: (title: string) => void;
  onClose: () => void;
}) {
  const { workspace } = useWorkspace();
  const objects = useObjects(workspace).data ?? [];
  const q = useDebounced(query.trim(), 100);
  const parentIds = list.parentEntityDefinitionIds;
  const search = useQuery({
    queryKey: ['ws', workspace.id, 'record-search', 'add-to-list', parentIds.join(','), q],
    queryFn: () =>
      api.search.records.query(
        { query: q, limit: 50, ...(parentIds.length > 0 ? { entityDefinitionIds: parentIds } : {}) },
        inWorkspace(workspace),
      ),
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });
  const records: PickerItem[] = (search.data?.hits ?? []).map((h) => {
    const object = objects.find((o) => o.id === h.entityDefinitionId);
    return {
      key: h.entityInstanceId,
      icon: (
        <span className={s.rowTile}>
          <RecordAvatar kind={recordKind(object)} size={16} />
        </span>
      ),
      label: h.title ?? h.entityInstanceId,
      trailing: object ? (
        <span className={s.objectChip}>
          <ObjectIconTile object={object} size={16} />
          {object.singularNoun}
        </span>
      ) : undefined,
      onSelect: () => onPick({ entityDefinitionId: h.entityDefinitionId, entityInstanceId: h.entityInstanceId }),
      testId: 'choose-record-option',
    };
  });
  const create: PickerItem = {
    key: 'create',
    icon: (
      <span className={s.rowTile}>
        <Icon icon="add" size={14} />
      </span>
    ),
    label: q ? `Create "${q}" as record` : 'Create new record',
    onSelect: () => onCreate(q),
    testId: 'choose-record-create',
  };
  return (
    <PickerDialog
      label="Choose record"
      title="Choose record"
      onClose={onClose}
      search={{ value: query, onChange: onQuery, placeholder: 'Find record...' }}
      height={522}
      primaryLabel="Select record"
      testId="choose-record-dialog"
      sections={[
        {
          key: 'records',
          label: 'Records',
          uppercase: true,
          items: records,
          empty: search.isPending ? undefined : 'No records found',
        },
        { key: 'actions', label: 'Actions', uppercase: true, items: [create] },
      ]}
    />
  );
}

function DuplicatesStep({
  list,
  record,
  entryIds,
  onBack,
  onClose,
  onEdit,
  onCreate,
}: {
  list: List;
  record: RecordRef;
  entryIds: string[];
  onBack: () => void;
  onClose: () => void;
  onEdit: (entryId: string) => void;
  onCreate: () => void;
}) {
  const { workspace } = useWorkspace();
  const attributes = useListAttributes(workspace, list.id);
  // The status context of each duplicate: the list's first status attribute (C2 A.2 "Stage: ● Lead").
  const status = useMemo(
    () =>
      [...(attributes.data ?? [])]
        .filter((a) => !a.isArchived && a.type === 'pipeline')
        .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : 1))[0],
    [attributes.data],
  );
  const items: PickerItem[] = entryIds.map((id) => ({
    key: id,
    icon: <RecordTile record={record} />,
    label: <RecordTitle record={record} />,
    detail: status ? <EntryStatus listId={list.id} entryId={id} attributeId={status.id} /> : undefined,
    onSelect: () => onEdit(id),
    testId: 'duplicate-entry-option',
  }));
  return (
    <PickerDialog
      label="Duplicates"
      title={
        <Crumbs
          parts={[
            <span key="c" className={s.crumbMuted}>
              Choose record
            </span>,
            <span key="r" className={`${s.crumbMuted} ${s.crumbSmall}`}>
              <RecordName record={record} muted />
            </span>,
          ]}
        />
      }
      onBack={onBack}
      onClose={onClose}
      height={522}
      primaryLabel="Edit entry"
      testId="duplicates-dialog"
      sections={[
        { key: 'dups', label: 'Duplicates', items },
        {
          key: 'actions',
          label: 'Actions',
          items: [
            {
              key: 'create',
              icon: (
                <span className={s.rowTile}>
                  <Icon icon="listAdd" size={14} />
                </span>
              ),
              label: 'Create new entry',
              onSelect: onCreate,
              testId: 'create-new-entry',
            },
          ],
        },
      ]}
    />
  );
}

function RecordTile({ record }: { record: RecordRef }) {
  const { definition } = useRecordTitle(record.entityDefinitionId, record.entityInstanceId);
  return (
    <span className={s.rowTile}>
      <RecordAvatar kind={recordKind(definition)} size={16} />
    </span>
  );
}

function RecordTitle({ record }: { record: RecordRef }) {
  return <>{useRecordTitleText(record)}</>;
}

function EntryStatus({ listId, entryId, attributeId }: { listId: string; entryId: string; attributeId: string }) {
  const { workspace } = useWorkspace();
  const attributes = useListAttributes(workspace, listId);
  const attribute = attributes.data?.find((a) => a.id === attributeId);
  const cell = useRecordValues(workspace, listId, attributeId, entryId, true);
  const stages = useStageList(attribute);
  const stageId = (cell.values?.[0]?.value as { pipelineStageId?: string } | undefined)?.pipelineStageId;
  const stage = stages.find((st) => st.id === stageId);
  if (!attribute || !stage) return null;
  return (
    <>
      {attribute.title}:
      <span className={s.stageValue}>
        <StatusDot color={stage.color as Parameters<typeof StatusDot>[0]['color']} size={6} />
        {stage.title}
      </span>
    </>
  );
}

/** Stages of a status attribute (empty for other types). */
function useStageList(attribute: AttributeDefinition | undefined) {
  return useStages(attribute ?? PLACEHOLDER_ATTRIBUTE);
}

const PLACEHOLDER_ATTRIBUTE = { id: '', entityDefinitionId: '', type: 'text' } as unknown as AttributeDefinition;
