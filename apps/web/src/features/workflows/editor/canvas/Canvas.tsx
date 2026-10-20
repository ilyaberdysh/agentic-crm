// The workflow canvas on @xyflow/react (README §2.3, §3): blocks as cards, paths as edges, drag to connect (drop on a
// card: dashed blue outline), drag to move (committed on drop as one batch move), click / Shift+click / marquee to
// select, edges selectable for Delete. Pointer mode (V): scroll pans, drag selects; hand mode (H): drag pans;
// ⌘ + scroll zooms. The same component renders read-only versions and the run viewer (status tags, green paths).
import type { ExecutionStatus, Position as XY } from '@agentic-crm/contracts';
import {
  Background,
  BackgroundVariant,
  type Connection,
  type EdgeChange,
  MarkerType,
  type NodeChange,
  ReactFlow,
  SelectionMode,
} from '@xyflow/react';
import type { WorkflowBlock, WorkflowPath } from '../../types';
import '@xyflow/react/dist/base.css';
import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BlockNode, type BlockNodeData, type BlockNodeType, PlaceholderNode } from './BlockNode';
import * as s from './canvas.css';
import { CARD_WIDTH, cardHeight } from './geometry';
import { type Inset, useFitToArea } from './viewport';
import { EDGE_COLORS, type EdgeTone, WorkflowEdge, type WorkflowEdgeType } from './WorkflowEdge';

export interface RunOverlay {
  /** Latest execution status per block of the shown attempt. */
  statusByBlock: Map<string, ExecutionStatus>;
  /** Outcome each executed block took. */
  outcomeByBlock: Map<string, string>;
  /** `${source}:${outcome}:${target}` of the paths the run took. */
  taken: Set<string>;
  selectedBlockId: string | null;
}

export interface CanvasProps {
  blocks: WorkflowBlock[];
  paths: WorkflowPath[];
  mode: 'edit' | 'view' | 'run';
  tool: 'pointer' | 'hand';
  selectedIds: ReadonlySet<string>;
  onSelect: (ids: string[]) => void;
  highlightId?: string | null;
  placeholder?: { position: XY; from: { blockId: string; outcome: string } } | null;
  run?: RunOverlay;
  /** The visible area: insets from the canvas edges (the side panel covers the right). */
  inset: Inset;
  onConnect?: (sourceBlockId: string, outcome: string, targetBlockId: string) => void;
  onMove?: (positions: { blockId: string; position: XY }[]) => void;
  onAddNext?: (blockId: string, outcome: string) => void;
  /** The selected edge (Delete disconnects it; the parent owns keyboard handling). */
  selectedPathId?: string | null;
  onSelectPath?: (pathId: string | null) => void;
  onNodeContextMenu?: (event: MouseEvent, blockId: string) => void;
  onPaneContextMenu?: (event: MouseEvent | globalThis.MouseEvent) => void;
  onPaneClick?: () => void;
}

const nodeTypes = { block: BlockNode, placeholder: PlaceholderNode };
const edgeTypes = { wf: WorkflowEdge };

