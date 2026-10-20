// Schema service: entity definitions (objects), attribute definitions of all 17 types, select options and pipeline
// stages (A §4.3–4.6, attribute-types §1–2, J attribute-dialogs §7). The single write path for the catalog (I1).
// Creating an attribute adds its projection column in the same transaction; relationship attributes are created in
// pairs (one call creates both sides).
import {
  type AttributeConfig,
  type AttributeDefinition,
  type AttributeType,
  type CreateAttributeInput,
  type CreateObjectInput,
  type CreateOptionInput,
  type CreateStageInput,
  createAttributeInputSchema,
  createObjectInputSchema,
  createOptionInputSchema,
  createStageInputSchema,
  currencyConfigurationSchema,
  type DefaultValue,
  type EntityDefinition,
  type EntityType,
  historicByDefaultTypes,
  type ListAttributesInput,
  type ListEntityDefinitionsInput,
  type ListOptionsInput,
  listAttributesInputSchema,
  listEntityDefinitionsInputSchema,
  listOptionsInputSchema,
  multiValueTypes,
  numberConfigurationSchema,
  optionColors,
  type PipelineStage,
  type ProjectionReport,
  rankAfter,
  type SelectOption,
  stageColors,
  type UpdateAttributeInput,
  type UpdateObjectInput,
  type UpdateOptionInput,
  type UpdateStageInput,
  updateAttributeInputSchema,
  updateObjectInputSchema,
  updateOptionInputSchema,
  updateStageInputSchema,
} from '@agentic-crm/contracts';
import { jsonb } from '@agentic-crm/db';
import { badRequest, conflict, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import { assertWithinLimit } from '../limits.ts';
import {
  addProjectionColumns,
  createProjectionTable,
  diffProjection,
  ensureProjectionIndex,
  rebuildProjection,
} from '../projection.ts';
import type { Tx } from '../tx.ts';
import { canonicalFromRow } from '../values/canonical.ts';
import { attributeEvent } from '../webhooks/events.ts';
import {
  type AttrDef,
  type DefInfo,
  invalidateDefinitions,
  loadDefinition,
  loadDefinitionsByIds,
  resolveAttribute,
  toAttributeDefinition,
  toEntityDefinition,
} from './model.ts';

/** System attribute types that cannot be archived or reconfigured. */
const PROTECTED_SYSTEM_TYPES = new Set([
  'id',
  'created-at',
  'created-by',
  'entry-parent-record',
  'list-entries',
  'workspace-member-id',
]);

// ---------------------------------------------------------------------------------------------------------------
// Internal primitives (used by the services below and by workspace bootstrap)

export interface DefinitionSpec {
  id?: string;
  entityType: EntityType;
  standardObjectType?: 'deal' | 'user' | 'workspace' | null;
  entitySubType?: string | null;
  apiSlug: string;
  singularNoun: string;
  pluralNoun: string;
  icon?: string | null;
  interfaceIds?: string[];
  sortOrder?: string | null;
  isArchived?: boolean;
  isSystem?: boolean;
  seeded?: boolean;
}

export async function insertEntityDefinition(tx: Tx, spec: DefinitionSpec): Promise<DefInfo> {
  const id = spec.id ?? newId();
  const projectionTable =
    spec.entityType === 'interface' ? null : await createProjectionTable(tx, { id, workspaceId: tx.workspaceId });
  await tx.db
    .insertInto('entity_definitions')
    .values({
      id,
      workspace_id: tx.workspaceId,
      entity_type: spec.entityType,
      standard_object_type: spec.standardObjectType ?? null,
      entity_sub_type: spec.entitySubType ?? null,
      api_slug: spec.apiSlug,
      singular_noun: spec.singularNoun,
      plural_noun: spec.pluralNoun,
      icon: spec.icon ?? null,
      interface_ids: spec.interfaceIds ?? [],
      sort_order: spec.sortOrder ?? null,
      is_archived: spec.isArchived ?? false,
      is_system: spec.isSystem ?? false,
      seeded_at: spec.seeded === false ? null : tx.now,
      projection_table: projectionTable,
      created_by: jsonb(tx.ctx.actor),
      created_at: tx.now,
      updated_at: tx.now,
    })
    .execute();
  tx.emit('entity-definition', id);
  tx.emit('entity-definition-list', null);
  invalidateDefinitions(tx);
  return loadDefinition(tx, id);
}

export interface AttributeSpec {
  id?: string;
  apiSlug?: string;
  title: string;
  description?: string;
  type: AttributeType;
  isMultiselect?: boolean;
  isUnique?: boolean;
  isRequired?: boolean;
  isHistoric?: boolean;
  isSystem?: boolean;
  systemAttributeType?: string | null;
  isReadOnly?: boolean;
  isHidden?: boolean;
  config?: AttributeConfig;
  defaultValue?: DefaultValue | null;
  relationshipAttributeId?: string | null;
  interfaceAttributeId?: string | null;
  sortOrder?: string;
}

/** Lower-case, non-alphanumerics → '_' ("[seed] J Multi-select" → "seed_j_multi_select"). */
export function slugify(title: string): string {
  const s = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (s === '') return 'attribute';
  return /^[a-z]/.test(s) ? s.slice(0, 64) : `a_${s}`.slice(0, 64);
}

function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function normalizeConfig(type: AttributeType, config: AttributeConfig | undefined): AttributeConfig {
  const out: AttributeConfig = {};
  if (type === 'number') out.numberConfiguration = numberConfigurationSchema.parse(config?.numberConfiguration ?? {});
  if (type === 'currency') {
    out.currencyConfiguration = currencyConfigurationSchema.parse(config?.currencyConfiguration ?? {});
  }
  if (type === 'entity-reference') {
    out.entityReferenceConfiguration = {
      allowedEntityDefinitionIds: config?.entityReferenceConfiguration?.allowedEntityDefinitionIds ?? null,
    };
  }
  return out;
}

function validateDefaultValue(type: AttributeType, dv: DefaultValue | null | undefined): void {
  if (!dv) return;
  if (dv.type === 'dynamic') {
    const okDuration = (type === 'date' || type === 'timestamp') && /^-?P/.test(dv.identifier);
    const okActor = type === 'actor-reference' && dv.identifier === 'current-user';
    if (!okDuration && !okActor) throw badRequest('VALIDATION_ERROR', `Unsupported dynamic default for ${type}`);
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(dv.identifier);
  } catch {
    throw badRequest('VALIDATION_ERROR', 'Static default value must be a JSON array of values');
  }
  if (!Array.isArray(parsed))
    throw badRequest('VALIDATION_ERROR', 'Static default value must be a JSON array of values');
}

function validateFlags(spec: AttributeSpec): void {
  if (spec.isMultiselect && !multiValueTypes.has(spec.type)) {
    throw badRequest('VALIDATION_ERROR', `Attributes of type ${spec.type} cannot have multiple values`);
  }
  if (spec.isUnique && (spec.type === 'select' || spec.type === 'pipeline')) {
    throw badRequest('VALIDATION_ERROR', `Attributes of type ${spec.type} cannot be unique`);
  }
}

/**
 * Inserts attribute definitions of one entity definition in one batch: stable attnums, one multi-row insert, one
 * ALTER TABLE for their projection columns.
 */
export async function insertAttributeDefinitions(tx: Tx, def: DefInfo, specs: AttributeSpec[]): Promise<AttrDef[]> {
  if (specs.length === 0) return [];
  // Archived attributes keep their projection columns, so they count too.
  await assertWithinLimit(tx, 'attributes_per_object_hard', def.attrs.length, specs.length, {
    entity_definition_id: def.id,
  });
  const taken = new Set(def.attrs.map((a) => a.apiSlug));
  let last = def.attrs.reduce<string | null>((m, a) => (m === null || a.sortOrder > m ? a.sortOrder : m), null);
  const prepared = specs.map((spec) => {
    validateFlags(spec);
    validateDefaultValue(spec.type, spec.defaultValue);
    if (spec.apiSlug && taken.has(spec.apiSlug)) {
      throw conflict('SLUG_IN_USE', 'This slug is already in use', { conflicting_field: 'api_slug' });
    }
    const apiSlug = spec.apiSlug ?? uniqueSlug(slugify(spec.title), taken);
    taken.add(apiSlug);
    const sortOrder = spec.sortOrder ?? rankAfter(last);
    if (last === null || sortOrder > last) last = sortOrder;
    return { spec, id: spec.id ?? newId(), apiSlug, sortOrder };
  });
  const allocated = await tx.db
    .updateTable('entity_definitions')
    .set((eb) => ({ next_attnum: eb('next_attnum', '+', specs.length), updated_at: tx.now }))
    .where('id', '=', def.id)
    .returning('next_attnum')
    .executeTakeFirstOrThrow();
  const firstAttnum = allocated.next_attnum - specs.length;
  await tx.db
    .insertInto('attribute_definitions')
    .values(
      prepared.map(({ spec, id, apiSlug, sortOrder }, i) => ({
        id,
        workspace_id: tx.workspaceId,
        entity_definition_id: def.id,
        api_slug: apiSlug,
        title: spec.title,
        description: spec.description ?? '',
        type: spec.type,
        is_multiselect: spec.isMultiselect ?? false,
        is_unique: spec.isUnique ?? false,
        is_required: spec.isRequired ?? false,
        is_historic: spec.isHistoric ?? historicByDefaultTypes.has(spec.type),
        is_system: spec.isSystem ?? false,
        system_attribute_type: spec.systemAttributeType ?? null,
        is_read_only: spec.isReadOnly ?? false,
        is_hidden: spec.isHidden ?? false,
        config: jsonb(normalizeConfig(spec.type, spec.config)),
        default_value: jsonb(spec.defaultValue ?? null),
        relationship_attribute_id: spec.relationshipAttributeId ?? null,
        interface_attribute_id: spec.interfaceAttributeId ?? null,
        attnum: firstAttnum + i,
        sort_order: sortOrder,
        created_by: jsonb(tx.ctx.actor),
        created_at: tx.now,
        updated_at: tx.now,
      })),
    )
    .execute();
  invalidateDefinitions(tx);
  const fresh = await loadDefinition(tx, def.id);
  const attrs = prepared.map((p) => fresh.byId.get(p.id) as AttrDef);
  await addProjectionColumns(tx, fresh, attrs);
  for (const attr of attrs) {
    tx.emit('attribute-definition', attr.id, { entityDefinitionId: def.id });
    attributeEvent(tx, def, 'created', attr.id);
  }
  tx.emit('attribute-definition-list', def.id, { entityDefinitionId: def.id });
  return attrs;
}

/** Inserts one attribute definition and its projection column(s). */
export async function insertAttributeDefinition(tx: Tx, def: DefInfo, spec: AttributeSpec): Promise<AttrDef> {
  const [attr] = await insertAttributeDefinitions(tx, def, [spec]);
  return attr as AttrDef;
}

/** Creates both sides of a relationship (entity-reference attributes pointing at each other). */
export async function insertRelationshipPair(
  tx: Tx,
  left: { def: DefInfo; spec: AttributeSpec },
  right: { def: DefInfo; spec: AttributeSpec },
): Promise<[AttrDef, AttrDef]> {
  const leftId = left.spec.id ?? newId();
  const rightId = right.spec.id ?? newId();
  const leftConfig: AttributeConfig = { entityReferenceConfiguration: { allowedEntityDefinitionIds: [right.def.id] } };
  const rightConfig: AttributeConfig = { entityReferenceConfiguration: { allowedEntityDefinitionIds: [left.def.id] } };
  const a = await insertAttributeDefinition(tx, left.def, {
    ...left.spec,
    id: leftId,
    type: 'entity-reference',
    config: leftConfig,
    relationshipAttributeId: rightId,
  });
  const rightDef = await loadDefinition(tx, right.def.id);
  const b = await insertAttributeDefinition(tx, rightDef, {
    ...right.spec,
    id: rightId,
    type: 'entity-reference',
    config: rightConfig,
    relationshipAttributeId: leftId,
  });
  return [a, b];
}

export interface OptionSpec {
  id?: string;
  title: string;
  color?: string;
  sortOrder?: string;
  lifecyclePhase?: 'ACTIVE' | 'WON' | 'LOST';
  targetTimeInStatus?: string | null;
  celebrationEnabled?: boolean;
}

async function existingOptions(tx: Tx, attrId: string) {
  return tx.db
    .selectFrom('select_options')
    .selectAll()
    .where('attribute_id', '=', attrId)
    .orderBy('sort_order')
    .execute();
}

/** Inserts select options (kind option) or pipeline stages (kind stage) of one attribute. */
export async function insertOptions(tx: Tx, attr: AttrDef, specs: OptionSpec[]): Promise<string[]> {
  const kind = attr.type === 'pipeline' ? 'stage' : 'option';
  if (attr.type !== 'pipeline' && attr.type !== 'select') {
    throw badRequest('VALIDATION_ERROR', `Attribute "${attr.apiSlug}" has no ${kind}s`);
  }
  const current = await existingOptions(tx, attr.id);
  await assertWithinLimit(tx, 'select_options_per_attribute_hard', current.length, specs.length, {
    attribute_definition_id: attr.id,
  });
  const titles = new Set(current.filter((o) => !o.is_archived).map((o) => o.title.toLowerCase()));
  const palette: readonly string[] = kind === 'stage' ? stageColors : optionColors;
  let last = current.at(-1)?.sort_order ?? null;
  const ids: string[] = [];
  const rows = specs.map((s, i) => {
    const key = s.title.trim().toLowerCase();
    if (titles.has(key)) throw conflict('TITLE_IN_USE', 'This name is already in use', { title: s.title });
    titles.add(key);
    if (s.color && !palette.includes(s.color)) throw badRequest('VALIDATION_ERROR', `Invalid colour ${s.color}`);
    const sortOrder = s.sortOrder ?? rankAfter(last);
    last = sortOrder > (last ?? '') ? sortOrder : last;
    const id = s.id ?? newId();
    ids.push(id);
    return {
      id,
      workspace_id: tx.workspaceId,
      entity_definition_id: attr.entityDefinitionId,
      attribute_id: attr.id,
      kind: kind as 'option' | 'stage',
      title: s.title.trim(),
      color: s.color ?? (palette[(current.length + i) % palette.length] as string),
      sort_order: sortOrder,
      lifecycle_phase: kind === 'stage' ? (s.lifecyclePhase ?? 'ACTIVE') : null,
      target_time_in_status: kind === 'stage' ? (s.targetTimeInStatus ?? null) : null,
      celebration_enabled: kind === 'stage' ? (s.celebrationEnabled ?? false) : false,
      created_by: jsonb(tx.ctx.actor),
      created_at: tx.now,
      updated_at: tx.now,
    };
  });
  if (rows.length > 0) await tx.db.insertInto('select_options').values(rows).execute();
  tx.emit('select-option-list', attr.id, {
    entityDefinitionId: attr.entityDefinitionId,
    attributeDefinitionId: attr.id,
    kind,
  });
  return ids;
}

type OptionRow = Awaited<ReturnType<typeof existingOptions>>[number];

function toSelectOption(r: OptionRow): SelectOption {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    entityDefinitionId: r.entity_definition_id,
    attributeDefinitionId: r.attribute_id,
    title: r.title,
    color: r.color,
    sortOrder: r.sort_order,
    isArchived: r.is_archived,
    createdAt: r.created_at,
  };
}

