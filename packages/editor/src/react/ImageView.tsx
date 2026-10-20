// Image block node view (E editor.md §7 "Display", "Image options"): natural size up to the column width, aligned
// centre by default; side handles resize with the aspect ratio kept (min 100 px); a hover "⋯" button opens
// Duplicate, Download, Replace, Add caption, Align ▸, Delete. Enter adds a paragraph after a selected image, Shift+Enter
// before; Backspace/Delete remove it.
import { IconButton, Menu, MenuItem, MenuSeparator, MenuTrigger, Submenu } from '@agentic-crm/ui';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { type NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { AlignCenter, AlignLeft, AlignRight, Captions, Copy, Download, Ellipsis, RefreshCw, Trash } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Image as ImageNode } from '../extensions/nodes.ts';
import type { ImageAlignment } from '../model/blocks.ts';
import * as s from './content.css.ts';
import { type ImageUploads, pickImageFile } from './images.ts';

const MIN_WIDTH = 100;

export interface ImageViewOptions {
  uploads: ImageUploads | null;
  resolveImageUrl: ((assetId: string) => string | Promise<string>) | undefined;
}

function useResolvedSrc(src: string | null, assetId: string | null, options: ImageViewOptions): string | null {
  const [resolved, setResolved] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setResolved(null);
    const resolve = options.resolveImageUrl;
    if (assetId && resolve) {
      Promise.resolve(resolve(assetId))
        .then((url) => {
          if (!cancelled) setResolved(url);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [assetId, options.resolveImageUrl]);
  return resolved ?? src;
}

function ImageView({ node, updateAttributes, deleteNode, selected, editor, getPos, extension }: NodeViewProps) {
  const options = extension.options as ImageViewOptions;
  const uploads = options.uploads;
  useSyncExternalStore(uploads?.subscribe ?? noopSubscribe, uploads?.getVersion ?? zero, uploads?.getVersion ?? zero);
  const attrs = node.attrs as {
    src: string | null;
    assetId: string | null;
    uploadId: string | null;
    width: number | null;
    height: number | null;
    alignment: ImageAlignment;
    caption: string | null;
  };
  const remoteSrc = useResolvedSrc(attrs.src, attrs.assetId, options);
  const src = remoteSrc ?? uploads?.preview(attrs.uploadId) ?? null;
  const editable = editor.isEditable;
  const frameRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLInputElement>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [captionFocus, setCaptionFocus] = useState(false);
  const ratio = attrs.width && attrs.height ? attrs.height / attrs.width : null;
  const width = dragWidth ?? attrs.width;

  const pos = () => (typeof getPos === 'function' ? getPos() : undefined);

  const startResize = (side: 'left' | 'right') => (event: React.PointerEvent) => {
    if (!editable) return;
    event.preventDefault();
    event.stopPropagation();
    const frame = frameRef.current;
    const container = frame?.closest('.ProseMirror') as HTMLElement | null;
    if (!frame) return;
    const startX = event.clientX;
    const startWidth = frame.getBoundingClientRect().width;
    const maxWidth = container?.clientWidth ?? startWidth;
    const factor = attrs.alignment === 'center' ? 2 : 1;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    let latest = startWidth;
    const onMove = (e: PointerEvent) => {
      const dx = (e.clientX - startX) * (side === 'right' ? 1 : -1) * factor;
      latest = Math.round(Math.max(MIN_WIDTH, Math.min(maxWidth, startWidth + dx)));
      setDragWidth(latest);
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      setDragWidth(null);
      updateAttributes({ width: latest, height: ratio ? Math.round(latest * ratio) : attrs.height });
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  };

  const onAction = (key: React.Key) => {
    const at = pos();
    switch (key) {
      case 'duplicate':
        if (at !== undefined)
          editor
            .chain()
            .insertContentAt(at + node.nodeSize, { type: 'image', attrs: { ...attrs, uploadId: null } })
            .run();
        return;
      case 'download':
        if (src) {
          const a = document.createElement('a');
          a.href = src;
          a.download = '';
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.click();
        }
        return;
      case 'replace':
        if (uploads && at !== undefined) pickImageFile((file) => void uploads.replace(editor, at, file));
        return;
      case 'caption':
        if (attrs.caption === null) updateAttributes({ caption: '' });
        requestAnimationFrame(() => captionRef.current?.focus());
        return;
      case 'align-left':
      case 'align-center':
      case 'align-right':
        updateAttributes({ alignment: String(key).slice('align-'.length) });
        return;
      case 'delete':
        deleteNode();
        return;
    }
  };

  const showCaption = attrs.caption !== null && (attrs.caption !== '' || captionFocus || editable);

  return (
    <NodeViewWrapper
      as="figure"
      className={s.figure}
      data-align={attrs.alignment}
      data-selected={selected}
      data-resizing={dragWidth !== null}
      data-drag-handle=""
    >
      <div ref={frameRef} className={s.frame} style={width ? { width } : undefined} contentEditable={false}>
        {src ? (
          <img
            className={`${s.image} agentic-crm-note-image`}
            src={src}
            alt={attrs.caption ?? ''}
            draggable={false}
            width={attrs.width ?? undefined}
            height={attrs.height ?? undefined}
          />
        ) : (
          <span
            className={s.imagePlaceholder}
            style={ratio && width ? { height: Math.round(width * ratio) } : undefined}
            role="img"
            aria-label="Uploading image"
          />
        )}
        {editable ? (
          <>
            <span className={`${s.resizeHandle} ${s.resizeHandleLeft}`} onPointerDown={startResize('left')} />
            <span className={`${s.resizeHandle} ${s.resizeHandleRight}`} onPointerDown={startResize('right')} />
            <span className={s.imageMenuButton} style={{ background: 'transparent', boxShadow: 'none' }}>
              <MenuTrigger>
                <IconButton icon={Ellipsis} aria-label="Image options" variant="secondary" size={28} />
                <Menu placement="bottom end" width={180} onAction={onAction}>
                  <MenuItem id="duplicate" icon={Copy}>
                    Duplicate
                  </MenuItem>
                  <MenuItem id="download" icon={Download} isDisabled={!src}>
                    Download
                  </MenuItem>
                  {uploads?.enabled ? (
                    <MenuItem id="replace" icon={RefreshCw}>
                      Replace
                    </MenuItem>
                  ) : null}
                  <MenuItem id="caption" icon={Captions}>
                    {attrs.caption === null ? 'Add caption' : 'Edit caption'}
                  </MenuItem>
                  <Submenu label="Align" icon={AlignCenter}>
                    <MenuItem id="align-left" icon={AlignLeft} onAction={() => onAction('align-left')}>
                      Left
                    </MenuItem>
                    <MenuItem id="align-center" icon={AlignCenter} onAction={() => onAction('align-center')}>
                      Center
                    </MenuItem>
                    <MenuItem id="align-right" icon={AlignRight} onAction={() => onAction('align-right')}>
                      Right
                    </MenuItem>
                  </Submenu>
                  <MenuSeparator />
                  <MenuItem id="delete" icon={Trash} variant="danger">
                    Delete
                  </MenuItem>
                </Menu>
              </MenuTrigger>
            </span>
          </>
        ) : null}
      </div>
      {showCaption ? (
        <input
          ref={captionRef}
          className={s.caption}
          value={attrs.caption ?? ''}
          placeholder="Write a caption..."
          maxLength={256}
          readOnly={!editable}
          onFocus={() => setCaptionFocus(true)}
          onBlur={() => {
            setCaptionFocus(false);
            if (attrs.caption === '') updateAttributes({ caption: null });
          }}
          onChange={(e) => updateAttributes({ caption: e.target.value.slice(0, 256) })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const at = pos();
              if (at !== undefined) {
                const after = at + node.nodeSize;
                editor
                  .chain()
                  .insertContentAt(after, { type: 'paragraph' })
                  .command(({ tr }) => {
                    tr.setSelection(TextSelection.create(tr.doc, after + 1));
                    return true;
                  })
                  .focus()
                  .run();
              }
            }
          }}
          style={{ width: width ?? undefined }}
        />
      ) : null}
    </NodeViewWrapper>
  );
}

const noopSubscribe = () => () => {};
const zero = () => 0;

/** The schema's image node plus the React node view and the image keyboard behaviour. */
export const EditorImage = ImageNode.extend<ImageViewOptions>({
  addOptions() {
    return { uploads: null, resolveImageUrl: undefined };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
  addKeyboardShortcuts() {
    const insertParagraph = (before: boolean) => () => {
      const { selection } = this.editor.state;
      if (!(selection instanceof NodeSelection) || selection.node.type.name !== this.name) return false;
      const at = before ? selection.from : selection.to;
      return this.editor
        .chain()
        .insertContentAt(at, { type: 'paragraph' })
        .command(({ tr }) => {
          tr.setSelection(TextSelection.create(tr.doc, at + 1));
          return true;
        })
        .scrollIntoView()
        .run();
    };
    return { Enter: insertParagraph(false), 'Shift-Enter': insertParagraph(true) };
  },
});
