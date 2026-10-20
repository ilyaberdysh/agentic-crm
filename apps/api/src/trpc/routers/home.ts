// Home page (BACKLOG 5.07; B-shell/home.md §2): one summary query for the greeting, the Tasks block and recent
// records. Thin adapter over domain.home.
import { homeSummaryInputSchema } from '@agentic-crm/contracts';
import { acceptAfterInput } from '../mutation';
import { router, workspaceProcedure } from '../trpc';

export const homeRouter = router({
  /**
   * `{timeZone, now?, taskLimit? (5), recentLimit? (8)}` → `{greeting: {partOfDay, firstName, text}, tasks: {total,
   * today, tomorrow, overdue, later, noDueDate, items: [{bucket, task}]}, recentRecords, localDate, accurateAt}`.
   */
  summary: workspaceProcedure.input(homeSummaryInputSchema.extend(acceptAfterInput)).query(({ ctx, input }) => {
    const { acceptAfter: _, ...query } = input;
    return ctx.domain.home.summary(ctx.service, query);
  }),
});
