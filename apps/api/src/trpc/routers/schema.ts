// Data model metadata (A §4.3–4.6, J attribute-dialogs, J objects-lists): objects, attributes, select options and
// statuses (pipeline stages). Thin adapters over domain.schema; creates are PUT-style with client UUIDs (I3).
import {
  type AttributeDefinition,
  createAttributeInputSchema,
  createObjectInputSchema,
  createOptionInputSchema,
  createStageInputSchema,
  idOrSlugSchema,
  listAttributesInputSchema,
  listEntityDefinitionsInputSchema,
  listOptionsInputSchema,
  rankSchema,
  updateAttributeInputSchema,
  updateObjectInputSchema,
  updateOptionInputSchema,
  updateStageInputSchema,
  uuidSchema,
} from '@agentic-crm/contracts';
import { DomainError } from '@agentic-crm/domain';
import { z } from 'zod';
import { acceptAfterInput, withSeq } from '../mutation';
import { assertCan, filterAllowed } from '../policy';
import { adminProcedure, router, workspaceProcedure } from '../trpc';

const objectRef = z.object({ entityDefinitionId: idOrSlugSchema, ...acceptAfterInput });
const attributeRef = { entityDefinitionId: idOrSlugSchema, attributeDefinitionId: idOrSlugSchema };
const optionRef = z.object({ ...attributeRef, selectOptionId: uuidSchema });
const stageRef = z.object({ ...attributeRef, pipelineStageId: uuidSchema });

const objects = router({
  /**
   * Entity definitions the member can see (objects, plus system definitions when not filtered by type). Objects with
   * No access are left out (sidebar, pickers); `scope: 'all'` (admins, settings → Objects) lists every definition so
   * admins can always reach an object's Permissions tab (OQ-067).
   */
  list: workspaceProcedure
    .input(
      listEntityDefinitionsInputSchema
        .extend({ ...acceptAfterInput, scope: z.enum(['readable', 'all']).optional() })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const { acceptAfter: _, scope, ...filter } = input ?? {};
      const defs = await ctx.domain.schema.listObjects(ctx.service, filter);
      if (scope === 'all') {
        if (ctx.membership.accessLevel !== 'admin') {
          throw new DomainError(403, 'FORBIDDEN', 'Only workspace admins can see every object');
        }
        return defs;
      }
      return filterAllowed(ctx, defs, (d) => d.id, 'read_entity_definition');
    }),

  /** One definition; admins may read any object's definition (settings pages), its records still follow grants. */
  get: workspaceProcedure.input(objectRef).query(async ({ ctx, input }) => {
    if (ctx.membership.accessLevel !== 'admin')
      await assertCan(ctx, input.entityDefinitionId, 'read_entity_definition');
    return ctx.domain.schema.getObject(ctx.service, input.entityDefinitionId);
  }),

  /** Create a custom object (settings → Objects; admin). Idempotent per id. */
  create: adminProcedure.input(createObjectInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.schema.createObject(svc, input));
    return { object: result, seq };
  }),

  /** Names, slug, icon, display paths, sort order. */
  update: workspaceProcedure.input(updateObjectInputSchema).mutation(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'update_entity_definition');
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.schema.updateObject(svc, input));
    return { object: result, seq };
  }),

  archive: workspaceProcedure
    .input(z.object({ entityDefinitionId: idOrSlugSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertCan(ctx, input.entityDefinitionId, 'update_entity_definition');
      const { result, seq } = await withSeq(ctx.service, (svc) =>
        ctx.domain.schema.updateObject(svc, { entityDefinitionId: input.entityDefinitionId, isArchived: true }),
      );
      return { object: result, seq };
    }),

  /** Activate a standard object (Deals, Users, Workspaces): the first activation seeds attributes and views. */
  activate: workspaceProcedure
    .input(z.object({ entityDefinitionId: idOrSlugSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertCan(ctx, input.entityDefinitionId, 'update_entity_definition');
      const { result, seq } = await withSeq(ctx.service, (svc) =>
        ctx.domain.schema.updateObject(svc, { entityDefinitionId: input.entityDefinitionId, isArchived: false }),
      );
      return { object: result, seq };
    }),
});

