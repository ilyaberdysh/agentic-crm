// A read model over the loaded schema (definitions + attributes per definition) for paths (B.6/B.7): resolve the
// attribute at each hop, the record-reference target of a hop, and the "Parent › Child" labels of path columns,
// filters and sorts.
import type { AttributeDefinition, EntityDefinition, Path, PathHop } from '@agentic-crm/contracts';
import type { LeafResolver } from './filterModel';
import { subFieldLabel } from './operators';

/** Path length limit for drill-downs (C1, CROSS-DOMAIN C.4 #7: keep 5). */
export const MAX_PATH_LENGTH = 5;

export class SchemaIndex {
  private readonly defs = new Map<string, EntityDefinition>();
  private readonly attrsById = new Map<string, AttributeDefinition>();

  constructor(
    definitions: readonly EntityDefinition[] | undefined,
    private readonly attrsByDef: ReadonlyMap<string, readonly AttributeDefinition[]>,
  ) {
    for (const d of definitions ?? []) this.defs.set(d.id, d);
    for (const list of attrsByDef.values())
      for (const a of list) this.attrsById.set(`${a.entityDefinitionId}:${a.id}`, a);
  }

  definition(id: string): EntityDefinition | undefined {
    return this.defs.get(id);
  }

  /** All attributes of a definition (archived included), or undefined while loading. */
  attributes(entityDefinitionId: string): readonly AttributeDefinition[] | undefined {
    return this.attrsByDef.get(entityDefinitionId);
  }

  attribute(hop: PathHop): AttributeDefinition | undefined {
    return this.attrsById.get(`${hop.entityDefinitionId}:${hop.attributeDefinitionId}`);
  }

  /** Attribute at the end of a path. */
  leaf(path: Path): AttributeDefinition | undefined {
    const last = path[path.length - 1];
    return last ? this.attribute(last) : undefined;
  }

  /** Every hop resolved, or undefined when any hop is unknown (deleted attribute). */
  hops(path: Path): AttributeDefinition[] | undefined {
    const out: AttributeDefinition[] = [];
    for (const hop of path) {
      const a = this.attribute(hop);
      if (!a) return undefined;
      out.push(a);
    }
    return out;
  }

  /** The single object a record-reference attribute points to (drill-downs need exactly one). */
  targetOf(attr: AttributeDefinition): string | null {
    if (attr.type !== 'entity-reference') return null;
    if (attr.relationship) return attr.relationship.relatedEntityDefinitionId;
    const allowed = attr.config.entityReferenceConfiguration?.allowedEntityDefinitionIds;
    return allowed && allowed.length === 1 ? (allowed[0] as string) : null;
  }

  /** "Next due task › Due date", "Office › City", "Phase › Stage order". */
  pathParts(path: Path, field?: string | null, purpose: 'sort' | 'column' | 'filter' = 'column'): string[] {
    const hops = path.map((h) => this.attribute(h)?.title ?? 'Unknown attribute');
    const leaf = this.leaf(path);
    const sub = leaf && field ? subFieldLabel(leaf, field, purpose) : '';
    return sub ? [...hops, sub] : hops;
  }

  pathLabel(path: Path, field?: string | null, purpose: 'sort' | 'column' | 'filter' = 'column'): string {
    return this.pathParts(path, field, purpose).join(' › ');
  }

  readonly resolve: LeafResolver = (path) => this.leaf(path);
}

/** Definition ids whose attributes are needed to resolve these paths (every hop's definition). */
export function definitionsOfPaths(paths: readonly Path[]): string[] {
  const out = new Set<string>();
  for (const path of paths) for (const hop of path) out.add(hop.entityDefinitionId);
  return [...out];
}
