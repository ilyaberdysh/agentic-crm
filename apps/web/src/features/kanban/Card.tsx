// A kanban card (C2 kanban.md K2 card anatomy, K5 attributes, K9 actions; BACKLOG 4.06 time-in-stage chip):
// title row (16 px record avatar — a selection checkbox on hover — record name linking to the record page, hover
// "Edit" and "Open preview"), one row per view attribute (type icon + value, or the 12 px label above it with
// "Show attribute labels"; values editable in place, path values read-only), footer counters (notes, open tasks,
// comments) and the time-in-stage chip ("Nd", red past the stage's target time). Collapsed cards show the title only.
import type { AttributeDefinition, AttributeValue, Path, ViewColumn } from '@agentic-crm/contracts';
import { Icon, Skeleton, Tooltip, useThemeClassName } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { type MouseEvent, memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { valuesQuery } from '../../data/records';
import { useEntityAccess } from '../access/useEntityAccess';
import {
  type CommitInput,
  type CommitMeta,
  getAttributeUi,
  isAttributeEditable,
  objectQuery,
  RecordAvatar,
  recordPath,
  useAttributeValues,
  useAttributeWrite,
  useRecordTitle,
} from '../attributes';
import { recordKind } from '../attributes/ui/primitives';
import { openNewNote } from '../notes/NewNote';
import { openRecordOverlay } from '../overlays';
import { openRecordPreview, sequenceFromSnapshot } from '../record/overlay/store';
import { columnDisplayFormat } from '../table/columns';
import { usePathValues } from '../table/values';
import { openCreateTask } from '../tasks/TaskDialog';
import { attributeIcon } from '../views';
import { PathLabel } from '../views/components/ViewSettingsPopover';
import { countsQuery, timeInStageQuery } from './data';
import * as s from './kanban.css';
import { type BoardStage, daysInStage, formatDaysInStage, isOverTarget, NO_STAGE } from './model';
import type { Board } from './useBoard';

export interface CardProps {
  board: Board;
  cardId: string;
  column: BoardStage;
  /** Rendered in the drag overlay (hover affordances visible, not interactive). */
  overlay?: boolean;
  collapsed: boolean;
  hideEmpty: boolean;
  onEdit?: (cardId: string) => void;
}

/** The record a card stands for: the card itself on an object board, the entry's parent record on a list board. */
export function useCardRecord(
  board: Board,
  cardId: string,
): { entityDefinitionId: string; entityInstanceId: string } | null {
  const parent = board.parentAttribute;
  const q = useQuery({
    ...valuesQuery({
      workspace: board.workspace,
      entityDefinitionId: board.definition.id,
      attributeDefinitionId: parent?.id ?? '',
      entityInstanceId: cardId,
    }),
    enabled: Boolean(parent),
  });
  if (!parent) return { entityDefinitionId: board.definition.id, entityInstanceId: cardId };
  const ref = (q.data?.values as AttributeValue[] | undefined)?.find((v) => !v.activeUntil)?.value as
    | { entityDefinitionId?: string; entityInstanceId?: string }
    | undefined;
  return ref?.entityInstanceId && ref.entityDefinitionId
    ? { entityDefinitionId: ref.entityDefinitionId, entityInstanceId: ref.entityInstanceId }
    : null;
}

/** Current value of the grouping attribute (on the card, or its parent record for `[parent_record, stage]`). */
function useStageValue(board: Board, cardId: string): AttributeValue | null | undefined {
  const path = board.groupBy ?? ([] as Path);
  const cell = usePathValues(board.workspace, path, cardId, path.length > 0);
  if (path.length === 0 || cell.isLoading || !cell.values) return undefined;
  return cell.values.find((v) => !v.activeUntil) ?? null;
}

function stageKeyOf(value: AttributeValue | null): string {
  if (!value) return NO_STAGE;
  const v = value.value as { pipelineStageId?: string; selectOptionId?: string } | null;
  return v?.pipelineStageId ?? v?.selectOptionId ?? NO_STAGE;
}

export const Card = memo(function Card({ board, cardId, column, overlay, collapsed, hideEmpty, onEdit }: CardProps) {
  const record = useCardRecord(board, cardId);
  const definitionQ = useQuery({
    ...objectQuery(board.workspace, record?.entityDefinitionId ?? ''),
    enabled: Boolean(record && record.entityDefinitionId !== board.definition.id),
  });
  const recordDefinition =
    record?.entityDefinitionId === board.definition.id ? board.definition : (definitionQ.data ?? undefined);
  const title = useRecordTitle(record?.entityDefinitionId ?? '', record?.entityInstanceId ?? '');
  const router = useRouter();
  const selected = board.selection.has(cardId);
  const stageValue = useStageValue(board, cardId);
  const pending = board.pendingCards.has(cardId);

  // Realtime safety net: the card's stage changed elsewhere (another user, a 2-hop parent edit).
  useEffect(() => {
    if (overlay || pending || stageValue === undefined) return;
    if (stageKeyOf(stageValue) !== column.key) board.reportStale(cardId, stageValue?.id ?? 'none');
  }, [overlay, pending, stageValue, column.key, board, cardId]);

  const href =
    record && recordDefinition
      ? recordPath(board.workspace.slug, recordDefinition as never, record.entityInstanceId)
      : null;
  const columnIds = board.data[column.key]?.ids ?? [];

  const openRecord = useCallback(() => {
    if (!record) return;
    const parentOf = (id: string) => ({ entityDefinitionId: record.entityDefinitionId, entityInstanceId: id });
    openRecordOverlay(record, {
      list:
        board.parentAttribute === undefined
          ? { label: board.view.title, records: columnIds.map(parentOf) }
          : { label: board.view.title, records: [record] },
    });
  }, [record, board.parentAttribute, board.view.title, columnIds]);

  const openPreview = () => {
    if (!record || !recordDefinition) return;
    openRecordPreview({
      object: {
        id: recordDefinition.id,
        apiSlug: recordDefinition.apiSlug,
        entityType: recordDefinition.entityType,
        singularNoun: recordDefinition.singularNoun,
        pluralNoun: recordDefinition.pluralNoun,
      },
      recordId: record.entityInstanceId,
      sequence: sequenceFromSnapshot(
        board.parentAttribute ? [record.entityInstanceId] : columnIds,
        board.parentAttribute ? 1 : columnIds.length,
        board.view.title,
        `${window.location.pathname}${window.location.search}`,
      ),
    });
  };

  const onCardClick = (e: MouseEvent) => {
    if (overlay || e.defaultPrevented) return;
    if ((e.target as HTMLElement).closest('a, button, [role="button"], [data-card-field]')) return;
    openRecord();
  };

  const text = title.title || record?.entityInstanceId || '';
  // Cards are raised surfaces: #17181a on the #0b0c0d dark column (measured), white in light.
  const elevated = useThemeClassName({ surfaceMode: 'elevated' });
  return (
    <div
      className={`${elevated} ${s.card}${overlay ? ` ${s.cardOverlay}` : ''}`}
      data-card-id={cardId}
      data-testid="kanban-card"
      data-selected={selected || undefined}
      data-overlay={overlay || undefined}
      onClick={onCardClick}
    >
      <div className={s.titleRow}>
        <span className={s.avatarSlot}>
          <span className={s.avatarWhenIdle}>
            <RecordAvatar kind={recordKind(recordDefinition as never)} size={16} />
          </span>
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={selected ? 'Deselect card' : 'Select card'}
            className={s.cardCheckbox}
            tabIndex={overlay ? -1 : 0}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              board.toggleSelected(cardId, column.key, e.shiftKey);
            }}
          >
            {selected && <Icon icon="check" size={12} strokeWidth={3} />}
          </button>
        </span>
        {title.isLoading && !text ? (
          <Skeleton width={140} height={12} />
        ) : (
          <a
            href={href ?? undefined}
            className={s.cardTitle}
            data-testid="kanban-card-title"
            tabIndex={overlay ? -1 : 0}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || !href) return;
              e.preventDefault();
              void router.navigate({ href });
            }}
          >
            {text}
          </a>
        )}
        <span className={s.titleActions}>
          <Tooltip content={board.parentAttribute ? 'Edit entry' : 'Edit record'}>
            <AriaButton
              className={s.iconAction}
              aria-label={board.parentAttribute ? 'Edit entry' : 'Edit record'}
              excludeFromTabOrder={overlay}
              onPress={() => onEdit?.(cardId)}
            >
              <Icon icon="edit" size={14} />
            </AriaButton>
          </Tooltip>
          <Tooltip content="Open preview">
            <AriaButton
              className={s.iconAction}
              aria-label="Open preview"
              excludeFromTabOrder={overlay}
              onPress={openPreview}
            >
              <Icon icon="sidebarRight" size={14} />
            </AriaButton>
          </Tooltip>
        </span>
      </div>
      {!collapsed && (
        <>
          <CardFields board={board} cardId={cardId} hideEmpty={hideEmpty} readOnly={Boolean(overlay)} />
          <CardFooter
            board={board}
            cardId={cardId}
            record={record}
            stageValue={stageValue}
            stage={column}
            onOpenRecord={openRecord}
          />
        </>
      )}
    </div>
  );
});