export function Canvas(props: CanvasProps) {
  const {
    blocks,
    paths,
    mode,
    tool,
    selectedIds,
    onSelect,
    highlightId,
    placeholder,
    run,
    onConnect,
    onMove,
    onAddNext,
  } = props;
  const [drag, setDrag] = useState<Map<string, XY>>(new Map());
  const selectedEdge = props.selectedPathId ?? null;
  const setSelectedEdge = useCallback(
    (next: string | null | ((prev: string | null) => string | null)) => {
      const value = typeof next === 'function' ? next(selectedEdge) : next;
      if (value !== selectedEdge) props.onSelectPath?.(value);
    },
    [selectedEdge, props.onSelectPath],
  );
  const editable = mode === 'edit';
  // Opens at 100 % centred on the blocks left of the side panel (README §2.3); a canvas that starts empty is centred
  // once its first block has been measured.
  const fitToArea = useFitToArea(props.inset);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!ready || fitted.current || blocks.length === 0) return;
    fitted.current = true;
    fitToArea();
  }, [ready, blocks.length]);

  const nodes = useMemo(() => {
    const connected = new Map<string, string[]>();
    for (const p of paths) connected.set(p.sourceBlockId, [...(connected.get(p.sourceBlockId) ?? []), p.outcome]);
    const list: (
      | BlockNodeType
      | {
          id: string;
          type: 'placeholder';
          position: XY;
          initialWidth: number;
          initialHeight: number;
          data: Record<string, unknown>;
          selectable: false;
          draggable: false;
        }
    )[] = blocks.map((b) => {
      const data: BlockNodeData = {
        block: b,
        mode,
        selected: selectedIds.has(b.id),
        connectedOutcomes: connected.get(b.id) ?? [],
        highlighted: highlightId === b.id,
        issueMessage: b.issues[0]?.message ?? null,
        ...(onAddNext ? { onAddNext } : {}),
        ...(run
          ? {
              run: {
                status: run.statusByBlock.get(b.id) ?? null,
                takenOutcome: run.outcomeByBlock.get(b.id) ?? null,
                selected: run.selectedBlockId === b.id,
              },
            }
          : {}),
      };
      return {
        id: b.id,
        type: 'block' as const,
        position: drag.get(b.id) ?? b.position,
        // Known card sizes: xyflow counts the nodes as initialised (fit, bounds) before the DOM measure.
        initialWidth: CARD_WIDTH,
        initialHeight: cardHeight(b),
        data,
        selected: selectedIds.has(b.id),
        draggable: editable,
        connectable: editable,
      };
    });
    if (placeholder) {
      list.push({
        id: '__placeholder',
        type: 'placeholder',
        position: placeholder.position,
        initialWidth: CARD_WIDTH,
        initialHeight: 70,
        data: {},
        selectable: false,
        draggable: false,
      });
    }
    return list;
  }, [blocks, paths, mode, selectedIds, highlightId, run, drag, editable, placeholder, onAddNext]);

  const edges = useMemo(() => {
    const list: WorkflowEdgeType[] = paths.map((p) => {
      let tone: EdgeTone = 'default';
      if (run) {
        const executed = run.statusByBlock.has(p.sourceBlockId);
        tone = run.taken.has(`${p.sourceBlockId}:${p.outcome}:${p.targetBlockId}`)
          ? 'taken'
          : executed && run.outcomeByBlock.get(p.sourceBlockId) !== p.outcome
            ? 'skipped'
            : 'default';
      } else if (selectedIds.has(p.sourceBlockId)) tone = 'active';
      const color = EDGE_COLORS[selectedEdge === p.id ? 'active' : tone];
      return {
        id: p.id,
        type: 'wf' as const,
        source: p.sourceBlockId,
        sourceHandle: p.outcome,
        target: p.targetBlockId,
        targetHandle: 'in',
        selected: selectedEdge === p.id,
        selectable: editable,
        data: { tone },
        markerEnd: { type: MarkerType.Arrow, color, width: 14, height: 14, strokeWidth: 1.2 },
      };
    });
    if (placeholder) {
      list.push({
        id: '__placeholder-edge',
        type: 'wf',
        source: placeholder.from.blockId,
        sourceHandle: placeholder.from.outcome,
        target: '__placeholder',
        targetHandle: 'in',
        selectable: false,
        data: { tone: 'default' },
        markerEnd: { type: MarkerType.Arrow, color: EDGE_COLORS.default, width: 14, height: 14, strokeWidth: 1.2 },
      });
    }
    return list;
  }, [paths, run, selectedIds, selectedEdge, editable, placeholder]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      let selection: Set<string> | null = null;
      const moved = new Map<string, XY>();
      for (const ch of changes) {
        if (ch.type === 'select' && ch.id !== '__placeholder') {
          selection ??= new Set(selectedIds);
          if (ch.selected) selection.add(ch.id);
          else selection.delete(ch.id);
        }
        if (ch.type === 'position' && ch.position && ch.dragging) moved.set(ch.id, ch.position);
      }
      if (moved.size > 0) {
        setDrag((prev) => {
          const next = new Map(prev);
          for (const [id, pos] of moved) next.set(id, pos);
          return next;
        });
      }
      if (selection) {
        setSelectedEdge(null);
        onSelect([...selection]);
      }
    },
    [selectedIds, onSelect, setSelectedEdge],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const ch of changes) {
        if (ch.type === 'select') {
          if (ch.selected) {
            setSelectedEdge(ch.id);
            onSelect([]);
          } else setSelectedEdge((prev) => (prev === ch.id ? null : prev));
        }
      }
    },
    [onSelect, setSelectedEdge],
  );

  const onNodeDragStop = useCallback(() => {
    setDrag((prev) => {
      if (prev.size > 0 && onMove) {
        const positions = [...prev.entries()].map(([blockId, p]) => ({
          blockId,
          position: { x: Math.round(p.x), y: Math.round(p.y) },
        }));
        // Commit after this render pass: the queued move patches the cached draft at once.
        queueMicrotask(() => onMove(positions));
      }
      return new Map();
    });
  }, [onMove]);

  const connect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || !c.sourceHandle || c.source === c.target || c.target === '__placeholder') return;
      onConnect?.(c.source, c.sourceHandle, c.target);
    },
    [onConnect],
  );

  return (
    <div className={s.flow} data-testid="workflow-canvas" data-mode={mode} data-tool={tool}>
      <ReactFlow
        nodes={nodes as never}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={connect}
        onInit={() => setReady(true)}
        isValidConnection={(c) => {
          const target = blocks.find((b) => b.id === c.target);
          return Boolean(target && target.blockType !== 'trigger' && c.source !== c.target);
        }}
        connectionRadius={30}
        nodesDraggable={editable}
        nodesConnectable={editable}
        elementsSelectable
        selectNodesOnDrag={false}
        multiSelectionKeyCode="Shift"
        selectionKeyCode={null}
        selectionOnDrag={tool === 'pointer' && editable}
        selectionMode={SelectionMode.Partial}
        panOnDrag={tool === 'hand' ? true : [1, 2]}
        panOnScroll={tool === 'pointer'}
        zoomOnScroll={tool === 'hand'}
        zoomActivationKeyCode="Meta"
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        minZoom={0.2}
        maxZoom={2}
        onPaneClick={() => {
          setSelectedEdge(null);
          props.onPaneClick?.();
        }}
        onNodeContextMenu={(e, node) => {
          if (node.id === '__placeholder') return;
          e.preventDefault();
          props.onNodeContextMenu?.(e, node.id);
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          props.onPaneContextMenu?.(e);
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={10} size={1} color="var(--ar-color-stroke-tertiary)" />
      </ReactFlow>
    </div>
  );
}
