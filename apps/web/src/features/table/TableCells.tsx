// Rows and cells of the record table (C1 README §2.4–2.5, §3.3, §5; components.md §9). A row is a 36 px absolutely
// positioned strip: the sticky record cell in flow, data cells absolutely placed at their column offsets, a filler
// under "+ Add column". The active cell, editor and peers' rings are siblings of the cell so they can grow past it.
import type { AttributeValue, ValueInput } from '@agentic-crm/contracts';
import { hueForSeed, Icon, Skeleton, Tooltip, vars } from '@agentic-crm/ui';
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import type { WorkspaceRef } from '../../data/trpc';
import { AnnotatedValue } from '../ai-attributes';
import { isAnnotated } from '../formulas';
import type { TableColumn } from './columns';
import { type CommitInput, type CommitMeta, RecordAvatar as Placeholder, useAttributeWrite } from './contracts';
import { cellKey, type Peer, usePeersAt } from './presence';
import * as s from './table.css';
import { type TableObject, useTable } from './tableContext';
import { type CellValues, cachedValues, titleText, usePathValues, useRecordValues } from './values';

export interface PlacedColumn {
  column: TableColumn;
  index: number;
  left: number;
  width: number;
}

export interface EditingState {
  row: number;
  col: number;
  initialKey?: string;
}

export interface RowProps {
  index: number;
  recordId: string | undefined;
  top: number;
  width: number;
  recordWidth: number;
  columns: PlacedColumn[];
  fillerLeft: number;
  fillerWidth: number;
  selected: boolean;
  hydrate: boolean;
  /** Column index of the active cell when it is in this row (-1 = record column). */
  activeCol: number | null;
  editing: EditingState | null;
  /** Inclusive column range of a multi-cell selection crossing this row. */
  range: [number, number] | null;
  selectionDisabled: boolean;
}

export const RecordRow = memo(function RecordRow(props: RowProps) {
  const { index, recordId, top, width, columns, selected, hydrate, activeCol, editing, range } = props;
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      className={s.row}
      data-selected={selected || undefined}
      data-record-id={recordId}
      style={{ width, transform: `translateY(${top}px)` }}
    >
      <RecordCell
        index={index}
        recordId={recordId}
        width={props.recordWidth}
        selected={selected}
        hydrate={hydrate}
        active={activeCol === -1}
        disabled={props.selectionDisabled}
      />
      {columns.map((placed) => (
        <DataCell
          key={placed.column.key}
          row={index}
          recordId={recordId}
          placed={placed}
          hydrate={hydrate}
          active={activeCol === placed.index}
          editing={editing && editing.col === placed.index ? editing : null}
          inRange={range !== null && placed.index >= range[0] && placed.index <= range[1]}
        />
      ))}
      <div className={s.fillerCell} style={{ left: props.fillerLeft, width: props.fillerWidth }} />
    </div>
  );
});

// ---- record (first) column ----------------------------------------------------------------------------------------

/** The record's placeholder avatar (the attributes feature's: person / company / standard object / cube). */
export function RecordAvatar({ object }: { object: TableObject }) {
  const kind =
    object.entityType === 'person-record'
      ? 'person'
      : object.entityType === 'company-record'
        ? 'company'
        : object.entityType === 'standard-object' && object.standardObjectType
          ? object.standardObjectType
          : 'object';
  return <Placeholder kind={kind} size={16} />;
}

interface RecordCellProps {
  index: number;
  recordId: string | undefined;
  width: number;
  selected: boolean;
  hydrate: boolean;
  active: boolean;
  disabled: boolean;
}

const RecordCell = memo(function RecordCell(props: RecordCellProps) {
  const { recordColumn } = useTable();
  if (recordColumn) return <RecordCellBody {...props} title={SLOT_TITLE} />;
  return props.hydrate ? <LiveRecordCell {...props} /> : <LiteRecordCell {...props} />;
});

