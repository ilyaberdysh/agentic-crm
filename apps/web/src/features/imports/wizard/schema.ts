// Schema the wizard needs for a destination: its attributes plus every object its relationship attributes point at
// (drill-downs, linked-object mapping) — for lists that includes the parent object through `parent_record`.
import { useMemo } from 'react';
import { useSchemaIndex } from '../../views/data';
import type { SchemaIndex } from '../../views/schemaIndex';
import { isMappable } from '../model/mapping';

export function useImportSchema(destinationId: string | null | undefined): SchemaIndex | null {
  const first = useSchemaIndex(destinationId);
  const targets = useMemo(() => {
    if (!first || !destinationId) return [];
    const out = new Set<string>();
    for (const a of first.attributes(destinationId) ?? []) {
      if (a.isArchived || (!isMappable(a) && a.apiSlug !== 'parent_record')) continue;
      const t = first.targetOf(a);
      if (t) out.add(t);
    }
    return [...out];
  }, [first, destinationId]);
  const full = useSchemaIndex(destinationId, targets);
  if (!first) return null;
  return targets.length === 0 ? first : full;
}