const duplicateAttributeInputSchema = z.object({
  ...attributeRef,
  /** Client-minted id of the copy (I3); replays return the existing copy. */
  id: uuidSchema,
  title: z.string().trim().min(1).max(200).optional(),
  sortOrder: rankSchema.optional(),
});

/** What a copy keeps: type, description, multiplicity, history tracking, configuration, default, options/stages. */
async function duplicateSpec(
  ctx: Parameters<typeof assertCan>[0],
  source: AttributeDefinition,
  input: z.infer<typeof duplicateAttributeInputSchema>,
) {
  if (source.relationship || source.isReadOnly || source.type === 'interaction') {
    throw new DomainError(400, 'VALIDATION_ERROR', 'This attribute cannot be duplicated', {
      attribute_definition_id: source.id,
    });
  }
  const ref = {
    entityDefinitionId: source.entityDefinitionId,
    attributeDefinitionId: source.id,
    includeArchived: false,
  };
  const options = source.type === 'select' ? await ctx.domain.schema.listOptions(ctx.service, ref) : undefined;
  const stages = source.type === 'pipeline' ? await ctx.domain.schema.listStages(ctx.service, ref) : undefined;
  return {
    id: input.id,
    entityDefinitionId: source.entityDefinitionId,
    title: input.title ?? `${source.title} (copy)`,
    description: source.description,
    type: source.type,
    isMultiselect: source.isMultiselect,
    isHistoric: source.isHistoric,
    ...(input.sortOrder ? { sortOrder: input.sortOrder } : {}),
    ...source.config,
    defaultValue: source.defaultValue,
    ...(options ? { options: options.map((o) => ({ title: o.title, color: o.color as never })) } : {}),
    ...(stages
      ? {
          stages: stages.map((s) => ({
            title: s.title,
            color: s.color as never,
            lifecyclePhase: s.lifecyclePhase,
            targetTimeInStatus: s.targetTimeInStatus,
            celebrationEnabled: s.celebrationEnabled,
          })),
        }
      : {}),
  };
}

const attributes = router({
  /** Attributes of an object, archived ones included unless `includeArchived: false` (A internal #18). */
  list: workspaceProcedure.input(listAttributesInputSchema.extend(acceptAfterInput)).query(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'read_attribute_definition');
    return ctx.domain.schema.listAttributes(ctx.service, input);
  }),

  get: workspaceProcedure.input(z.object({ ...attributeRef, ...acceptAfterInput })).query(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'read_attribute_definition');
    return ctx.domain.schema.getAttribute(ctx.service, input.entityDefinitionId, input.attributeDefinitionId);
  }),

  /** PUT create (idempotent per id); a relationship creates both sides; options/stages may be created inline. */
  create: workspaceProcedure.input(createAttributeInputSchema).mutation(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'create_attribute_definition');
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.schema.createAttribute(svc, input));
    return { attribute: result, seq };
  }),

  /** Title, description, slug, required/unique, configuration, default value, sort order. */
  update: workspaceProcedure.input(updateAttributeInputSchema).mutation(async ({ ctx, input }) => {
    await assertCan(
      ctx,
      input.entityDefinitionId,
      input.isArchived !== undefined ? 'archive_attribute_definition' : 'update_attribute_definition',
    );
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.schema.updateAttribute(svc, input));
    return { attribute: result, seq };
  }),

  /** Archive (both sides of a relationship); `restore` undoes it (J README §3 "Undo"). */
  archive: workspaceProcedure.input(z.object(attributeRef)).mutation(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'archive_attribute_definition');
    const { result, seq } = await withSeq(ctx.service, (svc) =>
      ctx.domain.schema.updateAttribute(svc, { ...input, isArchived: true }),
    );
    return { attribute: result, seq };
  }),

  restore: workspaceProcedure.input(z.object(attributeRef)).mutation(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'archive_attribute_definition');
    const { result, seq } = await withSeq(ctx.service, (svc) =>
      ctx.domain.schema.updateAttribute(svc, { ...input, isArchived: false }),
    );
    return { attribute: result, seq };
  }),

  /**
   * Duplicate (A internal #23 `POST …/duplicate {sort_order, title}`): a new empty attribute with the source's
   * type, configuration and options or stages, created in one write. Relationship and read-only system attributes
   * cannot be duplicated.
   */
  duplicate: workspaceProcedure.input(duplicateAttributeInputSchema).mutation(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'create_attribute_definition');
    const source = await ctx.domain.schema.getAttribute(
      ctx.service,
      input.entityDefinitionId,
      input.attributeDefinitionId,
    );
    const spec = await duplicateSpec(ctx, source, input);
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.schema.createAttribute(svc, spec));
    return { attribute: result, seq };
  }),
});

