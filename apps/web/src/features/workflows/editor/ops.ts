// Editor writes (README §3 "Every edit autosaves immediately (one PUT per change)"): a serial queue of draft edits per
// workflow. Each op applies an optimistic patch to the draft at once (canvas and panel read the cached draft with the
// pending patches on top), then runs its requests in order; the server's answer is written into the cache and, when
// the queue drains, the draft is refetched for the canonical issues, outcomes and checklist. A failed op is dropped
// with a toast and the draft refetched.
import { type BlockConfig, blockDefinition, type Position } from '@agentic-crm/contracts';
import { useSyncExternalStore } from 'react';
import { queryClient } from '../../../data/queryClient';
import { api, inWorkspace, noteAcceptAfter, type WorkspaceRef } from '../../../data/trpc';
import { newId } from '../../../lib/ids';
import { reportError, type WorkflowDetail, wfKeys, writeWorkflow } from '../data';
import type { Workflow, WorkflowBlock, WorkflowPath } from '../types';

type Patch = (d: WorkflowDetail) => WorkflowDetail;

interface PendingOp {
  id: string;
  apply: Patch;
}

class OpQueue {
  pending: PendingOp[] = [];
  private listeners = new Set<() => void>();
  private chain: Promise<void> = Promise.resolve();
  version = 0;

  constructor(
    readonly ws: WorkspaceRef,
    readonly workflowId: string,
  ) {}

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  snapshot = () => this.version;

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Queues an edit: `apply` now (optimistic), `request` in order; its result patches the cached draft. */
  run(apply: Patch, request: () => Promise<Patch | null>, failure = 'Failed to save changes'): Promise<boolean> {
    const op: PendingOp = { id: newId(), apply };
    this.pending.push(op);
    this.emit();
    const result = this.chain.then(async () => {
      let ok = true;
      try {
        const patch = await request();
        if (patch) {
          queryClient.setQueryData<WorkflowDetail>(wfKeys.detail(this.ws.id, this.workflowId, null), (prev) =>
            prev ? patch(prev) : prev,
          );
        }
      } catch (error) {
        ok = false;
        reportError(error, failure);
      } finally {
        this.pending = this.pending.filter((p) => p.id !== op.id);
        this.emit();
        if (this.pending.length === 0 || !ok) {
          void queryClient.invalidateQueries({ queryKey: wfKeys.workflow(this.ws.id, this.workflowId) });
        }
      }
      return ok;
    });
    this.chain = result.then(() => undefined);
    return result;
  }

  /** Waits for every queued edit (publish waits so it commits what the user sees). */
  idle(): Promise<void> {
    return this.chain;
  }

  applyTo(detail: WorkflowDetail): WorkflowDetail {
    return this.pending.reduce((d, op) => op.apply(d), detail);
  }
}

const queues = new Map<string, OpQueue>();

export function opQueue(ws: WorkspaceRef, workflowId: string): OpQueue {
  const key = `${ws.id}:${workflowId}`;
  let q = queues.get(key);
  if (!q) {
    q = new OpQueue(ws, workflowId);
    queues.set(key, q);
  }
  return q;
}

/** The cached draft with the pending edits applied (re-renders on every queue change). */
export function usePendingDetail(ws: WorkspaceRef, workflowId: string, detail: WorkflowDetail | undefined) {
  const q = opQueue(ws, workflowId);
  useSyncExternalStore(q.subscribe, q.snapshot, q.snapshot);
  return detail ? q.applyTo(detail) : undefined;
}

// ---- draft patches ------------------------------------------------------------------------------------------------------

const mapVersion = (
  d: WorkflowDetail,
  fn: (v: WorkflowDetail['version']) => WorkflowDetail['version'],
): WorkflowDetail => ({
  ...d,
  version: fn(d.version),
});

const withWorkflow =
  (workflow: Workflow): Patch =>
  (d) => ({ ...d, workflow });

function upsertBlock(block: WorkflowBlock): Patch {
  return (d) =>
    mapVersion(d, (v) => ({
      ...v,
      blocks: v.blocks.some((b) => b.id === block.id)
        ? v.blocks.map((b) => (b.id === block.id ? block : b))
        : [...v.blocks, block],
    }));
}

function patchBlock(blockId: string, fn: (b: WorkflowBlock) => WorkflowBlock): Patch {
  return (d) => mapVersion(d, (v) => ({ ...v, blocks: v.blocks.map((b) => (b.id === blockId ? fn(b) : b)) }));
}

const both =
  (...patches: Patch[]): Patch =>
  (d) =>
    patches.reduce((x, p) => p(x), d);

/** A block as the server would answer it right after creation (outcomes from the catalogue, no issues yet). */
export function optimisticBlock(
  versionId: string,
  id: string,
  slug: string,
  position: Position,
  config: BlockConfig = { type: 'object', entries: {} },
  description: string | null = null,
): WorkflowBlock {
  const def = blockDefinition(slug);
  const now = new Date().toISOString();
  return {
    id,
    versionId,
    blockType: def?.blockType ?? 'step',
    slug,
    blockVersion: def?.version ?? 1,
    title: def?.title ?? slug,
    category: def?.category ?? 'misc',
    description,
    position,
    config,
    outcomes: (def?.outcomes ?? []).map((o) => ({
      slug: o.slug,
      label: o.label,
      outputs: o.outputs ? o.outputs.map((x) => ({ key: x.key, label: x.label, type: x.type })) : null,
    })),
    cost: def?.cost ?? { type: 'free' },
    issues: [],
    createdAt: now,
    updatedAt: now,
  };
}

