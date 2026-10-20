// Image insertion and upload (E editor.md §7): PNG / GIF / JPEG only, max 20 MB; file picker, paste and drop.
// The image block is inserted immediately with a client upload id (other editors see a placeholder of the right
// size, this one a local preview); when the host's `uploadImage` resolves, the block gets its src + asset id.
import { toast } from '@agentic-crm/ui';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { UploadImage } from './types.ts';

export const IMAGE_ACCEPT = 'image/png,image/gif,image/jpeg';
export const IMAGE_TYPES = ['image/png', 'image/gif', 'image/jpeg'];
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export const UNSUPPORTED_IMAGE_MESSAGE = 'Only JPEG, PNG and GIF images are supported';
export const IMAGE_TOO_LARGE_MESSAGE = 'Image too large';

function newUploadId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

async function naturalSize(file: File): Promise<{ width: number; height: number } | null> {
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    }
  } catch {
    // fall through
  }
  return null;
}

function findUpload(doc: PMNode, uploadId: string): { pos: number; node: PMNode } | null {
  let found: { pos: number; node: PMNode } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === 'image' && node.attrs.uploadId === uploadId) {
      found = { pos, node };
      return false;
    }
    return node.isBlock;
  });
  return found;
}

/** Per-editor upload state: local previews keyed by upload id. */
export class ImageUploads {
  private readonly previews = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(private readonly upload: () => UploadImage | undefined) {}

  get enabled(): boolean {
    return this.upload() !== undefined;
  }

  preview(uploadId: string | null | undefined): string | null {
    return uploadId ? (this.previews.get(uploadId) ?? null) : null;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private changed(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** The validation message for a file, or null when it can be uploaded. */
  validate(file: File): string | null {
    if (!IMAGE_TYPES.includes(file.type)) return UNSUPPORTED_IMAGE_MESSAGE;
    if (file.size > MAX_IMAGE_BYTES) return IMAGE_TOO_LARGE_MESSAGE;
    return null;
  }

  /** Inserts an image block for `file` (at `pos`, or after the current block) and uploads it. */
  async insert(editor: Editor, file: File, pos?: number): Promise<void> {
    const upload = this.upload();
    if (!upload) return;
    const problem = this.validate(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    const uploadId = newUploadId();
    const size = await naturalSize(file);
    if (typeof URL !== 'undefined' && 'createObjectURL' in URL) this.previews.set(uploadId, URL.createObjectURL(file));
    this.changed();
    const attrs = { uploadId, width: size?.width ?? null, height: size?.height ?? null, src: null, assetId: null };
    if (pos === undefined) editor.chain().focus().insertImage(attrs).run();
    else editor.chain().insertContentAt(pos, { type: 'image', attrs }).run();
    await this.complete(editor, uploadId, file, upload);
  }

  /** Uploads `file` as the new content of the image at `pos` (image options → Replace). */
  async replace(editor: Editor, pos: number, file: File): Promise<void> {
    const upload = this.upload();
    if (!upload) return;
    const problem = this.validate(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    const uploadId = newUploadId();
    const size = await naturalSize(file);
    if (typeof URL !== 'undefined' && 'createObjectURL' in URL) this.previews.set(uploadId, URL.createObjectURL(file));
    this.changed();
    const node = editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'image') return;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        uploadId,
        src: null,
        assetId: null,
        width: size?.width ?? node.attrs.width,
        height: size?.height ?? node.attrs.height,
      }),
    );
    await this.complete(editor, uploadId, file, upload);
  }

  private async complete(editor: Editor, uploadId: string, file: File, upload: UploadImage): Promise<void> {
    try {
      const result = await upload(file);
      if (editor.isDestroyed) return;
      const found = findUpload(editor.state.doc, uploadId);
      if (!found) return;
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(found.pos, undefined, {
          ...found.node.attrs,
          src: result.url,
          assetId: result.assetId,
          uploadId: null,
          width: result.width ?? found.node.attrs.width,
          height: result.height ?? found.node.attrs.height,
        }),
      );
    } catch {
      if (!editor.isDestroyed) {
        const found = findUpload(editor.state.doc, uploadId);
        if (found) editor.view.dispatch(editor.state.tr.delete(found.pos, found.pos + found.node.nodeSize));
      }
      toast.error('Image upload failed');
    } finally {
      const preview = this.previews.get(uploadId);
      // Keep the preview until the real image has had a moment to load, then release it.
      if (preview)
        setTimeout(() => {
          URL.revokeObjectURL(preview);
          this.previews.delete(uploadId);
          this.changed();
        }, 10_000);
    }
  }

  destroy(): void {
    for (const url of this.previews.values()) URL.revokeObjectURL(url);
    this.previews.clear();
    this.listeners.clear();
  }
}

function imageFiles(list: FileList | null | undefined): File[] {
  return list ? [...list].filter((f) => f.type.startsWith('image/')) : [];
}

/** Paste and drop of image files. */
export function imagePastePlugin(editor: () => Editor | null, uploads: ImageUploads): Plugin {
  return new Plugin({
    key: new PluginKey('agenticCrmImagePaste'),
    props: {
      handlePaste: (_view, event) => {
        const files = imageFiles(event.clipboardData?.files);
        const current = editor();
        if (files.length === 0 || !current || !uploads.enabled) return false;
        event.preventDefault();
        for (const file of files) void uploads.insert(current, file);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = imageFiles(event.dataTransfer?.files);
        const current = editor();
        if (files.length === 0 || !current || !uploads.enabled) return false;
        event.preventDefault();
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        const $pos = coords ? view.state.doc.resolve(coords.pos) : null;
        const at = $pos && $pos.depth > 0 ? $pos.after(1) : (coords?.pos ?? view.state.doc.content.size);
        for (const file of files) void uploads.insert(current, file, at);
        return true;
      },
    },
  });
}

/** Opens the native file picker for images. */
export function pickImageFile(onFile: (file: File) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = IMAGE_ACCEPT;
  input.style.display = 'none';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.remove();
    if (file) onFile(file);
  });
  document.body.appendChild(input);
  input.click();
}
