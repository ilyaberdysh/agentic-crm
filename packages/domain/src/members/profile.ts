// Profile (BACKLOG 6.01; J workspace-admin §1): first/last name, avatar (an image file on the member's own record),
// time zone, "Start week on" and locale. Names and time preferences apply to every workspace of the user ("Changes to
// your profile will apply to all of your workspaces"; the domain index propagates them); the avatar file lives in
// this workspace.
import type { Profile, UpdateProfileInput, WeekStart } from '@agentic-crm/contracts';
import { updateProfileInputSchema } from '@agentic-crm/contracts';
import { preferenceOps } from '../collab/preferences.ts';
import { permissionMemberId } from '../context.ts';
import { forbidden, notFound } from '../errors.ts';
import { engineFor } from '../records/engine.ts';
import { type AttrDef, loadDefinition } from '../schema/model.ts';
import type { Tx } from '../tx.ts';
import { assertImageFile } from '../workspace/images.ts';

const WEEK_DAY: Record<WeekStart, number> = { sunday: 0, monday: 1, saturday: 6 };
const WEEK_START: Record<number, WeekStart> = { 0: 'sunday', 1: 'monday', 6: 'saturday' };

function requireSelf(tx: Tx): string {
  const memberId = permissionMemberId(tx.ctx);
  if (!memberId) throw forbidden('Only workspace members have a profile');
  return memberId;
}

export const profileOps = {
  async get(tx: Tx): Promise<Profile> {
    const memberId = requireSelf(tx);
    const row = await tx.db.selectFrom('workspace_members').selectAll().where('id', '=', memberId).executeTakeFirst();
    if (!row) throw notFound('The requested workspace member could not be found', { workspace_member_id: memberId });
    const prefs = await tx.db
      .selectFrom('member_preferences')
      .selectAll()
      .where('member_id', '=', memberId)
      .executeTakeFirst();
    return {
      memberId,
      userId: row.user_id,
      firstName: row.first_name,
      lastName: row.last_name,
      emailAddress: row.email_address,
      avatarFileId: row.avatar_file_id ?? null,
      timeZone: prefs?.time_zone ?? null,
      weekStart: prefs?.week_start_day != null ? (WEEK_START[prefs.week_start_day] ?? null) : null,
      locale: prefs?.locale ?? null,
    };
  },

  async update(tx: Tx, input: UpdateProfileInput): Promise<Profile> {
    const data = updateProfileInputSchema.parse(input);
    const memberId = requireSelf(tx);
    if (data.name) {
      await tx.db
        .updateTable('workspace_members')
        .set({ first_name: data.name.firstName, last_name: data.name.lastName, updated_at: tx.now })
        .where('id', '=', memberId)
        .execute();
      // The member's record carries the name too (people pickers, actor labels).
      const def = await loadDefinition(tx, 'workspace_members');
      const attr = def.bySlug.get('name') as AttrDef | undefined;
      if (attr) {
        const engine = engineFor(tx);
        const empty = !data.name.firstName && !data.name.lastName;
        await engine.asSystem(() =>
          engine.setAttribute(
            def,
            memberId,
            attr,
            empty ? [] : [{ value: { firstName: data.name?.firstName, lastName: data.name?.lastName } }],
          ),
        );
        await engine.finalize();
      }
      tx.emit('workspace-member', memberId);
    }
    if (data.avatarFileId !== undefined) {
      if (data.avatarFileId !== null) await assertImageFile(tx, data.avatarFileId, memberId);
      await tx.db
        .updateTable('workspace_members')
        .set({ avatar_file_id: data.avatarFileId, updated_at: tx.now })
        .where('id', '=', memberId)
        .execute();
      tx.emit('workspace-member', memberId);
    }
    if (data.timeZone !== undefined || data.weekStart !== undefined || data.locale !== undefined) {
      await preferenceOps.update(tx, {
        ...(data.timeZone !== undefined ? { timeZone: data.timeZone } : {}),
        ...(data.locale !== undefined ? { locale: data.locale } : {}),
        ...(data.weekStart !== undefined
          ? { weekStartDay: data.weekStart === null ? null : WEEK_DAY[data.weekStart] }
          : {}),
      });
    }
    return profileOps.get(tx);
  },
};
