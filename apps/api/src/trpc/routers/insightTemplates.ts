// Insight templates (slice 10; BACKLOG 10.13; I calls §4, §10, §11.5): list, editor reads, create (transient until
// edited), rename / reorder / archive, delete (unused only), duplicate, publish / discard, our preset gallery,
// previews against a call, and sections (create, update format / order / text, delete, duplicate, move). Section
// titles and prompts are rich-text documents edited live through the collab server. Thin adapters over
// domain.insightTemplates (I5).
import {
  applyInsightPresetInputSchema,
  createInsightSectionInputSchema,
  createInsightTemplateInputSchema,
  duplicateInsightSectionInputSchema,
  duplicateInsightTemplateInputSchema,
  insightSectionIdInputSchema,
  insightTemplateIdInputSchema,
  listInsightTemplatesInputSchema,
  moveInsightSectionInputSchema,
  previewInsightTemplateInputSchema,
  updateInsightSectionInputSchema,
  updateInsightTemplateInputSchema,
  uuidSchema,
} from '@agentic-crm/contracts';
import { z } from 'zod';
import { acceptAfterOnly, withSeq } from '../mutation';
import { router, workspaceProcedure } from '../trpc';

const templateId = z.object({ templateId: uuidSchema });

export const insightTemplatesRouter = router({
  list: workspaceProcedure.input(listInsightTemplatesInputSchema).query(({ ctx, input }) => {
    const { acceptAfter: _, ...query } = input;
    return ctx.domain.insightTemplates.list(ctx.service, query);
  }),

  get: workspaceProcedure
    .input(insightTemplateIdInputSchema)
    .query(({ ctx, input }) => ctx.domain.insightTemplates.get(ctx.service, input.templateId)),

  create: workspaceProcedure.input(createInsightTemplateInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.insightTemplates.create(svc, input));
    return { template: result, seq };
  }),

  update: workspaceProcedure.input(updateInsightTemplateInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.insightTemplates.update(svc, input));
    return { template: result, seq };
  }),

  delete: workspaceProcedure.input(templateId).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) =>
      ctx.domain.insightTemplates.delete(svc, input.templateId),
    );
    return { ...result, seq };
  }),

  duplicate: workspaceProcedure.input(duplicateInsightTemplateInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.insightTemplates.duplicate(svc, input));
    return { template: result, seq };
  }),

  publish: workspaceProcedure.input(templateId).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) =>
      ctx.domain.insightTemplates.publish(svc, input.templateId),
    );
    return { template: result, seq };
  }),

  discard: workspaceProcedure.input(templateId).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) =>
      ctx.domain.insightTemplates.discard(svc, input.templateId),
    );
    return { template: result, seq };
  }),

  /** "Start with a template": our preset gallery. */
  presets: workspaceProcedure.input(acceptAfterOnly).query(({ ctx }) => ctx.domain.insightTemplates.presets()),

  /** "Use this template". */
  applyPreset: workspaceProcedure.input(applyInsightPresetInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.insightTemplates.applyPreset(svc, input));
    return { template: result, seq };
  }),

  /** "Generate preview": the draft rendered against a call. */
  preview: workspaceProcedure.input(previewInsightTemplateInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.insightTemplates.preview(svc, input));
    return { preview: result, seq };
  }),

  sections: router({
    create: workspaceProcedure.input(createInsightSectionInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) =>
        ctx.domain.insightTemplates.sections.create(svc, input),
      );
      return { template: result, seq };
    }),
    update: workspaceProcedure.input(updateInsightSectionInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) =>
        ctx.domain.insightTemplates.sections.update(svc, input),
      );
      return { template: result, seq };
    }),
    delete: workspaceProcedure.input(insightSectionIdInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) =>
        ctx.domain.insightTemplates.sections.delete(svc, input.sectionId),
      );
      return { template: result, seq };
    }),
    duplicate: workspaceProcedure.input(duplicateInsightSectionInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) =>
        ctx.domain.insightTemplates.sections.duplicate(svc, input),
      );
      return { template: result, seq };
    }),
    move: workspaceProcedure.input(moveInsightSectionInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) =>
        ctx.domain.insightTemplates.sections.move(svc, input),
      );
      return { template: result, seq };
    }),
  }),
});
