// The member's calendar preferences (decisions X-09 / X-10; CROSS-DOMAIN B.24): time zone, locale, week start.
import {
  isTimeZone,
  type MemberPreferences,
  type UpdateMemberPreferencesInput,
  updateMemberPreferencesInputSchema,
  type WeekDay,
  weekStartForLocale,
} from '@agentic-crm/contracts';
import { badRequest } from '../errors.ts';
import type { Tx } from '../tx.ts';
import { memberAudience, requireMember } from './common.ts';

function toPreferences(
  memberId: string,
  row: { time_zone: string | null; locale: string | null; week_start_day: number | null } | undefined,
): MemberPreferences {
  const weekStartDay = row?.week_start_day ?? null;
  const locale = row?.locale ?? null;
  return {
    memberId,
    timeZone: row?.time_zone ?? null,
    locale,
    weekStartDay,
    effectiveWeekStartDay: weekStartDay ?? weekStartForLocale(locale),
  };
}

export const preferenceOps = {
  async get(tx: Tx): Promise<MemberPreferences> {
    const memberId = requireMember(tx);
    const row = await tx.db
      .selectFrom('member_preferences')
      .selectAll()
      .where('member_id', '=', memberId)
      .executeTakeFirst();
    return toPreferences(memberId, row);
  },

  async update(tx: Tx, input: UpdateMemberPreferencesInput): Promise<MemberPreferences> {
    const data = updateMemberPreferencesInputSchema.parse(input);
    const memberId = requireMember(tx);
    if (data.timeZone && !isTimeZone(data.timeZone)) {
      throw badRequest('VALIDATION_ERROR', `Unknown time zone "${data.timeZone}"`, { field: 'timeZone' });
    }
    if (data.locale) {
      try {
        new Intl.Locale(data.locale);
      } catch {
        throw badRequest('VALIDATION_ERROR', `Unknown locale "${data.locale}"`, { field: 'locale' });
      }
    }
    const set = {
      ...(data.timeZone !== undefined ? { time_zone: data.timeZone } : {}),
      ...(data.locale !== undefined ? { locale: data.locale } : {}),
      ...(data.weekStartDay !== undefined ? { week_start_day: data.weekStartDay as WeekDay | null } : {}),
      updated_at: tx.now,
    };
    const row = await tx.db
      .insertInto('member_preferences')
      .values({ member_id: memberId, workspace_id: tx.workspaceId, ...set })
      .onConflict((oc) => oc.column('member_id').doUpdateSet(set))
      .returningAll()
      .executeTakeFirstOrThrow();
    tx.emit('member-preferences', memberId, { memberId }, await memberAudience(tx, memberId));
    return toPreferences(memberId, row);
  },
};
