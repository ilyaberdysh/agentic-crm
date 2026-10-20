// Editor tab `/automations/workflows/$id/editor` (BACKLOG 8.02–8.05; README §2.2–2.3, §3, §3.3, §3.5): the canvas,
// the unpublished-changes banner (Discard / Publish changes; publishing a live workflow asks first), the old-version
// banner (Back to current / Restore this version), the bottom toolbar, the side panel (overview + version history,
// block configuration, palette) and the canvas shortcuts: B add block, H / V tools, Delete, ⌘C / ⌘V, ⌘0, ⇧1, Esc.
import type { BlockDefinition, Position } from '@agentic-crm/contracts';
import { AlertDialog, Button, ContextMenu, Icon, IconButton, MenuItem, toast } from '@agentic-crm/ui';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { newId } from '../../../lib/ids';
import { isTypingTarget } from '../../../lib/shortcuts';
import { discardDraft, type PublishFailure, publishWorkflow, restoreVersion, useWorkflow, useWs } from '../data';
import type { WorkflowBlock, WorkflowPath } from '../types';
import { Canvas } from './canvas/Canvas';
import { CanvasToolbar, useZoomActions } from './canvas/CanvasToolbar';
import * as cs from './canvas/canvas.css';
import { loosePosition, nextPosition } from './canvas/geometry';
import { type EditorUi, EditorUiProvider, type PanelState } from './EditorContext';
import { EmptyEditor } from './EmptyEditor';
import { BlockPanel } from './panel/BlockPanel';
import { OverviewHeader, OverviewPanel, VersionHistory } from './panel/OverviewPanel';
import { Palette } from './panel/Palette';
import * as ps from './panel/panel.css';
import { useWorkflowPage } from './WorkflowLayout';

const PANEL_WIDTH = 400;

interface Clipboard {
  blocks: WorkflowBlock[];
  paths: WorkflowPath[];
}
let clipboard: Clipboard | null = null;

export function EditorTab() {
  return (
    <ReactFlowProvider>
      <Editor />
    </ReactFlowProvider>
  );
}

