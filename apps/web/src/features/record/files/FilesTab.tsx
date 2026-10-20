// Files tab (BACKLOG 3.06; D README §3.9, §4.4): folders first, then files; folders expand inline (children load
// lazily); the whole tab is a drop zone; "Upload file" accepts several files; "New folder" adds an inline row (Enter
// creates, Esc cancels); file / folder options (rename, download, upload into, subfolder, delete with confirm); a
// click opens the dark lightbox (images and PDFs preview, other files show icon, name, size and Download).
import {
  AlertDialog,
  Button,
  Icon,
  IconButton,
  type IconName,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  toast,
} from '@agentic-crm/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type DragEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, errorEnvelopeOf, inWorkspace } from '../../../data/trpc';
import { newId } from '../../../lib/ids';
import { useWorkspace } from '../../shell/workspaceContext';
import { type RecordRef, useRecordPage } from '../context';
import { recordKeys, type StorageEntry } from '../data';
import * as r from '../record.css';
import { EmptyIllustration } from '../ui/EmptyIllustration';
import * as s from './files.css';
import { formatBytes, UploadError, uploadFile } from './upload';

function useEntries(recordRef: RecordRef, folderId: string | null, enabled = true) {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: recordKeys.files(workspace.id, recordRef.entityDefinitionId, recordRef.entityInstanceId, folderId),
    queryFn: () =>
      api.files.list.query({ ...recordRef, parentFolderId: folderId }, inWorkspace(workspace)).then((o) => o.entries),
    enabled,
  });
}

function useRefreshFiles() {
  const { workspace } = useWorkspace();
  const { recordRef } = useRecordPage();
  const client = useQueryClient();
  return () =>
    client.invalidateQueries({
      queryKey: ['ws', workspace.id, 'storage-entry-list', recordRef.entityDefinitionId, recordRef.entityInstanceId],
    });
}

