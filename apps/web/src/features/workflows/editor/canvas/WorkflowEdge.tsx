// Edges: orthogonal connectors with rounded corners and an open arrow into the target's left
// edge; grey normally, blue when the source block (or the edge) is selected; green along a run's taken paths and dashed
// light grey for outcomes the run did not take.
import { BaseEdge, type Edge, type EdgeProps, getSmoothStepPath, Position } from '@xyflow/react';
import { memo } from 'react';

export type EdgeTone = 'default' | 'active' | 'taken' | 'skipped';

export interface WorkflowEdgeData extends Record<string, unknown> {
  tone: EdgeTone;
}

export type WorkflowEdgeType = Edge<WorkflowEdgeData, 'wf'>;

export const EDGE_COLORS: Record<EdgeTone, string> = {
  default: '#b1b1b7',
  active: '#266df0',
  taken: '#02ad6e',
  skipped: '#d0d0d4',
};

export const WorkflowEdge = memo(function WorkflowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
  markerEnd,
}: EdgeProps<WorkflowEdgeType>) {
  const tone: EdgeTone = selected ? 'active' : (data?.tone ?? 'default');
  const [path] = getSmoothStepPath({
    sourceX: sourceX - 6,
    sourceY,
    sourcePosition: Position.Right,
    targetX: targetX + 1,
    targetY,
    targetPosition: Position.Left,
    borderRadius: 10,
    offset: 18,
  });
  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      interactionWidth={14}
      style={{
        stroke: EDGE_COLORS[tone],
        strokeWidth: 1,
        ...(tone === 'skipped' ? { strokeDasharray: '4 4' } : {}),
      }}
    />
  );
});