function optimisticPath(
  versionId: string,
  id: string,
  sourceBlockId: string,
  outcome: string,
  targetBlockId: string,
): WorkflowPath {
  return { id, versionId, sourceBlockId, outcome, targetBlockId, createdAt: new Date().toISOString() };
}

// ---- editor actions -------------------------------------------------------------------------------------------------------

export interface NewBlock {
  id?: string;
  slug: string;
  position: Position;
  config?: BlockConfig;
  description?: string | null;
}

export function editorActions(ws: WorkspaceRef, workflowId: string, versionId: string) {
  const q = opQueue(ws, workflowId);
  const ctx = inWorkspace(ws);
  const seq = (s: string | null | undefined) => noteAcceptAfter(ws.id, s ?? null);

  const putBlock = async (input: Parameters<typeof api.workflows.blocks.put.mutate>[0]): Promise<Patch> => {
    const { block, workflow, seq: s } = await api.workflows.blocks.put.mutate(input, ctx);
    seq(s);
    writeWorkflow(queryClient, ws, workflow);
    return both(upsertBlock(block), withWorkflow(workflow));
  };

  return {
    queue: q,

    /** Adds a block; `from` also connects the source block's outcome to it ("Select next block", "+"). */
    addBlock(block: NewBlock, from?: { blockId: string; outcome: string }) {
      const id = block.id ?? newId();
      const pathId = newId();
      const created = optimisticBlock(
        versionId,
        id,
        block.slug,
        block.position,
        block.config,
        block.description ?? null,
      );
      const optimistic = both(
        upsertBlock(created),
        from
          ? (d) =>
              mapVersion(d, (v) => ({
                ...v,
                paths: [...v.paths, optimisticPath(versionId, pathId, from.blockId, from.outcome, id)],
              }))
          : (d) => d,
      );
      void q.run(
        optimistic,
        async () => {
          const patch = await putBlock({
            workflowId,
            blockId: id,
            slug: block.slug,
            position: block.position,
            ...(block.config ? { config: block.config } : {}),
            ...(block.description ? { description: block.description } : {}),
          });
          if (!from) return patch;
          const {
            path,
            workflow,
            seq: s,
          } = await api.workflows.blocks.connect.mutate(
            { workflowId, pathId, sourceBlockId: from.blockId, outcome: from.outcome, targetBlockId: id },
            ctx,
          );
          seq(s);
          return both(
            patch,
            (d) => mapVersion(d, (v) => ({ ...v, paths: [...v.paths.filter((p) => p.id !== path.id), path] })),
            withWorkflow(workflow),
          );
        },
        'Failed to add block',
      );
      return id;
    },

    setConfig(block: Pick<WorkflowBlock, 'id' | 'slug'>, config: BlockConfig) {
      return q.run(
        patchBlock(block.id, (b) => ({ ...b, config })),
        () => putBlock({ workflowId, blockId: block.id, slug: block.slug, config }),
      );
    },

    setDescription(block: Pick<WorkflowBlock, 'id' | 'slug'>, description: string | null) {
      return q.run(
        patchBlock(block.id, (b) => ({ ...b, description })),
        () => putBlock({ workflowId, blockId: block.id, slug: block.slug, description }),
      );
    },

    /** "Replace trigger / step": same block id, new slug, config reset (README §3.5). */
    replaceBlock(block: Pick<WorkflowBlock, 'id' | 'slug' | 'position'>, slug: string) {
      return q.run(
        upsertBlock(optimisticBlock(versionId, block.id, slug, block.position)),
        () => putBlock({ workflowId, blockId: block.id, slug, config: { type: 'object', entries: {} } }),
        'Failed to replace block',
      );
    },

    move(positions: { blockId: string; position: Position }[]) {
      if (positions.length === 0) return Promise.resolve(true);
      const byId = new Map(positions.map((p) => [p.blockId, p.position]));
      return q.run(
        (d) =>
          mapVersion(d, (v) => ({
            ...v,
            blocks: v.blocks.map((b) => (byId.has(b.id) ? { ...b, position: byId.get(b.id) as Position } : b)),
          })),
        async () => {
          const { seq: s } = await api.workflows.blocks.organize.mutate({ workflowId, positions }, ctx);
          seq(s);
          return null;
        },
        'Failed to move blocks',
      );
    },

    /** Organize blocks: the server lays out; answers the previous positions for Undo. */
    async organize(): Promise<{ changed: boolean; previous: { blockId: string; position: Position }[] } | null> {
      let answer: { changed: boolean; previous: { blockId: string; position: Position }[] } | null = null;
      await q.run(
        (d) => d,
        async () => {
          const res = await api.workflows.blocks.organize.mutate({ workflowId }, ctx);
          seq(res.seq);
          answer = { changed: res.changed, previous: res.previous };
          const byId = new Map(res.positions.map((p) => [p.blockId, p.position]));
          return (d) =>
            mapVersion(d, (v) => ({
              ...v,
              blocks: v.blocks.map((b) => (byId.has(b.id) ? { ...b, position: byId.get(b.id) as Position } : b)),
            }));
        },
        'Failed to organize blocks',
      );
      return answer;
    },

    deleteBlocks(blockIds: string[]) {
      const ids = new Set(blockIds);
      return q.run(
        (d) =>
          mapVersion(d, (v) => ({
            ...v,
            blocks: v.blocks.filter((b) => !ids.has(b.id)),
            paths: v.paths.filter((p) => !ids.has(p.sourceBlockId) && !ids.has(p.targetBlockId)),
          })),
        async () => {
          let last: Workflow | null = null;
          for (const blockId of blockIds) {
            const { workflow, seq: s } = await api.workflows.blocks.delete.mutate({ workflowId, blockId }, ctx);
            seq(s);
            last = workflow;
          }
          return last ? withWorkflow(last) : null;
        },
        blockIds.length > 1 ? 'Failed to delete blocks' : 'Failed to delete block',
      );
    },

    connect(sourceBlockId: string, outcome: string, targetBlockId: string) {
      const pathId = newId();
      return q.run(
        (d) =>
          mapVersion(d, (v) =>
            v.paths.some(
              (p) => p.sourceBlockId === sourceBlockId && p.outcome === outcome && p.targetBlockId === targetBlockId,
            )
              ? v
              : { ...v, paths: [...v.paths, optimisticPath(versionId, pathId, sourceBlockId, outcome, targetBlockId)] },
          ),
        async () => {
          const {
            path,
            workflow,
            seq: s,
          } = await api.workflows.blocks.connect.mutate(
            { workflowId, pathId, sourceBlockId, outcome, targetBlockId },
            ctx,
          );
          seq(s);
          return both(
            (d) =>
              mapVersion(d, (v) => ({
                ...v,
                paths: [
                  ...v.paths.filter(
                    (p) =>
                      p.id !== path.id &&
                      !(
                        p.sourceBlockId === sourceBlockId &&
                        p.outcome === outcome &&
                        p.targetBlockId === targetBlockId
                      ),
                  ),
                  path,
                ],
              })),
            withWorkflow(workflow),
          );
        },
        'Failed to connect blocks',
      );
    },

    disconnect(pathId: string) {
      return q.run(
        (d) => mapVersion(d, (v) => ({ ...v, paths: v.paths.filter((p) => p.id !== pathId) })),
        async () => {
          const { workflow, seq: s } = await api.workflows.blocks.disconnect.mutate({ workflowId, pathId }, ctx);
          seq(s);
          return withWorkflow(workflow);
        },
        'Failed to disconnect blocks',
      );
    },

    /** Paste: new blocks (fresh ids) and the paths between them, in one queued op. */
    paste(blocks: NewBlock[], paths: { source: string; outcome: string; target: string }[]) {
      const created = blocks.map((b) =>
        optimisticBlock(versionId, b.id as string, b.slug, b.position, b.config, b.description ?? null),
      );
      const newPaths = paths.map((p) => optimisticPath(versionId, newId(), p.source, p.outcome, p.target));
      return q.run(
        (d) => mapVersion(d, (v) => ({ ...v, blocks: [...v.blocks, ...created], paths: [...v.paths, ...newPaths] })),
        async () => {
          let patch: Patch = (d) => d;
          for (const b of blocks) {
            const p = await putBlock({
              workflowId,
              blockId: b.id as string,
              slug: b.slug,
              position: b.position,
              ...(b.config ? { config: b.config } : {}),
              ...(b.description ? { description: b.description } : {}),
            });
            patch = both(patch, p);
          }
          for (const path of newPaths) {
            const { seq: s } = await api.workflows.blocks.connect.mutate(
              {
                workflowId,
                pathId: path.id,
                sourceBlockId: path.sourceBlockId,
                outcome: path.outcome,
                targetBlockId: path.targetBlockId,
              },
              ctx,
            );
            seq(s);
          }
          return patch;
        },
        'Failed to paste blocks',
      );
    },

    /** Rename / description of the workflow (overview panel, breadcrumb title). */
    async renameWorkflow(patch: { title?: string | null; description?: string | null }) {
      await q.run(
        (d) => ({
          ...d,
          workflow: {
            ...d.workflow,
            ...patch,
            ...(patch.title !== undefined
              ? { displayTitle: patch.title || d.workflow.aiTitle || 'Untitled Workflow' }
              : {}),
          },
        }),
        async () => {
          const { workflow, seq: s } = await api.workflows.update.mutate({ workflowId, ...patch }, ctx);
          seq(s);
          writeWorkflow(queryClient, ws, workflow);
          return withWorkflow(workflow);
        },
        'Failed to update workflow title',
      );
    },
  };
}

export type EditorActions = ReturnType<typeof editorActions>;