// ---- attribute rows (K5) ------------------------------------------------------------------------------------------------

function CardFields({
  board,
  cardId,
  hideEmpty,
  readOnly,
}: {
  board: Board;
  cardId: string;
  hideEmpty: boolean;
  readOnly: boolean;
}) {
  const columns = board.draft.columns;
  if (columns.length === 0) return null;
  return (
    <div className={s.fields}>
      {columns.map((column) => (
        <CardField
          key={column.id}
          board={board}
          column={column}
          cardId={cardId}
          hideEmpty={hideEmpty}
          readOnly={readOnly}
        />
      ))}
    </div>
  );
}

function CardField({
  board,
  column,
  cardId,
  hideEmpty,
  readOnly,
}: {
  board: Board;
  column: ViewColumn;
  cardId: string;
  hideEmpty: boolean;
  readOnly: boolean;
}) {
  const attribute = board.schema?.leaf(column.path);
  if (!attribute || attribute.isArchived) return null;
  return column.path.length === 1 ? (
    <SingleField
      board={board}
      column={column}
      attribute={attribute}
      cardId={cardId}
      hideEmpty={hideEmpty}
      readOnly={readOnly}
    />
  ) : (
    <PathField board={board} column={column} attribute={attribute} cardId={cardId} hideEmpty={hideEmpty} />
  );
}

