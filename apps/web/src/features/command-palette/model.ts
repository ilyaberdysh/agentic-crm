// The palette's rows: pure functions from the sources — favorites, objects, lists, context
// and workspace actions, record hits — and the query to the ordered, sectioned list. The UI renders the payloads.
import type { SearchRecordHit } from '@agentic-crm/contracts';
import type { ObjectSummary } from '../../data/objects';
import type { Favorite } from '../favorites/data';
import type { List } from '../lists/data';
import type { PaletteAction, PaletteContext } from './contexts';
import { fuzzyFilter } from './fuzzy';

export type RowPayload =
  | { type: 'action'; action: PaletteAction; contextId: string | null }
  | { type: 'jump-favorite'; favorite: Favorite }
  | { type: 'jump-object'; object: ObjectSummary }
  | { type: 'jump-list'; list: List }
  | { type: 'record'; hit: SearchRecordHit }
  /** 'See more results for "q"' → the Search page. */
  | { type: 'more'; query: string }
  /** 'Search for "q" in records' → the Search page. */
  | { type: 'search-in'; query: string }
  | { type: 'create-record'; query: string };

export interface PaletteRow {
  key: string;
  section: string;
  payload: RowPayload;
}

/** Jump To takes the first three matches of favorites, then objects, then lists. */
export const JUMP_TO_LIMIT = 3;
/** Record hits shown in the Search section; "See more" appears beyond five. */
export const SEARCH_ROWS_LIMIT = 10;
export const SEE_MORE_THRESHOLD = 5;

export interface RootSources {
  query: string;
  favorites: readonly Favorite[];
  objects: readonly ObjectSummary[];
  lists: readonly List[];
  contexts: readonly PaletteContext[];
  quick: readonly PaletteAction[];
  help: readonly PaletteAction[];
  /** Hits of the newest applied search response (null = none yet). */
  hits: readonly SearchRecordHit[] | null;
}

/** Favorites that Jump To offers: not reports, not forbidden, not deleted. */
function jumpableFavorites(favorites: readonly Favorite[]): Favorite[] {
  return favorites.filter(
    (f) =>
      f.favoriteType !== 'report' &&
      f.favoriteType !== 'reporting-dashboard' &&
      f.target.state === 'ok' &&
      Boolean(f.target.label),
  );
}

export function jumpToRows(sources: Pick<RootSources, 'query' | 'favorites' | 'objects' | 'lists'>): PaletteRow[] {
  const query = sources.query.trim();
  if (!query) return [];
  const rows: PaletteRow[] = [];
  const favorites = fuzzyFilter(jumpableFavorites(sources.favorites), query, (f) => ({ title: f.target.label ?? '' }));
  for (const { item } of favorites) {
    rows.push({ key: `jump:fav:${item.id}`, section: 'Jump To', payload: { type: 'jump-favorite', favorite: item } });
  }
  const objects = fuzzyFilter(sources.objects, query, (o) => ({
    title: o.pluralNoun,
    keywords: [o.singularNoun],
  }));
  for (const { item } of objects) {
    rows.push({ key: `jump:object:${item.id}`, section: 'Jump To', payload: { type: 'jump-object', object: item } });
  }
  const lists = fuzzyFilter(sources.lists, query, (l) => ({ title: l.name }));
  for (const { item } of lists) {
    rows.push({ key: `jump:list:${item.id}`, section: 'Jump To', payload: { type: 'jump-list', list: item } });
  }
  return rows.slice(0, JUMP_TO_LIMIT);
}

function actionRows(
  actions: readonly PaletteAction[],
  query: string,
  section: string,
  contextId: string | null,
): PaletteRow[] {
  const q = query.trim();
  const visible = q
    ? fuzzyFilter(actions, q, (a) => ({ title: a.title, keywords: a.keywords })).map((m) => m.item)
    : actions.filter((a) => !a.searchOnly);
  return visible.map((action) => ({
    key: `action:${contextId ?? 'ws'}:${action.id}`,
    section,
    payload: { type: 'action', action, contextId },
  }));
}

/** The Search section of the root page and the rows of the Search page share their record rows. */
export function recordRows(hits: readonly SearchRecordHit[], section: string): PaletteRow[] {
  return hits.slice(0, SEARCH_ROWS_LIMIT).map((hit) => ({
    key: `record:${hit.entityInstanceId}`,
    section,
    payload: { type: 'record', hit },
  }));
}

/** Rows of the Quick actions page in display order. */
export function buildRootRows(sources: RootSources): PaletteRow[] {
  const q = sources.query.trim();
  const rows: PaletteRow[] = [];
  // (Meetings arrive with: today's meetings that have not ended, empty query only.)
  rows.push(...jumpToRows(sources));
  for (const context of sources.contexts) rows.push(...actionRows(context.actions, q, context.title, context.id));
  rows.push(...actionRows(sources.quick, q, 'Quick Action', null));
  rows.push(...actionRows(sources.help, q, 'Help', null));
  if (q) {
    const hits = sources.hits ?? [];
    rows.push(...recordRows(hits, 'Search'));
    if (hits.length > SEE_MORE_THRESHOLD) {
      rows.push({ key: 'more', section: 'Search', payload: { type: 'more', query: q } });
    } else if (hits.length > 0) {
      rows.push({ key: 'search-in', section: 'Search', payload: { type: 'search-in', query: q } });
    }
    rows.push({ key: 'create-record', section: 'Search', payload: { type: 'create-record', query: q } });
  }
  return rows;
}

/** URL-like queries are reduced to their hostname before searching. */
export function searchTermOf(query: string): string {
  const q = query.trim();
  if (!/^(https?:\/\/|www\.)\S+$/i.test(q)) return q;
  try {
    return new URL(/^https?:\/\//i.test(q) ? q : `https://${q}`).hostname.replace(/^www\./i, '');
  } catch {
    return q;
  }
}
