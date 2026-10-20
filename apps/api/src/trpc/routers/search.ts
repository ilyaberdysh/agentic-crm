// Search (CROSS-DOMAIN B.8; slice5-contracts "Search ranking"): records over the search index across one or several
// objects, and workspace members. Thin adapters over domain.search; the domain drops objects the caller may not read.
import { searchMembersInputSchema, searchRecordsInputSchema } from '@agentic-crm/contracts';
import { acceptAfterInput } from '../mutation';
import { router, workspaceProcedure } from '../trpc';

export const searchRouter = router({
  /**
   * `{query, requestSeq?, entityDefinitionIds?, limit? (20), excludeIds?}` → `{requestSeq, hits: [{entityDefinitionId,
   * entityInstanceId, title, subtitle, avatar, score, matchedField, matchedValue, highlights, emailAddresses,
   * phoneNumbers, domains, lists: [{listId, name, icon, entryIds}]}], groups}`, best first (⌘K, Search modal,
   * pickers, mentions). Empty query = most recently updated records. `requestSeq` is echoed for the client's
   * stale-response guard.
   */
  records: workspaceProcedure.input(searchRecordsInputSchema.extend(acceptAfterInput)).query(({ ctx, input }) => {
    const { acceptAfter: _, ...query } = input;
    return ctx.domain.search.records(ctx.service, query);
  }),

  /** `{query, limit?, includeSuspended?}` → `{hits: [{id, firstName, lastName, emailAddress, accessLevel, score}]}`. */
  members: workspaceProcedure.input(searchMembersInputSchema.extend(acceptAfterInput)).query(({ ctx, input }) => {
    const { acceptAfter: _, ...query } = input;
    return ctx.domain.search.members(ctx.service, query);
  }),
});
