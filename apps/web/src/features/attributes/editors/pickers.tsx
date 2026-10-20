// Picker editors (C1 cells.md §2; evidence/C1/28–31, D-project-tags-editor): status, select / multi-select with
// inline option creation, record reference (RecordPicker, B.8) and workspace members (MemberPicker). Single-value
// pickers commit on pick; multi-value pickers write each toggle immediately and stay open.
import type { EntityDefinition } from '@agentic-crm/contracts';
import { toast } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { errorEnvelopeOf } from '../../../data/trpc';
import { useAttributeEnv } from '../data/env';
import {
  useMembers,
  useObjectDefinition,
  usePolicy,
  useRecordTitle,
  useSelectOptions,
  useStages,
} from '../data/queries';
import type { RecordSearchHit } from '../data/server';
import { memberName } from '../format/formatValue';
import { NewRecordDialog } from '../NewRecordDialog';
import type { AttributeValue, CommitVia, EditorProps, Member, ValueOp } from '../types';
import { MemberAvatar, OptionTag, RecordAvatar, recordKind, StatusChip } from '../ui/primitives';
import { currentValues, read } from '../values/shapes';
import * as s from './editors.css';
import { CreateRowContent, EditorPopover, type PickerItem, PickerPanel } from './shell';
import { useWorkingValues } from './working';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const norm = (t: string) => t.trim().toLowerCase();
const matches = (title: string, query: string) => norm(title).includes(norm(query));

/** Closing protocol of popover pickers: one terminal call (commit or cancel). */
function useOnce() {
  const done = useRef(false);
  return (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };
}

// ---- status --------------------------------------------------------------------------------------------------------

export function StatusEditor({
  attribute,
  values,
  onCommit,
  onCancel,
  initialKey,
  anchor,
  density = 'cell',
}: EditorProps) {
  const stages = useStages(attribute);
  const [query, setQuery] = useState(initialKey ?? '');
  const once = useOnce();
  const currentId = currentValues(values)[0] ? read.pipeline(currentValues(values)[0]?.value) : null;
  const items: PickerItem[] = stages
    .filter((st) => !st.isArchived || st.id === currentId)
    .filter((st) => !query || matches(st.title, query))
    .map((st) => ({
      key: st.id,
      textValue: st.title,
      content: <StatusChip stage={st} className={s.statusOption} />,
      mark: 'check',
      selected: st.id === currentId,
      onSelect: () => once(() => onCommit([{ value: { pipelineStageId: st.id } }], { via: 'pick' })),
    }));
  return (
    <EditorPopover
      anchor={anchor}
      density={density}
      label={attribute.title}
      onDismiss={() => once(() => onCancel({ via: 'blur' }))}
      onEscape={() => once(() => onCancel({ via: 'escape' }))}
    >
      <PickerPanel
        placeholder="Search..."
        query={query}
        onQueryChange={setQuery}
        items={items}
        label={attribute.title}
      />
    </EditorPopover>
  );
}

// ---- select / multi-select ---------------------------------------------------------------------------------------