interface FieldProps {
  board: Board;
  column: ViewColumn;
  attribute: AttributeDefinition;
  cardId: string;
  hideEmpty: boolean;
}

function FieldRow({
  board,
  column,
  attribute,
  children,
}: {
  board: Board;
  column: ViewColumn;
  attribute: AttributeDefinition;
  children: ReactNode;
}) {
  const parts = column.title
    ? [column.title]
    : (board.schema?.pathParts(column.path, column.field) ?? [attribute.title]);
  if (board.config.showLabels) {
    return (
      <div className={`${s.fieldRow} ${s.fieldRowLabelled}`} data-testid="kanban-card-field">
        <span className={s.fieldLabel}>
          <PathLabel parts={parts} />
        </span>
        {children}
      </div>
    );
  }
  return (
    <div className={s.fieldRow} data-testid="kanban-card-field">
      <Tooltip content={parts.join(' › ')}>
        <span className={s.fieldIcon} style={{ display: 'inline-flex' }}>
          <Icon icon={attributeIcon(attribute)} size={16} />
        </span>
      </Tooltip>
      {children}
    </div>
  );
}

const IN_PLACE = new Set(['checkbox', 'rating']);

function SingleField({ board, column, attribute, cardId, hideEmpty, readOnly }: FieldProps & { readOnly: boolean }) {
  const recordRef = useMemo(
    () => ({ workspace: board.workspace, entityDefinitionId: attribute.entityDefinitionId, entityInstanceId: cardId }),
    [board.workspace, attribute.entityDefinitionId, cardId],
  );
  const { values, isLoading } = useAttributeValues(recordRef, attribute);
  const write = useAttributeWrite(recordRef, attribute);
  const [editing, setEditing] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const ui = getAttributeUi(attribute.type);
  const access = useEntityAccess(attribute.entityDefinitionId);
  const editable = !readOnly && access.canEditValues && isAttributeEditable(attribute);
  const inPlace = IN_PLACE.has(attribute.type);
  const format = useMemo(() => columnDisplayFormat(column.displayConfiguration), [column.displayConfiguration]);
  const commit = useCallback(
    (next: CommitInput, meta?: CommitMeta) => {
      write(next, meta);
      if (!meta?.keepOpen) setEditing(false);
    },
    [write],
  );
  const empty = !isLoading && values.length === 0;
  if (empty && hideEmpty && !editing) return null;
  const { View, Editor } = ui;
  return (
    <FieldRow board={board} column={column} attribute={attribute}>
      <div
        ref={anchor}
        className={s.fieldValue}
        data-card-field=""
        data-editable={(editable && !inPlace) || undefined}
        role={editable && !inPlace ? 'button' : undefined}
        tabIndex={editable && !inPlace ? 0 : undefined}
        aria-label={editable && !inPlace ? `Edit ${attribute.title}` : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if ((e.target as HTMLElement).closest('a')) return;
          if (editable && !inPlace) setEditing(true);
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if ((e.key === 'Enter' || e.key === ' ') && editable && !inPlace) {
            e.preventDefault();
            e.stopPropagation();
            setEditing(true);
          }
        }}
      >
        {isLoading ? (
          <Skeleton width={90} height={12} />
        ) : empty && !inPlace ? (
          <span className={s.fieldEmpty}>{board.config.showLabels ? 'Empty' : attribute.title}</span>
        ) : (
          <View
            attribute={attribute}
            values={values}
            density="chip"
            field={column.field}
            format={format}
            recordRef={recordRef}
            onCommit={inPlace && editable ? (next, meta) => commit(next, { ...meta, keepOpen: true }) : undefined}
          />
        )}
      </div>
      {editing && anchor.current && (
        <Editor
          attribute={attribute}
          values={values}
          anchor={anchor.current}
          density="field"
          recordRef={recordRef}
          field={column.field}
          format={format}
          onCommit={commit}
          onCancel={() => setEditing(false)}
          liveCommit
        />
      )}
    </FieldRow>
  );
}

