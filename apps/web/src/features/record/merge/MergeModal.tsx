// Merge records (BACKLOG 3.07): companies and people only. The current record starts in the right
// card (priority: its single values win, its emails / domains come first); "+" picks the second record; ⇄ swaps;
// the preview shows the merged name, the union of identifiers and summed counters. "Merge records ↵" merges into a
// new record (client-minted id) and opens it; both sources then show the merged-away state with "Go to record".
import type { AttributeDefinition } from '@agentic-crm/contracts';
import {
  Button,
  DialogFooter,
  DialogHeader,
  Icon,
  IconButton,
  type IconName,
  Modal,
  Popover,
  Tooltip,
  toast,
} from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { api, errorEnvelopeOf, inWorkspace } from '../../../data/trpc';
import { newId } from '../../../lib/ids';
import { useShortcut } from '../../../lib/shortcuts';
import { RecordAvatar, RecordPicker, useAttributeValues } from '../../attributes';
import { titleFromValue } from '../../attributes/data/queries';
import { recordKind } from '../../attributes/ui/primitives';
import { read } from '../../attributes/values/shapes';
import { useWorkspace } from '../../shell/workspaceContext';
import { type RecordRef, useRecordPage } from '../context';
import { invalidateTimeline, type RelatedCounts, recordKeys } from '../data';
import { recordUrl } from '../paths';
import { PLACEHOLDER_ATTRIBUTE as PLACEHOLDER, unnamedTitle } from '../title';
import * as s from './merge.css';

interface CardData {
  ref: RecordRef;
  name: string;
  identifiers: string[];
  counts: RelatedCounts | null;
}

function useCardData(
  ref: RecordRef | null,
  nameAttr: AttributeDefinition | undefined,
  idAttr: AttributeDefinition | undefined,
) {
  const { workspace } = useWorkspace();
  const empty = { entityDefinitionId: ref?.entityDefinitionId ?? '', entityInstanceId: '' };
  const name = useAttributeValues(ref && nameAttr ? ref : empty, nameAttr ?? PLACEHOLDER);
  const ids = useAttributeValues(ref && idAttr ? ref : empty, idAttr ?? PLACEHOLDER);
  const counts = useQuery({
    queryKey: ref
      ? [...recordKeys.counts(workspace.id, ref.entityDefinitionId, ref.entityInstanceId)]
      : ['ws', workspace.id, 'none'],
    queryFn: async () => {
      const r = ref as RecordRef;
      const { counts: map } = await api.recordPage.relatedCounts.query(
        { entityDefinitionId: r.entityDefinitionId, entityInstanceIds: [r.entityInstanceId] },
        inWorkspace(workspace),
      );
      return map[r.entityInstanceId] ?? null;
    },
    enabled: Boolean(ref),
  });
  return useMemo<CardData | null>(() => {
    if (!ref) return null;
    const value = name.values[0]?.value;
    return {
      ref,
      name: value !== undefined ? titleFromValue(value) : '',
      identifiers: ids.values
        .map((v) => read.email(v.value)?.originalEmailAddress ?? read.domain(v.value)?.normalizedDomain ?? '')
        .filter(Boolean),
      counts: counts.data ?? null,
    };
  }, [ref, name.values, ids.values, counts.data]);
}