function Editor() {
  const page = useWorkflowPage();
  const ws = useWs();
  const flow = useReactFlow();
  const [panel, setPanelState] = useState<PanelState>({ kind: 'overview' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [tool, setTool] = useState<'pointer' | 'hand'>('pointer');
  const [highlight, setHighlight] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [failure, setFailure] = useState<PublishFailure | null>(null);
  const [confirm, setConfirm] = useState<'publish' | 'discard' | 'restore' | { deleteBlocks: string[] } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; blockId: string | null; flow: Position } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const old = useWorkflow(page.workflowId, viewing);
  const draft = page.detail.version;
  const version = useMemo(() => {
    if (viewing) return old.data?.version ?? draft;
    // Issues show once a block is touched (configured or connected) or after a refused publish (README §3.3).
    if (failure) return draft;
    const linked = new Set(draft.paths.flatMap((p) => [p.sourceBlockId, p.targetBlockId]));
    return {
      ...draft,
      blocks: draft.blocks.map((b) =>
        Object.keys(b.config.entries).length > 0 || linked.has(b.id) ? b : { ...b, issues: [] },
      ),
    };
  }, [viewing, old.data, draft, failure]);
  const readOnly = Boolean(viewing) || !page.canEdit;
  const w = page.detail.workflow;
  const empty = !viewing && draft.blocks.length === 0;
  const actions = page.actions;

  const inset = useMemo(
    () => ({ top: 80, right: collapsed ? 40 : PANEL_WIDTH + 52, bottom: 90, left: 40 }),
    [collapsed],
  );
  const zoom = useZoomActions(inset);

  const setPanel = useCallback((next: PanelState) => {
    setPanelState(next);
    setCollapsed(false);
    if (next.kind === 'block') setSelected(new Set([next.blockId]));
    else if (next.kind === 'overview' || next.kind === 'versions') setSelected(new Set());
  }, []);

  const selectBlock = useCallback(
    (blockId: string | null) => {
      setSelectedPath(null);
      if (blockId) setPanel({ kind: 'block', blockId });
      else setPanel({ kind: 'overview' });
    },
    [setPanel],
  );

  // Blocks removed elsewhere (another tab, delete) drop out of the selection.
  useEffect(() => {
    const ids = new Set(version.blocks.map((b) => b.id));
    if ([...selected].some((id) => !ids.has(id))) setSelected(new Set([...selected].filter((id) => ids.has(id))));
    if (panel.kind === 'block' && !ids.has(panel.blockId)) setPanelState({ kind: 'overview' });
  }, [version.blocks]);

  const ui: EditorUi = {
    page,
    version,
    readOnly,
    viewingVersionId: viewing,
    panel,
    setPanel,
    selectBlock,
    setHighlight,
    blockTitle: (id) =>
      version.blocks.find((b) => b.id === id)?.title ?? draft.blocks.find((b) => b.id === id)?.title ?? null,
    showRequired: failure !== null,
    viewVersion: (id) => {
      setViewing(id);
      setSelected(new Set());
      if (id) setPanelState({ kind: 'versions' });
    },
  };

  // ---- actions --------------------------------------------------------------------------------------------------------

  const addFromPalette = (def: BlockDefinition) => {
    if (panel.kind === 'palette' && panel.purpose === 'replace') {
      const block = draft.blocks.find((b) => b.id === panel.blockId);
      if (block && block.slug !== def.slug) void actions.replaceBlock(block, def.slug);
      setPanel({ kind: 'block', blockId: panel.blockId });
      return;
    }
    if (panel.kind === 'palette' && panel.purpose === 'next') {
      const id = actions.addBlock({ slug: def.slug, position: panel.position }, panel.from);
      setPanel({ kind: 'block', blockId: id });
      return;
    }
    const id = actions.addBlock({ slug: def.slug, position: loosePosition(draft.blocks) });
    setPanel({ kind: 'block', blockId: id });
  };

  const publish = async () => {
    setPublishing(true);
    await actions.queue.idle();
    const result = await publishWorkflow(ws, w.id);
    setPublishing(false);
    if (result.ok) {
      setFailure(null);
      toast.success(w.status === 'draft' ? 'Workflow published' : 'Changes published');
    } else {
      setFailure(result.failure);
      setPanel({ kind: 'overview' });
      toast.error({ title: result.failure.message });
    }
  };

  const organize = async () => {
    const res = await actions.organize();
    if (!res) return;
    if (!res.changed) {
      toast({ title: 'The blocks in this workflow are already organized' });
      return;
    }
    setTimeout(() => zoom.fit(), 50);
    toast.success({
      title: 'Blocks organized',
      action: { label: 'Undo', onAction: () => void actions.move(res.previous) },
    });
  };

  const copy = (ids: string[]) => {
    const blocks = draft.blocks.filter((b) => ids.includes(b.id));
    if (blocks.length === 0) return;
    const set = new Set(blocks.map((b) => b.id));
    clipboard = { blocks, paths: draft.paths.filter((p) => set.has(p.sourceBlockId) && set.has(p.targetBlockId)) };
    void navigator.clipboard?.writeText(JSON.stringify({ attioReWorkflowBlocks: clipboard })).catch(() => {});
    toast.success(`${blocks.length} ${blocks.length === 1 ? 'block' : 'blocks'} copied to clipboard`);
  };

  const paste = (at?: Position) => {
    if (!clipboard || readOnly) return;
    const ids = new Map(clipboard.blocks.map((b) => [b.id, newId()]));
    const minX = Math.min(...clipboard.blocks.map((b) => b.position.x));
    const minY = Math.min(...clipboard.blocks.map((b) => b.position.y));
    const origin = at ?? { x: minX + 70, y: minY + 70 };
    const remap = (config: WorkflowBlock['config']) => {
      let text = JSON.stringify(config);
      for (const [from, to] of ids) text = text.split(from).join(to);
      return JSON.parse(text) as WorkflowBlock['config'];
    };
    const blocks = clipboard.blocks.map((b) => ({
      id: ids.get(b.id) as string,
      slug: b.slug,
      position: { x: origin.x + (b.position.x - minX), y: origin.y + (b.position.y - minY) },
      config: remap(b.config),
      description: b.description,
    }));
    const paths = clipboard.paths.map((p) => ({
      source: ids.get(p.sourceBlockId) as string,
      outcome: p.outcome,
      target: ids.get(p.targetBlockId) as string,
    }));
    void actions.paste(blocks, paths);
    setSelected(new Set(blocks.map((b) => b.id)));
  };

  const deleteSelection = () => {
    if (readOnly) return;
    if (selectedPath) {
      void actions.disconnect(selectedPath);
      setSelectedPath(null);
      return;
    }
    const ids = [...selected];
    if (ids.length === 0) return;
    setConfirm({ deleteBlocks: ids });
  };

  // The "Select next step" placeholder must be visible left of the panel: pan the canvas when it is not.
  const root = useRef<HTMLDivElement>(null);
  const placeholderKey =
    panel.kind === 'palette' && panel.purpose === 'next' ? `${panel.position.x}:${panel.position.y}` : null;
  useEffect(() => {
    if (panel.kind !== 'palette' || panel.purpose !== 'next' || !root.current) return;
    const box = root.current.getBoundingClientRect();
    const right = flow.flowToScreenPosition({ x: panel.position.x + 240, y: panel.position.y + 100 });
    const limitX = box.right - (PANEL_WIDTH + 24);
    const limitY = box.bottom - 70;
    const vp = flow.getViewport();
    const dx = right.x > limitX ? right.x - limitX : 0;
    const dy = right.y > limitY ? right.y - limitY : 0;
    if (dx > 0 || dy > 0) void flow.setViewport({ ...vp, x: vp.x - dx, y: vp.y - dy }, { duration: 200 });
  }, [placeholderKey]);

  // ---- shortcuts ------------------------------------------------------------------------------------------------------

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target) || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === '0') {
      e.preventDefault();
      zoom.zoomTo100();
    } else if (mod && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      zoom.zoomIn();
    } else if (mod && e.key === '-') {
      e.preventDefault();
      zoom.zoomOut();
    } else if (e.shiftKey && e.key === '!') {
      zoom.fit();
    } else if (mod && e.key.toLowerCase() === 'c') {
      if (selected.size > 0) copy([...selected]);
    } else if (mod && e.key.toLowerCase() === 'v') {
      paste();
    } else if (mod) {
      return;
    } else if (e.key === 'b' || e.key === 'B') {
      if (!readOnly && !empty) {
        e.preventDefault();
        setPanel({ kind: 'palette', purpose: 'add' });
      }
    } else if (e.key === 'h' || e.key === 'H') setTool('hand');
    else if (e.key === 'v' || e.key === 'V') setTool('pointer');
    else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelection();
    else if (e.key === 'Escape') {
      if (panel.kind === 'palette')
        setPanel(selected.size === 1 ? { kind: 'block', blockId: [...selected][0] as string } : { kind: 'overview' });
      else selectBlock(null);
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ---- render ---------------------------------------------------------------------------------------------------------

  const panelBlock = panel.kind === 'block' ? version.blocks.find((b) => b.id === panel.blockId) : undefined;
  const placeholder =
    panel.kind === 'palette' && panel.purpose === 'next' ? { position: panel.position, from: panel.from } : null;
  const showBanner = !viewing && w.hasUnpublishedChanges && !empty;
  const center = collapsed || empty ? '50%' : `calc((100% - ${PANEL_WIDTH + 12}px) / 2)`;
  const bannerRight = collapsed || empty ? 12 : PANEL_WIDTH + 24;

  return (
    <EditorUiProvider value={ui}>
      <div ref={root} style={{ position: 'relative', flex: 1, minWidth: 0 }} data-testid="workflow-editor">
        <Canvas
          blocks={version.blocks}
          paths={version.paths}
          mode={readOnly ? 'view' : 'edit'}
          tool={tool}
          selectedIds={selected}
          onSelect={(ids) => {
            setSelected(new Set(ids));
            if (ids.length === 1) setPanelState({ kind: 'block', blockId: ids[0] as string });
            else if (ids.length === 0 && panel.kind === 'block') setPanelState({ kind: 'overview' });
            if (ids.length > 0) setCollapsed(false);
          }}
          selectedPathId={selectedPath}
          onSelectPath={setSelectedPath}
          highlightId={highlight}
          placeholder={placeholder}
          inset={inset}
          onConnect={(source, outcome, target) => void actions.connect(source, outcome, target)}
          onMove={(positions) => void actions.move(positions)}
          onAddNext={(blockId, outcome) => {
            const block = draft.blocks.find((b) => b.id === blockId);
            if (!block) return;
            setPanel({
              kind: 'palette',
              purpose: 'next',
              from: { blockId, outcome },
              position: nextPosition(block, outcome, draft.blocks),
            });
          }}
          onNodeContextMenu={(e: MouseEvent, blockId) => {
            if (!selected.has(blockId)) setSelected(new Set([blockId]));
            setMenu({
              x: e.clientX,
              y: e.clientY,
              blockId,
              flow: flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }),
            });
          }}
          onPaneContextMenu={(e) =>
            setMenu({
              x: e.clientX,
              y: e.clientY,
              blockId: null,
              flow: flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }),
            })
          }
          onPaneClick={() => {
            if (panel.kind !== 'versions') selectBlock(null);
          }}
        />
        {empty && (
          <EmptyEditor
            readOnly={readOnly}
            onTrigger={(def) => {
              const id = actions.addBlock({ slug: def.slug, position: { x: 0, y: 0 } });
              setPanel({ kind: 'block', blockId: id });
            }}
          />
        )}
        {showBanner && (
          <div className={cs.banner} style={{ right: bannerRight }} data-testid="unpublished-banner">
            <span className={cs.bannerText}>
              <Icon icon="info" size={16} />
              This workflow has unpublished changes
            </span>
            {w.latestPublishedVersionId && page.canEdit && (
              <Button variant="ghost" size={28} onPress={() => setConfirm('discard')} data-testid="discard-changes">
                Discard changes
              </Button>
            )}
            {page.canEdit && (
              <Button
                variant="primary"
                size={28}
                isPending={publishing}
                onPress={() => (w.status === 'draft' ? void publish() : setConfirm('publish'))}
                data-testid="publish-changes"
              >
                Publish changes
              </Button>
            )}
          </div>
        )}
        {viewing && (
          <div
            className={`${cs.banner} ${cs.bannerOld}`}
            style={{ right: bannerRight }}
            data-testid="old-version-banner"
          >
            <span className={cs.bannerText}>
              <Icon icon="history" size={16} />
              You are viewing an old version of this workflow
            </span>
            <Button variant="ghost" size={28} onPress={() => ui.viewVersion(null)} data-testid="back-to-current">
              Back to current
            </Button>
            {page.canEdit && (
              <Button variant="primary" size={28} onPress={() => setConfirm('restore')} data-testid="restore-version">
                Restore this version
              </Button>
            )}
          </div>
        )}
        {!empty && (
          <CanvasToolbar
            tool={tool}
            onTool={setTool}
            center={center}
            inset={inset}
            {...(!readOnly
              ? {
                  onAddBlock: () => setPanel({ kind: 'palette', purpose: 'add' }),
                  onOrganize: () => void organize(),
                }
              : {})}
          />
        )}
        {!empty && !collapsed && (
          <aside className={ps.panel} data-testid="side-panel" aria-label="Workflow side panel">
            {panel.kind === 'overview' || panel.kind === 'versions' ? (
              <>
                <OverviewHeader onCollapse={() => setCollapsed(true)} />
                <div className={ps.scroll} style={{ display: 'flex', flexDirection: 'column' }}>
                  {panel.kind === 'versions' ? <VersionHistory /> : <OverviewPanel failure={failure} />}
                </div>
              </>
            ) : panel.kind === 'palette' ? (
              <Palette
                purpose={panel.purpose}
                {...(panel.purpose === 'replace' ? { blockType: panel.blockType } : {})}
                onBack={() =>
                  setPanel(
                    panel.purpose === 'replace'
                      ? { kind: 'block', blockId: panel.blockId }
                      : panel.purpose === 'next'
                        ? { kind: 'block', blockId: panel.from.blockId }
                        : { kind: 'overview' },
                  )
                }
                onPick={addFromPalette}
              />
            ) : panelBlock ? (
              <>
                <div className={ps.topBar}>
                  <IconButton
                    icon="chevronLeft"
                    size={20}
                    aria-label="Back to workflow"
                    tooltip="Back to workflow"
                    onPress={() => selectBlock(null)}
                  />
                  <span className={ps.topSpacer} />
                  <IconButton
                    icon="wfCollapsePanel"
                    size={20}
                    aria-label="Collapse workflow side panel"
                    tooltip="Collapse"
                    onPress={() => setCollapsed(true)}
                  />
                </div>
                <div className={ps.scroll}>
                  <BlockPanel key={panelBlock.id} block={panelBlock} />
                </div>
              </>
            ) : null}
          </aside>
        )}
        {!empty && collapsed && (
          <div style={{ position: 'absolute', top: 10, right: 12, zIndex: 6 }}>
            <IconButton
              icon="sidebarRight"
              variant="secondary"
              size={28}
              aria-label="Expand workflow side panel"
              tooltip="Expand"
              onPress={() => setCollapsed(false)}
            />
          </div>
        )}
        {menu && (
          <ContextMenu
            isOpen
            onOpenChange={(o) => !o && setMenu(null)}
            x={menu.x}
            y={menu.y}
            width={200}
            aria-label={menu.blockId ? 'Block menu' : 'Canvas menu'}
            disabledKeys={clipboard && !readOnly ? [] : ['paste']}
            onAction={(key) => {
              if (key === 'copy') copy(selected.size > 0 ? [...selected] : menu.blockId ? [menu.blockId] : []);
              if (key === 'paste') paste(menu.flow);
              if (key === 'delete') deleteSelection();
            }}
          >
            {menu.blockId && (
              <MenuItem id="copy" icon="copy" shortcut={['mod', 'c']}>
                Copy block
              </MenuItem>
            )}
            <MenuItem id="paste" icon="paste" shortcut={['mod', 'v']}>
              Paste
            </MenuItem>
            {menu.blockId && !readOnly && (
              <MenuItem id="delete" icon="delete" variant="danger">
                {selected.size > 1 ? 'Delete blocks' : 'Delete block'}
              </MenuItem>
            )}
          </ContextMenu>
        )}
        <AlertDialog
          isOpen={confirm === 'publish'}
          onOpenChange={(o) => !o && setConfirm(null)}
          title="Are you sure you want to publish these changes?"
          description="Ongoing runs will not be affected by these changes."
          confirmLabel="Publish"
          variant="primary"
          onConfirm={() => {
            setConfirm(null);
            void publish();
          }}
        />
        <AlertDialog
          isOpen={confirm === 'discard'}
          onOpenChange={(o) => !o && setConfirm(null)}
          title="Are you sure you want to discard these changes?"
          description="This will discard all changes you have made to this workflow since you last published it."
          confirmLabel="Discard"
          onConfirm={() => {
            setConfirm(null);
            selectBlock(null);
            void actions.queue.idle().then(() => discardDraft(ws, w.id));
          }}
        />
        <AlertDialog
          isOpen={confirm === 'restore'}
          onOpenChange={(o) => !o && setConfirm(null)}
          title="Are you sure you want to restore this version?"
          description="Your current draft will be replaced with this version. Any unpublished changes will be lost."
          confirmLabel="Confirm"
          variant="primary"
          onConfirm={() => {
            const versionId = viewing;
            setConfirm(null);
            if (!versionId) return;
            void actions.queue.idle().then(async () => {
              if (await restoreVersion(ws, w.id, versionId)) {
                setViewing(null);
                setPanelState({ kind: 'versions' });
              }
            });
          }}
        />
        <AlertDialog
          isOpen={typeof confirm === 'object' && confirm !== null}
          onOpenChange={(o) => !o && setConfirm(null)}
          title={
            typeof confirm === 'object' && confirm && confirm.deleteBlocks.length > 1
              ? `Are you sure you want to delete these ${confirm.deleteBlocks.length} blocks?`
              : 'Are you sure you want to delete this block?'
          }
          description="This cannot be undone"
          confirmLabel="Delete"
          onConfirm={() => {
            if (typeof confirm === 'object' && confirm) {
              void actions.deleteBlocks(confirm.deleteBlocks);
              setSelected(new Set());
              setPanelState({ kind: 'overview' });
            }
            setConfirm(null);
          }}
        />
      </div>
    </EditorUiProvider>
  );
}