function PathField({ board, column, attribute, cardId, hideEmpty }: FieldProps) {
  const cell = usePathValues(board.workspace, column.path, cardId, true);
  const format = useMemo(() => columnDisplayFormat(column.displayConfiguration), [column.displayConfiguration]);
  const values = useMemo(() => (cell.values ?? []).filter((v) => !v.activeUntil), [cell.values]);
  const empty = !cell.isLoading && values.length === 0;
  if (empty && hideEmpty) return null;
  const { View } = getAttributeUi(attribute.type);
  return (
    <FieldRow board={board} column={column} attribute={attribute}>
      <div className={s.fieldValue} data-card-field="">
        {cell.isLoading ? (
          <Skeleton width={90} height={12} />
        ) : empty ? (
          <span className={s.fieldEmpty}>{board.config.showLabels ? 'Empty' : attribute.title}</span>
        ) : (
          <View attribute={attribute} values={values} density="chip" field={column.field} format={format} />
        )}
      </div>
    </FieldRow>
  );
}

// ---- footer (K2) -------------------------------------------------------------------------------------------------------

function CardFooter({
  board,
  cardId,
  record,
  stageValue,
  stage,
  onOpenRecord,
}: {
  board: Board;
  cardId: string;
  record: { entityDefinitionId: string; entityInstanceId: string } | null;
  stageValue: AttributeValue | null | undefined;
  stage: BoardStage;
  onOpenRecord: () => void;
}) {
  const recordCounts = useQuery({
    ...countsQuery({
      workspace: board.workspace,
      entityDefinitionId: record?.entityDefinitionId ?? '',
      entityInstanceId: record?.entityInstanceId ?? '',
    }),
    enabled: Boolean(record),
  });
  // Comments of an entry are the entry's own (K2); notes and tasks belong to the parent record.
  const entryCounts = useQuery({
    ...countsQuery({ workspace: board.workspace, entityDefinitionId: board.definition.id, entityInstanceId: cardId }),
    enabled: Boolean(board.parentAttribute),
  });
  const notes = recordCounts.data?.notes ?? 0;
  const tasks = recordCounts.data?.openTasks ?? 0;
  const comments = (board.parentAttribute ? entryCounts.data?.comments : recordCounts.data?.comments) ?? 0;
  return (
    <div className={s.cardFooter}>
      <Counter
        icon="noteTab"
        count={notes}
        label={notes > 0 ? 'View notes' : 'Create note'}
        onPress={() => (notes > 0 || !record ? onOpenRecord() : openNewNote({ record }))}
      />
      <Counter
        icon="tasks"
        count={tasks}
        label={tasks > 0 ? 'View tasks' : 'Create task'}
        onPress={() => (tasks > 0 || !record ? onOpenRecord() : openCreateTask({ records: [record] }))}
      />
      <Counter icon="comments" count={comments} label="Comments" onPress={onOpenRecord} />
      {board.showTimeInStage && <TimeInStage board={board} cardId={cardId} value={stageValue} stage={stage} />}
    </div>
  );
}

