// In-transaction model of entity definitions and their attributes, loaded from the catalog tables and memoised per
// transaction. Every service resolves "id or api_slug" references through here.
import type {
  Actor,
  AiAutofillConfiguration,
  AiAutofillPrompt,
  AttributeConfig,
  AttributeDefinition,
  AttributeType,
  DefaultValue,
  EntityDefinition,
  EntityType,
  Path,
} from '@agentic-crm/contracts';
import { notFound } from '../errors.ts';
import type { Tx } from '../tx.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s);

export interface AttrDef {
  id: string;
  workspaceId: string;
  entityDefinitionId: string;
  apiSlug: string;
  title: string;
  description: string;
  type: AttributeType;
  isMultiselect: boolean;
  isUnique: boolean;
  isRequired: boolean;
  isHistoric: boolean;
  isArchived: boolean;
  isSystem: boolean;
  systemAttributeType: string | null;
  isReadOnly: boolean;
  isHidden: boolean;
  config: AttributeConfig;
  defaultValue: DefaultValue | null;
  relationshipAttributeId: string | null;
  relatedEntityDefinitionId: string | null;
  interfaceAttributeId: string | null;
  attnum: number;
  isIndexed: boolean;
  sortOrder: string;
  createdBy: Actor;
  createdAt: string;
  /** Formula attribute: the active snapshot (slice 10). */
  formula: { activeSnapshotId: string; activeSnapshotCreatedAt: string } | null;
  /** AI autofill configuration (slice 10). */
  aiAutofill: AiAutofillConfiguration | null;
}

/** Credits per generated AI value (ai-attributes §2): the web agent costs 10, the others 1. */
export const aiCreditsPerValue = (type: AiAutofillConfiguration['type']) => (type === 'research-web' ? 10 : 1);

export interface DefInfo {
  id: string;
  workspaceId: string;
  entityType: EntityType;
  standardObjectType: 'deal' | 'user' | 'workspace' | null;
  entitySubType: string | null;
  apiSlug: string;
  singularNoun: string;
  pluralNoun: string;
  icon: string | null;
  imagePath: Path | null;
  epithetPath: Path | null;
  interfaceIds: string[];
  sortOrder: string | null;
  isArchived: boolean;
  isSystem: boolean;
  seededAt: string | null;
  projectionTable: string | null;
  createdBy: Actor;
  createdAt: string;
  attrs: AttrDef[];
  byId: Map<string, AttrDef>;
  bySlug: Map<string, AttrDef>;
}

type DefRow = Awaited<ReturnType<typeof selectDefs>>[number];

function selectDefs(tx: Tx) {
  return tx.db.selectFrom('entity_definitions').selectAll().execute();
}

async function loadAttrs(tx: Tx, defIds: string[]): Promise<AttrDef[]> {
  if (defIds.length === 0) return [];
  const rows = await tx.db
    .selectFrom('attribute_definitions as a')
    .leftJoin('attribute_definitions as r', 'r.id', 'a.relationship_attribute_id')
    .leftJoin('formula_attributes as f', 'f.attribute_id', 'a.id')
    .leftJoin('ai_attribute_configs as ai', 'ai.attribute_id', 'a.id')
    .selectAll('a')
    .select([
      'r.entity_definition_id as related_entity_definition_id',
      'f.active_snapshot_id as formula_snapshot_id',
      'f.active_snapshot_created_at as formula_snapshot_created_at',
      'ai.type as ai_type',
      'ai.is_enabled as ai_is_enabled',
      'ai.prompt as ai_prompt',
      'ai.is_option_creation_enabled as ai_option_creation',
    ])
    .where('a.entity_definition_id', 'in', defIds)
    .orderBy('a.sort_order')
    .orderBy('a.attnum')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    entityDefinitionId: r.entity_definition_id,
    apiSlug: r.api_slug,
    title: r.title,
    description: r.description,
    type: r.type as AttributeType,
    isMultiselect: r.is_multiselect,
    isUnique: r.is_unique,
    isRequired: r.is_required,
    isHistoric: r.is_historic,
    isArchived: r.is_archived,
    isSystem: r.is_system,
    systemAttributeType: r.system_attribute_type,
    isReadOnly: r.is_read_only,
    isHidden: r.is_hidden,
    config: (r.config ?? {}) as AttributeConfig,
    defaultValue: (r.default_value ?? null) as DefaultValue | null,
    relationshipAttributeId: r.relationship_attribute_id,
    relatedEntityDefinitionId: r.related_entity_definition_id,
    interfaceAttributeId: r.interface_attribute_id,
    attnum: r.attnum,
    isIndexed: r.is_indexed,
    sortOrder: r.sort_order,
    createdBy: r.created_by as Actor,
    createdAt: r.created_at,
    formula:
      r.formula_snapshot_id && r.formula_snapshot_created_at
        ? { activeSnapshotId: r.formula_snapshot_id, activeSnapshotCreatedAt: r.formula_snapshot_created_at }
        : null,
    aiAutofill: r.ai_type
      ? {
          isEnabled: r.ai_is_enabled ?? false,
          type: r.ai_type,
          prompt: (r.ai_prompt ?? null) as AiAutofillPrompt | null,
          isOptionCreationEnabled: r.ai_option_creation ?? false,
          creditsPerValue: aiCreditsPerValue(r.ai_type),
        }
      : null,
  }));
}