export function SelectEditor(props: EditorProps) {
  const { attribute, onCommit, onCancel, initialKey, anchor, density = 'cell' } = props;
  const options = useSelectOptions(attribute);
  const env = useAttributeEnv();
  const can = usePolicy(attribute.entityDefinitionId);
  const [query, setQuery] = useState(initialKey ?? '');
  const [creating, setCreating] = useState(false);
  const once = useOnce();
  const multi = attribute.isMultiselect;
  const working = useWorkingValues(props);
  const current = working.shown;
  const selectedIds = current.map((v) => read.select(v.value)).filter((x): x is string => Boolean(x));
  const valueIdOf = (optionId: string) => current.find((v) => read.select(v.value) === optionId)?.id;

  const visible = options.filter(
    (o) => (!o.isArchived || selectedIds.includes(o.id)) && (!query || matches(o.title, query)),
  );
  const exact = options.some((o) => !o.isArchived && norm(o.title) === norm(query));
  const canCreate = Boolean(query.trim()) && !exact && can('update_attribute_definition');

  const toggle = (optionId: string) => {
    const valueId = valueIdOf(optionId);
    const op: ValueOp = valueId ? { op: 'retire', id: valueId } : { op: 'put', value: { selectOptionId: optionId } };
    working.apply([op]);
  };

  const pick = (optionId: string) => {
    if (multi) toggle(optionId);
    else once(() => onCommit([{ value: { selectOptionId: optionId } }], { via: 'pick' }));
  };

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const option = await env.createOption(attribute, query.trim());
      setQuery('');
      pick(option.id);
    } catch (error) {
      toast.error({ title: 'Failed to create option', description: errorEnvelopeOf(error).message });
    } finally {
      setCreating(false);
    }
  };

  let items: PickerItem[];
  if (multi) {
    const selected = visible.filter((o) => selectedIds.includes(o.id));
    const rest = visible.filter((o) => !selectedIds.includes(o.id));
    items = [
      ...selected.map((o) => ({ o, on: true, sep: false })),
      ...rest.map((o, i) => ({ o, on: false, sep: i === 0 && selected.length > 0 })),
    ].map(({ o, on, sep }) => ({
      key: o.id,
      textValue: o.title,
      content: <OptionTag option={o} />,
      mark: 'checkbox' as const,
      selected: on,
      separatorBefore: Boolean(sep),
      onSelect: () => pick(o.id),
    }));
  } else {
    items = visible.map((o) => ({
      key: o.id,
      textValue: o.title,
      content: <OptionTag option={o} />,
      mark: 'check' as const,
      selected: selectedIds.includes(o.id),
      onSelect: () => pick(o.id),
    }));
  }
  if (canCreate) {
    items.push({
      key: '__create__',
      textValue: query,
      padded: true,
      content: <CreateRowContent label={`Create “${query.trim()}”`} />,
      onSelect: () => void create(),
    });
  }
  return (
    <EditorPopover
      anchor={anchor}
      density={density}
      label={attribute.title}
      onDismiss={() => (multi ? working.finish('blur') : once(() => onCancel({ via: 'blur' })))}
      onEscape={() => (multi ? working.finish('escape') : once(() => onCancel({ via: 'escape' })))}
    >
      <PickerPanel
        placeholder="Search..."
        query={query}
        onQueryChange={setQuery}
        items={items}
        label={attribute.title}
        onTab={multi ? (shift) => working.finish(shift ? 'shift-tab' : 'tab') : undefined}
      />
    </EditorPopover>
  );
}

// ---- record picker ---------------------------------------------------------------------------------------------------

export interface RecordRefValue {
  entityDefinitionId: string;
  entityInstanceId: string;
}

function RecordRowContent({ hit }: { hit: RecordSearchHit }) {
  const { title, definition } = useRecordTitle(hit.entityDefinitionId, hit.title ? '' : hit.entityInstanceId);
  return (
    <>
      <RecordAvatar kind={recordKind(definition)} />
      <span className={s.optionTexts}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hit.title ?? title}</span>
        {hit.subtitle && <span className={s.optionDescription}>{hit.subtitle}</span>}
      </span>
    </>
  );
}

export interface RecordPickerProps {
  /** Objects the reference may point at (null / empty = any record object). */
  entityDefinitionIds: string[] | null;
  selected: RecordRefValue[];
  multiple?: boolean;
  /** Pick (single) or toggle (multi). */
  onSelect: (record: RecordRefValue, isSelected: boolean) => void;
  /** "+ Create {Object}": receives the typed query and the object to create in. */
  onCreate?: (query: string, entityDefinitionId: string) => void;
  initialQuery?: string;
  placeholder?: string;
  label?: string;
  onTab?: (shift: boolean) => void;
}

/**
 * Record search list (B.8): empty query shows a default set, typing searches display names (debounced); multi
 * pickers list the selected records first with checked boxes, then suggestions; footer "+ Create {Object}".
 */
