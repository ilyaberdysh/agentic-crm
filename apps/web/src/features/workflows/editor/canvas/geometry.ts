// Card geometry and placement (README §2.3 measured styles, §2.3 "Placement"): cards are 200 px wide, 70 px tall with one
// outcome; multi-outcome cards list their outcomes in 22 px rows (If = 116 px). Next blocks go one 270 px column to the
// right of their source (rows 150 px apart per outcome, moved down past occupied slots); palette blocks without a
// selection go +70 / +70 from the last block. Pure.
import type { Position } from '@agentic-crm/contracts';
import type { WorkflowBlock } from '../../types';

export const CARD_WIDTH = 200;
export const CARD_HEIGHT = 70;
export const COLUMN = 270;
export const ROW = 150;

export const showsOutcomeRows = (block: Pick<WorkflowBlock, 'outcomes'>) => block.outcomes.length > 1;

export function cardHeight(block: Pick<WorkflowBlock, 'outcomes'>): number {
  return showsOutcomeRows(block) ? 72 + 22 * block.outcomes.length : CARD_HEIGHT;
}

/** Vertical centre of an outcome's handle inside the card. */
export function handleY(block: Pick<WorkflowBlock, 'outcomes'>, outcome: string): number {
  if (!showsOutcomeRows(block)) return CARD_HEIGHT / 2;
  const i = Math.max(
    0,
    block.outcomes.findIndex((o) => o.slug === outcome),
  );
  return 78 + 22 * i;
}

const overlaps = (a: Position, b: Position, height = CARD_HEIGHT) =>
  Math.abs(a.x - b.x) < CARD_WIDTH + 20 && Math.abs(a.y - b.y) < height + 30;

/** Where a block added after `source`'s `outcome` goes. */
export function nextPosition(
  source: Pick<WorkflowBlock, 'position' | 'outcomes'>,
  outcome: string,
  blocks: readonly Pick<WorkflowBlock, 'position'>[],
): Position {
  const index = Math.max(
    0,
    source.outcomes.findIndex((o) => o.slug === outcome),
  );
  const pos = { x: source.position.x + COLUMN, y: source.position.y + index * ROW };
  for (let guard = 0; guard < 50 && blocks.some((b) => overlaps(b.position, pos)); guard++) pos.y += ROW;
  return pos;
}

/** A block added from the palette with nothing selected. */
export function loosePosition(blocks: readonly Pick<WorkflowBlock, 'position' | 'createdAt'>[]): Position {
  if (blocks.length === 0) return { x: 0, y: 0 };
  const last = [...blocks].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).slice(-1)[0] as WorkflowBlock;
  const pos = { x: last.position.x + 70, y: last.position.y + 70 };
  for (let guard = 0; guard < 50 && blocks.some((b) => b !== last && overlaps(b.position, pos, 40)); guard++) {
    pos.x += 70;
    pos.y += 70;
  }
  return pos;
}
