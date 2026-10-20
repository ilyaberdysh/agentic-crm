// Record and member search for ⌘K, the Search modal, pickers, add-to-list dialogs and mentions (CROSS-DOMAIN B.8;
// B-shell/command-palette.md §3.1, §4, §5; C1 cells §2 record reference editor; Attio's
// `POST …/search/…/query {query, filters:{entity_definition_id}, hitsPerPage}`).
//
// Ranking is ours (Attio's is opaque; decision "Search ranking & debounce" in slice5-contracts.md, X-17, C.4 #8):
//   exact match on name / email / domain / phone (or social handle) > prefix > word prefix (name and identifiers,
//   then every query word in any order, then description / location words) > substring > trigram similarity
//   (typos); ties by recency of the record's last update. A record id finds its record exactly. Results carry the
//   record's list memberships (lists the caller may read).
// Stale-response guard: clients fire on every keystroke with a monotonically increasing `requestSeq`; the server echoes
// it and the client drops responses older than the newest one it applied.
import { z } from 'zod';
import { idOrSlugSchema, uuidSchema } from './common.ts';
import { accessLevelSchema } from './workspaces.ts';

/** Hits per query when the caller names no limit (decision: 20). */
export const SEARCH_DEFAULT_LIMIT = 20;

export const searchRecordsInputSchema = z.object({
  /** Free text: name, email, domain, phone (digits are matched without formatting), handle, words of the
   * description or location, or a record id. Empty = the default set (most recently updated records). */
  query: z.string().max(256).default(''),
  /** Echoed back unchanged: the client's sequence number of this request (stale-response guard). */
  requestSeq: z.number().int().min(0).optional(),
  /** Objects to search (ids or api slugs); omitted = every active record object the caller may read. */
  entityDefinitionIds: z.array(idOrSlugSchema).min(1).max(50).optional(),
  limit: z.number().int().min(1).max(100).default(SEARCH_DEFAULT_LIMIT),
  /** Already selected records to leave out (multi-value pickers). */
  excludeIds: z.array(uuidSchema).max(1000).optional(),
});
export type SearchRecordsInput = z.input<typeof searchRecordsInputSchema>;

/** Which field produced the hit's rank (null for the empty-query default set). */
export const searchMatchedFieldSchema = z.enum([
  'record-id',
  'name',
  'email',
  'domain',
  'phone',
  'handle',
  'description',
  'location',
]);
export type SearchMatchedField = z.infer<typeof searchMatchedFieldSchema>;

/** A matched character range in `matchedValue` (UTF-16 offsets, ready for `String.slice`). */
export const searchHighlightSchema = z.object({ start: z.number().int().min(0), length: z.number().int().min(1) });
export type SearchHighlight = z.infer<typeof searchHighlightSchema>;

export const searchHitListSchema = z.object({
  listId: uuidSchema,
  name: z.string(),
  /** 'emoji:<shortname>' or null (default list icon). */
  icon: z.string().nullable(),
  /** The record's entries in that list (usually one; duplicates are allowed). */
  entryIds: z.array(uuidSchema),
});
export type SearchHitList = z.infer<typeof searchHitListSchema>;

export const searchRecordHitSchema = z.object({
  entityDefinitionId: uuidSchema,
  entityInstanceId: uuidSchema,
  /** Display name (the object's label attribute); null when the record has none (custom objects show the id). */
  title: z.string().nullable(),
  /** Secondary line: first domain (companies) or email address (people), else null. */
  subtitle: z.string().nullable(),
  /** Avatar / logo URL, or null. */
  avatar: z.string().nullable(),
  /** Relevance (higher first): 1000 exact, 800 prefix, 600 word prefix, 550 all words, 500 description / location
   * words, 300 substring, 100–200 trigram similarity; 2000 for a record id; 0 for the empty-query default set. */
  score: z.number(),
  matchedField: searchMatchedFieldSchema.nullable(),
  /** The value that matched (e.g. the email address); equals `title` for name matches; null when unknown. */
  matchedValue: z.string().nullable(),
  highlights: z.array(searchHighlightSchema),
  /** People / companies identifiers (Attio hit fields email_addresses, phone_numbers, domains). */
  emailAddresses: z.array(z.string()),
  phoneNumbers: z.array(z.string()),
  domains: z.array(z.string()),
  /** List memberships (lists the caller may read), in sidebar order. */
  lists: z.array(searchHitListSchema),
});
export type SearchRecordHit = z.infer<typeof searchRecordHitSchema>;

export const searchRecordsOutputSchema = z.object({
  /** The request's `requestSeq` (null when the request carried none). */
  requestSeq: z.number().int().nullable(),
  hits: z.array(searchRecordHitSchema),
  /** Hits grouped by object, objects ordered by their best hit (ids in rank order). */
  groups: z.array(z.object({ entityDefinitionId: uuidSchema, entityInstanceIds: z.array(uuidSchema) })),
});
export type SearchRecordsOutput = z.infer<typeof searchRecordsOutputSchema>;

export const searchMembersInputSchema = z.object({
  /** Name or email; empty = every member, by name. */
  query: z.string().max(200).default(''),
  limit: z.number().int().min(1).max(200).default(50),
  includeSuspended: z.boolean().default(false),
});
export type SearchMembersInput = z.input<typeof searchMembersInputSchema>;

export const searchMemberHitSchema = z.object({
  id: uuidSchema,
  firstName: z.string(),
  lastName: z.string(),
  emailAddress: z.string(),
  accessLevel: accessLevelSchema,
  score: z.number(),
});
export type SearchMemberHit = z.infer<typeof searchMemberHitSchema>;

export const searchMembersOutputSchema = z.object({ hits: z.array(searchMemberHitSchema) });
export type SearchMembersOutput = z.infer<typeof searchMembersOutputSchema>;
