// Record and member search for ⌘K, the Search modal, pickers, add-to-list dialogs and mentions (CROSS-DOMAIN B.8,
// decision "Search ranking & debounce" in slice5-contracts.md). Records come from the search index (migration 0600,
// search/indexer.ts); members from workspace_members.
//
// Ranking (higher first; ties by the record's last update, newest first):
//   2000 record id · 1000 exact name / email / domain / phone / handle · 800 prefix of one of those · 600 word prefix
//   (name words, then words of emails / domains / handles) · 550 every query word is a word prefix (any order) ·
//   500 word prefix in the description or location · 300 substring anywhere · 100–200 trigram word similarity
//   (typos; ordered by similarity before recency; only when nothing matches literally). 1–2 character queries match
//   word prefixes only.
// The index is read as the table owner with an explicit workspace filter: RLS would forbid the trigram / GIN index
// quals (non-leakproof operators) and turn every query into a sequential scan (see migration 0600).
import {
  type SearchHighlight,
  type SearchMatchedField,
  type SearchMembersInput,
  type SearchMembersOutput,
  type SearchRecordHit,
  type SearchRecordsInput,
  type SearchRecordsOutput,
  searchMembersInputSchema,
  searchRecordsInputSchema,
} from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { liveEntriesOf } from '../lists/parents.ts';
import { type DefInfo, isUuid, loadDefinition, loadDefinitionsByIds } from '../schema/model.ts';
import { likeEscape } from '../sqltext.ts';
import type { Tx } from '../tx.ts';
import { SEARCHABLE_ENTITY_TYPE_LIST, SEARCHABLE_ENTITY_TYPES } from './indexer.ts';

const NONE = ['00000000-0000-0000-0000-000000000000'];
/** At most this many query words get their own "all words" condition. */
const MAX_WORDS = 6;

/** Field digit of the rank code (code = score * 10 + field). */
const FIELD_BY_DIGIT: Record<number, SearchMatchedField | null> = {
  9: 'name',
  8: 'email',
  7: 'domain',
  6: 'phone',
  5: 'handle',
  4: 'description',
  3: 'location',
  2: null, // a word of the name or of an identifier: resolved from the values
  1: null, // substring / similarity: resolved from the values
};

/**
 * Digits of a phone-like query ("+49 (151) 123", "0151-123"), else ''. Leading zeros (national trunk prefix, '00'
 * international prefix) are dropped so national input matches the stored E.164 number.
 */
export function phoneDigits(query: string): string {
  if (!/^[\d\s+().-]+$/.test(query)) return '';
  const digits = query.replace(/\D/g, '').replace(/^0+/, '');
  return digits.length >= 3 ? digits : '';
}

