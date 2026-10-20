// The Templates tab (F composer §6): a Favorites strip and a grid of template cards (title, subject, body preview with
// {{tokens}}, creator and date, ⋮ → Add to favorites / Delete template); a card opens the template dialog (808 × 548,
// editable title, "Use template"). Toolbar: View settings (Show favorites) and "New template".
import {
  AlertDialog,
  Button,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Modal,
  Skeleton,
  toast,
} from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { usePersistentState } from '../../../lib/storage';
import { useWs } from '../../mailboxes/data';
import { ActorLabel } from '../../notes/actors';
import { relativeDay } from '../../notes/format';
import { FavoritesStrip, ViewSettingsMenu } from '../../notes/indexParts';
import * as n from '../../notes/notesPage.css';
import { useCalendar } from '../../tasks/calendar';
import { createTemplateNow, type EmailTemplate, useDeleteTemplate, useFavoriteTemplate, useTemplates } from '../data';
import { previewSubject } from '../model';
import { TemplateEditor } from '../TemplateEditor';
import * as s from './pages.css';
import { EmptyTab, Toolbar } from './parts';

function TemplateCard({
  template,
  favorite,
  onOpen,
}: {
  template: EmailTemplate;
  favorite?: boolean;
  onOpen: () => void;
}) {
  const calendar = useCalendar();
  const toggle = useFavoriteTemplate();
  const remove = useDeleteTemplate();
  const [confirm, setConfirm] = useState(false);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div
      role="button"
      tabIndex={0}
      className={s.templateCard}
      style={favorite ? { width: 275, flex: 'none' } : undefined}
      data-testid="email-template-card"
      data-template-id={template.id}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) onOpen();
      }}
    >
      <div className={s.templateTop}>
        <span className={s.templateTitle}>{template.title || 'Untitled Template'}</span>
        <span className={s.templateMenu} onClick={stop} onKeyDown={stop}>
          <MenuTrigger>
            <IconButton icon="moreVertical" aria-label="Email template options" size={20} />
            <Menu
              aria-label="Email template options"
              placement="bottom end"
              width={220}
              onAction={(key) => {
                if (key === 'favorite') {
                  toggle.mutate(
                    { templateId: template.id, favorite: !template.isFavorite },
                    { onError: () => toast.error({ title: 'Failed to update favorites' }) },
                  );
                }
                if (key === 'delete') setConfirm(true);
              }}
            >
              <MenuItem id="favorite" icon={template.isFavorite ? 'favoriteRemove' : 'favorite'}>
                {template.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              </MenuItem>
              <MenuSeparator />
              <MenuItem id="delete" icon="delete" variant="danger">
                Delete template
              </MenuItem>
            </Menu>
          </MenuTrigger>
        </span>
      </div>
      <div className={s.templateSubject}>{previewSubject(template.subject.text, template.subject.variables)}</div>
      <div className={s.templatePreview}>{template.preview}</div>
      <div className={s.templateFooter}>
        <ActorLabel actor={template.createdBy} size={16} />
        <span className={n.cardDate}>{relativeDay(template.createdAt, calendar.timeZone, calendar.locale)}</span>
      </div>
      <span onClick={stop} onKeyDown={stop}>
        <AlertDialog
          isOpen={confirm}
          onOpenChange={setConfirm}
          title="Are you sure?"
          description="Permanently delete this email template?"
          confirmLabel="Confirm"
          onConfirm={() =>
            remove.mutate(template.id, {
              onSuccess: () => toast({ title: 'Template deleted' }),
              onError: () => toast.error({ title: 'Failed to delete the template' }),
            })
          }
        />
      </span>
    </div>
  );
}

export function TemplatesTab() {
  const ws = useWs();
  const client = useQueryClient();
  const templates = useTemplates();
  const [showFavorites, setShowFavorites] = usePersistentState<boolean>('email-templates-show-favorites', true);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = templates.data ?? [];
  const favorites = list.filter((t) => t.isFavorite);

  const create = async () => {
    try {
      const template = await createTemplateNow(client, ws);
      setOpenId(template.id);
    } catch {
      toast.error({ title: 'Failed to create the template' });
    }
  };
  const newButton = (
    <Button variant="primary" size={28} icon="add" onPress={() => void create()} data-testid="new-email-template">
      New template
    </Button>
  );

  return (
    <>
      <Toolbar>
        <ViewSettingsMenu showFavorites={showFavorites} onShowFavorites={setShowFavorites} />
        {newButton}
      </Toolbar>
      {templates.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton width="40%" height={12} />
        </div>
      ) : templates.isError ? (
        <div className={n.state} data-testid="index-state">
          <span className={n.stateError}>
            Something went wrong trying to load templates. Refresh the page to try again.
          </span>
        </div>
      ) : list.length === 0 ? (
        <EmptyTab
          icon="noteTemplate"
          title="Email templates"
          text="No templates yet! Create your first template to get started."
          action={newButton}
          learn="Email sync, People and Company records"
        />
      ) : (
        <div className={n.scroll}>
          {showFavorites && (
            <FavoritesStrip emptyText="Email templates that you favorite will appear here">
              {favorites.length > 0
                ? favorites.map((t) => <TemplateCard key={t.id} template={t} favorite onOpen={() => setOpenId(t.id)} />)
                : undefined}
            </FavoritesStrip>
          )}
          <div className={s.templateGrid}>
            {list.map((t) => (
              <TemplateCard key={t.id} template={t} onOpen={() => setOpenId(t.id)} />
            ))}
          </div>
        </div>
      )}
      <Modal
        isOpen={openId !== null}
        onOpenChange={(open) => !open && setOpenId(null)}
        size={808}
        overlay
        aria-label="Email template"
        className={s.templateDialog}
      >
        {openId && <TemplateEditor key={openId} templateId={openId} variant="dialog" onClose={() => setOpenId(null)} />}
      </Modal>
    </>
  );
}
