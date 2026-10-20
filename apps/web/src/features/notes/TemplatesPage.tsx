// Note templates page `/$ws/notes/templates`: the notes
// header tabs; toolbar "Sorted by Creation date" · search (expands to "Search templates") · View settings ·
// "+ New template"; favourites strip; 395 × 208 template cards (title, ⋮ Add to favorites | Delete template, preview,
// creator + date). Empty: "No templates yet! Create your first template to get started."
import { AlertDialog, Button, IconButton, Menu, MenuItem, MenuSeparator, MenuTrigger, toast } from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorEnvelopeOf } from '../../data/trpc';
import { usePersistentState } from '../../lib/storage';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useFavoriteToggle } from '../favorites/data';
import { closeWindow, openNoteTemplate } from '../overlays/store';
import { useCalendar } from '../tasks/calendar';
import { ActorLabel } from './actors';
import { createTemplate, deleteTemplate, type NoteTemplate, useNoteTemplates, useWorkspaceRef } from './data';
import { NotePreview } from './editor/NotePreview';
import { relativeDay } from './format';
import { FavoritesStrip, IndexState, NotesHeader, type SortDirection, SortMenu, ViewSettingsMenu } from './indexParts';
import * as s from './notesPage.css';

function TemplateOptions({ template }: { template: NoteTemplate }) {
  const ws = useWorkspaceRef();
  const client = useQueryClient();
  const favorite = useFavoriteToggle({ favoriteType: 'note-template', targetId: template.id });
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <MenuTrigger>
        <IconButton icon="moreVertical" aria-label="Template options" size={20} />
        <Menu
          aria-label="Template options"
          placement="bottom end"
          width={220}
          onAction={(key) => {
            if (key === 'favorite') favorite.toggle();
            if (key === 'delete') setConfirm(true);
          }}
        >
          <MenuItem id="favorite" icon={favorite.isFavorite ? 'favoriteRemove' : 'favorite'}>
            {favorite.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          </MenuItem>
          <MenuSeparator />
          <MenuItem id="delete" icon="delete" variant="danger">
            Delete template
          </MenuItem>
        </Menu>
      </MenuTrigger>
      <AlertDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title="Are you sure?"
        description="Are you sure you want to permanently delete this template?"
        confirmLabel="Confirm"
        onConfirm={async () => {
          try {
            await deleteTemplate(client, ws, template.id);
            closeWindow('note-template', template.id);
            toast({ title: 'Template deleted' });
          } catch (error) {
            toast.error({ title: 'Failed to delete the template', description: errorEnvelopeOf(error).message });
          }
        }}
      />
    </>
  );
}

export function TemplateCard({
  template,
  variant = 'grid',
}: {
  template: NoteTemplate;
  variant?: 'grid' | 'favorite';
}) {
  const calendar = useCalendar();
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div
      role="button"
      tabIndex={0}
      className={`${s.card} ${variant === 'favorite' ? s.cardFavorite : ''}`}
      data-testid="template-card"
      data-template-id={template.id}
      onClick={() => openNoteTemplate(template.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) openNoteTemplate(template.id);
      }}
    >
      <div className={s.cardTop} style={{ height: 20 }}>
        <span className={s.cardTitle} style={{ margin: 0 }}>
          {template.title || 'Untitled Template'}
        </span>
        <span className={s.cardTopSpacer} />
        <span onClick={stop} onKeyDown={stop}>
          <TemplateOptions template={template} />
        </span>
      </div>
      <div className={s.cardPreview} style={{ marginTop: 6 }}>
        <NotePreview
          content={template.content}
          compact
          maxBlocks={6}
          emptyText={template.headerTitle || template.title}
          emptyClassName={s.cardEmpty}
        />
      </div>
      <div className={s.cardFooter}>
        <ActorLabel actor={template.createdBy} size={16} />
        <span className={s.cardDate}>{relativeDay(template.createdAt, calendar.timeZone, calendar.locale)}</span>
      </div>
    </div>
  );
}

export function TemplatesPage() {
  useDocumentTitle('Note templates');
  const ws = useWorkspaceRef();
  const client = useQueryClient();
  const [direction, setDirection] = usePersistentState<SortDirection>('note-templates-sort-direction', 'desc');
  const [showFavorites, setShowFavorites] = usePersistentState<boolean>('note-templates-show-favorites', true);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const sort = direction === 'asc' ? 'created_at:asc' : 'created_at:desc';
  const templates = useNoteTemplates({ sort, search: query.trim() || undefined });
  const favorites = useNoteTemplates({ sort, favoritesOnly: true }, showFavorites);
  const list = templates.data?.templates ?? [];

  const create = async () => {
    try {
      const template = await createTemplate(client, ws, { title: '' });
      openNoteTemplate(template.id);
    } catch (error) {
      toast.error({ title: 'Failed to create the template', description: errorEnvelopeOf(error).message });
    }
  };

  return (
    <>
      <NotesHeader active="templates" />
      <div className={s.page} data-testid="templates-page">
        <div className={s.toolbar}>
          <SortMenu direction={direction} onChange={setDirection} />
          <span className={s.toolbarSpacer} />
          {searching ? (
            <input
              className={s.searchInput}
              placeholder="Search templates"
              aria-label="Search note templates"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => !query && setSearching(false)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setQuery('');
                  setSearching(false);
                }
              }}
            />
          ) : (
            <IconButton
              icon="search"
              aria-label="Search note templates"
              variant="secondary"
              size={28}
              onPress={() => setSearching(true)}
            />
          )}
          <ViewSettingsMenu showFavorites={showFavorites} onShowFavorites={setShowFavorites} />
          <Button variant="primary" size={28} icon="add" onPress={() => void create()} data-testid="new-template">
            New template
          </Button>
        </div>
        <div className={s.scroll}>
          {showFavorites && (
            <FavoritesStrip emptyText="Note templates that you favorite will appear here">
              {favorites.data?.templates.length
                ? favorites.data.templates.map((t) => <TemplateCard key={t.id} template={t} variant="favorite" />)
                : undefined}
            </FavoritesStrip>
          )}
          {templates.isError ? (
            <IndexState error text="Something went wrong trying to load templates. Refresh the page to try again." />
          ) : templates.isPending ? null : list.length === 0 ? (
            query ? (
              <IndexState text={`No templates match "${query}"`} />
            ) : (
              <div className={s.state} data-testid="index-state">
                <span className={s.stateTitle}>Note templates</span>
                <span className={s.stateText}>No templates yet! Create your first template to get started.</span>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <Button variant="primary" size={28} icon="add" onPress={() => void create()}>
                    New template
                  </Button>
                </div>
              </div>
            )
          ) : (
            <div className={s.grid} style={{ paddingTop: 12 }}>
              {list.map((t) => (
                <TemplateCard key={t.id} template={t} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
