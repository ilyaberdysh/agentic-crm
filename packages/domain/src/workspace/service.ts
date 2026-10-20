// Workspace › General and Security (BACKLOG 6.02, 6.09; J workspace-admin §2, §5): name, slug (availability check;
// the unique index guards races), logo (a file uploaded through the files flow), and workspace settings — export
// formula-injection protection and the default workspace level per resource kind (X-06). Admin-only writes.
import {
  type CheckWorkspaceSlugOutput,
  type UpdateWorkspaceGeneralInput,
  type UpdateWorkspaceSettingsInput,
  updateWorkspaceGeneralInputSchema,
  updateWorkspaceSettingsInputSchema,
  type WorkspaceDetail,
  workspaceSlugSchema,
} from '@agentic-crm/contracts';
import { type Database, jsonb } from '@agentic-crm/db';
import { actingMemberId } from '../context.ts';
import { badRequest, notFound } from '../errors.ts';
import { requireAdminCaller } from '../permissions/admin.ts';
import { runAsOwner, type Tx } from '../tx.ts';
import { RESERVED_SLUGS, toWorkspace } from '../workspaces/service.ts';
import { assertImageFile } from './images.ts';

type Settings = Record<string, unknown> & {
  exportFormulaInjectionPrefix?: boolean;
  defaultWorkspaceAccess?: Record<string, string | null>;
};

async function loadRow(tx: Tx) {
  const row = await tx.db.selectFrom('workspaces').selectAll().where('id', '=', tx.workspaceId).executeTakeFirst();
  if (!row) throw notFound('The requested workspace could not be found');
  return row;
}

function toDetail(row: Awaited<ReturnType<typeof loadRow>>): WorkspaceDetail {
  const settings = (row.settings ?? {}) as Settings;
  return {
    ...toWorkspace(row),
    logoFileId: row.logo_file_id ?? null,
    exportFormulaInjectionPrefix: settings.exportFormulaInjectionPrefix === true,
  };
}

/** Whether exports of this workspace prefix formula-like cells (read by the export service). */
export async function exportFormulaInjectionPrefix(tx: Tx): Promise<boolean> {
  const row = await tx.db
    .selectFrom('workspaces')
    .select('settings')
    .where('id', '=', tx.workspaceId)
    .executeTakeFirst();
  return ((row?.settings ?? {}) as Settings).exportFormulaInjectionPrefix === true;
}

export const workspaceSettingsOps = {
  async get(tx: Tx): Promise<WorkspaceDetail> {
    return toDetail(await loadRow(tx));
  },

  /** Workspace › General: name, slug, logo (admin). A changed slug moves every URL of the workspace. */
  async updateGeneral(tx: Tx, input: UpdateWorkspaceGeneralInput): Promise<WorkspaceDetail> {
    const data = updateWorkspaceGeneralInputSchema.parse(input);
    await requireAdminCaller(tx, 'Only workspace admins can change workspace settings');
    const row = await loadRow(tx);
    if (data.slug !== undefined && data.slug !== row.slug && RESERVED_SLUGS.has(data.slug)) {
      throw badRequest('RESERVED_SLUG', 'This handle is reserved', { conflicting_field: 'slug' });
    }
    if (data.logoFileId) {
      const memberId = actingMemberId(tx.ctx);
      await assertImageFile(tx, data.logoFileId, memberId);
    }
    await tx.db
      .updateTable('workspaces')
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.slug !== undefined ? { slug: data.slug } : {}),
        // An uploaded logo replaces an external logo URL; removing the logo clears both.
        ...(data.logoFileId !== undefined ? { logo_file_id: data.logoFileId, logo_url: null } : {}),
        updated_at: tx.now,
      })
      .where('id', '=', tx.workspaceId)
      .execute();
    tx.emit('workspace', tx.workspaceId);
    return toDetail(await loadRow(tx));
  },

  /** Security → export security, and default access per resource kind (admin). */
  async updateSettings(tx: Tx, input: UpdateWorkspaceSettingsInput): Promise<WorkspaceDetail> {
    const data = updateWorkspaceSettingsInputSchema.parse(input);
    await requireAdminCaller(tx, 'Only workspace admins can change workspace settings');
    const row = await loadRow(tx);
    const settings = { ...((row.settings ?? {}) as Settings) };
    if (data.exportFormulaInjectionPrefix !== undefined) {
      settings.exportFormulaInjectionPrefix = data.exportFormulaInjectionPrefix;
    }
    if (data.defaultWorkspaceAccess) {
      const next = { ...(settings.defaultWorkspaceAccess ?? {}) };
      for (const [kind, level] of Object.entries(data.defaultWorkspaceAccess)) {
        if (level === undefined) continue;
        if (level === null) delete next[kind];
        else next[kind] = level;
      }
      settings.defaultWorkspaceAccess = next;
    }
    await tx.db
      .updateTable('workspaces')
      .set({ settings: jsonb(settings), updated_at: tx.now })
      .where('id', '=', tx.workspaceId)
      .execute();
    tx.emit('workspace', tx.workspaceId);
    return toDetail(await loadRow(tx));
  },
};

/** "Copy slug" / slug change check: format, reserved handles and other workspaces (cross-tenant, owner role). */
export async function checkWorkspaceSlug(
  database: Database,
  workspaceId: string,
  slug: string,
): Promise<CheckWorkspaceSlugOutput> {
  if (!workspaceSlugSchema.safeParse(slug).success) return { slug, valid: false, available: false, reason: 'invalid' };
  if (RESERVED_SLUGS.has(slug)) return { slug, valid: true, available: false, reason: 'reserved' };
  return runAsOwner(database, async (trx) => {
    const owner = await trx.selectFrom('workspaces').select('id').where('slug', '=', slug).executeTakeFirst();
    if (!owner) return { slug, valid: true, available: true, reason: null };
    if (owner.id === workspaceId) return { slug, valid: true, available: true, reason: 'current' };
    return { slug, valid: true, available: false, reason: 'taken' };
  });
}
