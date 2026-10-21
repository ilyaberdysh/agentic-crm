// The focused table row's record actions in the palette (context categories): while a
// row of an object table has the active cell, ⌘K lists Open record, Open in a new tab, Copy domain / email address,
// Create task, Create note, Merge… in a section named after the record. The record's name and identifiers come from
// the search index (a record id finds its record), looked up once the focus has rested for a moment.

import type { IconName } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, inWorkspace } from '../../data/trpc';
import { useWorkspace } from '../shell/workspaceContext';
import { type PaletteAction, usePaletteContext } from './contexts';
import { type ObjectRef, useRecordMenu } from './recordActions';

const ICONS: Record<string, { icon: IconName; gesture: string }> = {
  open: { icon: 'arrowUpRight', gesture: 'Open record' },
  'open-new-tab': { icon: 'externalLink', gesture: 'Open' },
  'copy-domain': { icon: 'copy', gesture: 'Copy' },
  'copy-email': { icon: 'copy', gesture: 'Copy' },
  'create-task': { icon: 'tasks', gesture: 'Create' },
  'create-note': { icon: 'notes', gesture: 'Create' },
  merge: { icon: 'merge', gesture: 'Merge' },
  'send-email': { icon: 'emails', gesture: 'Compose' },
};

/** Registers the focused row's record actions while `recordId` is set (null / undefined: none). */
export function useFocusedRecordContext(
  object: (ObjectRef & { id: string }) | null,
  recordId: string | null | undefined,
): void {
  const { workspace } = useWorkspace();
  const buildMenu = useRecordMenu();
  // Arrowing through rows must not search for each one: look up once the focus rested.
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    if (!recordId) {
      setSettled(null);
      return;
    }
    const t = setTimeout(() => setSettled(recordId), 250);
    return () => clearTimeout(t);
  }, [recordId]);

  const hit = useQuery({
    queryKey: ['ws', workspace.id, 'palette-record', settled],
    queryFn: async () => {
      const res = await api.search.records.query(
        { query: settled as string, limit: 1 },
        inWorkspace({ id: workspace.id, slug: workspace.slug }),
      );
      return res.hits.find((h) => h.entityInstanceId === settled) ?? null;
    },
    enabled: Boolean(settled),
    staleTime: 60_000,
  });

  const context = useMemo(() => {
    const found = hit.data;
    if (!object || !settled || !found) return null;
    const items = buildMenu(
      {
        entityDefinitionId: object.id,
        entityInstanceId: settled,
        title: found.title ?? '',
        domains: found.domains,
        emailAddresses: found.emailAddresses,
      },
      object,
      () => {},
    );
    const actions: PaletteAction[] = items.map((item) => ({
      id: `record:${item.id}`,
      title: item.label,
      icon: ICONS[item.id]?.icon ?? 'record',
      gesture: ICONS[item.id]?.gesture ?? 'Open',
      hint: item.keys && item.keys !== 'enter' ? item.keys : undefined,
      run: ({ close }) => {
        close();
        item.run();
      },
    }));
    return { id: 'table-row', title: found.title ?? 'Record', actions };
  }, [hit.data, object, settled, buildMenu]);

  usePaletteContext(context);
}
