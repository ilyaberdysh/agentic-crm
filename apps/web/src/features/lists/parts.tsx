// Small shared pieces of the lists feature: a record's avatar + name (pickers, breadcrumbs), the list chip of a
// breadcrumb, and the parent object of a list.
import type { EntityDefinition, RecordRef } from '@agentic-crm/contracts';
import { IconTile, type IconTileProps } from '@agentic-crm/ui';
import { useObjects } from '../../data/objects';
import { RecordAvatar, useRecordTitle } from '../attributes';
import { recordKind } from '../attributes/ui/primitives';
import { objectAppearance } from '../shell/objectAppearance';
import { useWorkspace } from '../shell/workspaceContext';
import type { List } from './data';
import { ListIcon } from './icon';
import * as s from './lists.css';

/** Record avatar + display name, loading-safe (falls back to the id). */
export function RecordName({ record, size = 16, muted }: { record: RecordRef; size?: number; muted?: boolean }) {
  const { title, definition } = useRecordTitle(record.entityDefinitionId, record.entityInstanceId);
  return (
    <span className={muted ? s.crumbMuted : s.rowMuted} style={muted ? undefined : { color: 'inherit' }}>
      <RecordAvatar kind={recordKind(definition)} size={size} />
      <span className={s.rowTitle}>{title || 'Untitled record'}</span>
    </span>
  );
}

export function useRecordTitleText(record: RecordRef | null): string {
  const { title } = useRecordTitle(record?.entityDefinitionId ?? '', record?.entityInstanceId ?? '');
  return title || 'Untitled record';
}

/** "[seed] Project pipeline (2)" in a hairline chip (Add to list breadcrumb). */
export function ListChip({ list }: { list: Pick<List, 'name'> }) {
  return <span className={s.crumbChip}>{list.name}</span>;
}

/** The list's parent objects resolved against the workspace objects (first = the default one). */
export function useParentObjects(list: Pick<List, 'parentEntityDefinitionIds'> | undefined) {
  const { workspace } = useWorkspace();
  const objects = useObjects(workspace).data ?? [];
  return (list?.parentEntityDefinitionIds ?? [])
    .map((id) => objects.find((o) => o.id === id))
    .filter((o): o is NonNullable<typeof o> => Boolean(o));
}

/** Coloured object tile (16 px) of an object. */
export function ObjectIconTile({
  object,
  size = 16,
}: {
  object: Pick<EntityDefinition, 'entityType' | 'standardObjectType'> | undefined;
  size?: IconTileProps['size'];
}) {
  if (!object) return null;
  const look = objectAppearance(object);
  return <IconTile icon={look.icon} color={look.color} size={size} />;
}
