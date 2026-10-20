// Notifications (BACKLOG 5.05–5.06; B-shell/notifications.md; slice5-contracts "Procedure names"): the caller's inbox,
// unread badge, read / unread / archive and preferences per group × channel. Thin adapters over domain.notifications.
// New notifications reach the recipient as `notification` invalidations on their user channel (audience = them).
import {
  archiveNotificationsInputSchema,
  listNotificationsInputSchema,
  markNotificationsReadInputSchema,
  markNotificationsUnreadInputSchema,
  updateNotificationPreferenceInputSchema,
} from '@agentic-crm/contracts';
import { acceptAfterInput, acceptAfterOnly, withSeq } from '../mutation';
import { router, workspaceProcedure } from '../trpc';

export const notificationsRouter = router({
  /**
   * `{topic?, topics?, state: 'unread'|'all'|'archived', actionNeeded?, cursor?, limit?}` → `{items: NotificationGroup[],
   * nextCursor}`: inbox rows newest first (25 per page), each with entries, actors and the resolved subject.
   */
  list: workspaceProcedure.input(listNotificationsInputSchema.extend(acceptAfterInput)).query(({ ctx, input }) => {
    const { acceptAfter: _, ...query } = input;
    return ctx.domain.notifications.list(ctx.service, query);
  }),

  /** `{count, byTopic, actionNeeded, accurateAt}` — the sidebar Inbox badge. */
  unreadCount: workspaceProcedure
    .input(acceptAfterOnly)
    .query(({ ctx }) => ctx.domain.notifications.unreadCount(ctx.service)),

  /** `{ids}` (opening a row) or `{all: true, topics?}` ("Mark all as read") → `{updated, seq}`. */
  markRead: workspaceProcedure.input(markNotificationsReadInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.notifications.markRead(svc, input));
    return { ...result, seq };
  }),

  /** `{ids}` → the newest entry of each row becomes unread. */
  markUnread: workspaceProcedure.input(markNotificationsUnreadInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.notifications.markUnread(svc, input));
    return { ...result, seq };
  }),

  /** `{ids}` or `{all: true, topics?}`, `archived` (default true; false moves rows back) → `{updated, seq}`. */
  archive: workspaceProcedure.input(archiveNotificationsInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.notifications.archive(svc, input));
    return { ...result, seq };
  }),

  preferences: router({
    /** Settings → Notifications: `{groups: [{group, title, description, visible, channels: [{channel, available,
     * enabled}]}]}`. */
    get: workspaceProcedure
      .input(acceptAfterOnly)
      .query(({ ctx }) => ctx.domain.notifications.preferences.get(ctx.service)),

    /** One toggle `{group, channel: 'in-app'|'email', enabled}` → the full preferences + seq. */
    update: workspaceProcedure.input(updateNotificationPreferenceInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) =>
        ctx.domain.notifications.preferences.update(svc, input),
      );
      return { ...result, seq };
    }),
  }),
});