/** Lower-case, accent-free form of one character (JS approximation of norm_key for highlight offsets). */
function foldChar(ch: string): string {
  return ch.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Folded text plus, per folded UTF-16 unit, the offset of the source character it came from. */
function fold(value: string): { text: string; origin: number[] } {
  let text = '';
  const origin: number[] = [];
  for (let i = 0; i < value.length; ) {
    const cp = value.codePointAt(i) as number;
    const ch = String.fromCodePoint(cp);
    const folded = foldChar(ch);
    for (let k = 0; k < folded.length; k++) origin.push(i);
    text += folded;
    i += ch.length;
  }
  origin.push(value.length);
  return { text, origin };
}

/** Ranges of `needles` (folded) inside `value`, preferring word starts; merged and sorted. */
export function highlightRanges(value: string, needles: string[]): SearchHighlight[] {
  const { text, origin } = fold(value);
  const ranges: { start: number; end: number }[] = [];
  for (const needle of needles) {
    if (needle === '') continue;
    let at = -1;
    for (let from = 0; ; ) {
      const i = text.indexOf(needle, from);
      if (i < 0) break;
      if (at < 0) at = i;
      if (i === 0 || !/[\p{L}\p{N}]/u.test(text[i - 1] as string)) {
        at = i;
        break;
      }
      from = i + 1;
    }
    if (at < 0) continue;
    const start = origin[at] as number;
    const lastSource = origin[at + needle.length - 1] as number;
    const end = lastSource + (String.fromCodePoint(value.codePointAt(lastSource) as number).length || 1);
    ranges.push({ start, end });
  }
  ranges.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged.map((r) => ({ start: r.start, length: r.end - r.start }));
}

/** Phone highlights: the query digits inside a formatted number. */
function phoneRanges(value: string, digits: string): SearchHighlight[] {
  const positions: number[] = [];
  let only = '';
  for (let i = 0; i < value.length; i++) {
    if (/\d/.test(value[i] as string)) {
      positions.push(i);
      only += value[i];
    }
  }
  const at = only.indexOf(digits);
  if (at < 0 || digits === '') return [];
  const start = positions[at] as number;
  const end = (positions[at + digits.length - 1] as number) + 1;
  return [{ start, length: end - start }];
}

interface IndexRow {
  instance_id: string;
  entity_definition_id: string;
  title: string | null;
  subtitle: string | null;
  image: string | null;
  emails: string[];
  domains: string[];
  phones: string[];
  handles: string[];
  description: string;
  location: string;
}

interface Normalized {
  k: string;
  e: string;
  we: string;
  tokens: { e: string; w: string }[];
}

/** The query in index form (norm_key / search_words), computed by Postgres so both sides fold identically. */
async function normalize(tx: Tx, query: string, words: string[]): Promise<Normalized> {
  const { rows } = await sql<{ k: string; e: string; we: string; te: string[]; tw: string[] }>`
    SELECT norm_key(${query}) AS k, norm_key(${likeEscape(query)}) AS e, btrim(search_words(${query})) AS we,
      array(SELECT norm_key(x) FROM unnest(${words.map(likeEscape)}::text[]) WITH ORDINALITY u(x, n) ORDER BY n) AS te,
      array(SELECT btrim(search_words(x)) FROM unnest(${words}::text[]) WITH ORDINALITY u(x, n) ORDER BY n) AS tw`.execute(
    tx.db,
  );
  const row = rows[0] as { k: string; e: string; we: string; te: string[]; tw: string[] };
  return {
    k: row.k,
    e: row.e,
    we: row.we,
    tokens: row.te.map((e, i) => ({ e, w: row.tw[i] ?? '' })).filter((t) => t.e !== '' && t.w !== ''),
  };
}

/** Similarity threshold of the typo phase (pg_trgm default 0.6 misses one transposition in an 8-letter word). */
const TYPO_THRESHOLD = 0.55;

/**
 * Candidate ids with their rank code and similarity (best first). Two phases: literal matches (prefixes for 1–2
 * character queries, substrings / all words / phone digits otherwise); only when that finds nothing, typo candidates
 * by trigram word similarity (expensive on common trigrams, and noise next to literal hits).
 */
async function rankedIds(
  tx: Tx,
  q: Normalized,
  digits: string,
  defIds: string[],
  exclude: string[],
  limit: number,
): Promise<{ instance_id: string; code: number; sim: number }[]> {
  const ws = tx.workspaceId;
  const multi = q.tokens.length > 1;
  const tokens = q.tokens.slice(0, MAX_WORDS);
  const contains = (pattern: string) => `%${pattern}%`;
  const allWords = (column: ReturnType<typeof sql.ref>) =>
    sql.join(
      tokens.map((t) => sql`${column} LIKE ${`% ${t.w}%`}`),
      sql` AND `,
    );
  const short = q.k.length < 3;
  const exactPhone =
    digits === ''
      ? sql`false`
      : digits.length >= 7
        ? sql`(si.phone_text LIKE ${`%\n${digits}\n%`} OR si.phone_text LIKE ${`%${digits}\n%`})`
        : sql`si.phone_text LIKE ${`%\n${digits}\n%`}`;
  const wordsRef = sql.ref('si.words');
  const extraRef = sql.ref('si.both_words');
  const code = sql<number>`CASE
      WHEN si.name_key = ${q.k} THEN 10009
      WHEN si.email_text LIKE ${`%\n${q.e}\n%`} THEN 10008
      WHEN si.domain_text LIKE ${`%\n${q.e}\n%`} THEN 10007
      WHEN ${exactPhone} THEN 10006
      WHEN si.handle_text LIKE ${`%\n${q.e}\n%`} THEN 10005
      WHEN si.name_key LIKE ${`${q.e}%`} THEN 8009
      WHEN si.email_text LIKE ${`%\n${q.e}%`} THEN 8008
      WHEN si.domain_text LIKE ${`%\n${q.e}%`} THEN 8007
      WHEN ${digits !== ''} AND si.phone_text LIKE ${`%\n${digits}%`} THEN 8006
      WHEN si.handle_text LIKE ${`%\n${q.e}%`} THEN 8005
      WHEN ' ' || si.name_key LIKE ${`% ${q.e}%`} THEN 6009
      WHEN ${q.we !== ''} AND si.words LIKE ${`% ${q.we}%`} THEN 6002
      WHEN ${multi} AND ${multi ? allWords(wordsRef) : sql`false`} THEN 5502
      WHEN ${q.we !== ''} AND si.extra_words LIKE ${`% ${q.we}%`} THEN 5001
      WHEN ${multi} AND ${multi ? allWords(extraRef) : sql`false`} THEN 5001
      WHEN si.all_text LIKE ${contains(q.e)} THEN 3001
      WHEN ${digits !== ''} AND si.phone_text LIKE ${contains(digits)} THEN 3006
      ELSE 1001
    END`;
  const run = async (candidates: ReturnType<typeof sql>) => {
    const { rows } = await sql<{ instance_id: string; code: number; sim: number }>`
      SELECT r.instance_id, r.code, r.sim FROM (
        SELECT c.instance_id, c.recency_at, c.code,
          CASE WHEN c.code < 2000 THEN word_similarity(${q.k}, c.all_text) ELSE 0 END AS sim
        FROM (
          SELECT si.instance_id, si.recency_at, si.all_text, ${code} AS code
          FROM (SELECT s.*, s.words || E'\n' || s.extra_words AS both_words FROM search_index s
                WHERE s.workspace_id = ${ws}::uuid) si
          WHERE si.entity_definition_id = ANY(${defIds}::uuid[])
            AND NOT (si.instance_id = ANY(${exclude}::uuid[]))
            AND ${candidates}
        ) c
      ) r
      WHERE r.code >= 2000 OR r.sim > 0
      ORDER BY r.code / 10 DESC, r.sim DESC, r.recency_at DESC, r.instance_id DESC
      LIMIT ${limit}`.execute(tx.db);
    return rows.map((r) => ({ instance_id: r.instance_id, code: Number(r.code), sim: Number(r.sim) }));
  };

  if (short) {
    if (q.we === '') return [];
    return run(sql`si.prefixes @> ARRAY[${q.we.slice(0, 2)}]::text[]`);
  }
  const parts = [sql`si.all_text LIKE ${contains(q.e)}`];
  if (multi)
    parts.push(
      sql`(${sql.join(
        tokens.map((t) => sql`si.all_text LIKE ${contains(t.e)}`),
        sql` AND `,
      )})`,
    );
  if (digits !== '') parts.push(sql`si.all_text LIKE ${contains(digits)}`);
  if (q.we !== '' && q.we !== q.e) parts.push(sql`si.all_text LIKE ${contains(q.we)}`);
  const literal = await run(sql`(${sql.join(parts, sql` OR `)})`);
  if (literal.length > 0 || q.k.length < 4 || q.k.length > 64) return literal;
  await sql`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(TYPO_THRESHOLD)}, true)`.execute(tx.db);
  return run(sql`${q.k} <% si.all_text`);
}

async function indexRows(tx: Tx, ids: string[]): Promise<Map<string, IndexRow>> {
  if (ids.length === 0) return new Map();
  const { rows } = await sql<IndexRow>`
    SELECT instance_id, entity_definition_id, title, subtitle, image, emails, domains, phones, handles, description,
      location
    FROM search_index WHERE instance_id = ANY(${ids}::uuid[])`.execute(tx.db);
  return new Map(rows.map((r) => [r.instance_id, r]));
}

/** The field a word / substring / similarity hit came from, its value and highlight ranges. */
function resolveMatch(
  row: IndexRow,
  hint: SearchMatchedField | null,
  needles: string[],
  digits: string,
): { field: SearchMatchedField | null; value: string | null; highlights: SearchHighlight[] } {
  const candidates: { field: SearchMatchedField; values: string[] }[] = [
    { field: 'name', values: row.title ? [row.title] : [] },
    { field: 'email', values: row.emails },
    { field: 'domain', values: row.domains },
    { field: 'phone', values: row.phones },
    { field: 'handle', values: row.handles },
    { field: 'description', values: row.description ? [row.description] : [] },
    { field: 'location', values: row.location ? [row.location] : [] },
  ];
  const ordered = hint ? [...candidates.filter((c) => c.field === hint), ...candidates] : candidates;
  for (const { field, values } of ordered) {
    for (const value of values) {
      const highlights =
        field === 'phone' ? (digits ? phoneRanges(value, digits) : []) : highlightRanges(value, needles);
      if (highlights.length > 0) return { field, value, highlights };
    }
  }
  if (hint) {
    const values = candidates.find((c) => c.field === hint)?.values ?? [];
    return { field: hint, value: values[0] ?? null, highlights: [] };
  }
  return { field: null, value: null, highlights: [] };
}

/** List memberships of `recordIds` in lists the caller may read (sidebar order). */
async function membershipsOf(
  tx: Tx,
  recordIds: string[],
  readable: (defs: DefInfo[]) => Promise<DefInfo[]>,
): Promise<Map<string, SearchRecordHit['lists']>> {
  const out = new Map<string, SearchRecordHit['lists']>(recordIds.map((id) => [id, []]));
  const entries = await liveEntriesOf(tx, recordIds);
  if (entries.length === 0) return out;
  const listIds = [...new Set(entries.map((e) => e.listId))];
  const lists = await tx.db
    .selectFrom('collections')
    .select(['id', 'name', 'icon', 'sort_order'])
    .where('id', 'in', listIds)
    .where('deleted_at', 'is', null)
    .orderBy('sort_order')
    .orderBy('id')
    .execute();
  const defs = await loadDefinitionsByIds(
    tx,
    lists.map((l) => l.id),
  );
  const allowed = new Set((await readable([...defs.values()])).map((d) => d.id));
  for (const list of lists) {
    if (!allowed.has(list.id)) continue;
    const byRecord = new Map<string, string[]>();
    for (const e of entries) {
      if (e.listId === list.id) byRecord.set(e.recordId, [...(byRecord.get(e.recordId) ?? []), e.entryId]);
    }
    for (const [recordId, entryIds] of byRecord) {
      out.get(recordId)?.push({ listId: list.id, name: list.name, icon: list.icon, entryIds });
    }
  }
  return out;
}

export const searchOps = {
  /**
   * Ranked record search. `readable` keeps the definitions the caller may read (permission hook); definitions
   * named explicitly but unreadable are dropped the same way, so the result never leaks them. Lists in the hits are
   * filtered with the same hook.
   */
  async records(
    tx: Tx,
    input: SearchRecordsInput,
    readable: (defs: DefInfo[]) => Promise<DefInfo[]>,
  ): Promise<SearchRecordsOutput> {
    const data = searchRecordsInputSchema.parse(input);
    const requestSeq = data.requestSeq ?? null;
    let defs: DefInfo[];
    if (data.entityDefinitionIds) {
      defs = [];
      for (const ref of new Set(data.entityDefinitionIds)) defs.push(await loadDefinition(tx, ref));
    } else {
      const rows = await tx.db
        .selectFrom('entity_definitions')
        .select('id')
        .where('entity_type', 'in', SEARCHABLE_ENTITY_TYPE_LIST)
        .where('is_archived', '=', false)
        .execute();
      defs = [
        ...(
          await loadDefinitionsByIds(
            tx,
            rows.map((r) => r.id),
          )
        ).values(),
      ];
    }
    defs = (
      await readable(defs.filter((d) => d.projectionTable !== null && SEARCHABLE_ENTITY_TYPES.has(d.entityType)))
    ).filter((d) => !d.isArchived);
    if (defs.length === 0) return { requestSeq, hits: [], groups: [] };

    const defIds = defs.map((d) => d.id);
    const exclude = data.excludeIds?.length ? data.excludeIds.map((id) => id.toLowerCase()) : NONE;
    const query = data.query.trim();
    const digits = phoneDigits(query);
    let ranked: { instance_id: string; code: number; sim: number }[];
    let needles: string[] = [];
    if (query === '') {
      // Default set of an empty query: the most recently updated records.
      ranked = await tx.asOwner(async () => {
        const { rows } = await sql<{ instance_id: string }>`
          SELECT si.instance_id FROM search_index si
          WHERE si.workspace_id = ${tx.workspaceId}::uuid AND si.entity_definition_id = ANY(${defIds}::uuid[])
            AND NOT (si.instance_id = ANY(${exclude}::uuid[]))
          ORDER BY si.recency_at DESC, si.instance_id DESC
          LIMIT ${data.limit}`.execute(tx.db);
        return rows.map((r) => ({ instance_id: r.instance_id, code: 0, sim: 0 }));
      });
    } else if (isUuid(query)) {
      const id = query.toLowerCase();
      const { rows } = await sql<{ instance_id: string }>`
        SELECT instance_id FROM search_index
        WHERE instance_id = ${id}::uuid AND entity_definition_id = ANY(${defIds}::uuid[])
          AND NOT (instance_id = ANY(${exclude}::uuid[]))`.execute(tx.db);
      ranked = rows.map((r) => ({ instance_id: r.instance_id, code: 20000, sim: 0 }));
    } else {
      const words = query.split(/\s+/).filter((w) => w !== '');
      const q = await normalize(tx, query, words);
      if (q.k === '') return { requestSeq, hits: [], groups: [] };
      needles = [...new Set([q.k, ...q.tokens.map((t) => t.w), ...q.tokens.flatMap((t) => t.w.split(' '))])].filter(
        (n) => n !== '',
      );
      ranked = await tx.asOwner(() => rankedIds(tx, q, digits, defIds, exclude, data.limit));
    }

    const ids = ranked.map((r) => r.instance_id);
    const [rows, lists] = await Promise.all([indexRows(tx, ids), membershipsOf(tx, ids, readable)]);
    const hits: SearchRecordHit[] = [];
    for (const r of ranked) {
      const row = rows.get(r.instance_id);
      if (!row) continue;
      const tier = Math.floor(r.code / 10);
      const score = r.code === 0 ? 0 : tier === 100 ? 100 + r.sim * 100 : tier;
      let field: SearchMatchedField | null = null;
      let value: string | null = null;
      let highlights: SearchHighlight[] = [];
      if (r.code >= 20000) {
        field = 'record-id';
        value = row.instance_id;
        highlights = [{ start: 0, length: row.instance_id.length }];
      } else if (r.code > 0) {
        const m = resolveMatch(row, FIELD_BY_DIGIT[r.code % 10] ?? null, needles, digits);
        ({ field, value, highlights } = m);
      }
      hits.push({
        entityDefinitionId: row.entity_definition_id,
        entityInstanceId: row.instance_id,
        title: row.title,
        subtitle: row.subtitle,
        avatar: row.image,
        score: Math.round(score * 100) / 100,
        matchedField: field,
        matchedValue: value,
        highlights,
        emailAddresses: row.emails,
        phoneNumbers: row.phones,
        domains: row.domains,
        lists: lists.get(row.instance_id) ?? [],
      });
    }
    const groups = new Map<string, string[]>();
    for (const h of hits)
      groups.set(h.entityDefinitionId, [...(groups.get(h.entityDefinitionId) ?? []), h.entityInstanceId]);
    return {
      requestSeq,
      hits,
      groups: [...groups].map(([entityDefinitionId, entityInstanceIds]) => ({ entityDefinitionId, entityInstanceIds })),
    };
  },

  /** Workspace members by name or email (actor pickers, "With" filters); suspended members only on request. */
  async members(tx: Tx, input: SearchMembersInput): Promise<SearchMembersOutput> {
    const data = searchMembersInputSchema.parse(input);
    const query = data.query.trim();
    type Row = {
      id: string;
      first_name: string;
      last_name: string;
      email_address: string;
      access_level: 'admin' | 'member' | 'suspended';
      score: number;
    };
    const { rows } = await sql<Row>`
      WITH q AS (SELECT norm_key(${query}) AS k, norm_key(${likeEscape(query)}) AS e)
      SELECT * FROM (
        SELECT m.id, m.first_name, m.last_name, m.email_address, m.access_level,
          (CASE
             WHEN q.k = '' THEN 0
             WHEN norm_key(trim(m.first_name || ' ' || m.last_name)) = q.k THEN 1000
             WHEN norm_key(trim(m.first_name || ' ' || m.last_name)) LIKE q.e || '%' THEN 800
             WHEN norm_key(m.last_name) LIKE q.e || '%' THEN 700
             WHEN lower(m.email_address) LIKE q.e || '%' THEN 600
             WHEN norm_key(m.first_name || ' ' || m.last_name) LIKE '%' || q.e || '%'
               OR lower(m.email_address) LIKE '%' || q.e || '%' THEN 300
             ELSE 0
           END)::float8 AS score,
          norm_key(trim(m.first_name || ' ' || m.last_name)) COLLATE "C" AS name_key
        FROM workspace_members m CROSS JOIN q
        WHERE (${data.includeSuspended} OR m.access_level <> 'suspended')
      ) s
      WHERE ${query} = '' OR s.score > 0
      ORDER BY s.score DESC, s.name_key, s.id
      LIMIT ${data.limit}`.execute(tx.db);
    return {
      hits: rows.map((r) => ({
        id: r.id,
        firstName: r.first_name,
        lastName: r.last_name,
        emailAddress: r.email_address,
        accessLevel: r.access_level,
        score: Number(r.score),
      })),
    };
  },
};