export function MergeModal({ onClose }: { onClose: () => void }) {
  const { object, recordRef, attributes, titleAttribute } = useRecordPage();
  const { workspace, href } = useWorkspace();
  const navigate = useNavigate();
  const [left, setLeft] = useState<RecordRef | null>(null);
  const [right, setRight] = useState<RecordRef>(recordRef);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const idAttr = attributes.find((a) =>
    object.entityType === 'person-record'
      ? a.systemAttributeType === 'email-addresses' || a.apiSlug === 'email_addresses'
      : a.apiSlug === 'domains',
  );
  const leftData = useCardData(left, titleAttribute, idAttr);
  const rightData = useCardData(right, titleAttribute, idAttr);
  const kind = recordKind(object);
  const unnamed = unnamedTitle(object);

  const pick = (ref: RecordRef) => {
    setPicking(false);
    if (ref.entityInstanceId === right.entityInstanceId) {
      toast.error('You cannot merge a record into itself.');
      return;
    }
    setLeft(ref);
  };

  const merge = async () => {
    if (!left || busy) return;
    setBusy(true);
    try {
      const out = await api.records.merge.mutate(
        {
          entityDefinitionId: object.id,
          // The right card holds priority: in the API that is the merge *target* (its single values win).
          baseEntityInstanceId: left.entityInstanceId,
          targetEntityInstanceId: right.entityInstanceId,
          mergedEntityInstanceId: newId(),
        },
        inWorkspace(workspace),
      );
      const mergedId = out.record.entityInstanceId;
      invalidateTimeline(workspace, { entityDefinitionId: object.id, entityInstanceId: mergedId });
      toast.success('Records merged successfully');
      onClose();
      void navigate({ href: recordUrl(href, object, mergedId, 'overview'), replace: true });
    } catch (error) {
      const { message } = errorEnvelopeOf(error);
      toast.error({ title: 'Error merging record', description: message });
      setBusy(false);
    }
  };
  useShortcut(left ? 'enter' : null, () => void merge());

  const preview: CardData | null =
    leftData && rightData
      ? {
          ref: rightData.ref,
          name: rightData.name || leftData.name,
          identifiers: [...new Set([...rightData.identifiers, ...leftData.identifiers])],
          counts: sumCounts(leftData.counts, rightData.counts),
        }
      : rightData;

  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()} size={806} overlay aria-label="Merge records">
      <DialogHeader
        title={
          <span className={s.headerTitle}>
            Merge
            <span className={s.headerChip}>
              <RecordAvatar kind={kind} size={12} />
              {rightData?.name || unnamed}
            </span>
          </span>
        }
        onClose={onClose}
      />
      <div className={s.body} data-allow-global-shortcuts="">
        <div className={s.info}>
          <Icon icon="info" size={16} />
          Our system intelligently combines your data. Note that the second selected record holds higher priority.
        </div>
        <div className={s.row}>
          <div className={s.sources}>
            {leftData ? (
              <Card data={leftData} kind={kind} unnamed={unnamed} testId="merge-left" />
            ) : (
              <div className={s.slot} data-testid="merge-slot">
                <Popover
                  isOpen={picking}
                  onOpenChange={setPicking}
                  aria-label="Find record"
                  placement="bottom"
                  width={300}
                  trigger={
                    <IconButton
                      icon="add"
                      variant="secondary"
                      size={28}
                      aria-label="Find Record"
                      tooltip="Find Record"
                    />
                  }
                >
                  <RecordPicker
                    entityDefinitionIds={[object.id]}
                    selected={[]}
                    placeholder="Search..."
                    label={object.pluralNoun}
                    onSelect={(ref) =>
                      pick({ entityDefinitionId: ref.entityDefinitionId, entityInstanceId: ref.entityInstanceId })
                    }
                  />
                </Popover>
              </div>
            )}
            <Tooltip content="Swap Position">
              <button
                type="button"
                className={s.swap}
                aria-label="Swap Position"
                data-disabled={left ? undefined : ''}
                disabled={!left}
                onClick={() => {
                  if (!left) return;
                  setLeft(right);
                  setRight(left);
                }}
              >
                <Icon icon="swap" size={14} />
              </button>
            </Tooltip>
            {rightData && <Card data={rightData} kind={kind} unnamed={unnamed} testId="merge-right" />}
          </div>
          <span className={s.operator} aria-hidden="true">
            <Icon icon="equal" size={12} />
          </span>
          {preview && <Card data={preview} kind={kind} unnamed={unnamed} result testId="merge-result" />}
        </div>
      </div>
      <DialogFooter>
        <Button variant="secondary" size={28} onPress={onClose} shortcut={['esc']}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size={28}
          icon="merge"
          isDisabled={!left}
          isPending={busy}
          onPress={() => void merge()}
          shortcut={['enter']}
        >
          {busy ? 'Merging records' : 'Merge records'}
        </Button>
      </DialogFooter>
    </Modal>
  );
}

function sumCounts(a: RelatedCounts | null, b: RelatedCounts | null): RelatedCounts | null {
  if (!a || !b) return a ?? b;
  return {
    lists: a.lists + b.lists,
    notes: a.notes + b.notes,
    tasks: a.tasks + b.tasks,
    openTasks: a.openTasks + b.openTasks,
    comments: a.comments + b.comments,
    files: a.files + b.files,
  };
}

const COUNTERS: { key: keyof RelatedCounts; icon: IconName; tip: (n: number) => string }[] = [
  { key: 'lists', icon: 'list', tip: (n) => `Appears in ${n} Lists` },
  { key: 'notes', icon: 'noteTab', tip: (n) => `${n} related Notes` },
  { key: 'tasks', icon: 'tasks', tip: (n) => `Connected to ${n} Tasks` },
  { key: 'comments', icon: 'comment', tip: (n) => `Mentioned in ${n} Comments` },
];

function Card({
  data,
  kind,
  unnamed,
  result,
  testId,
}: {
  data: CardData;
  kind: ReturnType<typeof recordKind>;
  unnamed: string;
  result?: boolean;
  testId: string;
}) {
  const identifier = data.identifiers[0];
  return (
    <div className={result ? s.result : s.card} data-testid={testId}>
      <div className={s.cardMain}>
        <RecordAvatar kind={kind} size={32} />
        <span className={s.cardName}>{data.name || unnamed}</span>
        {identifier && (
          <span className={s.identifier}>
            <Icon icon={kind === 'person' ? 'attrEmail' : 'attrDomain'} size={16} color="secondary" />
            <span className={s.identifierText}>{identifier}</span>
          </span>
        )}
      </div>
      <div className={s.counters}>
        {COUNTERS.map((c) => {
          const n = data.counts?.[c.key] ?? 0;
          return (
            <Tooltip key={c.key} content={c.tip(n)}>
              <span className={s.counter} tabIndex={-1}>
                <Icon icon={c.icon} size={12} />
                {n}
              </span>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