function buildDef(r: DefRow, attrs: AttrDef[]): DefInfo {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    entityType: r.entity_type as EntityType,
    standardObjectType: r.standard_object_type as DefInfo['standardObjectType'],
    entitySubType: r.entity_sub_type,
    apiSlug: r.api_slug,
    singularNoun: r.singular_noun,
    pluralNoun: r.plural_noun,
    icon: r.icon,
    imagePath: (r.image_path ?? null) as Path | null,
    epithetPath: (r.epithet_path ?? null) as Path | null,
    interfaceIds: r.interface_ids,
    sortOrder: r.sort_order,
    isArchived: r.is_archived,
    isSystem: r.is_system,
    seededAt: r.seeded_at,
    projectionTable: r.projection_table,
    createdBy: r.created_by as Actor,
    createdAt: r.created_at,
    attrs,
    byId: new Map(attrs.map((a) => [a.id, a])),
    bySlug: new Map(attrs.map((a) => [a.apiSlug, a])),
  };
}

const memoKey = (key: string) => `def:${key}`;

/** Loads one entity definition (by id or api_slug) with all its attributes; 404 when missing. */
export async function loadDefinition(tx: Tx, idOrSlug: string): Promise<DefInfo> {
  const cached = tx.memo.get(memoKey(idOrSlug)) as DefInfo | undefined;
  if (cached) return cached;
  const row = await tx.db
    .selectFrom('entity_definitions')
    .selectAll()
    .$if(isUuid(idOrSlug), (q) => q.where('id', '=', idOrSlug))
    .$if(!isUuid(idOrSlug), (q) => q.where('api_slug', '=', idOrSlug))
    .executeTakeFirst();
  if (!row) throw notFound('The requested object could not be found', { entity_definition_id: idOrSlug });
  const def = buildDef(row, await loadAttrs(tx, [row.id]));
  tx.memo.set(memoKey(def.id), def);
  tx.memo.set(memoKey(def.apiSlug), def);
  return def;
}

/** Loads several definitions by id (missing ids are skipped). */
export async function loadDefinitionsByIds(tx: Tx, ids: string[]): Promise<Map<string, DefInfo>> {
  const out = new Map<string, DefInfo>();
  const missing = [...new Set(ids)].filter((id) => {
    const cached = tx.memo.get(memoKey(id)) as DefInfo | undefined;
    if (cached) out.set(id, cached);
    return !cached;
  });
  if (missing.length > 0) {
    const rows = await tx.db.selectFrom('entity_definitions').selectAll().where('id', 'in', missing).execute();
    const attrs = await loadAttrs(
      tx,
      rows.map((r) => r.id),
    );
    for (const row of rows) {
      const def = buildDef(
        row,
        attrs.filter((a) => a.entityDefinitionId === row.id),
      );
      tx.memo.set(memoKey(def.id), def);
      tx.memo.set(memoKey(def.apiSlug), def);
      out.set(def.id, def);
    }
  }
  return out;
}

/** Forget memoised definitions after a schema write in the same transaction. */
export function invalidateDefinitions(tx: Tx): void {
  for (const key of [...tx.memo.keys()]) if (key.startsWith('def:')) tx.memo.delete(key);
}

export function resolveAttribute(def: DefInfo, idOrSlug: string): AttrDef {
  const attr = def.byId.get(idOrSlug) ?? def.bySlug.get(idOrSlug);
  if (!attr) {
    throw notFound('The requested attribute definition could not be found', {
      entity_definition_id: def.id,
      attribute_definition_id: idOrSlug,
    });
  }
  return attr;
}

export function toEntityDefinition(def: DefInfo): EntityDefinition {
  return {
    id: def.id,
    workspaceId: def.workspaceId,
    entityType: def.entityType,
    standardObjectType: def.standardObjectType,
    entitySubType: def.entitySubType,
    apiSlug: def.apiSlug,
    singularNoun: def.singularNoun,
    pluralNoun: def.pluralNoun,
    icon: def.icon,
    imagePath: def.imagePath,
    epithetPath: def.epithetPath,
    interfaceIds: def.interfaceIds,
    sortOrder: def.sortOrder,
    isArchived: def.isArchived,
    isSystem: def.isSystem,
    createdBy: def.createdBy,
    createdAt: def.createdAt,
  };
}

export function toAttributeDefinition(attr: AttrDef): AttributeDefinition {
  return {
    id: attr.id,
    workspaceId: attr.workspaceId,
    entityDefinitionId: attr.entityDefinitionId,
    apiSlug: attr.apiSlug,
    title: attr.title,
    description: attr.description,
    type: attr.type,
    isMultiselect: attr.isMultiselect,
    isUnique: attr.isUnique,
    isRequired: attr.isRequired,
    isHistoric: attr.isHistoric,
    isArchived: attr.isArchived,
    isSystem: attr.isSystem,
    systemAttributeType: attr.systemAttributeType,
    isReadOnly: attr.isReadOnly,
    isHidden: attr.isHidden,
    config: attr.config,
    defaultValue: attr.defaultValue,
    relationship:
      attr.relationshipAttributeId && attr.relatedEntityDefinitionId
        ? {
            relatedEntityDefinitionId: attr.relatedEntityDefinitionId,
            relatedAttributeDefinitionId: attr.relationshipAttributeId,
          }
        : null,
    interfaceAttributeId: attr.interfaceAttributeId,
    sortOrder: attr.sortOrder,
    createdBy: attr.createdBy,
    createdAt: attr.createdAt,
    formulaConfiguration: attr.formula,
    aiAutofillConfiguration: attr.aiAutofill,
  };
}
