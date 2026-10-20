// Record table: virtualised rows, selection, column operations and keyboard navigation.
// Renders an object's rows for a view draft: `snapshots.query` (first 1000 ids, total) + `snapshots.chunk` while
// scrolling (SnapshotController), rows virtualised with TanStack Virtual (36 px), columns virtualised by offset
// (+2 overscan), cells hydrated per visible column through the batching loaders and drawn by the C1 registry,
// footer calculations over the snapshot, zebra row selection with the bulk bar, the keyboard/clipboard model and
// the view presence room (peers' active cells and live drafts).
import type { AttributeDefinition, Path } from '@agentic-crm/contracts';
import { zebraSize } from '@agentic-crm/contracts';
import { Button, ContextMenu, ErrorState, Icon, MenuItem, MenuSeparator, toast } from '@agentic-crm/ui';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { keys } from '../../data/keys';
import { valuesQuery } from '../../data/records';
import { api, errorEnvelopeOf, inWorkspace } from '../../data/trpc';
import { useEntityAccess } from '../access/useEntityAccess';
import { useAiRunDialog } from '../ai-attributes';
import { useFocusedRecordContext } from '../command-palette/focusedRecord';
import { openRecordOverlay } from '../overlays';
import { openRecordPreview, sequenceFromSnapshot } from '../record/overlay/store';
import { useWorkspace } from '../shell/workspaceContext';
import { RunWorkflowDialog, type RunWorkflowTarget } from '../workflows/run-dialog/RunWorkflowDialog';
import type { ColumnAggregation } from './aggregations';
import { BulkBar, deleteSelection } from './BulkBar';
import { cellsCopiedLabel, firstClipboardCell, toHtmlTable, toTsv } from './clipboard';
import {
  ADD_COLUMN_MIN_WIDTH,
  type AttributeIndex,
  buildColumns,
  clampRecordWidth,
  FOOTER_HEIGHT,
  HEADER_HEIGHT,
  RECORD_COLUMN,
  ROW_HEIGHT,
  type TableColumn,
} from './columns';
import { AddColumnPicker, type CommitInput, type ViewDraft } from './contracts';
import { attributesQuery, fetchChunk, resolveSelection, snapshotQuery, useAttributes } from './data';
import { exportCsv } from './exportCsv';
import { type CellPos, gridAction } from './keyboard';
import type { ViewPresence } from './presence';
import { emptySelection, headerState, isSelected, selectedCount, selectionReducer } from './selection';
import { SnapshotController } from './snapshot';
import { type EditingState, type PlacedColumn, RecordRow } from './TableCells';
import { TableFooter } from './TableFooter';
import { TableHeader } from './TableHeader';
import * as s from './table.css';
import {
  type RecordColumnSlot,
  type TableActions,
  TableContext,
  type TableContextValue,
  type TableObject,
} from './tableContext';
import { cachedValues, titleAttributeOf, titleText } from './values';

export interface RecordTableObject extends TableObject {
  epithetPath?: Path | null;
}

export interface RecordTableHandle {
  /** "Export view as CSV": every row of the shown snapshot. */
  exportView(): void;
  /** Applies the newest snapshot (after creating a record from the toolbar). */
  refresh(): void;
}

export interface RecordTableProps {
  object: RecordTableObject;
  draft: ViewDraft;
  presence?: ViewPresence;
  onNewRecord?: () => void;
  onClearFilter?: () => void;
  /** Header menu / view settings "Edit attribute" and the column picker's "+ Create new attribute". */
  onEditAttribute?: (attribute: AttributeDefinition) => void;
  onCreateAttribute?: () => void;
  ref?: Ref<RecordTableHandle>;

  // ---- list tables (features/lists): rows are entries of a list ----------------------------------------
  /** The record column shows something else than `object`'s title (each entry's parent record). */
  recordColumn?: RecordColumnSlot;
  /** Path columns through this attribute (the entry's `parent_record`) are editable on the referenced record. */
  editablePathHead?: string;
  /** Replaces the record overlay / preview of a row (list entries open their parent record). */
  onOpenRow?: (rowId: string, rowIds: string[]) => void;
  onPreviewRow?: (rowId: string, rowIds: string[]) => void;
  /** The record cell's "Comment" action. */
  onCommentRow?: (rowId: string) => void;
  /** Shown instead of "No records yet" when the unfiltered view is empty. */
  emptyState?: ReactNode;
  /** Bulk bar "Add to list" (`clear` clears the selection once done). Without it the action is a placeholder. */
  onBulkAddToList?: (rowIds: string[], clear: () => void) => void;
  /** Bulk bar "Send email" (a mass-send draft to the selected rows; `clear` clears the selection). */
  onBulkSendEmail?: (rowIds: string[], clear: () => void) => void;
  /** Replaces "Delete records" in the bulk bar's More menu (list tables: "Remove from list"). */
  bulkRemove?: { label: (count: number) => string; onRemove: (rowIds: string[], clear: () => void) => void };
  /** The snapshot the table shows (list Comments panel: comments on the entries of the current view). */
  onSnapshot?: (snapshotId: string | null) => void;
}

const COLUMN_OVERSCAN = 2;
const PREFETCH_BLOCK = 50;
const FAST_SCROLL_PX_PER_MS = 4;
const isApple = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

type ContextMenuState = { x: number; y: number; range: boolean } | null;

