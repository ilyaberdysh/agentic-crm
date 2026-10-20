// Mailbox → Signatures:
// empty state "No email signatures", or two columns: the signature pills (Default badge, ⋮ Set as default / Clear
// default / Delete, "+ New signature") and the editor (title input + rich-text box with the "+" Insert menu). The
// first signature created becomes the default (the server does it). Title and body autosave (600 ms, flushed when
// switching signatures or leaving); the body is editable by the mailbox owner only.
import { type Block, BlockEditor, type EmailEditorHandle } from '@agentic-crm/editor';
import {
  AlertDialog,
  Button,
  ErrorState,
  Icon,
  IconButton,
  LoadingState,
  Menu,
  MenuItem,
  MenuTrigger,
  Tag,
  TextInput,
  toast,
} from '@agentic-crm/ui';
import { useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import {
  type Mailbox,
  type MailboxSignature,
  useCreateSignature,
  useDeleteSignature,
  useSetDefaultSignature,
  useSignatures,
  useUpdateSignature,
} from './data';
import { useDebouncedSaver } from './debouncedSaver';
import { EmptyBlock } from './EmptyBlock';
import { Section } from './parts';
import * as s from './signatures.css';

const AUTOSAVE_MS = 600;

export function SignaturesTab({ mailbox, isOwner }: { mailbox: Mailbox; isOwner: boolean }) {
  const signatures = useSignatures(mailbox.id);
  const create = useCreateSignature(mailbox.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (signatures.isPending) return <LoadingState />;
  if (signatures.isError) {
    return (
      <ErrorState
        message="Failed to load signatures"
        actions={
          <Button variant="secondary" size={28} onPress={() => void signatures.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  const list = signatures.data;
  const selected = list.find((x) => x.id === selectedId) ?? list.find((x) => x.isDefault) ?? list[0] ?? null;

  const createSignature = () =>
    create.mutate(
      {},
      {
        onSuccess: (signature) => setSelectedId(signature.id),
        onError: (error) => toast.error({ title: 'Could not create the signature', description: error.message }),
      },
    );

  if (!selected) {
    return (
      <EmptyBlock
        testId="signatures-empty"
        icon="edit"
        title="No email signatures"
        description="Create multiple signatures for your mailbox."
        action={
          <Button variant="primary" size={32} icon="edit" isPending={create.isPending} onPress={createSignature}>
            Create first signature
          </Button>
        }
      />
    );
  }

  return (
    <Section
      id="signatures"
      title="Signatures"
      description="Create multiple signatures for your mailbox, and set up your default signature."
    >
      <div className={s.layout} data-testid="signatures">
        <div className={s.list} role="list" aria-label="Signatures">
          {list.map((signature) => (
            <SignatureItem
              key={signature.id}
              signature={signature}
              isSelected={signature.id === selected.id}
              onSelect={() => setSelectedId(signature.id)}
              onDeleted={() => setSelectedId(null)}
            />
          ))}
          <AriaButton className={s.newButton} onPress={createSignature} isDisabled={create.isPending}>
            <Icon icon="add" size={16} />
            New signature
          </AriaButton>
        </div>
        <SignatureEditor key={selected.id} signature={selected} canEdit={isOwner} />
      </div>
    </Section>
  );
}

function SignatureItem({
  signature,
  isSelected,
  onSelect,
  onDeleted,
}: {
  signature: MailboxSignature;
  isSelected: boolean;
  onSelect: () => void;
  onDeleted: () => void;
}) {
  const setDefault = useSetDefaultSignature();
  const remove = useDeleteSignature();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className={s.pill} role="listitem" data-selected={isSelected || undefined} data-testid="signature-item">
      <AriaButton className={s.pillMain} onPress={onSelect} aria-current={isSelected ? 'true' : undefined}>
        <span className={s.pillTitle}>{signature.title || 'Untitled'}</span>
        {signature.isDefault && <Tag color="blue">Default</Tag>}
      </AriaButton>
      <MenuTrigger>
        <IconButton icon="moreVertical" aria-label="Show menu" size={20} className={s.pillMenu} />
        <Menu
          aria-label={`Menu for ${signature.title || 'Untitled'}`}
          placement="bottom end"
          width={180}
          onAction={(key) => {
            if (key === 'default') {
              setDefault.mutate(
                { signatureId: signature.id, isDefault: !signature.isDefault },
                {
                  onError: (error) =>
                    toast.error({ title: 'Could not change the default', description: error.message }),
                },
              );
            } else if (key === 'delete') setConfirming(true);
          }}
        >
          <MenuItem id="default" icon="check">
            {signature.isDefault ? 'Clear default' : 'Set as default'}
          </MenuItem>
          <MenuItem id="delete" icon="delete" variant="danger">
            Delete
          </MenuItem>
        </Menu>
      </MenuTrigger>
      <AlertDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title="Are you sure?"
        description="This signature will be permanently deleted, this cannot be undone."
        onConfirm={() =>
          remove.mutate(signature.id, {
            onSuccess: onDeleted,
            onError: (error) => toast.error({ title: 'Could not delete the signature', description: error.message }),
          })
        }
      />
    </div>
  );
}

function SignatureEditor({ signature, canEdit }: { signature: MailboxSignature; canEdit: boolean }) {
  const update = useUpdateSignature();
  const [title, setTitle] = useState(signature.title);
  const [handle, setHandle] = useState<EmailEditorHandle | null>(null);
  const onError = (error: unknown) =>
    toast.error({
      title: 'Could not save the signature',
      description: error instanceof Error ? error.message : undefined,
    });
  const titleSaver = useDebouncedSaver<string>(
    (value) => update.mutateAsync({ signatureId: signature.id, title: value }).catch(onError),
    500,
  );
  const bodySaver = useDebouncedSaver<Block[]>(
    (blocks) => update.mutateAsync({ signatureId: signature.id, body: blocks }).catch(onError),
    AUTOSAVE_MS,
  );

  const insert = (key: string) => {
    if (!handle) return;
    const chain = handle.editor.chain().focus();
    if (key === 'body') chain.setNode('paragraph').run();
    else if (key === 'ul' || key === 'ol') chain.setListItem(key).run();
  };

  return (
    <div className={s.editorColumn} data-testid="signature-editor">
      <TextInput
        aria-label="Signature title"
        placeholder="Enter title"
        size={32}
        value={title}
        isReadOnly={!canEdit}
        onChange={(value) => {
          setTitle(value);
          titleSaver.schedule(value);
        }}
        onBlur={() => void titleSaver.flush()}
      />
      <div className={s.editorBox}>
        <BlockEditor
          className={s.editorHost}
          initialBlocks={signature.body as Block[]}
          resetKey={signature.id}
          placeholder="Start typing your signature..."
          ariaLabel="Signature body"
          testId="signature-body-editor"
          readOnly={!canEdit}
          onReady={setHandle}
          onChange={(blocks) => bodySaver.schedule(blocks)}
          onBlur={() => void bodySaver.flush()}
        />
        <div className={s.editorFooter}>
          {canEdit ? (
            <MenuTrigger>
              <Button variant="secondary" size="20" icon="add" aria-label="Insert" data-testid="signature-insert" />
              <Menu aria-label="Insert" placement="top start" width={260} onAction={(key) => insert(String(key))}>
                <MenuItem id="body" icon="attrText" description="Just start typing with plain text">
                  Body
                </MenuItem>
                <MenuItem id="ul" icon="viewList" description="Create a simple bulleted list">
                  Bulleted list
                </MenuItem>
                <MenuItem id="ol" icon="orderedList" description="Create a list with numbering">
                  Numbered list
                </MenuItem>
              </Menu>
            </MenuTrigger>
          ) : (
            <p className={s.readOnlyNote}>Only the mailbox owner can edit signatures.</p>
          )}
        </div>
      </div>
    </div>
  );
}