const options = router({
  /** Options of a select attribute in rank order (archived included unless `includeArchived: false`). */
  list: workspaceProcedure.input(listOptionsInputSchema.extend(acceptAfterInput)).query(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'read_attribute_definition');
    return ctx.domain.schema.listOptions(ctx.service, input);
  }),

  /** PUT create (idempotent per id); 409 TITLE_IN_USE, 409 ATTRIBUTE_SELECT_OPTIONS_LIMIT_EXCEEDED. */
  create: workspaceProcedure.input(createOptionInputSchema).mutation(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'update_attribute_definition');
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.schema.createOption(svc, input));
    return { option: result, seq };
  }),

  update: workspaceProcedure.input(updateOptionInputSchema).mutation(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'update_attribute_definition');
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.schema.updateOption(svc, input));
    return { option: result, seq };
  }),

  archive: workspaceProcedure.input(optionRef).mutation(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'update_attribute_definition');
    const { result, seq } = await withSeq(ctx.service, (svc) =>
      ctx.domain.schema.updateOption(svc, { ...input, isArchived: true }),
    );
    return { option: result, seq };
  }),

  /** Drag-and-drop: only the moved option gets a new rank (X-01: `rankBetween(prev, next)`). */
  reorder: workspaceProcedure.input(optionRef.extend({ sortOrder: rankSchema })).mutation(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'update_attribute_definition');
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.schema.updateOption(svc, input));
    return { option: result, seq };
  }),
});

const statuses = router({
  /** Stages of a status attribute in rank order (archived included unless `includeArchived: false`). */
  list: workspaceProcedure.input(listOptionsInputSchema.extend(acceptAfterInput)).query(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'read_attribute_definition');
    return ctx.domain.schema.listStages(ctx.service, input);
  }),

  create: workspaceProcedure.input(createStageInputSchema).mutation(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'update_attribute_definition');
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.schema.createStage(svc, input));
    return { status: result, seq };
  }),

  update: workspaceProcedure.input(updateStageInputSchema).mutation(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'update_attribute_definition');
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.schema.updateStage(svc, input));
    return { status: result, seq };
  }),

  /** Stages are archived, never deleted (CROSS-DOMAIN X-08). */
  archive: workspaceProcedure.input(stageRef).mutation(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'update_attribute_definition');
    const { result, seq } = await withSeq(ctx.service, (svc) =>
      ctx.domain.schema.updateStage(svc, { ...input, isArchived: true }),
    );
    return { status: result, seq };
  }),

  reorder: workspaceProcedure.input(stageRef.extend({ sortOrder: rankSchema })).mutation(async ({ ctx, input }) => {
    await assertCan(ctx, input.entityDefinitionId, 'update_attribute_definition');
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.schema.updateStage(svc, input));
    return { status: result, seq };
  }),
});

export const schemaRouter = router({ objects, attributes, options, statuses });