/** Slot cells (list entries) resolve their own title. */
const SLOT_TITLE: CellValues = { values: [], isLoading: false, error: null };

function LiveRecordCell(props: RecordCellProps) {
  const { workspace, object, titleAttribute } = useTable();
  const title = useRecordValues(workspace, object.id, titleAttribute?.id, props.recordId, true);
  return <RecordCellBody {...props} title={title} />;
}

function LiteRecordCell(props: RecordCellProps) {
  const { workspace, object, titleAttribute } = useTable();
  const values =
    props.recordId && titleAttribute
      ? cachedValues(workspace, object.id, titleAttribute.id, props.recordId)
      : undefined;
  return <RecordCellBody {...props} title={{ values, isLoading: values === undefined, error: null }} />;
}

function RecordCellBody({
  index,
  recordId,
  width,
  selected,
  hydrate,
  active,
  disabled,
  title,
}: RecordCellProps & { title: CellValues }) {
  const { object, titleAttribute, recordHref, actions, recordColumn, onCommentRow } = useTable();
  const text = titleAttribute ? titleText(titleAttribute, title.values) : (recordId ?? '');
  const loading = !recordId || (!recordColumn && titleAttribute !== undefined && title.isLoading);
  const SlotCell = recordColumn?.Cell;
  return (
    <div
      role="gridcell"
      aria-colindex={1}
      className={s.recordCell}
      data-loading={loading || undefined}
      style={{ width, boxShadow: active ? `inset 0 0 0 1px ${vars.color.stroke.accent}` : undefined }}
      onPointerDown={(e) => actions.cellPointerDown(e, index, -1)}
      onContextMenu={(e) => actions.cellContextMenu(e, index, -1)}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={selected ? 'Deselect row' : 'Select row'}
        className={s.checkbox}
        disabled={!recordId || disabled}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => actions.toggleRow(e, index)}
      >
        {selected && <Icon icon="check" size={12} strokeWidth={3} />}
      </button>
      {loading ? (
        <Skeleton width={120} height={12} className={s.skeleton} />
      ) : (
        <>
          {SlotCell ? (
            <SlotCell rowId={recordId as string} live={hydrate} onOpen={() => actions.openRecord(recordId as string)} />
          ) : (
            <a
              href={recordHref(recordId as string)}
              className={s.recordTitle}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                e.preventDefault();
                actions.openRecord(recordId as string);
              }}
            >
              <RecordAvatar object={object} />
              <span className={s.recordTitleText}>{text || 'Unnamed'}</span>
            </a>
          )}
          <span className={s.recordActions}>
            <Tooltip content="Comment">
              <AriaButton
                className={s.recordAction}
                aria-label="Comment"
                onPress={onCommentRow ? () => onCommentRow(recordId as string) : undefined}
              >
                <Icon icon="chat" size={12} />
              </AriaButton>
            </Tooltip>
            <Tooltip content="Open preview">
              <AriaButton
                className={s.recordAction}
                aria-label="Open preview"
                onPress={() => actions.openPreview(recordId as string)}
              >
                <Icon icon="sidebarRight" size={12} />
              </AriaButton>
            </Tooltip>
          </span>
        </>
      )}
    </div>
  );
}

// ---- data cells ----------------------------------------------------------------------------------------------------

interface DataCellProps {
  row: number;
  recordId: string | undefined;
  placed: PlacedColumn;
  hydrate: boolean;
  active: boolean;
  editing: EditingState | null;
  inRange: boolean;
}

/**
 * A data cell. While the table flings (hydration off) cells are "lite": no query subscriptions, cached values or a
 * skeleton; otherwise they subscribe to their values key (single attribute) or resolve their path hop by hop.
 */
const DataCell = memo(function DataCell(props: DataCellProps) {
  if (!props.hydrate && !props.active && !props.editing) return <LiteDataCell {...props} />;
  return props.placed.column.isPath ? <PathDataCell {...props} /> : <SingleDataCell {...props} />;
});

