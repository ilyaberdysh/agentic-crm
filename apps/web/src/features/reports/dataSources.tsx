// Data sources of reports: objects and lists as one picker model (builder §2.2 "Data source", §11 list sources) and
// the chip that names a report's source on cells (object icon tile + plural name, chart-types §2).
import { Icon, IconTile } from '@agentic-crm/ui';
import { useMemo } from 'react';
import { useObjects } from '../../data/objects';
import { useLists } from '../lists/data';
import { ListIcon } from '../lists/icon';
import { objectAppearance } from '../shell/objectAppearance';
import { useWorkspace } from '../shell/workspaceContext';
import * as s from './reports.css';

export interface DataSource {
  /** Entity definition id (a list is its collection-entry definition). */
  id: string;
  kind: 'object' | 'list';
  /** Object plural noun or list name. */
  name: string;
  appearance: { icon: Parameters<typeof IconTile>[0]['icon']; color: Parameters<typeof IconTile>[0]['color'] } | null;
  listIcon: string | null;
}

export function useDataSources(): {
  sources: DataSource[];
  byId: (id: string) => DataSource | undefined;
  ready: boolean;
} {
  const { workspace } = useWorkspace();
  const ws = useMemo(() => ({ id: workspace.id, slug: workspace.slug }), [workspace.id, workspace.slug]);
  const objects = useObjects(workspace);
  const lists = useLists(ws);
  const sources = useMemo<DataSource[]>(
    () => [
      ...(objects.data ?? []).map((o) => ({
        id: o.id,
        kind: 'object' as const,
        name: o.pluralNoun,
        appearance: objectAppearance(o),
        listIcon: null,
      })),
      ...(lists.data ?? []).map((l) => ({
        id: l.id,
        kind: 'list' as const,
        name: l.name,
        appearance: null,
        listIcon: l.icon,
      })),
    ],
    [objects.data, lists.data],
  );
  return {
    sources,
    byId: (id) => sources.find((x) => x.id === id),
    ready: !objects.isPending && !lists.isPending,
  };
}

export function SourceIcon({ source, size = 16 }: { source: DataSource | undefined; size?: number }) {
  if (!source) return <Icon icon="lock" size={size} />;
  if (source.kind === 'list') return <ListIcon icon={source.listIcon} size={size} />;
  return source.appearance ? (
    <IconTile icon={source.appearance.icon} color={source.appearance.color} size={size as 16} />
  ) : (
    <Icon icon="object" size={size} />
  );
}

/** Grey chip on a cell header: the source's icon and name ("[seed] Projects"). */
export function SourceChip({ source }: { source: DataSource | undefined }) {
  return (
    <span className={s.sourceChip} data-testid="source-chip">
      <SourceIcon source={source} size={16} />
      <span className={s.sourceChipText}>{source?.name ?? 'Inaccessible data source'}</span>
    </span>
  );
}