export function RecordPicker({
  entityDefinitionIds,
  selected,
  multiple = false,
  onSelect,
  onCreate,
  initialQuery = '',
  placeholder = 'Search records...',
  label = 'Records',
  onTab,
}: RecordPickerProps) {
  const env = useAttributeEnv();
  const [query, setQuery] = useState(initialQuery);
  const debounced = useDebounced(query, 120);
  const defsKey = (entityDefinitionIds ?? []).join(',');
  const excludeIds = multiple ? selected.map((r) => r.entityInstanceId) : [];
  const search = useQuery({
    queryKey: ['ws', env.workspace.id, 'record-search', defsKey, debounced, excludeIds.join(',')],
    queryFn: () => env.searchRecords({ query: debounced, entityDefinitionIds, limit: 25, excludeIds }),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
    enabled: Boolean(env.workspace.id),
  });
  const single = entityDefinitionIds?.length === 1 ? entityDefinitionIds[0] : undefined;
  const createObject = useObjectDefinition(single ?? null);
  const selectedIds = new Set(selected.map((r) => r.entityInstanceId));
  const hits = (search.data ?? []).filter((h) => !multiple || !selectedIds.has(h.entityInstanceId));

  const items: PickerItem[] = [];
  if (multiple) {
    for (const r of selected) {
      items.push({
        key: `sel:${r.entityInstanceId}`,
        content: <RecordRowContent hit={r} />,
        mark: 'checkbox',
        selected: true,
        onSelect: () => onSelect(r, true),
      });
    }
  }
  hits.forEach((h, i) => {
    items.push({
      key: h.entityInstanceId,
      content: <RecordRowContent hit={h} />,
      mark: multiple ? 'checkbox' : 'check',
      selected: selectedIds.has(h.entityInstanceId),
      separatorBefore: multiple && i === 0 && selected.length > 0,
      labelBefore: i === 0 && debounced.trim() ? 'Records' : undefined,
      onSelect: () => onSelect(h, selectedIds.has(h.entityInstanceId)),
    });
  });
  const footer: PickerItem[] =
    onCreate && (single || entityDefinitionIds === null || entityDefinitionIds.length === 0) && createObject
      ? [
          {
            key: '__create__',
            padded: true,
            content: <CreateRowContent label={`Create ${createObject.singularNoun}`} />,
            onSelect: () => onCreate(query, createObject.id),
          },
        ]
      : [];
  return (
    <PickerPanel
      placeholder={placeholder}
      query={query}
      onQueryChange={setQuery}
      items={items}
      footerItems={footer}
      emptyText={search.isPending ? 'Searching...' : 'No results'}
      isLoading={search.isPending}
      label={label}
      onTab={onTab}
    />
  );
}

export function RecordReferenceEditor(props: EditorProps) {
  const { attribute, onCommit, onCancel, initialKey, anchor, density = 'cell' } = props;
  const once = useOnce();
  const [creating, setCreating] = useState<{ query: string; objectId: string } | null>(null);
  const working = useWorkingValues(props);
  const multi = attribute.isMultiselect;
  const current = working.shown;
  const selected = current
    .map((v) => read.reference(v.value))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => ({ entityDefinitionId: r.entityDefinitionId, entityInstanceId: r.entityInstanceId }));
  const allowed = attribute.config.entityReferenceConfiguration?.allowedEntityDefinitionIds ?? null;
  const valueIdOf = (id: string) => current.find((v) => read.reference(v.value)?.entityInstanceId === id)?.id;

  const select = (r: RecordRefValue, isSelected: boolean) => {
    const value = { entityDefinitionId: r.entityDefinitionId, entityInstanceId: r.entityInstanceId };
    if (multi) {
      const id = valueIdOf(r.entityInstanceId);
      working.apply([isSelected && id ? { op: 'retire', id } : { op: 'put', value }]);
    } else once(() => onCommit([{ value }], { via: 'pick' }));
  };

  if (creating) {
    return (
      <NewRecordDialog
        entityDefinitionId={creating.objectId}
        initialTitle={creating.query}
        allowCreateMore={false}
        navigateOnCreate={false}
        onClose={() => (multi ? working.finish('escape') : once(() => onCancel({ via: 'escape' })))}
        onCreated={(record) =>
          multi
            ? working.finish('pick', [{ op: 'put', value: record }])
            : once(() => onCommit([{ value: record }], { via: 'pick' }))
        }
      />
    );
  }
  return (
    <EditorPopover
      anchor={anchor}
      density={density}
      label={attribute.title}
      onDismiss={() => (multi ? working.finish('blur') : once(() => onCancel({ via: 'blur' })))}
      onEscape={() => (multi ? working.finish('escape') : once(() => onCancel({ via: 'escape' })))}
    >
      <RecordPicker
        entityDefinitionIds={allowed}
        selected={selected}
        multiple={multi}
        onSelect={select}
        onCreate={(query, objectId) => setCreating({ query, objectId })}
        initialQuery={initialKey ?? ''}
        label={attribute.title}
        onTab={multi ? (shift) => working.finish(shift ? 'shift-tab' : 'tab') : undefined}
      />
    </EditorPopover>
  );
}

// ---- member picker ---------------------------------------------------------------------------------------------------

