import type { ProductModule } from '@agentic-crm/contracts/product-modules';
import { z } from 'zod';
import { actingMemberId } from '../context.ts';
import { badRequest, forbidden, notFound } from '../errors.ts';
import type { Tx } from '../tx.ts';
import { productModuleRegistry } from './registry.ts';

export const updateProductModuleSchema = z.strictObject({ moduleId: z.string(), enabled: z.boolean() });
export type UpdateProductModuleInput = z.input<typeof updateProductModuleSchema>;
export type WorkspaceProductModule = { module: ProductModule; enabled: boolean };

function declared(moduleId: string): ProductModule {
  const module = productModuleRegistry.get(moduleId);
  if (!module) throw badRequest('VALIDATION_ERROR', 'Unknown product module');
  return module;
}

async function requireMemberAdmin(tx: Tx): Promise<void> {
  const memberId = actingMemberId(tx.ctx);
  if (!memberId) throw forbidden('Only workspace admins can manage product modules');
  const member = await tx.db
    .selectFrom('workspace_members')
    .select('access_level')
    .where('workspace_id', '=', tx.workspaceId)
    .where('id', '=', memberId)
    .executeTakeFirst();
  if (member?.access_level !== 'admin') throw forbidden('Only workspace admins can manage product modules');
}

/** Holds a shared row lock through the caller's transaction so a disable cannot race a dispatch. */
export async function assertProductModuleEnabled(tx: Tx, moduleId: string): Promise<void> {
  declared(moduleId);
  const row = await tx.db
    .selectFrom('workspace_product_modules')
    .select('enabled')
    .where('workspace_id', '=', tx.workspaceId)
    .where('module_id', '=', moduleId)
    .forShare()
    .executeTakeFirst();
  if (!row?.enabled) throw forbidden('Product module is disabled in this workspace');
}

export const workspaceProductModuleOps = {
  async list(tx: Tx): Promise<WorkspaceProductModule[]> {
    await requireMemberAdmin(tx);
    const rows = await tx.db
      .selectFrom('workspace_product_modules')
      .select(['module_id', 'enabled'])
      .where('workspace_id', '=', tx.workspaceId)
      .execute();
    return productModuleRegistry.list().map((module) => {
      const row = rows.find((item) => item.module_id === module.id);
      if (!row) throw notFound('Workspace product module state not found');
      return { module, enabled: row.enabled };
    });
  },

  async update(tx: Tx, input: UpdateProductModuleInput): Promise<WorkspaceProductModule> {
    const parsed = updateProductModuleSchema.parse(input);
    await requireMemberAdmin(tx);
    const module = declared(parsed.moduleId);
    const row = await tx.db
      .updateTable('workspace_product_modules')
      .set({ enabled: parsed.enabled, updated_at: tx.now })
      .where('workspace_id', '=', tx.workspaceId)
      .where('module_id', '=', parsed.moduleId)
      .returning('enabled')
      .executeTakeFirst();
    if (!row) throw notFound('Workspace product module state not found');
    tx.emit('workspace', tx.workspaceId);
    return { module, enabled: row.enabled };
  },
};