function toPipelineStage(r: OptionRow): PipelineStage {
  return {
    ...toSelectOption(r),
    lifecyclePhase: r.lifecycle_phase ?? 'ACTIVE',
    targetTimeInStatus: r.target_time_in_status,
    celebrationEnabled: r.celebration_enabled,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Services (one transaction per call; inputs validated with the contracts schemas)

export const schemaOps = {
  async listObjects(tx: Tx, input: ListEntityDefinitionsInput = {}): Promise<EntityDefinition[]> {
    const { includeArchived, entityTypes } = listEntityDefinitionsInputSchema.parse(input);
    const rows = await tx.db
      .selectFrom('entity_definitions')
      .select('id')
      .$if(!includeArchived, (q) => q.where('is_archived', '=', false))
      .$if(!!entityTypes, (q) => q.where('entity_type', 'in', entityTypes ?? []))
      .orderBy('sort_order')
      .orderBy('created_at')
      .execute();
    const defs = await loadDefinitionsByIds(
      tx,
      rows.map((r) => r.id),
    );
    return rows.map((r) => toEntityDefinition(defs.get(r.id) as DefInfo));
  },

  async getObject(tx: Tx, entityDefinitionId: string): Promise<EntityDefinition> {
    return toEntityDefinition(await loadDefinition(tx, entityDefinitionId));
  },

  /** Custom object with the system attributes of API-created custom objects (attribute-types §4). */
  async createObject(
    tx: Tx,
    input: CreateObjectInput,
    seed: (tx: Tx, def: DefInfo) => Promise<void>,
  ): Promise<EntityDefinition> {
    const data = createObjectInputSchema.parse(input);
    const existing = await tx.db
      .selectFrom('entity_definitions')
      .selectAll()
      .where('id', '=', data.id)
      .executeTakeFirst();
    if (existing) return toEntityDefinition(await loadDefinition(tx, data.id)); // idempotent replay
    const taken = await tx.db
      .selectFrom('entity_definitions')
      .select('id')
      .where('api_slug', '=', data.apiSlug)
      .executeTakeFirst();
    if (taken) throw conflict('SLUG_IN_USE', 'This slug is already in use', { conflicting_field: 'api_slug' });
    const def = await insertEntityDefinition(tx, {
      id: data.id,
      entityType: 'custom-record',
      apiSlug: data.apiSlug,
      singularNoun: data.singularNoun,
      pluralNoun: data.pluralNoun,
      icon: data.icon ?? null,
      sortOrder: data.sortOrder ?? null,
    });
    await seed(tx, def);
    return toEntityDefinition(await loadDefinition(tx, def.id));
  },

  async updateObject(
    tx: Tx,
    input: UpdateObjectInput,
    activate: (tx: Tx, def: DefInfo) => Promise<void>,
  ): Promise<EntityDefinition> {
    const data = updateObjectInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    if (def.entityType === 'interface') throw badRequest('VALIDATION_ERROR', 'Interfaces cannot be changed');
    if (data.apiSlug !== undefined && data.apiSlug !== def.apiSlug) {
      if (def.isSystem) throw badRequest('RESERVED_API_SLUG', 'The slug of a standard object cannot be changed');
      const taken = await tx.db
        .selectFrom('entity_definitions')
        .select('id')
        .where('api_slug', '=', data.apiSlug)
        .executeTakeFirst();
      if (taken)
        throw conflict('SLUG_IN_USE', 'This slug is already in use', {
          conflicting_field: 'api_slug',
          entity_definition_id: def.id,
        });
    }
    await tx.db
      .updateTable('entity_definitions')
      .set({
        ...(data.apiSlug !== undefined ? { api_slug: data.apiSlug } : {}),
        ...(data.singularNoun !== undefined ? { singular_noun: data.singularNoun } : {}),
        ...(data.pluralNoun !== undefined ? { plural_noun: data.pluralNoun } : {}),
        ...(data.icon !== undefined ? { icon: data.icon } : {}),
        ...(data.isArchived !== undefined ? { is_archived: data.isArchived } : {}),
        ...(data.imagePath !== undefined ? { image_path: jsonb(data.imagePath) } : {}),
        ...(data.epithetPath !== undefined ? { epithet_path: jsonb(data.epithetPath) } : {}),
        ...(data.sortOrder !== undefined ? { sort_order: data.sortOrder } : {}),
        updated_at: tx.now,
      })
      .where('id', '=', def.id)
      .execute();
    invalidateDefinitions(tx);
    tx.emit('entity-definition', def.id);
    tx.emit('entity-definition-list', null);
    if (data.isArchived === false && def.seededAt === null) await activate(tx, await loadDefinition(tx, def.id));
    return toEntityDefinition(await loadDefinition(tx, def.id));
  },

  async listAttributes(tx: Tx, input: ListAttributesInput): Promise<AttributeDefinition[]> {
    const { entityDefinitionId, includeArchived } = listAttributesInputSchema.parse(input);
    const def = await loadDefinition(tx, entityDefinitionId);
    return def.attrs.filter((a) => includeArchived || !a.isArchived).map(toAttributeDefinition);
  },

  async getAttribute(tx: Tx, entityDefinitionId: string, attributeDefinitionId: string): Promise<AttributeDefinition> {
    return toAttributeDefinition(resolveAttribute(await loadDefinition(tx, entityDefinitionId), attributeDefinitionId));
  },

  async createAttribute(tx: Tx, input: CreateAttributeInput): Promise<AttributeDefinition> {
    const data = createAttributeInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    const existing = await tx.db
      .selectFrom('attribute_definitions')
      .select(['id', 'entity_definition_id'])
      .where('id', '=', data.id)
      .executeTakeFirst();
    if (existing) {
      if (existing.entity_definition_id !== def.id)
        throw conflict('ID_CONFLICT', 'This attribute id is used by another object');
      return toAttributeDefinition(resolveAttribute(def, data.id)); // idempotent replay
    }
    if (data.relationship && data.type !== 'entity-reference') {
      throw badRequest('VALIDATION_ERROR', 'Relationships are entity-reference attributes');
    }
    if (data.options && data.type !== 'select')
      throw badRequest('VALIDATION_ERROR', 'Only select attributes have options');
    if (data.stages && data.type !== 'pipeline')
      throw badRequest('VALIDATION_ERROR', 'Only status attributes have stages');
    const allowed = data.entityReferenceConfiguration?.allowedEntityDefinitionIds;
    if (allowed && allowed.length > 0) {
      const found = await loadDefinitionsByIds(tx, allowed);
      if (found.size !== new Set(allowed).size)
        throw badRequest('VALIDATION_ERROR', 'Unknown object in allowedEntityDefinitionIds');
    }
    const spec: AttributeSpec = {
      id: data.id,
      ...(data.apiSlug !== undefined ? { apiSlug: data.apiSlug } : {}),
      title: data.title,
      description: data.description,
      type: data.type,
      isMultiselect: data.isMultiselect,
      isUnique: data.isUnique,
      isRequired: data.isRequired,
      ...(data.isHistoric !== undefined ? { isHistoric: data.isHistoric } : {}),
      ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      config: {
        ...(data.numberConfiguration ? { numberConfiguration: data.numberConfiguration } : {}),
        ...(data.currencyConfiguration ? { currencyConfiguration: data.currencyConfiguration } : {}),
        ...(data.entityReferenceConfiguration
          ? { entityReferenceConfiguration: data.entityReferenceConfiguration }
          : {}),
      },
      defaultValue: data.defaultValue ?? null,
    };
    let attr: AttrDef;
    if (data.relationship) {
      const rel = data.relationship;
      const otherDef = await loadDefinition(tx, rel.entityDefinitionId);
      if (otherDef.entityType === 'interface' || def.entityType === 'interface') {
        throw badRequest('VALIDATION_ERROR', 'Relationships connect objects or lists');
      }
      [attr] = await insertRelationshipPair(
        tx,
        { def, spec },
        {
          def: otherDef,
          spec: {
            id: rel.id,
            ...(rel.apiSlug !== undefined ? { apiSlug: rel.apiSlug } : {}),
            title: rel.title,
            description: rel.description,
            type: 'entity-reference',
            isMultiselect: rel.isMultiselect,
            isRequired: rel.isRequired,
            ...(rel.sortOrder !== undefined ? { sortOrder: rel.sortOrder } : {}),
          },
        },
      );
    } else {
      attr = await insertAttributeDefinition(tx, def, spec);
    }
    if (data.options?.length) await insertOptions(tx, attr, data.options);
    if (data.stages?.length) await insertOptions(tx, attr, data.stages);
    invalidateDefinitions(tx);
    return toAttributeDefinition(resolveAttribute(await loadDefinition(tx, def.id), attr.id));
  },

  async updateAttribute(tx: Tx, input: UpdateAttributeInput): Promise<AttributeDefinition> {
    const data = updateAttributeInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    const attr = resolveAttribute(def, data.attributeDefinitionId);
    const isProtected = attr.isSystem && PROTECTED_SYSTEM_TYPES.has(attr.systemAttributeType ?? '');
    if (
      isProtected &&
      (data.isArchived !== undefined || data.isUnique !== undefined || data.isRequired !== undefined)
    ) {
      throw badRequest('ATTRIBUTE_READ_ONLY', 'This system attribute cannot be changed');
    }
    if (data.apiSlug !== undefined && data.apiSlug !== attr.apiSlug) {
      if (attr.isSystem) throw badRequest('RESERVED_API_SLUG', 'The slug of a system attribute cannot be changed');
      if (def.bySlug.has(data.apiSlug)) {
        throw conflict('SLUG_IN_USE', 'This slug is already in use', {
          conflicting_field: 'api_slug',
          attribute_definition_id: attr.id,
        });
      }
    }
    if (data.isUnique === true && (attr.type === 'select' || attr.type === 'pipeline')) {
      throw badRequest('VALIDATION_ERROR', `Attributes of type ${attr.type} cannot be unique`);
    }
    validateDefaultValue(attr.type, data.defaultValue);
    if (data.isUnique !== undefined && data.isUnique !== attr.isUnique) await setUniqueness(tx, attr, data.isUnique);
    const config: AttributeConfig = { ...attr.config };
    if (data.numberConfiguration && attr.type === 'number') config.numberConfiguration = data.numberConfiguration;
    if (data.currencyConfiguration && attr.type === 'currency')
      config.currencyConfiguration = data.currencyConfiguration;
    if (data.entityReferenceConfiguration && attr.type === 'entity-reference' && !attr.relationshipAttributeId) {
      config.entityReferenceConfiguration = data.entityReferenceConfiguration;
    }
    const patch = {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.apiSlug !== undefined ? { api_slug: data.apiSlug } : {}),
      ...(data.isRequired !== undefined ? { is_required: data.isRequired } : {}),
      ...(data.isUnique !== undefined ? { is_unique: data.isUnique } : {}),
      ...(data.sortOrder !== undefined ? { sort_order: data.sortOrder } : {}),
      ...(data.defaultValue !== undefined ? { default_value: jsonb(data.defaultValue) } : {}),
      config: jsonb(config),
      updated_at: tx.now,
    };
    await tx.db.updateTable('attribute_definitions').set(patch).where('id', '=', attr.id).execute();
    if (data.isArchived !== undefined) {
      // Both sides of a relationship are archived together.
      const ids = [attr.id, ...(attr.relationshipAttributeId ? [attr.relationshipAttributeId] : [])];
      await tx.db
        .updateTable('attribute_definitions')
        .set({ is_archived: data.isArchived, updated_at: tx.now })
        .where('id', 'in', ids)
        .execute();
      if (attr.relationshipAttributeId && attr.relatedEntityDefinitionId) {
        tx.emit('attribute-definition', attr.relationshipAttributeId, {
          entityDefinitionId: attr.relatedEntityDefinitionId,
        });
        tx.emit('attribute-definition-list', attr.relatedEntityDefinitionId, {
          entityDefinitionId: attr.relatedEntityDefinitionId,
        });
      }
    }
    invalidateDefinitions(tx);
    tx.emit('attribute-definition', attr.id, { entityDefinitionId: def.id });
    tx.emit('attribute-definition-list', def.id, { entityDefinitionId: def.id });
    attributeEvent(tx, def, 'updated', attr.id);
    return toAttributeDefinition(resolveAttribute(await loadDefinition(tx, def.id), attr.id));
  },

  async listOptions(tx: Tx, input: ListOptionsInput): Promise<SelectOption[]> {
    const data = listOptionsInputSchema.parse(input);
    const attr = resolveAttribute(await loadDefinition(tx, data.entityDefinitionId), data.attributeDefinitionId);
    if (attr.type !== 'select') throw badRequest('VALIDATION_ERROR', `Attribute "${attr.apiSlug}" is not a select`);
    const rows = await existingOptions(tx, attr.id);
    return rows.filter((r) => data.includeArchived || !r.is_archived).map(toSelectOption);
  },

  async listStages(tx: Tx, input: ListOptionsInput): Promise<PipelineStage[]> {
    const data = listOptionsInputSchema.parse(input);
    const attr = resolveAttribute(await loadDefinition(tx, data.entityDefinitionId), data.attributeDefinitionId);
    if (attr.type !== 'pipeline') throw badRequest('VALIDATION_ERROR', `Attribute "${attr.apiSlug}" is not a status`);
    const rows = await existingOptions(tx, attr.id);
    return rows.filter((r) => data.includeArchived || !r.is_archived).map(toPipelineStage);
  },

  async createOption(tx: Tx, input: CreateOptionInput): Promise<SelectOption> {
    const data = createOptionInputSchema.parse(input);
    const attr = resolveAttribute(await loadDefinition(tx, data.entityDefinitionId), data.attributeDefinitionId);
    if (attr.type !== 'select') throw badRequest('VALIDATION_ERROR', `Attribute "${attr.apiSlug}" is not a select`);
    const existing = await tx.db.selectFrom('select_options').selectAll().where('id', '=', data.id).executeTakeFirst();
    if (existing) {
      if (existing.attribute_id !== attr.id)
        throw conflict('ID_CONFLICT', 'This option id is used by another attribute');
      return toSelectOption(existing);
    }
    await insertOptions(tx, attr, [data]);
    const row = await tx.db
      .selectFrom('select_options')
      .selectAll()
      .where('id', '=', data.id)
      .executeTakeFirstOrThrow();
    return toSelectOption(row);
  },

  async updateOption(tx: Tx, input: UpdateOptionInput): Promise<SelectOption> {
    const data = updateOptionInputSchema.parse(input);
    const attr = resolveAttribute(await loadDefinition(tx, data.entityDefinitionId), data.attributeDefinitionId);
    const row = await updateOptionRow(tx, attr, data.selectOptionId, data);
    return toSelectOption(row);
  },

  async createStage(tx: Tx, input: CreateStageInput): Promise<PipelineStage> {
    const data = createStageInputSchema.parse(input);
    const attr = resolveAttribute(await loadDefinition(tx, data.entityDefinitionId), data.attributeDefinitionId);
    if (attr.type !== 'pipeline') throw badRequest('VALIDATION_ERROR', `Attribute "${attr.apiSlug}" is not a status`);
    const existing = await tx.db.selectFrom('select_options').selectAll().where('id', '=', data.id).executeTakeFirst();
    if (existing) {
      if (existing.attribute_id !== attr.id)
        throw conflict('ID_CONFLICT', 'This stage id is used by another attribute');
      return toPipelineStage(existing);
    }
    await insertOptions(tx, attr, [data]);
    const row = await tx.db
      .selectFrom('select_options')
      .selectAll()
      .where('id', '=', data.id)
      .executeTakeFirstOrThrow();
    return toPipelineStage(row);
  },

  async updateStage(tx: Tx, input: UpdateStageInput): Promise<PipelineStage> {
    const data = updateStageInputSchema.parse(input);
    const attr = resolveAttribute(await loadDefinition(tx, data.entityDefinitionId), data.attributeDefinitionId);
    const row = await updateOptionRow(tx, attr, data.pipelineStageId, data);
    return toPipelineStage(row);
  },

  async rebuildProjection(tx: Tx, entityDefinitionId: string): Promise<ProjectionReport> {
    const def = await loadDefinition(tx, entityDefinitionId);
    if (!def.projectionTable) throw badRequest('VALIDATION_ERROR', 'Interfaces have no projection');
    await rebuildProjection(tx, def);
    const diff = await diffProjection(tx, def);
    return { entityDefinitionId: def.id, ...diff };
  },

  async verifyProjection(tx: Tx, entityDefinitionId: string): Promise<ProjectionReport> {
    const def = await loadDefinition(tx, entityDefinitionId);
    if (!def.projectionTable) throw badRequest('VALIDATION_ERROR', 'Interfaces have no projection');
    return { entityDefinitionId: def.id, ...(await diffProjection(tx, def)) };
  },

  async ensureIndex(
    tx: Tx,
    entityDefinitionId: string,
    attributeDefinitionId: string,
    kind: 'sort' | 'contains' = 'sort',
  ) {
    const def = await loadDefinition(tx, entityDefinitionId);
    await ensureProjectionIndex(tx, def, resolveAttribute(def, attributeDefinitionId), kind);
  },
};

async function updateOptionRow(
  tx: Tx,
  attr: AttrDef,
  optionId: string,
  data: {
    title?: string | undefined;
    color?: string | undefined;
    sortOrder?: string | undefined;
    isArchived?: boolean | undefined;
    lifecyclePhase?: 'ACTIVE' | 'WON' | 'LOST' | undefined;
    targetTimeInStatus?: string | null | undefined;
    celebrationEnabled?: boolean | undefined;
  },
): Promise<OptionRow> {
  const rows = await existingOptions(tx, attr.id);
  const row = rows.find((r) => r.id === optionId);
  if (!row) throw notFound('The requested option could not be found', { select_option_id: optionId });
  const isStage = row.kind === 'stage';
  if (data.title !== undefined) {
    const clash = rows.find(
      (r) => r.id !== optionId && !r.is_archived && r.title.toLowerCase() === data.title?.trim().toLowerCase(),
    );
    if (clash) throw conflict('TITLE_IN_USE', 'This name is already in use', { title: data.title });
  }
  const palette: readonly string[] = isStage ? stageColors : optionColors;
  if (data.color !== undefined && !palette.includes(data.color))
    throw badRequest('VALIDATION_ERROR', `Invalid colour ${data.color}`);
  await tx.db
    .updateTable('select_options')
    .set({
      ...(data.title !== undefined ? { title: data.title.trim() } : {}),
      ...(data.color !== undefined ? { color: data.color } : {}),
      ...(data.sortOrder !== undefined ? { sort_order: data.sortOrder } : {}),
      ...(data.isArchived !== undefined ? { is_archived: data.isArchived } : {}),
      ...(isStage && data.lifecyclePhase !== undefined ? { lifecycle_phase: data.lifecyclePhase } : {}),
      ...(isStage && data.targetTimeInStatus !== undefined ? { target_time_in_status: data.targetTimeInStatus } : {}),
      ...(isStage && data.celebrationEnabled !== undefined ? { celebration_enabled: data.celebrationEnabled } : {}),
      updated_at: tx.now,
    })
    .where('id', '=', optionId)
    .execute();
  tx.emit('select-option-list', attr.id, {
    entityDefinitionId: attr.entityDefinitionId,
    attributeDefinitionId: attr.id,
    kind: row.kind,
  });
  return tx.db.selectFrom('select_options').selectAll().where('id', '=', optionId).executeTakeFirstOrThrow();
}

/**
 * Turns uniqueness on (claims a unique_key on every current value; 409 if two records share a value) or off. The
 * claim column is derived data; the values themselves are not touched.
 */
async function setUniqueness(tx: Tx, attr: AttrDef, unique: boolean): Promise<void> {
  if (!unique) {
    await tx.db
      .updateTable('attribute_values')
      .set({ unique_key: null })
      .where('attribute_id', '=', attr.id)
      .where('active_until', 'is', null)
      .execute();
    return;
  }
  const rows = await tx.db
    .selectFrom('attribute_values')
    .select(['id', 'instance_id', 'v_text', 'v_num', 'v_ts', 'v_date', 'v_bool', 'v_ref', 'v_ref_def', 'v_json'])
    .where('attribute_id', '=', attr.id)
    .where('active_until', 'is', null)
    .execute();
  const seen = new Map<string, string>();
  for (const r of rows) {
    const key = canonicalFromRow(attr.type, r);
    const other = seen.get(key);
    if (other && other !== r.instance_id) {
      throw conflict('UNIQUE_CONSTRAINT_VIOLATION', 'Existing records share a value of this attribute', {
        attribute_definition_id: attr.id,
        entity_instance_ids: [other, r.instance_id],
      });
    }
    seen.set(key, r.instance_id);
  }
  for (const r of rows) {
    await tx.db
      .updateTable('attribute_values')
      .set({ unique_key: canonicalFromRow(attr.type, r) })
      .where('id', '=', r.id)
      .execute();
  }
}
