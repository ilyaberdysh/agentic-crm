// Public types of the editor package (contract).
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type { Editor } from '@tiptap/core';
import type { Block } from '../model/blocks.ts';
import type { CollabDenyReason } from '../model/collab.ts';

export type DocType = 'note' | 'note-template' | 'email-template' | 'insight-section';

/** The signed-in user as the editor shows them (the collab server re-asserts name and colour from the session). */
export interface EditorUser {
  /** Auth user id. */
  id: string;
  /** Workspace member id (colour seed). */
  memberId: string;
  name: string;
  avatarUrl?: string | null;
}

/** One option of the @-mention typeahead. Members are listed first ("Users"), then records ("Records"). */
export type MentionItem =
  | {
      kind: 'member';
      /** Workspace member id. */
      id: string;
      label: string;
      /** Show the member's email domain in muted text after the name. */
      secondary?: string | null;
      avatarUrl?: string | null;
    }
  | {
      kind: 'record';
      /** Entity instance id. */
      id: string;
      entityDefinitionId: string;
      label: string;
      /** Email or domain. */
      secondary?: string | null;
      avatarUrl?: string | null;
      /** Object noun ("Company", "Person") for the right-hand object badge's label. */
      objectName?: string | null;
      /** Avatar shape: people round, everything else box. */
      shape?: 'round' | 'box';
    };

/** Searches mentionable members and records; called on every keystroke after `@` (stale calls are aborted). */
export type MentionSearch = (query: string, options: { signal: AbortSignal }) => Promise<MentionItem[]>;

export interface UploadedImage {
  url: string;
  assetId: string;
  width?: number;
  height?: number;
}

/** Uploads an image (PNG, GIF or JPEG ≤ 20 MB, already validated) and returns where it lives. */
export type UploadImage = (file: File) => Promise<UploadedImage>;

/** One avatar per distinct viewer, including the current user. */
export interface PresenceUser {
  id: string;
  memberId: string;
  name: string;
  color: string;
  avatarUrl?: string | null;
  isSelf: boolean;
}

export type EditorStatus = 'connecting' | 'connected' | 'synced' | 'disconnected' | 'denied';

export type InsertItemId = 'h1' | 'h2' | 'h3' | 'body' | 'ul' | 'ol' | 'image';

/** Imperative handle passed to `onReady`. */
export interface EditorHandle {
  /** The TipTap editor (escape hatch). */
  editor: Editor;
  provider: HocuspocusProvider;
  focus(position?: 'start' | 'end'): void;
  /** True when the body has no text and no images. */
  isEmpty(): boolean;
  /** The current body as flat blocks. */
  getBlocks(): Block[];
  /** Appends blocks (e.g. a template); replaces the body when it is empty. */
  insertBlocks(blocks: Block[]): void;
  /** Runs an insert-menu item (heading, list, image…) at the current block. */
  runInsertItem(id: InsertItemId): void;
  /** Items the insert menus offer (Image only when `uploadImage` is set). */
  insertItems(): InsertItemId[];
  /** Whether the editor currently accepts input (synced, permitted, not read-only). */
  isEditable(): boolean;
}

export interface RichTextEditorProps {
  documentId: string;
  docType: DocType;
  /** WebSocket URL of the collab server, e.g. `ws://localhost:5173/collab`. */
  collabUrl: string;
  user: EditorUser;
  readOnly?: boolean;
  /** Defaults: notes "Start typing your note", templates "Start typing...". */
  placeholder?: string;
  autofocus?: boolean | 'start' | 'end';
  onReady?: (handle: EditorHandle) => void;
  mentionSearch?: MentionSearch;
  uploadImage?: UploadImage;
  /** Resolves a fresh URL for a stored image (signed URLs expire); defaults to the stored `src`. */
  resolveImageUrl?: (assetId: string) => string | Promise<string>;
  /** Distinct viewing users whenever presence changes (avatar stack data). */
  onAwarenessChange?: (users: PresenceUser[]) => void;
  onStatusChange?: (status: EditorStatus, detail?: { reason?: CollabDenyReason; readOnly?: boolean }) => void;
  /** Fired after local or remote changes, debounced to animation frames (e.g. to toggle an empty-state launcher). */
  onChange?: (state: { isEmpty: boolean }) => void;
  className?: string;
}