export function fileIcon(entry: Pick<StorageEntry, 'entryType' | 'contentType' | 'name'>): IconName {
  if (entry.entryType === 'folder') return 'fileTab';
  const type = entry.contentType ?? '';
  if (type.startsWith('image/')) return 'fileImage';
  if (type.startsWith('video/')) return 'fileVideo';
  if (type.startsWith('audio/')) return 'fileAudio';
  if (/zip|compressed|tar|gzip/.test(type)) return 'fileArchive';
  if (/pdf|text|document|msword|sheet|presentation/.test(type)) return 'fileDocument';
  return 'fileGeneric';
}

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function FilesTab() {
  const { recordRef } = useRecordPage();
  const { workspace } = useWorkspace();
  const root = useEntries(recordRef, null);
  const refresh = useRefreshFiles();
  const input = useRef<HTMLInputElement>(null);
  const [uploadInto, setUploadInto] = useState<string | null>(null);
  const [creatingIn, setCreatingIn] = useState<string | null | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [preview, setPreview] = useState<StorageEntry | null>(null);
  const dragDepth = useRef(0);

  const upload = async (files: File[], folderId: string | null) => {
    for (const file of files) {
      try {
        await uploadFile(workspace, { ...recordRef, parentFolderId: folderId }, file, (st) =>
          setStatus(`${st} ${file.name}`),
        );
        toast.success('File uploaded successfully');
      } catch (error) {
        toast.error(error instanceof UploadError ? error.message : 'Failed to upload file');
      }
    }
    setStatus(null);
    void refresh();
  };

  const chooseFiles = (folderId: string | null) => {
    setUploadInto(folderId);
    input.current?.click();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = [...e.dataTransfer.files];
    if (files.length > 0) void upload(files, null);
  };

  const entries = root.data ?? [];
  const actions = (
    <>
      <Button variant="secondary" size={28} icon="add" onPress={() => setCreatingIn(null)}>
        New folder
      </Button>
      <Button variant="secondary" size={28} icon="add" onPress={() => chooseFiles(null)}>
        Upload file
      </Button>
      <ProviderMenu />
    </>
  );

  return (
    <div
      className={s.tab}
      data-testid="files-tab"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="Browse files to upload"
        data-testid="file-input"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length > 0) void upload(files, uploadInto);
        }}
      />
      {root.isSuccess && entries.length === 0 && creatingIn === undefined ? (
        <div className={s.empty}>
          <EmptyIllustration icon="fileTab" />
          <div className={s.emptyTitle}>No files</div>
          <div className={s.emptyText}>Drag a file here or choose one from your computer.</div>
          <div className={s.emptyActions}>{actions}</div>
        </div>
      ) : (
        <>
          <div className={r.tabHeader}>
            <h2 className={r.tabTitle}>Files</h2>
            <div className={r.tabHeaderActions}>{actions}</div>
          </div>
          {status && <div className={s.status}>{status}…</div>}
          <div className={s.list} role="tree" aria-label="Files">
            {creatingIn === null && <NewFolderRow parentId={null} depth={0} onDone={() => setCreatingIn(undefined)} />}
            {entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                depth={0}
                onUploadInto={chooseFiles}
                creatingIn={creatingIn}
                setCreatingIn={setCreatingIn}
                onOpen={setPreview}
              />
            ))}
          </div>
        </>
      )}
      {dragging && <div className={s.dropOverlay}>Drop files to upload</div>}
      {preview && <Lightbox entry={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function ProviderMenu() {
  return (
    <MenuTrigger>
      <IconButton icon="moreVertical" variant="secondary" size={28} aria-label="Third party provider menu" />
      <Menu aria-label="Third party provider" placement="bottom end" width={300}>
        <MenuItem
          id="none"
          isDisabled
          description="Connect Google Drive, Microsoft OneDrive, Dropbox, or Box to start linking your files and folders."
        >
          No connected accounts
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}

function EntryRow({
  entry,
  depth,
  onUploadInto,
  creatingIn,
  setCreatingIn,
  onOpen,
}: {
  entry: StorageEntry;
  depth: number;
  onUploadInto: (folderId: string) => void;
  creatingIn: string | null | undefined;
  setCreatingIn: (id: string | null | undefined) => void;
  onOpen: (entry: StorageEntry) => void;
}) {
  const { recordRef } = useRecordPage();
  const { workspace } = useWorkspace();
  const refresh = useRefreshFiles();
  const isFolder = entry.entryType === 'folder';
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const children = useEntries(recordRef, entry.id, isFolder && (open || creatingIn === entry.id));

  const rename = async (name: string) => {
    setRenaming(false);
    if (!name.trim() || name === entry.name) return;
    try {
      await api.files.rename.mutate({ entryId: entry.id, name: name.trim() }, inWorkspace(workspace));
      void refresh();
    } catch (error) {
      toast.error({ title: 'Failed to rename', description: errorEnvelopeOf(error).message });
    }
  };
  const remove = async () => {
    try {
      await api.files.delete.mutate({ entryId: entry.id }, inWorkspace(workspace));
      toast(isFolder ? 'Folder deleted' : 'File deleted');
      void refresh();
    } catch (error) {
      toast.error({ title: 'Failed to delete', description: errorEnvelopeOf(error).message });
    }
  };
  const download = async () => {
    try {
      const { url } = await api.files.downloadUrl.query({ entryId: entry.id }, inWorkspace(workspace));
      window.open(url, '_blank', 'noopener');
    } catch (error) {
      toast.error({ title: 'Failed to download', description: errorEnvelopeOf(error).message });
    }
  };

  const indent = { paddingLeft: 8 + depth * 24 };
  return (
    <>
      {renaming ? (
        <div className={s.row} style={indent}>
          <Icon icon={fileIcon(entry)} size={16} className={s.rowIcon} />
          <NameInput initial={entry.name} onCommit={(n) => void rename(n)} onCancel={() => setRenaming(false)} />
        </div>
      ) : (
        <div
          className={s.row}
          style={indent}
          role="treeitem"
          aria-expanded={isFolder ? open : undefined}
          tabIndex={0}
          data-testid="file-row"
          data-entry-type={entry.entryType}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            if (isFolder) setOpen((o) => !o);
            else onOpen(entry);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.target !== e.currentTarget) return;
            if (isFolder) setOpen((o) => !o);
            else onOpen(entry);
          }}
        >
          <Icon icon={fileIcon(entry)} size={16} className={s.rowIcon} />
          <span className={s.name}>{entry.name}</span>
          {!isFolder && <span className={s.size}>({formatBytes(entry.contentSize)})</span>}
          {isFolder && entry.hasChildren && (
            <Icon icon="chevronDown" size={12} className={s.chevron} data-open={open || undefined} />
          )}
          <span className={s.spacer} />
          {!isFolder && <span className={s.date}>{dateFormat.format(new Date(entry.createdAt))}</span>}
          <MenuTrigger>
            <IconButton
              icon="moreVertical"
              variant="ghost"
              size={20}
              aria-label={isFolder ? 'Folder options' : 'File options'}
            />
            <Menu
              aria-label={isFolder ? 'Folder options' : 'File options'}
              placement="bottom end"
              width={220}
              onAction={(k) => {
                if (k === 'rename') setRenaming(true);
                if (k === 'download') void download();
                if (k === 'upload') onUploadInto(entry.id);
                if (k === 'subfolder') {
                  setOpen(true);
                  setCreatingIn(entry.id);
                }
                if (k === 'delete') setConfirming(true);
              }}
            >
              <MenuItem id="rename" icon="edit">
                Rename
              </MenuItem>
              {!isFolder && (
                <MenuItem id="download" icon="download">
                  Download ({formatBytes(entry.contentSize)})
                </MenuItem>
              )}
              {isFolder && (
                <MenuItem id="upload" icon="upload">
                  Upload file
                </MenuItem>
              )}
              {isFolder && (
                <MenuItem id="subfolder" icon="folderAdd">
                  Create subfolder
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem id="delete" icon="delete" variant="danger">
                Delete
              </MenuItem>
            </Menu>
          </MenuTrigger>
        </div>
      )}
      {isFolder && creatingIn === entry.id && (
        <NewFolderRow parentId={entry.id} depth={depth + 1} onDone={() => setCreatingIn(undefined)} />
      )}
      {isFolder &&
        open &&
        (children.data ?? []).map((child) => (
          <EntryRow
            key={child.id}
            entry={child}
            depth={depth + 1}
            onUploadInto={onUploadInto}
            creatingIn={creatingIn}
            setCreatingIn={setCreatingIn}
            onOpen={onOpen}
          />
        ))}
      <AlertDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title={isFolder ? 'Delete folder' : 'Delete file'}
        description={
          isFolder
            ? 'Are you sure you want to delete this folder and everything inside it?'
            : 'Are you sure you want to delete this file?'
        }
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          setConfirming(false);
          void remove();
        }}
      />
    </>
  );
}