function LiteDataCell(props: DataCellProps) {
  const { workspace, object } = useTable();
  const { column } = props.placed;
  const values =
    props.recordId && column.attribute && !column.isPath
      ? cachedValues(workspace, object.id, column.attribute.id, props.recordId)
      : undefined;
  return <CellBody {...props} cell={{ values, isLoading: values === undefined, error: null }} />;
}

function SingleDataCell(props: DataCellProps) {
  const { workspace, object } = useTable();
  const cell = useRecordValues(workspace, object.id, props.placed.column.attribute?.id, props.recordId, true);
  return <CellBody {...props} cell={cell} />;
}

function PathDataCell(props: DataCellProps) {
  const { workspace } = useTable();
  const cell = usePathValues(workspace, props.placed.column.column.path, props.recordId, true);
  return <CellBody {...props} cell={cell} />;
}

function CellBody({
  row,
  recordId,
  placed,
  active,
  editing,
  inRange,
  hydrate,
  cell,
}: DataCellProps & { cell: CellValues }) {
  const { actions, workspace } = useTable();
  const { column, index, left, width } = placed;
  const cellRef = useRef<HTMLDivElement>(null);
  const align = column.ui.align;
  // Editable path cells (list parent-record columns) write to the record that holds the values.
  const writeId = column.isPath ? cell.ownerId : recordId;
  const content = renderValues(column, cell, recordId, { live: hydrate, writeId, workspace });
  return (
    <>
      <div
        ref={cellRef}
        role="gridcell"
        aria-colindex={index + 2}
        aria-selected={active || inRange}
        className={s.cell}
        data-align={align}
        data-loading={(column.attribute && (!recordId || cell.isLoading)) || undefined}
        style={{ left, width }}
        onPointerDown={(e) => actions.cellPointerDown(e, row, index)}
        onPointerEnter={(e) => actions.cellPointerEnter(e, row, index)}
        onDoubleClick={() => actions.cellDoubleClick(row, index)}
        onContextMenu={(e) => actions.cellContextMenu(e, row, index)}
      >
        {content}
      </div>
      {inRange && !active && <div className={s.rangeOutline} style={{ left, width, top: 0, height: 36 }} />}
      {active && !editing && (
        <div
          className={s.activeBox}
          data-align={align}
          data-testid="active-cell"
          style={{ left, minWidth: width, maxWidth: Math.max(width, 350) }}
        >
          {renderValues(column, cell, recordId, { live: true, expanded: true, writeId, workspace })}
          {recordId && writeId && column.attribute && !column.readOnly && (
            <ActiveWriter recordId={recordId} writeId={writeId} column={column} />
          )}
        </div>
      )}
      {editing && recordId && writeId && column.attribute && (
        <EditorHost
          recordId={recordId}
          writeId={writeId}
          column={column}
          values={cell.values ?? []}
          initialKey={editing.initialKey}
          anchor={cellRef.current}
        />
      )}
      {hydrate && recordId && !editing && <Peers recordId={recordId} column={column} left={left} width={width} />}
    </>
  );
}

function Peers({
  recordId,
  column,
  left,
  width,
}: {
  recordId: string;
  column: TableColumn;
  left: number;
  width: number;
}) {
  const { presence } = useTable();
  const peers = usePeersAt(presence, cellKey(recordId, column.key));
  return peers.length > 0 ? <PeerDecoration peers={peers} column={column} left={left} width={width} /> : null;
}

/** In-place interactions of the cell itself (C1 README §3.3): a checkbox toggles, a star sets the rating. */
const IN_PLACE = new Set(['checkbox', 'rating']);

function renderValues(
  column: TableColumn,
  cell: CellValues,
  recordId: string | undefined,
  options: { live?: boolean; expanded?: boolean; writeId?: string; workspace: WorkspaceRef },
): ReactNode {
  const inner = renderCellValues(column, cell, recordId, options);
  // Formula / AI columns: "Calculating...", "AI is thinking...", errors (features/ai-attributes).
  if (!column.attribute || column.isPath || !isAnnotated(column.attribute) || !cell.values || cell.isLoading)
    return inner;
  return (
    <AnnotatedValue
      workspace={options.workspace}
      attribute={column.attribute}
      recordId={recordId}
      hasValue={cell.values.length > 0}
      density="cell"
      live={options.live}
    >
      {inner}
    </AnnotatedValue>
  );
}