export interface MemberPickerProps {
  selectedIds: string[];
  multiple?: boolean;
  onSelect: (member: PickedMember, isSelected: boolean) => void;
  initialQuery?: string;
  /** "Search people..." in cells, "Find someone..." on record pages (D §3.2). */
  placeholder?: string;
  label?: string;
}

/** What a member picker hands back (a `search.members` hit or a cached member). */
export type PickedMember = Pick<Member, 'id' | 'firstName' | 'lastName' | 'emailAddress'>;

function MemberRow({ member }: { member: PickedMember }): ReactNode {
  return (
    <>
      <MemberAvatar member={member as Member} size={20} />
      <span className={s.optionTexts}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{memberName(member)}</span>
        <span className={s.optionDescription}>{member.emailAddress}</span>
      </span>
    </>
  );
}

/** Workspace members ranked by `search.members` (name, email); multi pickers list the selected ones first. */
export function MemberPicker({
  selectedIds,
  multiple = false,
  onSelect,
  initialQuery = '',
  placeholder = 'Search people...',
  label = 'Members',
}: MemberPickerProps) {
  const env = useAttributeEnv();
  const members = useMembers();
  const [query, setQuery] = useState(initialQuery);
  const debounced = useDebounced(query, 80);
  const search = useQuery({
    queryKey: ['ws', env.workspace.id, 'member-search', debounced],
    queryFn: () => env.searchMembers({ query: debounced, limit: 50 }),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
    enabled: Boolean(env.workspace.id),
  });
  const hits: PickedMember[] = search.data ?? [];
  const selectedSet = new Set(selectedIds);
  const selected: PickedMember[] = multiple
    ? selectedIds
        .map((id) => members.find((m) => m.id === id) ?? hits.find((h) => h.id === id))
        .filter((m): m is PickedMember => Boolean(m))
        .filter((m) => !query || matches(`${memberName(m)} ${m.emailAddress}`, query))
    : [];
  const rest = multiple ? hits.filter((h) => !selectedSet.has(h.id)) : hits;
  const items: PickerItem[] = [...selected, ...rest].map((m, i) => ({
    key: m.id,
    textValue: memberName(m),
    content: <MemberRow member={m} />,
    mark: multiple ? 'checkbox' : 'check',
    selected: selectedSet.has(m.id),
    separatorBefore: multiple && i === selected.length && i > 0,
    onSelect: () => onSelect(m, selectedSet.has(m.id)),
  }));
  return (
    <PickerPanel
      placeholder={placeholder}
      query={query}
      onQueryChange={setQuery}
      items={items}
      label={label}
      isLoading={search.isPending}
      emptyText={search.isPending ? 'Searching...' : 'No results'}
    />
  );
}

export function ActorReferenceEditor(props: EditorProps) {
  const { attribute, onCommit, onCancel, initialKey, anchor, density = 'cell' } = props;
  const once = useOnce();
  const working = useWorkingValues(props);
  const multi = attribute.isMultiselect;
  const current = working.shown;
  const selectedIds = current
    .map((v) => read.actor(v.value))
    .filter((a): a is NonNullable<typeof a> => Boolean(a) && a?.referencedActorType === 'workspace-member')
    .map((a) => a.referencedActorId);
  const valueIdOf = (memberId: string) =>
    current.find((v: AttributeValue) => read.actor(v.value)?.referencedActorId === memberId)?.id;
  const select = (member: PickedMember, isSelected: boolean) => {
    const value = { referencedActorType: 'workspace-member', referencedActorId: member.id };
    if (multi) {
      const id = valueIdOf(member.id);
      working.apply([isSelected && id ? { op: 'retire', id } : { op: 'put', value }]);
    } else once(() => onCommit([{ value }], { via: 'pick' satisfies CommitVia }));
  };
  return (
    <EditorPopover
      anchor={anchor}
      density={density}
      label={attribute.title}
      onDismiss={() => (multi ? working.finish('blur') : once(() => onCancel({ via: 'blur' })))}
      onEscape={() => (multi ? working.finish('escape') : once(() => onCancel({ via: 'escape' })))}
    >
      <MemberPicker
        selectedIds={selectedIds}
        multiple={multi}
        onSelect={select}
        initialQuery={initialKey ?? ''}
        placeholder={density === 'field' ? 'Find someone...' : 'Search people...'}
        label={attribute.title}
      />
    </EditorPopover>
  );
}

export type { EntityDefinition };