function NameInput({
  initial,
  onCommit,
  onCancel,
  placeholder,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      done.current = true;
      onCommit(value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      done.current = true;
      onCancel();
    }
  };
  return (
    <input
      className={s.nameInput}
      autoFocus
      aria-label="Name"
      placeholder={placeholder}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => {
        if (!done.current) onCancel();
      }}
    />
  );
}

/** "New folder": inline row "Enter Name"; Enter creates (toast "Folder created"), Esc cancels without creating. */
function NewFolderRow({ parentId, depth, onDone }: { parentId: string | null; depth: number; onDone: () => void }) {
  const { recordRef } = useRecordPage();
  const { workspace } = useWorkspace();
  const refresh = useRefreshFiles();
  const create = async (name: string) => {
    onDone();
    if (!name.trim()) return;
    try {
      await api.files.createFolder.mutate(
        { id: newId(), ...recordRef, parentFolderId: parentId, name: name.trim() },
        inWorkspace(workspace),
      );
      toast.success('Folder created');
      void refresh();
    } catch (error) {
      toast.error({ title: 'Failed to create folder', description: errorEnvelopeOf(error).message });
    }
  };
  return (
    <div className={s.row} style={{ paddingLeft: 8 + depth * 24 }} data-testid="new-folder-row">
      <Icon icon="fileTab" size={16} className={s.rowIcon} />
      <NameInput initial="" placeholder="Enter Name" onCommit={(n) => void create(n)} onCancel={onDone} />
    </div>
  );
}

/** Dark full-screen viewer: title + Download + Close; images and PDFs preview inline. */
function Lightbox({ entry, onClose }: { entry: StorageEntry; onClose: () => void }) {
  const { workspace } = useWorkspace();
  const previewable = /^image\/|^application\/pdf$|^text\/plain$/.test(entry.contentType ?? '');
  const url = useQuery({
    queryKey: ['ws', workspace.id, 'storage-entry-list', 'download-url', entry.id],
    queryFn: () => api.files.downloadUrl.query({ entryId: entry.id, disposition: 'inline' }, inWorkspace(workspace)),
    enabled: previewable,
    staleTime: 60_000,
  });
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const download = async () => {
    const { url: href } = await api.files.downloadUrl.query({ entryId: entry.id }, inWorkspace(workspace));
    window.open(href, '_blank', 'noopener');
  };
  return createPortal(
    <div className={s.lightbox} role="dialog" aria-label={entry.name} data-testid="file-lightbox">
      <div className={s.lightboxBar}>
        <span className={s.lightboxTitle}>{entry.name}</span>
        <Button variant="secondary" size={28} icon="download" onPress={() => void download()}>
          Download
        </Button>
        <IconButton icon="close" variant="ghost" size={28} aria-label="Close" onPress={onClose} />
      </div>
      <div className={s.lightboxBody}>
        {previewable && url.data ? (
          entry.contentType?.startsWith('image/') ? (
            <img src={url.data.url} alt={entry.name} className={s.lightboxImage} />
          ) : (
            <iframe src={url.data.url} title={entry.name} className={s.lightboxFrame} />
          )
        ) : (
          <div className={s.lightboxCard}>
            <Icon icon={fileIcon(entry)} size={40} />
            <span>{entry.name}</span>
            <span className={s.lightboxMeta}>{formatBytes(entry.contentSize)}</span>
            <Button variant="primary" size={28} icon="download" onPress={() => void download()}>
              Download
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