function renderCellValues(
  column: TableColumn,
  cell: CellValues,
  recordId: string | undefined,
  options: { live?: boolean; expanded?: boolean; writeId?: string } = {},
): ReactNode {
  if (!column.attribute) return null;
  if (cell.error) {
    return (
      <div className={s.cellPad}>
        <span className={s.cellError}>
          <Icon icon="warning" size={16} />
          Unavailable
        </span>
      </div>
    );
  }
  if (!recordId || cell.isLoading || !cell.values) {
    return (
      <div className={s.cellPad}>
        <Skeleton width={78} height={12} className={s.skeleton} />
      </div>
    );
  }
  if (options.live && !column.readOnly && options.writeId && IN_PLACE.has(column.attribute.type)) {
    return (
      <InPlaceView
        column={column}
        values={cell.values}
        recordId={recordId}
        writeId={options.writeId}
        expanded={options.expanded}
      />
    );
  }
  if (cell.values.length === 0) return null;
  const { View } = column.ui;
  return (
    <View
      attribute={column.attribute}
      values={cell.values}
      density="cell"
      field={column.field}
      format={column.format}
      expanded={options.expanded}
      recordRef={{
        entityDefinitionId: column.attribute.entityDefinitionId,
        entityInstanceId: options.writeId ?? recordId,
      }}
    />
  );
}

function InPlaceView({
  column,
  values,
  recordId,
  writeId,
  expanded,
}: {
  column: TableColumn;
  values: AttributeValue[];
  recordId: string;
  writeId: string;
  expanded?: boolean;
}) {
  const { actions } = useTable();
  const attribute = column.attribute as NonNullable<TableColumn['attribute']>;
  const ref = useMemo(
    () => ({ entityDefinitionId: attribute.entityDefinitionId, entityInstanceId: writeId }),
    [attribute, writeId],
  );
  const write = useAttributeWrite(ref, attribute);
  const onCommit = useCallback(
    (next: CommitInput, meta?: CommitMeta) => {
      write(next, meta);
      actions.committed(recordId);
      actions.refocus();
    },
    [write, actions, recordId],
  );
  const { View } = column.ui;
  return (
    <View
      attribute={attribute}
      values={values}
      density="cell"
      field={column.field}
      format={column.format}
      expanded={expanded}
      recordRef={ref}
      onCommit={onCommit}
    />
  );
}

/** Registers the active cell's write function for keyboard paste / clear (useAttributeWrite is a hook). */
function ActiveWriter({ recordId, writeId, column }: { recordId: string; writeId: string; column: TableColumn }) {
  const { actions } = useTable();
  const ref = useMemo(
    () => ({ entityDefinitionId: column.attribute?.entityDefinitionId ?? '', entityInstanceId: writeId }),
    [column.attribute, writeId],
  );
  const write = useAttributeWrite(ref, column.attribute as NonNullable<TableColumn['attribute']>);
  useEffect(() => {
    actions.registerActiveWriter((next) => {
      write(next);
      actions.committed(recordId);
    });
    return () => actions.registerActiveWriter(null);
  }, [actions, write, recordId]);
  return null;
}

interface EditorHostProps {
  recordId: string;
  /** The record written (the row's record, or the parent record of an editable path cell). */
  writeId: string;
  column: TableColumn;
  values: AttributeValue[];
  initialKey?: string;
  anchor: HTMLElement | null;
}

/**
 * The cell editor. CELLS editors draw their own overlay (inline) or popover; multi-value editors write each toggle
 * at once (`liveCommit`) and report `keepOpen`, so the editor stays open until a final commit or cancel.
 */
