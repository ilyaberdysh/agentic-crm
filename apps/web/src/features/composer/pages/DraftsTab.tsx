// The Drafts tab (F composer §3): a table "Draft | Creation date" of the member's drafts (subject over a body
// preview with variables as {{tokens}}, relative creation day); a row opens the draft in the composer, ⋮ → Delete
// draft deletes at once with a toast. Empty: "Send emails in …" with a Compose email button.
import { Button, Icon, IconButton, Menu, MenuItem, MenuTrigger, Skeleton, toast } from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { brand } from '../../../lib/brand';
import { useWs } from '../../mailboxes/data';
import { relativeDay } from '../../notes/format';
import * as n from '../../notes/notesPage.css';
import { useCalendar } from '../../tasks/calendar';
import { type Draft, deleteDraft, useDrafts } from '../data';
import { ComposeGlyph } from '../glyphs';
import { previewSubject } from '../model';
import { openComposer, openDraft } from '../open';
import * as s from './pages.css';
import { EmptyTab, Toolbar } from './parts';

function DraftRow({ draft }: { draft: Draft }) {
  const ws = useWs();
  const client = useQueryClient();
  const calendar = useCalendar();
  const subject = previewSubject(draft.subject.text, draft.subject.variables);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div
      role="button"
      tabIndex={0}
      className={s.row}
      data-testid="draft-row"
      data-draft-id={draft.id}
      onClick={() => openDraft(draft.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) openDraft(draft.id);
      }}
    >
      <div className={`${s.cell} ${s.draftCell}`}>
        <span className={s.draftSubject} data-testid="draft-subject">
          {subject || 'No subject'}
        </span>
        <span className={s.draftPreview} data-testid="draft-preview">
          {draft.preview}
        </span>
      </div>
      <div className={`${s.cell} ${s.dateCell}`}>
        {relativeDay(draft.createdAt, calendar.timeZone, calendar.locale)}
      </div>
      <span className={s.rowMenu} onClick={stop} onKeyDown={stop}>
        <MenuTrigger>
          <IconButton icon="moreVertical" aria-label="Draft options" size={28} />
          <Menu
            aria-label="Draft options"
            placement="bottom end"
            width={200}
            onAction={() => {
              void deleteDraft(client, ws, draft.id).then(
                () => toast({ title: 'Draft deleted' }),
                () => toast.error({ title: 'Failed to delete the draft' }),
              );
            }}
          >
            <MenuItem id="delete" icon="delete" variant="danger">
              Delete draft
            </MenuItem>
          </Menu>
        </MenuTrigger>
      </span>
    </div>
  );
}

export function DraftsTab() {
  const drafts = useDrafts();
  const list = drafts.data ?? [];
  const compose = (
    <Button variant="primary" size={28} icon={ComposeGlyph} onPress={() => openComposer()} data-testid="compose-email">
      Compose email
    </Button>
  );
  return (
    <>
      <Toolbar>{compose}</Toolbar>
      {drafts.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton width="40%" height={12} />
        </div>
      ) : drafts.isError ? (
        <div className={n.state} data-testid="index-state">
          <span className={n.stateError}>
            Something went wrong trying to load drafts. Refresh the page to try again.
          </span>
        </div>
      ) : list.length === 0 ? (
        <EmptyTab
          icon="emails"
          title={`Send emails in ${brand.name}`}
          text="No email drafts yet! Send emails without leaving the CRM. Mass sending, templates, attachments, and more."
          action={compose}
          learn="Email outbox"
        />
      ) : (
        <div className={n.scroll}>
          <div className={s.table} role="table" aria-label="Drafts">
            <div className={s.head} role="row">
              <div className={s.headCell} role="columnheader">
                Draft
              </div>
              <div className={s.headCell} role="columnheader">
                <Icon icon="calendar" size={12} />
                Creation date
              </div>
            </div>
            {list.map((draft) => (
              <DraftRow key={draft.id} draft={draft} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