function Counter({
  icon,
  count,
  label,
  onPress,
}: {
  icon: 'noteTab' | 'tasks' | 'comments';
  count: number;
  label: string;
  onPress: () => void;
}) {
  return (
    <Tooltip content={label}>
      <AriaButton className={s.counter} aria-label={label} onPress={onPress}>
        <Icon icon={icon} size={14} className={s.counterIcon} />
        {count > 0 && <span>{count}</span>}
      </AriaButton>
    </Tooltip>
  );
}

/**
 * "0d" since the current stage value became active; red once over the stage's target time (C2 README §4). Days and
 * overdue come from `kanban.timeInStage` (value history); a just-moved card (optimistic value) shows its own value's
 * start until the server answers.
 */
function TimeInStage({
  board,
  cardId,
  value,
  stage,
}: {
  board: Board;
  cardId: string;
  value: AttributeValue | null | undefined;
  stage: BoardStage;
}) {
  const live = Boolean(value && board.groupBy && !value.id.startsWith('optimistic:') && stage.key !== NO_STAGE);
  const server = useQuery({
    ...timeInStageQuery({
      workspace: board.workspace,
      entityDefinitionId: board.definition.id,
      groupBy: board.groupBy ?? [],
      cardId,
      valueId: value?.id ?? '',
    }),
    enabled: live,
  });
  if (value === undefined || value === null || stage.key === NO_STAGE) {
    return value === undefined ? <span className={s.timeChip} /> : null;
  }
  const fromServer = live && server.data && server.data.stageId === stage.key ? server.data : null;
  const days = fromServer?.days ?? daysInStage(value.activeFrom);
  const over = fromServer ? fromServer.isOverdue : isOverTarget(value.activeFrom, stage.targetTimeInStatus);
  return (
    <Tooltip content={over ? 'Over the target time in this stage' : 'Time in stage'}>
      <span className={s.timeChip} data-over={over || undefined} data-testid="time-in-stage">
        <Icon icon="clock" size={14} />
        {formatDaysInStage(days)}
      </span>
    </Tooltip>
  );
}
