// Preview panes (command-palette.md §3.2, §3.5): the right half of the palette for the highlighted row — an object's
// details and views, a list's, a record's (header link, status chip, identifiers, list memberships).
import type { SearchRecordHit } from '@agentic-crm/contracts';
import { Icon, type IconName, IconTile } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Button as AriaButton } from 'react-aria-components';
import type { ObjectSummary } from '../../data/objects';
import { api, inWorkspace } from '../../data/trpc';
import { useAttributes } from '../attributes';
import { RecordAvatar, recordKind } from '../attributes/ui/primitives';
import { ListIcon } from '../lists';
import type { List } from '../lists/data';
import { recordUrl } from '../record/paths';
import { objectAppearance } from '../shell/objectAppearance';
import { useWorkspace } from '../shell/workspaceContext';
import { useViews } from '../views/data';
import * as s from './palette.css';
import { closePalette } from './store';

function Header({
  icon,
  children,
  trailing,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <div className={s.previewHeader}>
      {icon}
      <span className={s.previewTitle}>{children}</span>
      {trailing}
    </div>
  );
}

function Fact({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return (
    <div className={s.factRow}>
      <Icon icon={icon} size={16} className={s.factIcon} />
      <span className={s.factText}>{children}</span>
    </div>
  );
}

// ---- action ---------------------------------------------------------------------------------------------------------

export function PlaceholderPreview({ icon, title, body }: { icon: IconName; title: string; body?: string }) {
  return (
    <div className={s.previewPlaceholder} data-testid="palette-preview">
      <IconTile icon={icon} color="grey" size={40} />
      <strong style={{ color: 'inherit' }}>{title}</strong>
      {body && <span>{body}</span>}
    </div>
  );
}

// ---- object ---------------------------------------------------------------------------------------------------------

function useRecordCount(objectId: string): number | null {
  const { workspace } = useWorkspace();
  const ws = { id: workspace.id, slug: workspace.slug };
  const q = useQuery({
    queryKey: ['ws', ws.id, 'palette-record-count', objectId],
    queryFn: () =>
      api.snapshots.query.query({ entityDefinitionId: objectId, initialRange: { start: 0, size: 0 } }, inWorkspace(ws)),
    staleTime: 30_000,
  });
  return q.data?.total ?? null;
}

export function ObjectPreview({ object }: { object: ObjectSummary }) {
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const look = objectAppearance(object);
  const count = useRecordCount(object.id);
  const { attributes } = useAttributes(object.id);
  const views = useViews(object.id).data ?? [];
  const attributeCount = attributes.filter((a) => !a.isArchived).length;
  return (
    <div data-testid="palette-preview" data-preview="object">
      <Header icon={<IconTile icon={look.icon} color={look.color} size={20} />}>{object.pluralNoun}</Header>
      <div className={s.previewSection}>
        <h4 className={s.previewLabel}>Object Details</h4>
        <Fact icon="record">
          {count === null ? '…' : `${count.toLocaleString()} ${count === 1 ? 'record' : 'records'}`}
        </Fact>
        <Fact icon="apps">
          {attributeCount.toLocaleString()} {attributeCount === 1 ? 'attribute' : 'attributes'}
        </Fact>
      </div>
      {views.length > 0 && (
        <div className={s.previewSection}>
          <h4 className={s.previewLabel}>
            Views <span className={s.countBadge}>{views.length}</span>
          </h4>
          {views.map((view) => (
            <AriaButton
              key={view.id}
              className={s.viewRow}
              onPress={() => {
                closePalette();
                const base = object.entityType === 'custom-record' ? `custom/${object.apiSlug}` : object.apiSlug;
                void navigate({ href: href(`${base}/view/${view.id}`) });
              }}
            >
              <span className={s.viewTile}>
                <Icon icon={view.type === 'kanban' ? 'kanban' : 'viewGrid'} size={12} />
              </span>
              <span className={s.previewTitle} style={{ flex: 1 }}>
                {view.title}
              </span>
              <Icon icon="arrowRight" size={16} className={s.factIcon} />
            </AriaButton>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- list -----------------------------------------------------------------------------------------------------------

export function ListPreview({ list }: { list: List }) {
  const views = useViews(list.id).data ?? [];
  const { href } = useWorkspace();
  const navigate = useNavigate();
  return (
    <div data-testid="palette-preview" data-preview="list">
      <Header icon={<ListIcon icon={list.icon} size={20} />}>{list.name}</Header>
      <div className={s.previewSection}>
        <h4 className={s.previewLabel}>List Details</h4>
        {list.entryCount !== null && (
          <Fact icon="record">
            {list.entryCount.toLocaleString()} {list.entryCount === 1 ? 'entry' : 'entries'}
          </Fact>
        )}
        <Fact icon="list">List</Fact>
      </div>
      {views.length > 0 && (
        <div className={s.previewSection}>
          <h4 className={s.previewLabel}>
            Views <span className={s.countBadge}>{views.length}</span>
          </h4>
          {views.map((view) => (
            <AriaButton
              key={view.id}
              className={s.viewRow}
              onPress={() => {
                closePalette();
                void navigate({ href: href(`collection/${list.id}/view/${view.id}`) });
              }}
            >
              <span className={s.viewTile}>
                <Icon icon={view.type === 'kanban' ? 'kanban' : 'viewGrid'} size={12} />
              </span>
              <span className={s.previewTitle} style={{ flex: 1 }}>
                {view.title}
              </span>
              <Icon icon="arrowRight" size={16} className={s.factIcon} />
            </AriaButton>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- record ---------------------------------------------------------------------------------------------------------

export function RecordHitAvatar({
  hit,
  object,
  size = 20,
}: {
  hit: SearchRecordHit;
  object: ObjectSummary | undefined;
  size?: number;
}) {
  const kind = recordKind(object);
  if (hit.avatar) {
    return (
      <img
        src={hit.avatar}
        alt=""
        width={size}
        height={size}
        style={{ borderRadius: kind === 'person' ? '50%' : '30%', objectFit: 'cover', flex: 'none' }}
      />
    );
  }
  return <RecordAvatar kind={kind} size={size} />;
}

export function RecordHitPreview({
  hit,
  object,
  onOpenList,
}: {
  hit: SearchRecordHit;
  object: ObjectSummary | undefined;
  onOpenList: (listId: string, entryId: string) => void;
}) {
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const to = object ? recordUrl(href, object, hit.entityInstanceId) : null;
  return (
    <div data-testid="palette-preview" data-preview="record" data-record-id={hit.entityInstanceId}>
      <Header
        icon={<RecordHitAvatar hit={hit} object={object} />}
        trailing={
          <span className={s.statusChip}>
            <Icon icon="comment" size={12} />
            No communication found
          </span>
        }
      >
        {to ? (
          <a
            className={s.previewLink}
            href={to}
            onClick={(e) => {
              e.preventDefault();
              closePalette();
              void navigate({ href: to });
            }}
          >
            {hit.title ?? 'Untitled record'}
          </a>
        ) : (
          (hit.title ?? 'Untitled record')
        )}
      </Header>
      <div className={s.previewSection}>
        <h4 className={s.previewLabel}>Details</h4>
        {hit.emailAddresses.map((email) => (
          <Fact key={email} icon="attrEmail">
            <a className={s.factLink} href={`mailto:${email}`}>
              {email}
            </a>
          </Fact>
        ))}
        {hit.phoneNumbers.map((phone) => (
          <Fact key={phone} icon="attrPhone">
            {phone}
          </Fact>
        ))}
        {hit.domains.map((domain) => (
          <Fact key={domain} icon="attrDomain">
            <a className={s.factLink} href={`https://${domain}`} target="_blank" rel="noreferrer">
              {domain}
            </a>
          </Fact>
        ))}
        {hit.emailAddresses.length + hit.phoneNumbers.length + hit.domains.length === 0 && (
          <Fact icon="info">No details yet</Fact>
        )}
      </div>
      {hit.lists.length > 0 && (
        <div className={s.previewSection}>
          <h4 className={s.previewLabel}>
            Lists <span className={s.countBadge}>{hit.lists.length}</span>
          </h4>
          {hit.lists.map((list, i) => (
            <AriaButton
              key={list.listId}
              className={s.viewRow}
              aria-label={`${list.name}: list appearance ${i + 1} of ${hit.lists.length} for ${hit.title ?? 'this record'}`}
              onPress={() => onOpenList(list.listId, list.entryIds[0] ?? '')}
              data-testid="preview-list-membership"
            >
              <ListIcon icon={list.icon} size={16} />
              <span className={s.previewTitle} style={{ flex: 1 }}>
                {list.name}
              </span>
              <Icon icon="arrowRight" size={16} className={s.factIcon} />
            </AriaButton>
          ))}
        </div>
      )}
    </div>
  );
}