export function RecordTable({
  object,
  draft,
  presence,
  onNewRecord,
  onClearFilter,
  onEditAttribute,
  onCreateAttribute,
  ref,
  recordColumn,
  editablePathHead,
  onOpenRow,
  onPreviewRow,
  onCommentRow,
  emptyState,
  onBulkAddToList,
  onBulkSendEmail,
  bulkRemove,
  onSnapshot,
}: RecordTableProps) {
  const { workspace, href } = useWorkspace();
  const queryClient = useQueryClient();
  const access = useEntityAccess(object.id);

  // ---- attributes and columns ---------------------------------------------------------------------------------------
  const attributesQ = useAttributes(workspace, object.id);
  const relatedDefs = useMemo(() => {
    const ids = new Set<string>();
    for (const c of draft.columns) for (const hop of c.path.slice(1)) ids.add(hop.entityDefinitionId);
    ids.delete(object.id);
    return [...ids].sort();
  }, [draft.columns, object.id]);
  const relatedQ = useQueries({ queries: relatedDefs.map((id) => attributesQuery(workspace, id)) });
  const relatedKey = relatedQ.map((q) => q.dataUpdatedAt).join(',');
  const attrIndex = useMemo<AttributeIndex>(() => {
    const index: AttributeIndex = new Map();
    for (const a of attributesQ.data ?? []) index.set(a.id, a);
    for (const q of relatedQ) for (const a of q.data ?? []) index.set(a.id, a);
    return index;
  }, [attributesQ.data, relatedKey]);
  const attributes = useMemo(() => (attributesQ.data ?? []).filter((a) => !a.isArchived), [attributesQ.data]);
  const titleAttribute = useMemo(() => titleAttributeOf(object, attributes), [object, attributes]);

  // Column edits are optimistic in the draft (`draft.columns`); only a resize in progress is local.
  const [widthOverride, setWidthOverride] = useState<Record<string, number>>({});
  const schema = draft.schema;
  const pathLabel = useCallback((path: Path, field: string | null) => schema?.pathLabel(path, field) ?? '', [schema]);
  const canEditValues = access.canEditValues;
  const columns = useMemo(
    () =>
      buildColumns(draft.columns, attrIndex, pathLabel, editablePathHead).map((c) => {
        // Read only access (BACKLOG 6.04): no cell editors; the header keeps no "not editable" mark for it.
        const locked = canEditValues || c.readOnly ? c : { ...c, readOnly: true, policyLocked: true };
        return widthOverride[c.key] !== undefined ? { ...locked, width: widthOverride[c.key] as number } : locked;
      }),
    [draft.columns, attrIndex, pathLabel, widthOverride, editablePathHead, canEditValues],
  );
  const recordWidth =
    widthOverride.__record ?? clampRecordWidth(draft.view.tableRecordColumnWidth ?? RECORD_COLUMN.default);
  const lefts = useMemo(() => {
    const out: number[] = [];
    let x = recordWidth;
    for (const c of columns) {
      out.push(x);
      x += c.width;
    }
    out.push(x);
    return out;
  }, [columns, recordWidth]);
  const columnsEnd = lefts[lefts.length - 1] as number;

  // ---- snapshot -------------------------------------------------------------------------------------------------------
  const paramsKey = `${draft.view.id}|${draft.queryKey}`;
  const snapshotQ = useQuery(snapshotQuery(workspace, draft.query, paramsKey));
  const controller = useMemo(
    () =>
      new SnapshotController(
        (snapshotId, start) => fetchChunk(workspace, object.id, snapshotId, start),
        () => void queryClient.invalidateQueries({ queryKey: ['ws', workspace.id, 'snapshot', object.id] }),
      ),
    [workspace, object.id, queryClient],
  );
  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => {
    if (snapshotQ.data) controller.offer(snapshotQ.data, paramsKey);
  }, [controller, snapshotQ.data, paramsKey]);
  const snapshotVersion = useSyncExternalStore(controller.subscribe, controller.getVersion, controller.getVersion);
  const shown = controller.current;
  const total = shown?.total ?? 0;
  const shownSnapshotId = shown?.snapshotId ?? null;
  useEffect(() => onSnapshot?.(shownSnapshotId), [onSnapshot, shownSnapshotId]);

  // ---- selection / active cell / editing -----------------------------------------------------------------------------
  const [selection, dispatchSelection] = useReducer(selectionReducer, emptySelection);
  const hasSelection = selection.edges.length > 0;
  useEffect(() => controller.setSelectionHold(hasSelection), [controller, hasSelection]);
  const [active, setActive] = useState<CellPos | null>(null);
  const [rangeEnd, setRangeEnd] = useState<CellPos | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [menu, setMenu] = useState<ContextMenuState>(null);
  const [runTarget, setRunTarget] = useState<RunWorkflowTarget | null>(null);
  const aiRun = useAiRunDialog(workspace);
  const activeWriter = useRef<((next: CommitInput) => void) | null>(null);
  const dragging = useRef(false);

  // Keep the active cell inside the grid when rows/columns go away.
  useEffect(() => {
    if (!active) return;
    if (total === 0) setActive(null);
    else if (active.row >= total || active.col >= columns.length)
      setActive({ row: Math.min(active.row, total - 1), col: Math.min(active.col, columns.length - 1) });
  }, [active, total, columns.length]);

  // ---- virtualisation ----------------------------------------------------------------------------------------------------
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [hRange, setHRange] = useState<[number, number]>([0, -1]);
  const [fast, setFast] = useState(false);
  const scrollState = useRef({ top: 0, at: 0, fastTimer: 0 as unknown as ReturnType<typeof setTimeout> });

  const rowVirtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    scrollMargin: HEADER_HEIGHT,
    scrollPaddingStart: HEADER_HEIGHT,
    scrollPaddingEnd: FOOTER_HEIGHT,
    useFlushSync: false,
  });

  const computeHRange = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const left = el.scrollLeft;
    const right = left + el.clientWidth;
    let start = 0;
    while (start < columns.length && (lefts[start + 1] as number) <= left + recordWidth) start++;
    let end = start;
    while (end < columns.length && (lefts[end] as number) < right) end++;
    const next: [number, number] = [
      Math.max(0, start - COLUMN_OVERSCAN),
      Math.min(columns.length - 1, end - 1 + COLUMN_OVERSCAN),
    ];
    setHRange((prev) => (prev[0] === next[0] && prev[1] === next[1] ? prev : next));
    if (left > 0) el.setAttribute('data-scrolled-x', '');
    else el.removeAttribute('data-scrolled-x');
  }, [columns.length, lefts, recordWidth]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => {
      setViewport((v) =>
        v.width === el.clientWidth && v.height === el.clientHeight
          ? v
          : { width: el.clientWidth, height: el.clientHeight },
      );
      computeHRange();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [computeHRange]);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    computeHRange();
    // Fast flings skip hydration of rows that fly by (they render skeletons until the scroll slows down).
    const st = scrollState.current;
    const now = performance.now();
    const speed = Math.abs(el.scrollTop - st.top) / Math.max(1, now - st.at);
    st.top = el.scrollTop;
    st.at = now;
    if (speed > FAST_SCROLL_PX_PER_MS) {
      setFast(true);
      clearTimeout(st.fastTimer);
      st.fastTimer = setTimeout(() => setFast(false), 120);
    }
  }, [computeHRange]);

  const virtualRows = rowVirtualizer.getVirtualItems();
  const firstRow = virtualRows[0]?.index ?? 0;
  const lastRow = virtualRows[virtualRows.length - 1]?.index ?? -1;
  useEffect(() => controller.setVisible(firstRow, lastRow), [controller, firstRow, lastRow]);

  const totalWidth = Math.max(columnsEnd + ADD_COLUMN_MIN_WIDTH, viewport.width);
  const fillerLeft = columnsEnd;
  const fillerWidth = totalWidth - columnsEnd;
  // A view without columns: rows and footer end at the record column.
  const rowFillerWidth = columns.length === 0 ? 0 : fillerWidth;
  const placed = useMemo<PlacedColumn[]>(() => {
    const out: PlacedColumn[] = [];
    for (let i = hRange[0]; i <= hRange[1] && i < columns.length; i++) {
      const column = columns[i] as TableColumn;
      out.push({ column, index: i, left: lefts[i] as number, width: column.width });
    }
    return out;
  }, [hRange, columns, lefts]);
  // Columns appear/disappear: recompute the visible range.
  useLayoutEffect(() => computeHRange(), [computeHRange]);

  // Hydrate in blocks of 50 rows per visible column (one batched values.list each) slightly ahead of the viewport,
  // instead of one small batch per frame of newly visible rows.
  const prefetched = useRef(new Set<string>());
  useEffect(() => {
    void snapshotVersion;
    if (fast || !shown || lastRow < 0) return;
    const attrIds = [
      titleAttribute?.id,
      ...placed.filter((p) => p.column.attribute && !p.column.isPath).map((p) => p.column.attribute?.id),
    ].filter((id): id is string => Boolean(id));
    if (prefetched.current.size > 20_000) prefetched.current.clear();
    const last = Math.min(shown.total - 1, lastRow + PREFETCH_BLOCK / 2);
    for (let b = Math.floor(firstRow / PREFETCH_BLOCK); b <= Math.floor(last / PREFETCH_BLOCK); b++) {
      const ids = shown.ids.slice(b * PREFETCH_BLOCK, (b + 1) * PREFETCH_BLOCK);
      if (ids.length < Math.min(PREFETCH_BLOCK, shown.total - b * PREFETCH_BLOCK) || ids.some((id) => !id)) continue;
      for (const attr of attrIds) {
        const key = `${shown.snapshotId}:${b}:${attr}`;
        if (prefetched.current.has(key)) continue;
        prefetched.current.add(key);
        for (const id of ids) {
          void queryClient.prefetchQuery(
            valuesQuery({
              workspace,
              entityDefinitionId: object.id,
              attributeDefinitionId: attr,
              entityInstanceId: id as string,
            }),
          );
        }
      }
    }
  }, [snapshotVersion, fast, shown, firstRow, lastRow, placed, titleAttribute, queryClient, workspace, object.id]);

  // ---- helpers ---------------------------------------------------------------------------------------------------------
  const recordHref = useCallback(
    (recordId: string) => {
      if (object.entityType === 'company-record') return href(`company/${recordId}`);
      if (object.entityType === 'person-record') return href(`person/${recordId}`);
      if (object.entityType === 'custom-record') return href(`custom/${object.apiSlug}/record/${recordId}`);
      return href(`${object.apiSlug}/record/${recordId}`);
    },
    [href, object.entityType, object.apiSlug],
  );

  const focusGrid = useCallback(() => scrollerRef.current?.focus({ preventScroll: true }), []);

  const scrollCellIntoView = useCallback(
    (pos: CellPos) => {
      rowVirtualizer.scrollToIndex(pos.row, { align: 'auto' });
      const el = scrollerRef.current;
      if (!el || pos.col < 0) return;
      const left = lefts[pos.col] as number;
      const right = lefts[pos.col + 1] as number;
      if (left < el.scrollLeft + recordWidth) el.scrollLeft = left - recordWidth;
      else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth;
    },
    [rowVirtualizer, lefts, recordWidth],
  );

  const moveTo = useCallback(
    (pos: CellPos) => {
      setActive(pos);
      setRangeEnd(null);
      scrollCellIntoView(pos);
    },
    [scrollCellIntoView],
  );

  const canEdit = useCallback(
    (pos: CellPos | null) => {
      if (!pos || pos.col < 0) return false;
      const column = columns[pos.col];
      return Boolean(column && !column.readOnly && controller.idAt(pos.row));
    },
    [columns, controller],
  );

  const startEditing = useCallback(
    (pos: CellPos, initialKey?: string) => {
      if (!canEdit(pos)) return false;
      scrollCellIntoView(pos);
      setActive(pos);
      setRangeEnd(null);
      setEditing({ row: pos.row, col: pos.col, ...(initialKey ? { initialKey } : {}) });
      return true;
    },
    [canEdit, scrollCellIntoView],
  );

  // ---- presence ----------------------------------------------------------------------------------------------------------
  const activeRecordId = active ? controller.idAt(active.row) : undefined;
  const activeColumnKey = active ? (active.col < 0 ? 'record' : columns[active.col]?.key) : undefined;
  useEffect(() => {
    if (!presence) return;
    presence.setActiveCell(
      activeRecordId && activeColumnKey ? { recordId: activeRecordId, columnKey: activeColumnKey } : null,
    );
  }, [presence, activeRecordId, activeColumnKey]);
  useEffect(() => () => presence?.setActiveCell(null), [presence]);
  // Palette: the focused row's record actions (⌘); list tables show entries, whose parents have their own pages.
  useFocusedRecordContext(recordColumn ? null : object, recordColumn ? null : activeRecordId);

  // ---- actions for rows/cells (stable through a ref) ---------------------------------------------------------------------
  const viewTitle = draft.view.title;
  const live = useRef({
    active,
    editing,
    rangeEnd,
    columns,
    total,
    canEdit,
    startEditing,
    presence,
    viewTitle,
    object,
    onOpenRow,
    onPreviewRow,
  });
  live.current = {
    active,
    editing,
    rangeEnd,
    columns,
    total,
    canEdit,
    startEditing,
    presence,
    viewTitle,
    object,
    onOpenRow,
    onPreviewRow,
  };

  const actions = useMemo<TableActions>(
    () => ({
      cellPointerDown(event: PointerEvent, row: number, col: number) {
        if (event.button !== 0) return;
        const l = live.current;
        if (l.editing && l.editing.row === row && l.editing.col === col) return;
        event.preventDefault();
        focusGrid();
        if (event.shiftKey && l.active) {
          setRangeEnd({ row, col });
          return;
        }
        const same = l.active && l.active.row === row && l.active.col === col && !l.rangeEnd;
        if (same && !l.editing && l.canEdit({ row, col })) {
          l.startEditing({ row, col });
          return;
        }
        setActive({ row, col });
        setRangeEnd(null);
        dragging.current = true;
        const up = () => {
          dragging.current = false;
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointerup', up);
      },
      cellPointerEnter(_event: PointerEvent, row: number, col: number) {
        if (!dragging.current) return;
        const a = live.current.active;
        if (a && (a.row !== row || a.col !== col)) setRangeEnd({ row, col });
      },
      cellDoubleClick(row: number, col: number) {
        live.current.startEditing({ row, col });
      },
      cellContextMenu(event: MouseEvent, row: number, col: number) {
        event.preventDefault();
        const l = live.current;
        const inRange = l.active && l.rangeEnd && withinRange({ row, col }, l.active, l.rangeEnd);
        if (!inRange) {
          setActive({ row, col });
          setRangeEnd(null);
        }
        focusGrid();
        setMenu({ x: event.clientX, y: event.clientY, range: Boolean(inRange) });
      },
      toggleRow(event: MouseEvent, row: number) {
        event.stopPropagation();
        dispatchSelection(event.shiftKey ? { type: 'range', index: row } : { type: 'toggle', index: row });
      },
      openRecord(recordId: string) {
        // The record opens in the record overlay (features/overlays) with the view's order for
        // J / K and "1 of N in {view}".
        const ids = (controller.current?.ids ?? []).filter((id): id is string => typeof id === 'string');
        if (live.current.onOpenRow) {
          live.current.onOpenRow(recordId, ids);
          return;
        }
        const objectId = live.current.object.id;
        openRecordOverlay(
          { entityDefinitionId: objectId, entityInstanceId: recordId },
          {
            list: {
              label: live.current.viewTitle,
              records: ids.map((id) => ({ entityDefinitionId: objectId, entityInstanceId: id })),
            },
          },
        );
      },
      openPreview(recordId: string) {
        const shown = controller.current;
        if (live.current.onPreviewRow) {
          live.current.onPreviewRow(
            recordId,
            (shown?.ids ?? []).filter((id): id is string => typeof id === 'string'),
          );
          return;
        }
        openRecordPreview({
          object: live.current.object,
          recordId,
          sequence: sequenceFromSnapshot(
            shown?.ids ?? [],
            shown?.total ?? 0,
            live.current.viewTitle,
            `${window.location.pathname}${window.location.search}`,
          ),
        });
      },
      committed(recordId: string) {
        controller.noteAuthorEdit(recordId);
      },
      editEnded(how, via) {
        const l = live.current;
        const at = l.editing;
        setEditing(null);
        focusGrid();
        if (how !== 'commit' || !at) return;
        // Enter → next row, Tab / Shift+Tab → next / previous column ("Edit cell/go to next cell").
        if (via === 'enter') {
          if (at.row < l.total - 1) setActive({ row: at.row + 1, col: at.col });
        } else if (via === 'tab') {
          if (at.col < l.columns.length - 1) setActive({ row: at.row, col: at.col + 1 });
        } else if (via === 'shift-tab' && at.col > -1) setActive({ row: at.row, col: at.col - 1 });
      },
      draftChanged(recordId, columnKey, values) {
        live.current.presence?.setDraft({ recordId, columnKey }, values);
      },
      refocus() {
        requestAnimationFrame(() => focusGrid());
      },
      registerActiveWriter(write) {
        activeWriter.current = write;
      },
    }),
    [controller, focusGrid],
  );

  const ctx = useMemo<TableContextValue>(
    () => ({
      workspace,
      object,
      titleAttribute,
      recordHref,
      presence,
      actions,
      columns,
      ...(recordColumn ? { recordColumn } : {}),
      ...(onCommentRow ? { onCommentRow } : {}),
    }),
    [workspace, object, titleAttribute, recordHref, presence, actions, columns, recordColumn, onCommentRow],
  );

  // ---- clipboard ------------------------------------------------------------------------------------------------------
  const cellText = useCallback(
    (row: number, col: number): string | undefined => {
      const recordId = controller.idAt(row);
      if (!recordId) return '';
      if (col < 0) {
        if (recordColumn) return recordColumn.copyText?.(recordId) ?? recordId;
        if (!titleAttribute) return recordId;
        const values = cachedValues(workspace, object.id, titleAttribute.id, recordId);
        return values === undefined ? undefined : titleText(titleAttribute, values);
      }
      const column = columns[col];
      if (!column?.attribute || column.isPath) return column?.attribute ? undefined : '';
      const values = cachedValues(workspace, object.id, column.attribute.id, recordId);
      return values === undefined ? undefined : column.ui.copyText(values, column.attribute, { field: column.field });
    },
    [controller, titleAttribute, workspace, object.id, columns, recordColumn],
  );

  const selectedMatrix = useCallback((): string[][] | null => {
    if (!active) return null;
    const end = rangeEnd ?? active;
    const r0 = Math.min(active.row, end.row);
    const r1 = Math.max(active.row, end.row);
    const c0 = Math.min(active.col, end.col);
    const c1 = Math.max(active.col, end.col);
    const matrix: string[][] = [];
    for (let r = r0; r <= r1; r++) {
      const row: string[] = [];
      for (let c = c0; c <= c1; c++) row.push(cellText(r, c) ?? '');
      matrix.push(row);
    }
    return matrix;
  }, [active, rangeEnd, cellText]);

  const copyToClipboard = useCallback(
    async (event?: ClipboardEvent) => {
      const matrix = selectedMatrix();
      if (!matrix) return;
      const tsv = toTsv(matrix);
      const html = toHtmlTable(matrix);
      const n = matrix.length * (matrix[0]?.length ?? 0);
      if (event) {
        event.preventDefault();
        event.clipboardData.setData('text/plain', tsv);
        event.clipboardData.setData('text/html', html);
      } else {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/plain': new Blob([tsv], { type: 'text/plain' }),
              'text/html': new Blob([html], { type: 'text/html' }),
            }),
          ]);
        } catch {
          await navigator.clipboard.writeText(tsv);
        }
      }
      toast(cellsCopiedLabel(n));
    },
    [selectedMatrix],
  );

  const pasteText = useCallback(
    (text: string) => {
      if (!active || active.col < 0) return;
      const column = columns[active.col];
      const write = activeWriter.current;
      if (!column?.attribute || column.readOnly || !write) {
        toast.error('This cell is not editable');
        return;
      }
      const values = column.ui.pasteValue?.(firstClipboardCell(text), column.attribute) ?? null;
      if (!values) {
        toast.error('1 invalid cells were skipped.');
        return;
      }
      write(values);
      toast('1 cells pasted into view');
    },
    [active, columns],
  );

  const clearActive = useCallback(() => {
    if (!canEdit(active)) return;
    activeWriter.current?.([]);
  }, [active, canEdit]);

  // ---- keyboard -----------------------------------------------------------------------------------------------------
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editing || event.target !== event.currentTarget) return;
    const action = gridAction(event, {
      active,
      rows: total,
      cols: columns.length,
      page: Math.max(1, Math.floor((viewport.height - HEADER_HEIGHT - FOOTER_HEIGHT) / ROW_HEIGHT) - 1),
      apple: isApple(),
    });
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    switch (action.type) {
      case 'move':
        moveTo(action.to);
        return;
      case 'select-rows':
        dispatchSelection({ type: 'add', from: action.from, to: action.to });
        moveTo(action.move);
        return;
      case 'toggle-row':
        dispatchSelection({ type: 'toggle', index: action.row });
        return;
      case 'select-all':
        dispatchSelection({ type: 'all', total });
        return;
      case 'open-record': {
        const id = active ? controller.idAt(active.row) : undefined;
        if (id) actions.openRecord(id);
        return;
      }
      case 'edit':
        if (!active) return;
        if (!startEditing(active, action.initialKey) && !action.initialKey && active.row < total - 1) {
          moveTo({ row: active.row + 1, col: active.col });
        }
        return;
      case 'clear-value':
        clearActive();
        return;
      case 'escape':
        if (rangeEnd) setRangeEnd(null);
        else setActive(null);
        return;
    }
  };

  // ---- column operations -----------------------------------------------------------------------------------------------

  const dropWidthOverride = (key: string) =>
    setWidthOverride((prev) => {
      const { [key]: _, ...rest } = prev;
      return rest;
    });

  const headerProps = {
    draft,
    singularNoun: recordColumn?.label ?? object.singularNoun,
    columns,
    placed,
    recordWidth,
    totalWidth,
    addColumnLeft: fillerLeft,
    addColumnWidth: fillerWidth,
    selectAll: headerState(selection, total),
    selectAllDisabled: total === 0,
    recordIcon: recordColumn?.icon,
    onSelectAll: () => dispatchSelection(selectedCount(selection) > 0 ? { type: 'clear' } : { type: 'all', total }),
    onNewRecord: onNewRecord && access.canCreateRecords ? () => onNewRecord() : undefined,
    onResize: (key: string | null, width: number) =>
      setWidthOverride((prev) => ({ ...prev, [key ?? '__record']: width })),
    onResizeEnd: (key: string | null, width: number | null) => {
      if (key === null) {
        // The record column width lives on the view (saved, then the override goes).
        if (width === null) dropWidthOverride('__record');
        void draft.setRecordColumnWidth(width).finally(() => dropWidthOverride('__record'));
        return;
      }
      // The draft applies the width optimistically at once.
      void draft.updateColumn(key, { tableColumnWidth: width });
      dropWidthOverride(key);
    },
    onMove: (key: string, to: number) => void draft.moveColumn(key, { index: to }),
    onEditAttribute,
    onCreateAttribute,
    onRunAi: (attribute: AttributeDefinition) => {
      if (shown) aiRun.open(attribute, { type: 'column', snapshotId: shown.snapshotId });
    },
    toContentX: (clientX: number) => {
      const el = scrollerRef.current;
      if (!el) return clientX;
      return clientX - el.getBoundingClientRect().left + el.scrollLeft;
    },
  };

  const onSetAggregation = useCallback(
    (column: TableColumn, kind: ColumnAggregation | null) =>
      void draft.updateColumn(column.key, { tableColumnAggregationType: kind }),
    [draft],
  );

  // ---- bulk actions ----------------------------------------------------------------------------------------------------
  const resolveSelected = useCallback(async () => {
    if (!shown) return [];
    const { ids } = await resolveSelection(workspace, object.id, shown.snapshotId, selection.edges);
    return ids;
  }, [shown, workspace, object.id, selection.edges]);

  const clearSelection = useCallback(() => {
    dispatchSelection({ type: 'clear' });
    controller.resume();
    void queryClient.invalidateQueries({ queryKey: ['ws', workspace.id, 'snapshot', object.id] });
  }, [controller, queryClient, workspace.id, object.id]);

  const onBulkDelete = useCallback(async () => {
    if (shown) {
      await deleteSelection({
        workspace,
        entityDefinitionId: object.id,
        snapshotId: shown.snapshotId,
        zebraEdges: selection.edges,
        singularNoun: object.singularNoun,
        pluralNoun: object.pluralNoun,
      });
    }
    dispatchSelection({ type: 'clear' });
    controller.resume();
    void queryClient.invalidateQueries({ queryKey: ['ws', workspace.id, 'snapshot', object.id] });
  }, [shown, selection.edges, workspace, object, controller, queryClient]);

  const exportRows = useCallback(
    (recordIds: string[]) =>
      exportCsv({
        workspace,
        entityDefinitionId: object.id,
        singularNoun: object.singularNoun,
        titleAttribute,
        columns,
        recordIds,
        fileName: `${object.pluralNoun} - ${draft.view.title}`,
        title: `${object.pluralNoun} - ${draft.view.title} Export`,
      }),
    [workspace, object, titleAttribute, columns, draft.view.title],
  );

  useImperativeHandle(
    ref,
    () => ({
      exportView: () => {
        if (!shown) return;
        void resolveSelection(workspace, object.id, shown.snapshotId, shown.total > 0 ? [0, shown.total] : [])
          .then(({ ids }) => exportRows(ids))
          .catch((error: unknown) =>
            toast.error({ title: 'Failed to export', description: errorEnvelopeOf(error).message }),
          );
      },
      refresh: () => controller.resume(),
    }),
    [shown, workspace, object.id, exportRows, controller],
  );

  // ---- states ------------------------------------------------------------------------------------------------------------
  const queryError = !shown && snapshotQ.error ? snapshotQ.error : null;
  const errorCode = queryError ? errorEnvelopeOf(queryError).code : undefined;
  const isFiltered = Boolean(draft.filter && !('and' in draft.filter && draft.filter.and.length === 0));
  const showNoResults = shown !== null && total === 0 && isFiltered;
  const showEmpty = shown !== null && total === 0 && !isFiltered;
  const rangeBounds = active && rangeEnd ? rangeOf(active, rangeEnd) : null;
  // "Recalculate with AI" (C1 cells context menu; ai-attributes): the AI column under the menu's cells.
  const aiColumn = (() => {
    if (!menu || !active || active.col < 0) return null;
    const [c0, c1] = menu.range && rangeBounds ? [rangeBounds.c0, rangeBounds.c1] : [active.col, active.col];
    for (let c = Math.max(0, c0); c <= c1; c++) {
      const col = columns[c];
      if (col?.attribute?.aiAutofillConfiguration?.isEnabled && !col.isPath) return col.attribute;
    }
    return null;
  })();
  const recalculateWithAi = () => {
    if (!aiColumn || !active || !shown) return;
    if (menu?.range && rangeBounds) {
      aiRun.open(aiColumn, {
        type: 'selection',
        snapshotId: shown.snapshotId,
        zebraEdges: [rangeBounds.r0, rangeBounds.r1 + 1],
      });
    } else {
      const id = controller.idAt(active.row);
      if (id) aiRun.open(aiColumn, { type: 'records', entityInstanceIds: [id] });
    }
  };
  const hydrate = !fast;
  const count = zebraSize(selection.edges);

  if (queryError) {
    return (
      <div className={s.root}>
        <div className={s.stateOverlay} style={{ top: 0 }}>
          <ErrorState
            message={
              errorCode === 'UNSUPPORTED_FILTER'
                ? 'The filter for this view is no longer valid, please change the filter.'
                : errorCode === 'UNSUPPORTED_SORT'
                  ? 'The sort for this view is no longer valid, please change the sort.'
                  : 'Unable to load table'
            }
            actions={
              <Button variant="secondary" size={28} onPress={() => void snapshotQ.refetch()}>
                Try again
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <TableContext.Provider value={ctx}>
      <div className={s.root} data-testid="record-table">
        <div
          ref={scrollerRef}
          className={s.scroller}
          role="grid"
          aria-label={`${object.pluralNoun} table`}
          aria-rowcount={total + 1}
          aria-colcount={columns.length + 1}
          aria-multiselectable
          tabIndex={0}
          onScroll={onScroll}
          onKeyDown={onKeyDown}
          onCopy={(e) => {
            if (editing || e.target !== e.currentTarget) return;
            void copyToClipboard(e);
          }}
          onPaste={(e) => {
            if (editing || e.target !== e.currentTarget) return;
            e.preventDefault();
            pasteText(e.clipboardData.getData('text/plain'));
          }}
        >
          <div
            className={s.canvas}
            style={{
              width: totalWidth,
              height: HEADER_HEIGHT + total * ROW_HEIGHT + FOOTER_HEIGHT,
              userSelect: 'none',
            }}
          >
            <TableHeader {...headerProps} />
            <div className={s.body} style={{ height: total * ROW_HEIGHT, width: totalWidth }}>
              {virtualRows.map((item) => {
                const index = item.index;
                return (
                  <RecordRow
                    key={item.key}
                    index={index}
                    recordId={shown?.ids[index]}
                    top={item.start - HEADER_HEIGHT}
                    width={totalWidth}
                    recordWidth={recordWidth}
                    columns={placed}
                    fillerLeft={fillerLeft}
                    fillerWidth={rowFillerWidth}
                    selected={isSelected(selection, index)}
                    hydrate={hydrate}
                    activeCol={active?.row === index ? active.col : null}
                    editing={editing?.row === index ? editing : null}
                    range={
                      rangeBounds && index >= rangeBounds.r0 && index <= rangeBounds.r1
                        ? [rangeBounds.c0, rangeBounds.c1]
                        : null
                    }
                    selectionDisabled={false}
                  />
                );
              })}
            </div>
            <TableFooter
              workspace={workspace}
              entityDefinitionId={object.id}
              snapshotId={shown?.snapshotId}
              total={shown?.total}
              placed={placed}
              recordWidth={recordWidth}
              totalWidth={totalWidth}
              fillerLeft={fillerLeft}
              fillerWidth={rowFillerWidth}
              onSetAggregation={onSetAggregation}
            />
          </div>
        </div>
        {columns.length === 0 && attributesQ.data && !(emptyState && showEmpty) && (
          <NoColumns left={recordWidth} draft={draft} onCreateAttribute={onCreateAttribute} />
        )}
        {emptyState && showEmpty && (
          <div className={s.stateOverlay} style={{ top: HEADER_HEIGHT + FOOTER_HEIGHT }}>
            {emptyState}
          </div>
        )}
        {(showNoResults || (showEmpty && !emptyState)) && columns.length > 0 && (
          <div className={s.stateOverlay} style={{ top: HEADER_HEIGHT }}>
            {showNoResults ? (
              <TableState
                icon="table"
                title={`No ${object.pluralNoun} match that filter`}
                text={`No ${object.pluralNoun} match the filter that’s been set.`}
                action={
                  onClearFilter ? (
                    <Button variant="primary" size={28} icon="filter" onPress={onClearFilter}>
                      Clear Filter
                    </Button>
                  ) : null
                }
              />
            ) : (
              <TableState icon="table" title="No records yet" text="Create a record to get started with this view." />
            )}
          </div>
        )}
        {count > 0 && (
          <BulkBar
            count={count}
            singularNoun={object.singularNoun}
            pluralNoun={object.pluralNoun}
            viewChanged={controller.viewChanged}
            raised={HEADER_HEIGHT + total * ROW_HEIGHT + FOOTER_HEIGHT > viewport.height}
            onClear={() => dispatchSelection({ type: 'clear' })}
            onDelete={onBulkDelete}
            canDelete={bulkRemove ? access.canDeleteRecords : access.canDeleteMany}
            onExport={() => void resolveSelected().then(exportRows)}
            onAddToList={
              onBulkAddToList
                ? () => void resolveSelected().then((ids) => onBulkAddToList(ids, clearSelection))
                : undefined
            }
            onSendEmail={
              onBulkSendEmail
                ? () => void resolveSelected().then((ids) => onBulkSendEmail(ids, clearSelection))
                : undefined
            }
            onRunWorkflow={() =>
              void resolveSelected().then((ids) =>
                setRunTarget({
                  kind: object.entityType === 'collection-entry' ? 'list-entry' : 'record',
                  entityDefinitionId: object.id,
                  ids,
                  groupLabel: object.entityType === 'collection-entry' ? object.pluralNoun : object.singularNoun,
                }),
              )
            }
            remove={
              bulkRemove
                ? {
                    label: bulkRemove.label(count),
                    run: () => void resolveSelected().then((ids) => bulkRemove.onRemove(ids, clearSelection)),
                  }
                : undefined
            }
          />
        )}
        <RunWorkflowDialog target={runTarget} onClose={() => setRunTarget(null)} />
        {menu && (
          <ContextMenu
            aria-label="Cell actions"
            isOpen
            onOpenChange={(open) => {
              if (!open) {
                setMenu(null);
                focusGrid();
              }
            }}
            x={menu.x}
            y={menu.y}
            width={228}
            onAction={(key) => {
              if (key === 'copy') void copyToClipboard();
              else if (key === 'paste')
                void navigator.clipboard
                  .readText()
                  .then(pasteText)
                  .catch(() => toast.error('Paste with ⌘V'));
              else if (key === 'clear') clearActive();
              else if (key === 'ai-recalculate') recalculateWithAi();
              else if (key === 'history') toast('Edit history', { description: 'Arrives with the attribute cells.' });
            }}
          >
            <MenuItem id="copy" icon="copy">
              Copy
            </MenuItem>
            <MenuItem id="paste" icon="paste">
              Paste
            </MenuItem>
            {aiColumn && (
              <MenuItem id="ai-recalculate" icon="aiRun" isDisabled={!access.canEditValues}>
                Recalculate with AI
              </MenuItem>
            )}
            {!menu.range && active && active.col >= 0 && <MenuSeparator />}
            {!menu.range && active && active.col >= 0 && (
              <MenuItem id="history" icon="history">
                View edit history
              </MenuItem>
            )}
            {!menu.range && active && active.col >= 0 && <MenuSeparator />}
            {!menu.range && active && active.col >= 0 && (
              <MenuItem id="clear" icon="close" variant="danger" isDisabled={!canEdit(active)}>
                Clear value
              </MenuItem>
            )}
          </ContextMenu>
        )}
        {aiRun.dialog}
      </div>
    </TableContext.Provider>
  );
}

function withinRange(p: CellPos, a: CellPos, b: CellPos): boolean {
  const r = rangeOf(a, b);
  return p.row >= r.r0 && p.row <= r.r1 && p.col >= r.c0 && p.col <= r.c1;
}

function rangeOf(a: CellPos, b: CellPos) {
  return {
    r0: Math.min(a.row, b.row),
    r1: Math.max(a.row, b.row),
    c0: Math.min(a.col, b.col),
    c1: Math.max(a.col, b.col),
  };
}

function TableState({
  icon,
  title,
  text,
  action,
}: {
  icon: 'table' | 'filter';
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={s.statePanel} data-testid="table-state">
      <span className={s.stateIcon}>
        <Icon icon={icon} size={16} />
      </span>
      <h3 className={s.stateTitle}>{title}</h3>
      <p className={s.stateText}>{text}</p>
      {action && <div className={s.stateActions}>{action}</div>}
    </div>
  );
}

/** A view with no columns: "Add your first attribute column" panel right of the record column. */
function NoColumns({
  left,
  draft,
  onCreateAttribute,
}: {
  left: number;
  draft: ViewDraft;
  onCreateAttribute?: () => void;
}) {
  return (
    <div className={s.noColumnsPanel} style={{ left }}>
      <div className={s.statePanel}>
        <span className={s.stateIcon}>
          <Icon icon="columns" size={16} />
        </span>
        <h3 className={s.stateTitle}>Add your first attribute column</h3>
        <p className={s.stateText}>There are currently no attributes set up as columns in this view.</p>
        <div className={s.stateActions}>
          <AddColumnPicker
            draft={draft}
            onCreateAttribute={onCreateAttribute}
            trigger={
              <Button variant="primary" size={28} icon="add">
                Add attribute column
              </Button>
            }
          />
        </div>
      </div>
    </div>
  );
}
