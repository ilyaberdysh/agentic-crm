// Bottom toolbar: zoom menu ("100% ⌄": Zoom in, Zoom out, Zoom to 100%,
// Fit to view), hand tool, pointer (V, default, pressed), "Add block B" and "Organize blocks". The run viewer shows
// the zoom and the two tools only.
import { Button, IconButton, Kbd, Menu, MenuItem, MenuSeparator, MenuTrigger, Tooltip } from '@agentic-crm/ui';
import { useReactFlow, useViewport } from '@xyflow/react';
import * as s from './canvas.css';
import { type Inset, useFitToArea } from './viewport';

export interface CanvasToolbarProps {
  tool: 'pointer' | 'hand';
  onTool: (tool: 'pointer' | 'hand') => void;
  /** Centre of the toolbar (px from the canvas's left edge). */
  center: number | string;
  inset: Inset;
  onAddBlock?: () => void;
  onOrganize?: () => void;
}

export function useZoomActions(inset: Inset) {
  const flow = useReactFlow();
  const fitToArea = useFitToArea(inset);
  return {
    zoomIn: () => void flow.zoomIn({ duration: 150 }),
    zoomOut: () => void flow.zoomOut({ duration: 150 }),
    zoomTo100: () => void flow.zoomTo(1, { duration: 150 }),
    fit: () => fitToArea({ fit: true, duration: 200 }),
  };
}

export function CanvasToolbar({ tool, onTool, center, inset, onAddBlock, onOrganize }: CanvasToolbarProps) {
  const { zoom } = useViewport();
  const z = useZoomActions(inset);
  return (
    <div
      className={s.toolbar}
      style={{ left: center }}
      role="toolbar"
      aria-label="Canvas tools"
      data-testid="canvas-toolbar"
    >
      <MenuTrigger>
        <Button variant="ghost" size={32} icon="search" chevron className={s.zoomButton} data-testid="zoom-menu">
          {`${Math.round(zoom * 100)}%`}
        </Button>
        <Menu
          aria-label="Zoom"
          placement="top start"
          width={220}
          onAction={(key) => {
            if (key === 'in') z.zoomIn();
            if (key === 'out') z.zoomOut();
            if (key === '100') z.zoomTo100();
            if (key === 'fit') z.fit();
          }}
        >
          <MenuItem id="in" icon="wfZoomIn" shortcut={['mod', '+']}>
            Zoom in
          </MenuItem>
          <MenuItem id="out" icon="wfZoomOut" shortcut={['mod', '-']}>
            Zoom out
          </MenuItem>
          <MenuItem id="100" icon="search" shortcut={['mod', '0']}>
            Zoom to 100%
          </MenuItem>
          <MenuSeparator />
          <MenuItem id="fit" icon="expand" shortcut={['shift', '1']}>
            Fit to view
          </MenuItem>
        </Menu>
      </MenuTrigger>
      <IconButton
        icon="wfHand"
        size={28}
        aria-label="Hand tool"
        tooltip="Drag mode"
        tooltipShortcut={['h']}
        aria-pressed={tool === 'hand'}
        className={tool === 'hand' ? s.modeOn : undefined}
        onPress={() => onTool('hand')}
        data-testid="tool-hand"
      />
      <IconButton
        icon="wfPointer"
        size={28}
        aria-label="Pointer tool"
        tooltip="Select mode"
        tooltipShortcut={['v']}
        aria-pressed={tool === 'pointer'}
        className={tool === 'pointer' ? s.modeOn : undefined}
        onPress={() => onTool('pointer')}
        data-testid="tool-pointer"
      />
      {onAddBlock && (
        <>
          <span className={s.toolbarDivider} />
          <Tooltip content="Add block" shortcut={['b']}>
            <Button variant="ghost" size={32} icon="wfLoop" onPress={onAddBlock} data-testid="add-block">
              Add block
              <Kbd keys={['b']} size={20} />
            </Button>
          </Tooltip>
        </>
      )}
      {onOrganize && (
        <IconButton
          icon="wfOrganize"
          size={28}
          aria-label="Organize blocks"
          tooltip="Organize blocks"
          onPress={onOrganize}
          data-testid="organize-blocks"
        />
      )}
    </div>
  );
}
