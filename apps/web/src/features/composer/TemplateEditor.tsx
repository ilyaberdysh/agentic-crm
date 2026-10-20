// The email template editor (F composer §2.12, §6; evidence/F/template-editor-options.png): Subject row, body, footer
// with the attachment / image / variable tools, "⋮ Email template options" (Add to favorites, Delete template) and
// "Use template". Used inside the composer window ("Create email template") and as the centred dialog of the Templates
// page (808 × 548, editable title). Subject and body autosave (~600 ms) through `email.templates.update`.
import { type Block, BlockEditor, LineEditor, type LineValue } from '@agentic-crm/editor';
import {
  AlertDialog,
  Button,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Skeleton,
  toast,
} from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useWs } from '../mailboxes/data';
import * as s from './composer.css';
import { updateTemplate, useDeleteTemplate, useFavoriteTemplate, useTemplate } from './data';
import { VariableGlyph } from './glyphs';
import { openComposer } from './open';
import { useVariableUi } from './useVariableUi';

export type TemplateVariant = 'composer' | 'dialog';

interface Pending {
  title?: string;
  subject?: LineValue;
  body?: Block[];
}

export function TemplateEditor({
  templateId,
  variant,
  onBack,
  onClose,
  className,
}: {
  templateId: string;
  variant: TemplateVariant;
  /** Composer variant: ‹ back to the draft. */
  onBack?: () => void;
  onClose: () => void;
  className?: string;
}) {
  const ws = useWs();
  const client = useQueryClient();
  const template = useTemplate(templateId);
  const favorite = useFavoriteTemplate();
  const remove = useDeleteTemplate();
  const vars = useVariableUi();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [title, setTitle] = useState<string | null>(null);

  // Autosave: edits collect in `pending` and are written together after a pause; unmounting writes what is left.
  const pending = useRef<Pending>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useRef(async () => {});
  flush.current = async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const batch = pending.current;
    if (Object.keys(batch).length === 0) return;
    pending.current = {};
    try {
      await updateTemplate(client, ws, {
        templateId,
        ...(batch.title !== undefined ? { title: batch.title } : {}),
        ...(batch.subject ? { subject: batch.subject } : {}),
        ...(batch.body ? { body: batch.body as never } : {}),
      });
    } catch (error) {
      pending.current = { ...batch, ...pending.current };
      toast.error({
        title: 'Failed to save the template',
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };
  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush.current(), 600);
  };
  useEffect(() => () => void flush.current(), []);

  // The editors start from the stored template once it has loaded.
  const loaded = template.data;
  const initial = useRef<{ subject: LineValue; body: Block[] } | null>(null);
  if (loaded && !initial.current) {
    initial.current = { subject: loaded.subject as LineValue, body: loaded.body as Block[] };
  }

  const shownTitle = title ?? loaded?.title ?? '';
  const heading = shownTitle || 'Untitled Template';

  const use = async () => {
    await flush.current();
    openComposer({ templateId });
    if (variant === 'dialog') onClose();
  };

  const header =
    variant === 'composer' ? (
      <div className={s.header} data-testid="template-header">
        <IconButton icon="chevronLeft" aria-label="Back" tooltip="Back" size={28} onPress={onBack} />
        <div className={s.headerStart}>
          <span className={s.crumb}>
            <Icon icon="compose" size={16} />
            <span className={s.crumbMuted}>Compose email</span>
            <span className={s.crumbSeparator}>/</span>
            <span data-testid="template-title">{heading}</span>
          </span>
        </div>
        <IconButton icon="close" aria-label="Close" tooltip="Close" size={28} onPress={onClose} />
      </div>
    ) : (
      <div className={s.header} data-testid="template-header">
        <input
          className={s.templateTitleInput}
          style={{ marginLeft: 0 }}
          placeholder="Enter template title..."
          aria-label="Template title"
          value={shownTitle}
          data-testid="template-title-input"
          onChange={(e) => {
            setTitle(e.target.value);
            pending.current.title = e.target.value;
            schedule();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void flush.current();
              (e.target as HTMLInputElement).blur();
            }
          }}
          onBlur={() => void flush.current()}
        />
        <IconButton icon="close" aria-label="Close" tooltip="Close" size={28} onPress={onClose} />
      </div>
    );

  return (
    <div
      className={className}
      style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}
      data-testid="template-editor"
    >
      {header}
      {template.isPending || !initial.current ? (
        <div className={s.stateBox}>
          {template.isError ? (
            <>
              <span className={s.stateTitle}>Template not found</span>
              <span className={s.stateText}>It may have been deleted.</span>
            </>
          ) : (
            <Skeleton width={240} height={12} />
          )}
        </div>
      ) : (
        <>
          <div className={s.templateSubject}>
            <div className={s.subjectEditor}>
              <LineEditor
                initial={initial.current.subject}
                placeholder="Enter subject..."
                ariaLabel="Subject"
                testId="template-subject"
                {...vars.bind('subject')}
                onChange={(value) => {
                  pending.current.subject = value;
                  schedule();
                }}
                onEnter={() => vars.handle('body')?.focus('start')}
              />
            </div>
          </div>
          <div
            className={s.bodyScroll}
            onMouseDown={(e) => e.target === e.currentTarget && vars.handle('body')?.focus('end')}
          >
            <BlockEditor
              className={s.bodyEditor}
              initialBlocks={initial.current.body}
              ariaLabel="Template body"
              testId="template-body"
              placeholder="Start typing..."
              {...vars.bind('body')}
              onChange={(blocks) => {
                pending.current.body = blocks;
                schedule();
              }}
            />
          </div>
        </>
      )}
      <div className={s.footer}>
        <div className={s.footerTools}>
          <IconButton
            icon="attach"
            aria-label="Add attachment"
            tooltip="Template attachments arrive later"
            size={28}
            isDisabled
          />
          <IconButton icon="image" aria-label="Add image" tooltip="Template images arrive later" size={28} isDisabled />
          <IconButton
            icon={VariableGlyph}
            aria-label="Add variable"
            tooltip="Add Variable"
            size={28}
            onPress={vars.addVariable}
            data-testid="template-add-variable"
          />
        </div>
        <div className={s.footerRight}>
          <MenuTrigger>
            <IconButton
              icon="moreVertical"
              aria-label="Email template options"
              tooltip="Email template options"
              size={28}
              data-testid="template-options"
            />
            <Menu
              aria-label="Email template options"
              placement="top end"
              width={200}
              onAction={(key) => {
                if (key === 'favorite' && loaded) {
                  favorite.mutate(
                    { templateId, favorite: !loaded.isFavorite },
                    { onError: () => toast.error({ title: 'Failed to update favorites' }) },
                  );
                }
                if (key === 'delete') setConfirmDelete(true);
              }}
            >
              <MenuItem id="favorite" icon={loaded?.isFavorite ? 'favoriteRemove' : 'favorite'}>
                {loaded?.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              </MenuItem>
              <MenuSeparator />
              <MenuItem id="delete" icon="delete" variant="danger">
                Delete template
              </MenuItem>
            </Menu>
          </MenuTrigger>
          <Button
            variant="secondary"
            size={32}
            onPress={() => void use()}
            isDisabled={!loaded}
            data-testid="use-template"
          >
            Use template
          </Button>
        </div>
      </div>
      {vars.popovers}
      <AlertDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Are you sure?"
        description="Permanently delete this email template?"
        confirmLabel="Confirm"
        variant="danger"
        onConfirm={() => {
          setConfirmDelete(false);
          pending.current = {};
          if (timer.current) clearTimeout(timer.current);
          remove.mutate(templateId, {
            onSuccess: () => {
              toast({ title: 'Template deleted' });
              onClose();
            },
            onError: () => toast.error({ title: 'Failed to delete the template' }),
          });
        }}
      />
    </div>
  );
}