function EditorHost({ recordId, writeId, column, values, initialKey, anchor }: EditorHostProps) {
  const { actions } = useTable();
  const attribute = column.attribute as NonNullable<TableColumn['attribute']>;
  const ref = useMemo(
    () => ({ entityDefinitionId: attribute.entityDefinitionId, entityInstanceId: writeId }),
    [attribute, writeId],
  );
  const write = useAttributeWrite(ref, attribute);
  const done = useRef(false);
  const onCommit = useCallback(
    (next: CommitInput, meta?: CommitMeta) => {
      if (done.current) return;
      if (!sameValues(next, values)) {
        write(next, meta);
        actions.committed(recordId);
      }
      if (meta?.keepOpen) return;
      done.current = true;
      actions.draftChanged(recordId, column.key, null);
      actions.editEnded('commit', meta?.via);
    },
    [write, actions, recordId, column.key, values],
  );
  const onCancel = useCallback(
    (meta?: CommitMeta) => {
      if (done.current) return;
      done.current = true;
      actions.draftChanged(recordId, column.key, null);
      actions.editEnded('cancel', meta?.via);
    },
    [actions, recordId, column.key],
  );
  const onDraftChange = useCallback(
    (draft: ValueInput[] | null) => actions.draftChanged(recordId, column.key, draft),
    [actions, recordId, column.key],
  );
  const { Editor } = column.ui;
  return (
    <Editor
      attribute={attribute}
      values={values}
      onCommit={onCommit}
      onCancel={onCancel}
      initialKey={initialKey}
      anchor={anchor}
      density="cell"
      recordRef={ref}
      field={column.field}
      format={column.format}
      onDraftChange={onDraftChange}
      liveCommit
    />
  );
}

/** Unchanged commits (Enter without typing) write nothing. */
function sameValues(next: CommitInput, current: AttributeValue[]): boolean {
  if (next.length !== current.length) return false;
  return next.every((n, i) => {
    if ('op' in n) return false;
    return JSON.stringify(n.value) === JSON.stringify(current[i]?.value);
  });
}

function PeerDecoration({
  peers,
  column,
  left,
  width,
}: {
  peers: Peer[];
  column: TableColumn;
  left: number;
  width: number;
}) {
  const peer = peers[0] as Peer;
  const color = vars.color.utilities.surface[hueForSeed(peer.userId)];
  const draftValues = peer.draft as ValueInput[] | null;
  return (
    <div
      style={{ position: 'absolute', left, width, top: 0, height: 36, zIndex: 1, pointerEvents: 'none' }}
      data-testid="peer-cell"
    >
      {draftValues && column.attribute && (
        <div className={s.peerDraft} data-align={column.ui.align} data-testid="peer-draft">
          <PeerDraftValues column={column} values={draftValues} />
        </div>
      )}
      <div className={s.peerRing} style={{ boxShadow: `inset 0 0 0 1px ${color}` }} />
      <div className={s.peerTag} style={{ backgroundColor: color }}>
        {peers.map((p) => p.name).join(', ')}
      </div>
    </div>
  );
}

function PeerDraftValues({ column, values }: { column: TableColumn; values: ValueInput[] }) {
  const attribute = column.attribute as NonNullable<TableColumn['attribute']>;
  const shaped = useMemo<AttributeValue[]>(
    () =>
      values.map((v, i) => ({
        id: `draft-${i}`,
        workspaceId: attribute.workspaceId,
        entityDefinitionId: attribute.entityDefinitionId,
        entityInstanceId: '',
        attributeDefinitionId: attribute.id,
        attributeType: attribute.type,
        value: v.value,
        activeFrom: new Date(0).toISOString(),
        activeUntil: null,
        sortOrder: null,
        createdBy: { type: 'system', id: null },
        deactivatedBy: null,
      })),
    [values, attribute],
  );
  const { View } = column.ui;
  return <View attribute={attribute} values={shaped} density="cell" />;
}
